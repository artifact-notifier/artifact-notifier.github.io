import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { bearer, createTestApp } from './app';
import { createUser, resetDb } from './db';

const prisma = new PrismaClient();
let app: INestApplication;
let auth: Record<string, string>;

/** Registries answer with a fixed version list (follow() resolves the current version). */
function mockRegistries() {
  return jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes('maven-metadata.xml')) {
      return new Response(
        '<metadata><versioning><versions><version>4.1.2</version></versions></versioning></metadata>',
      );
    }
    if (url.startsWith('https://registry.npmjs.org/'))
      return new Response(JSON.stringify({ versions: { '22.2.3': {} } }));
    if (url.startsWith('https://pypi.org/')) return new Response(JSON.stringify({ releases: { '6.1.2': [] } }));
    return new Response('', { status: 404 });
  });
}

const FRONT = {
  label: 'front/package.json',
  kind: 'package.json',
  ecosystem: 'NPM',
  dependencies: [
    { coordinates: '@angular/core', declared: '^22.2.0', version: '22.2.3', scope: 'prod' },
    { coordinates: 'vitest', declared: '^5.0.0', scope: 'dev' },
  ],
};
const BACK = {
  label: 'back/pom.xml',
  kind: 'pom.xml',
  ecosystem: 'MAVEN',
  dependencies: [
    { coordinates: 'org.springframework.boot:spring-boot-starter-parent', version: '4.1.2', scope: 'parent' },
    { coordinates: 'org.junit.jupiter:junit-jupiter', scope: 'test' },
    // a sibling module of the same reactor
    { coordinates: 'com.acme:shop-api', version: '1.0.0', scope: 'module' },
  ],
};

beforeAll(async () => {
  app = await createTestApp();
});

beforeEach(async () => {
  await resetDb(prisma);
  await createUser(prisma, 'u1');
  auth = bearer(app, { id: 'u1', email: 'u1@example.test' });
  mockRegistries();
});

afterEach(() => jest.restoreAllMocks());

afterAll(async () => {
  await app?.close();
  await prisma.$disconnect();
});

const api = () => request(app.getHttpServer());
const importProject = (body: object, as = auth) => api().post('/api/projects/import').set(as).send(body);
const projects = async () => (await api().get('/api/projects').set(auth)).body;

