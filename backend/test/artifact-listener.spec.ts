import { ConfigService } from '@nestjs/config';
import { Ecosystem, PrismaClient } from '@prisma/client';
import { ArtifactsService } from '../src/artifacts/artifacts.service';
import { PublishedVersion } from '../src/artifacts/version-sources';
import { ArtifactListener } from '../src/listeners/artifact-listener.base';
import { createUser, resetDb } from './db';

const prisma = new PrismaClient();
const artifacts = new ArtifactsService(prisma as any, new ConfigService({}));
const notifications = { onNewVersion: jest.fn() };

/** Exposes the shared diff/notify logic without any polling. */
class TestListener extends ArtifactListener<number> {
  readonly ecosystem = Ecosystem.MAVEN;
  defaultSequence = 0;
  constructor() {
    super(artifacts, notifications as any, prisma as any);
  }
  async sync() {}
  handle(versions: string[], complete = true) {
    return this.handleVersions(
      C,
      versions.map((version): PublishedVersion => ({ version })),
      complete,
    );
  }
}

const C = 'org.springframework.boot:spring-boot';
const notified = () => notifications.onNewVersion.mock.calls.map(([, userId, , , version]) => `${userId}:${version}`);

let listener: TestListener;

beforeEach(async () => {
  await resetDb(prisma);
  notifications.onNewVersion.mockReset();
  await createUser(prisma, 'stable');
  await createUser(prisma, 'pre', { includePrereleases: true });
  for (const userId of ['stable', 'pre']) {
    await prisma.followedArtifact.create({
      data: { userId, ecosystem: 'MAVEN', coordinates: C, currentVersion: '4.1.1' },
    });
  }
  listener = new TestListener();
  await listener.refreshFollowed();
});
afterAll(() => prisma.$disconnect());

describe('ArtifactListener.handleVersions', () => {
  it('records a first full list silently (baseline)', async () => {
    await listener.handle(['4.0.8', '4.1.1']);
    expect(notified()).toEqual([]);
    expect([...(await artifacts.getKnownVersions(Ecosystem.MAVEN, C))].sort()).toEqual(['4.0.8', '4.1.1']);
  });

  it('notifies every new version, patches of older lines included, prereleases on opt-in', async () => {
    await listener.handle(['4.0.8', '4.1.1']);
    await listener.handle(['4.0.8', '4.0.9', '4.1.1', '4.1.2', '4.2.0-RC1']);

    expect(notified()).toEqual(['stable:4.0.9', 'stable:4.1.2', 'pre:4.0.9', 'pre:4.1.2', 'pre:4.2.0-RC1']);
    const current = await prisma.followedArtifact.findMany({ where: { coordinates: C }, orderBy: { userId: 'asc' } });
    // a patch of an older line never lowers currentVersion
    expect(current.map((f) => `${f.userId}:${f.currentVersion}`)).toEqual(['pre:4.2.0-RC1', 'stable:4.1.2']);
  });

  it('does not notify the same version twice', async () => {
    await listener.handle(['4.1.1']);
    await listener.handle(['4.1.1', '4.1.2']);
    await listener.handle(['4.1.1', '4.1.2']);
    expect(notified()).toEqual(['stable:4.1.2', 'pre:4.1.2']);
  });

  it('keeps a version "new" until every follower was notified', async () => {
    await listener.handle(['4.1.1']);
    notifications.onNewVersion.mockImplementation(async (_fa: string, userId: string) => {
      if (userId === 'stable') throw new Error('database is locked');
    });
    await listener.handle(['4.1.1', '4.1.2']);
    expect((await artifacts.getKnownVersions(Ecosystem.MAVEN, C)).has('4.1.2')).toBe(false);

    notifications.onNewVersion.mockReset();
    await listener.handle(['4.1.1', '4.1.2']);
    expect(notified()).toContain('stable:4.1.2');
    expect((await artifacts.getKnownVersions(Ecosystem.MAVEN, C)).has('4.1.2')).toBe(true);
  });

  it('notifies single feed events without a baseline', async () => {
    await listener.handle(['4.1.2'], false);
    expect(notified()).toEqual(['stable:4.1.2', 'pre:4.1.2']);
  });

  describe('projects asking for newer versions only', () => {
    async function useIn(userId: string, version: string | null, newerOnly: boolean) {
      const project = await prisma.project.create({
        data: { userId, name: `p-${userId}-${version}`, notifyNewerOnly: newerOnly },
      });
      const source = await prisma.projectSource.create({
        data: { projectId: project.id, label: 'pom.xml', kind: 'pom.xml', ecosystem: 'MAVEN' },
      });
      await prisma.projectDependency.create({ data: { sourceId: source.id, coordinates: C, version, scope: 'prod' } });
    }

    it('skips versions not newer than the one used', async () => {
      await useIn('stable', '4.1.2', true);
      await listener.refreshFollowed();
      await listener.handle(['4.1.1']);
      await listener.handle(['4.1.1', '4.0.10', '4.1.3']);
      expect(notified().filter((n) => n.startsWith('stable:'))).toEqual(['stable:4.1.3']);
    });

    it('notifies when one of the projects did not ask for it, or the used version is unknown', async () => {
      await useIn('stable', '4.1.2', true);
      await useIn('stable', '4.0.9', false);
      await useIn('pre', null, true);
      await listener.refreshFollowed();
      await listener.handle(['4.1.1']);
      await listener.handle(['4.1.1', '4.0.10']);
      expect(notified()).toEqual(['stable:4.0.10', 'pre:4.0.10']);
    });
  });
});
