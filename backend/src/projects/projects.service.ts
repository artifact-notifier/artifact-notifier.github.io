import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Ecosystem } from '@prisma/client';
import { ArtifactsService } from '../artifacts/artifacts.service';
import { normalizeCoordinates } from '../artifacts/coordinates';
import { PrismaService } from '../prisma/prisma.service';
import { compareVersions } from '../artifacts/versions';
import { ImportDto, UpdateProjectDto } from './projects.dto';

const MAX_PROJECTS_PER_USER = 100;
// follows resolve versions from the registries: a few at a time
const FOLLOW_CONCURRENCY = 6;

const key = (ecosystem: Ecosystem, coordinates: string) => `${ecosystem}:${coordinates}`;

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly artifacts: ArtifactsService,
  ) {}

  /** Projects with every dependency and whether (and as which follow) it is followed. */
  async list(userId: string) {
    const [projects, follows] = await Promise.all([
      this.prisma.project.findMany({
        where: { userId },
        orderBy: { name: 'asc' },
        include: {
          sources: { orderBy: { label: 'asc' }, include: { dependencies: { orderBy: { coordinates: 'asc' } } } },
        },
      }),
      this.prisma.followedArtifact.findMany({
        where: { userId },
        select: { id: true, ecosystem: true, coordinates: true, currentVersion: true },
      }),
    ]);
    const followed = new Map(follows.map((f) => [key(f.ecosystem, f.coordinates), f]));
    return projects.map((p) => ({
      id: p.id,
      name: p.name,
      notifyNewerOnly: p.notifyNewerOnly,
      createdAt: p.createdAt,
      sources: p.sources.map((s) => ({
        id: s.id,
        label: s.label,
        kind: s.kind,
        ecosystem: s.ecosystem,
        updatedAt: s.updatedAt,
        dependencies: s.dependencies.map((d) => {
          const f = followed.get(key(s.ecosystem, d.coordinates));
          return {
            coordinates: d.coordinates,
            declared: d.declared,
            version: d.version,
            scope: d.scope,
            followedArtifactId: f?.id ?? null,
            latestVersion: f?.currentVersion ?? null,
            // only exact versions (lockfile, pins) can be compared
            outdated: !!(f?.currentVersion && d.version && compareVersions(f.currentVersion, d.version) > 0),
          };
        }),
      })),
    }));
  }

  async import(userId: string, dto: ImportDto) {
    const project = await this.resolveProject(userId, dto);
    const replaced = await this.artifactKeys({
      projectId: project.id,
      label: { in: dto.sources.map((s) => s.label) },
    });

    await this.prisma.$transaction(async (tx) => {
      for (const s of dto.sources) {
        const source = await tx.projectSource.upsert({
          where: { projectId_label: { projectId: project.id, label: s.label } },
          create: { projectId: project.id, label: s.label, kind: s.kind, ecosystem: s.ecosystem },
          update: { kind: s.kind, ecosystem: s.ecosystem },
        });
        // a re-import replaces the source's dependency list
        await tx.projectDependency.deleteMany({ where: { sourceId: source.id } });
        const deps = new Map<string, (typeof s.dependencies)[number]>();
        for (const d of s.dependencies) deps.set(normalizeCoordinates(s.ecosystem, d.coordinates), d);
        await tx.projectDependency.createMany({
          data: [...deps].map(([coordinates, d]) => ({
            sourceId: source.id,
            coordinates,
            declared: d.declared ?? null,
            version: d.version ?? null,
            scope: d.scope,
          })),
        });
      }
    });

    const { followed, failed } = await this.followAll(userId, dto.follow);
    return { projectId: project.id, followed, failed, orphans: await this.orphans(userId, replaced) };
  }

  async update(userId: string, id: string, dto: UpdateProjectDto) {
    await this.owned(userId, id);
    try {
      return await this.prisma.project.update({
        where: { id },
        data: { name: dto.name?.trim(), notifyNewerOnly: dto.notifyNewerOnly },
      });
    } catch (e: any) {
      if (e?.code === 'P2002') throw new ConflictException('A project with this name already exists');
      throw e;
    }
  }

  /** Deletes the project only: its artifacts stay followed (the orphans are returned, to offer unfollowing). */
  async remove(userId: string, id: string) {
    await this.owned(userId, id);
    const keys = await this.artifactKeys({ projectId: id });
    await this.prisma.project.delete({ where: { id } });
    return { orphans: await this.orphans(userId, keys) };
  }

  async removeSource(userId: string, projectId: string, sourceId: string) {
    await this.owned(userId, projectId);
    const keys = await this.artifactKeys({ id: sourceId, projectId });
    const { count } = await this.prisma.projectSource.deleteMany({ where: { id: sourceId, projectId } });
    if (!count) throw new NotFoundException('Source not found');
    return { orphans: await this.orphans(userId, keys) };
  }

  /** Artifact keys referenced by the matching sources. */
  private async artifactKeys(where: { projectId: string; id?: string; label?: { in: string[] } }) {
    const sources = await this.prisma.projectSource.findMany({ where, include: { dependencies: true } });
    return new Set(sources.flatMap((s) => s.dependencies.map((d) => key(s.ecosystem, d.coordinates))));
  }

  /**
   * Among `formerly` (artifacts some project referenced), the follows no project of
   * the user references any more: no longer used, so the user may want to drop them.
   */
  private async orphans(userId: string, formerly: Set<string>) {
    if (!formerly.size) return [];
    const [follows, stillUsed] = await Promise.all([
      this.prisma.followedArtifact.findMany({
        where: { userId },
        select: { id: true, ecosystem: true, coordinates: true },
      }),
      this.prisma.projectSource.findMany({
        where: { project: { userId } },
        select: { ecosystem: true, dependencies: { select: { coordinates: true } } },
      }),
    ]);
    const used = new Set(stillUsed.flatMap((s) => s.dependencies.map((d) => key(s.ecosystem, d.coordinates))));
    return follows
      .filter((f) => formerly.has(key(f.ecosystem, f.coordinates)) && !used.has(key(f.ecosystem, f.coordinates)))
      .map((f) => ({ followedArtifactId: f.id, ecosystem: f.ecosystem, coordinates: f.coordinates }));
  }

  private async resolveProject(userId: string, dto: ImportDto) {
    if (dto.projectId) return this.owned(userId, dto.projectId);
    const name = dto.projectName?.trim();
    if (!name) throw new BadRequestException('projectId or projectName required');
    if (await this.prisma.project.findUnique({ where: { userId_name: { userId, name } } })) {
      throw new ConflictException('A project with this name already exists');
    }
    if ((await this.prisma.project.count({ where: { userId } })) >= MAX_PROJECTS_PER_USER) {
      throw new ConflictException(`At most ${MAX_PROJECTS_PER_USER} projects`);
    }
    return this.prisma.project.create({ data: { userId, name } });
  }

  private async owned(userId: string, id: string) {
    const project = await this.prisma.project.findFirst({ where: { id, userId } });
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  private async followAll(userId: string, refs: { ecosystem: Ecosystem; coordinates: string }[]) {
    const queue = [
      ...new Map(refs.map((r) => [key(r.ecosystem, normalizeCoordinates(r.ecosystem, r.coordinates)), r])).values(),
    ];
    let followed = 0;
    const failed: { ecosystem: Ecosystem; coordinates: string; reason: string }[] = [];
    const worker = async () => {
      for (let r = queue.shift(); r; r = queue.shift()) {
        try {
          await this.artifacts.follow(userId, r.ecosystem, r.coordinates);
          followed++;
        } catch (e) {
          failed.push({ ...r, reason: (e as Error).message });
        }
      }
    };
    await Promise.all(Array.from({ length: FOLLOW_CONCURRENCY }, worker));
    return { followed, failed };
  }
}