describe('projects import', () => {
  it('creates a project with its sources and follows the checked dependencies only', async () => {
    const res = await importProject({
      projectName: 'monorepo',
      sources: [FRONT, BACK],
      follow: [
        { ecosystem: 'NPM', coordinates: '@angular/core' },
        { ecosystem: 'MAVEN', coordinates: 'org.springframework.boot:spring-boot-starter-parent' },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ followed: 2, failed: [] });

    const [p] = await projects();
    expect(p.name).toBe('monorepo');
    expect(p.sources.map((s: any) => s.label)).toEqual(['back/pom.xml', 'front/package.json']);
    const front = p.sources.find((s: any) => s.label === 'front/package.json');
    expect(front.dependencies).toEqual([
      expect.objectContaining({
        coordinates: '@angular/core',
        version: '22.2.3',
        scope: 'prod',
        latestVersion: '22.2.3',
      }),
      expect.objectContaining({ coordinates: 'vitest', followedArtifactId: null, latestVersion: null }),
    ]);
    expect(front.dependencies[0].followedArtifactId).toEqual(expect.any(String));
    expect(await prisma.followedArtifact.count({ where: { userId: 'u1' } })).toBe(2);
  });

  it('follows an artifact shared by two projects only once', async () => {
    const follow = [{ ecosystem: 'NPM', coordinates: '@angular/core' }];
    await importProject({ projectName: 'a', sources: [FRONT], follow });
    await importProject({ projectName: 'b', sources: [FRONT], follow });
    expect(await prisma.followedArtifact.count({ where: { userId: 'u1' } })).toBe(1);
    const all = await projects();
    expect(all.map((p: any) => p.sources[0].dependencies[0].followedArtifactId)).toEqual([
      all[0].sources[0].dependencies[0].followedArtifactId,
      all[0].sources[0].dependencies[0].followedArtifactId,
    ]);
  });

  it('re-importing a source replaces its dependencies and leaves the other sources alone', async () => {
    const { projectId } = (await importProject({ projectName: 'p', sources: [FRONT, BACK], follow: [] })).body;
    const res = await importProject({
      projectId,
      sources: [{ ...FRONT, dependencies: [{ coordinates: 'rxjs', declared: '~7.8.0', scope: 'prod' }] }],
      follow: [],
    });
    expect(res.status).toBe(201);
    const [p] = await projects();
    expect(
      p.sources.find((s: any) => s.label === 'front/package.json').dependencies.map((d: any) => d.coordinates),
    ).toEqual(['rxjs']);
    expect(p.sources.find((s: any) => s.label === 'back/pom.xml').dependencies).toHaveLength(3);
  });

  it('matches PyPI names whatever their spelling (PEP 503)', async () => {
    await api().post('/api/artifacts/follow').set(auth).send({ ecosystem: 'PYPI', coordinates: 'Zope.Interface' });
    await importProject({
      projectName: 'py',
      sources: [
        {
          label: 'requirements.txt',
          kind: 'requirements.txt',
          ecosystem: 'PYPI',
          dependencies: [{ coordinates: 'zope_interface', declared: '>=6', scope: 'prod' }],
        },
      ],
      follow: [{ ecosystem: 'PYPI', coordinates: 'ZOPE-interface' }],
    });
    const follows = await prisma.followedArtifact.findMany({ where: { userId: 'u1' } });
    expect(follows.map((f) => f.coordinates)).toEqual(['zope-interface']);
    const [p] = await projects();
    expect(p.sources[0].dependencies[0]).toMatchObject({
      coordinates: 'zope-interface',
      followedArtifactId: follows[0].id,
    });
  });

  it('reports follows that failed without failing the import', async () => {
    await prisma.followedArtifact.createMany({
      data: Array.from({ length: 500 }, (_, i) => ({ userId: 'u1', ecosystem: 'TEST' as const, coordinates: `p${i}` })),
    });
    const res = await importProject({
      projectName: 'full',
      sources: [FRONT],
      follow: [{ ecosystem: 'NPM', coordinates: '@angular/core' }],
    });
    expect(res.status).toBe(201);
    expect(res.body.followed).toBe(0);
    expect(res.body.failed).toEqual([
      expect.objectContaining({ coordinates: '@angular/core', reason: expect.stringContaining('500') }),
    ]);
    expect((await projects())[0].sources[0].dependencies).toHaveLength(2);
  });
});

describe('large multi-module projects', () => {
  it('imports 120 modules with their dependencies (well over the default 100kb body)', async () => {
    const sources = Array.from({ length: 120 }, (_, m) => ({
      label: `modules/module-${m}/pom.xml`,
      kind: 'pom.xml',
      ecosystem: 'MAVEN',
      dependencies: Array.from({ length: 25 }, (_, d) => ({
        coordinates: `com.acme.module${m}:artifact-number-${d}`,
        declared: '${project.version}',
        version: '1.0.0-SNAPSHOT',
        scope: 'module',
      })),
    }));
    const body = { projectName: 'monorepo', sources, follow: [] };
    expect(JSON.stringify(body).length).toBeGreaterThan(300_000);
    const res = await importProject(body);
    expect(res.status).toBe(201);
    expect((await projects())[0].sources).toHaveLength(120);
  });

  it('still refuses absurd payloads', async () => {
    const sources = Array.from({ length: 501 }, (_, m) => ({
      label: `m${m}`,
      kind: 'pom.xml',
      ecosystem: 'MAVEN',
      dependencies: [],
    }));
    expect((await importProject({ projectName: 'too-big', sources, follow: [] })).status).toBe(400);
  });
});

describe('projects validation and ownership', () => {
  it('rejects a duplicate name, a missing target and invalid payloads', async () => {
    await importProject({ projectName: 'p', sources: [], follow: [] });
    expect((await importProject({ projectName: 'p', sources: [], follow: [] })).status).toBe(409);
    expect((await importProject({ sources: [], follow: [] })).status).toBe(400);
    const badScope = { ...FRONT, dependencies: [{ coordinates: 'x', scope: 'transitive' }] };
    expect((await importProject({ projectName: 'q', sources: [badScope], follow: [] })).status).toBe(400);
    const testEco = { ...FRONT, ecosystem: 'TEST' };
    expect((await importProject({ projectName: 'q', sources: [testEco], follow: [] })).status).toBe(400);
    const badCoords = { ...FRONT, dependencies: [{ coordinates: '<script>', scope: 'prod' }] };
    expect((await importProject({ projectName: 'q', sources: [badCoords], follow: [] })).status).toBe(400);
  });

  it("keeps other users' projects out of reach", async () => {
    await createUser(prisma, 'u2');
    const other = bearer(app, { id: 'u2', email: 'u2@example.test' });
    const { projectId } = (await importProject({ projectName: 'mine', sources: [FRONT], follow: [] })).body;

    expect(await (await api().get('/api/projects').set(other)).body).toEqual([]);
    expect((await importProject({ projectId, sources: [], follow: [] }, other)).status).toBe(404);
    expect((await api().patch(`/api/projects/${projectId}`).set(other).send({ name: 'x' })).status).toBe(404);
    expect((await api().delete(`/api/projects/${projectId}`).set(other)).status).toBe(404);
    expect((await api().get('/api/projects')).status).toBe(401);
  });
});

describe('projects management', () => {
  it('renames, refusing a name already used', async () => {
    const { projectId } = (await importProject({ projectName: 'a', sources: [], follow: [] })).body;
    await importProject({ projectName: 'b', sources: [], follow: [] });
    expect((await api().patch(`/api/projects/${projectId}`).set(auth).send({ name: 'b' })).status).toBe(409);
    expect((await api().patch(`/api/projects/${projectId}`).set(auth).send({ name: ' c ' })).body.name).toBe('c');
  });

  it('deletes a project or a source but keeps the follows', async () => {
    const { projectId } = (
      await importProject({
        projectName: 'p',
        sources: [FRONT, BACK],
        follow: [{ ecosystem: 'NPM', coordinates: '@angular/core' }],
      })
    ).body;
    const [p] = await projects();
    const back = p.sources.find((s: any) => s.label === 'back/pom.xml');

    expect((await api().delete(`/api/projects/${projectId}/sources/${back.id}`).set(auth)).status).toBe(200);
    expect((await api().delete(`/api/projects/${projectId}/sources/${back.id}`).set(auth)).status).toBe(404);
    expect((await projects())[0].sources).toHaveLength(1);

    expect((await api().delete(`/api/projects/${projectId}`).set(auth)).status).toBe(200);
    expect(await projects()).toEqual([]);
    expect(await prisma.projectDependency.count()).toBe(0);
    expect(await prisma.followedArtifact.count({ where: { userId: 'u1' } })).toBe(1);
  });
});

describe('versions used, newer-only option and orphans', () => {
  it('flags dependencies whose used version is behind the latest one', async () => {
    await importProject({
      projectName: 'p',
      sources: [
        {
          ...BACK,
          dependencies: [
            { coordinates: 'org.springframework.boot:spring-boot-starter-parent', version: '4.0.9', scope: 'parent' },
          ],
        },
        FRONT,
      ],
      follow: [
        { ecosystem: 'MAVEN', coordinates: 'org.springframework.boot:spring-boot-starter-parent' },
        { ecosystem: 'NPM', coordinates: '@angular/core' },
        { ecosystem: 'NPM', coordinates: 'vitest' },
      ],
    });
    const deps = (await projects())[0].sources.flatMap((s: any) => s.dependencies);
    const outdated = Object.fromEntries(deps.map((d: any) => [d.coordinates, d.outdated]));
    // 4.0.9 used, 4.1.2 out; 22.2.3 is the latest; vitest has no exact version (range only)
    expect(outdated).toEqual({
      'org.springframework.boot:spring-boot-starter-parent': true,
      '@angular/core': false,
      vitest: false,
    });
  });

  it('sets the newer-only option', async () => {
    const { projectId } = (await importProject({ projectName: 'p', sources: [], follow: [] })).body;
    const res = await api().patch(`/api/projects/${projectId}`).set(auth).send({ notifyNewerOnly: true });
    expect(res.body).toMatchObject({ name: 'p', notifyNewerOnly: true });
    expect((await projects())[0].notifyNewerOnly).toBe(true);
    expect((await api().patch(`/api/projects/${projectId}`).set(auth).send({ notifyNewerOnly: 'yes' })).status).toBe(
      400,
    );
  });

  it('returns the follows a re-import leaves unused by any project', async () => {
    const follow = [
      { ecosystem: 'NPM', coordinates: '@angular/core' },
      { ecosystem: 'NPM', coordinates: 'vitest' },
    ];
    const { projectId } = (await importProject({ projectName: 'a', sources: [FRONT], follow })).body;
    // another project still uses vitest
    await importProject({
      projectName: 'b',
      sources: [{ ...FRONT, dependencies: [{ coordinates: 'vitest', scope: 'dev' }] }],
      follow: [],
    });
    const res = await importProject({
      projectId,
      sources: [{ ...FRONT, dependencies: [{ coordinates: 'rxjs', scope: 'prod' }] }],
      follow: [],
    });
    expect(res.body.orphans).toEqual([
      { followedArtifactId: expect.any(String), ecosystem: 'NPM', coordinates: '@angular/core' },
    ]);
  });

  it('returns the orphans of a deleted source or project, never unrelated follows', async () => {
    await api().post('/api/artifacts/follow').set(auth).send({ ecosystem: 'NPM', coordinates: 'react' });
    const { projectId } = (
      await importProject({
        projectName: 'p',
        sources: [FRONT, BACK],
        follow: [
          { ecosystem: 'NPM', coordinates: '@angular/core' },
          { ecosystem: 'MAVEN', coordinates: 'org.springframework.boot:spring-boot-starter-parent' },
        ],
      })
    ).body;
    const back = (await projects())[0].sources.find((s: any) => s.label === 'back/pom.xml');
    const removed = await api().delete(`/api/projects/${projectId}/sources/${back.id}`).set(auth);
    expect(removed.body.orphans.map((o: any) => o.coordinates)).toEqual([
      'org.springframework.boot:spring-boot-starter-parent',
    ]);
    const deleted = await api().delete(`/api/projects/${projectId}`).set(auth);
    expect(deleted.body.orphans.map((o: any) => o.coordinates)).toEqual(['@angular/core']);
  });
});
