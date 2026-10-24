import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { bearer, createTestApp } from './app';
import { createUser, resetDb } from './db';

// ADMIN_USER_IDS is 'admin, other-admin' (test/env.ts)
const prisma = new PrismaClient();
let app: INestApplication;

beforeAll(async () => {
  app = await createTestApp();
});

beforeEach(() => resetDb(prisma));

afterAll(async () => {
  await app?.close();
  await prisma.$disconnect();
});

const api = () => request(app.getHttpServer());
const as = (id: string) => bearer(app, { id, email: `${id}@example.test` });

async function seed() {
  await createUser(prisma, 'admin', {
    notificationChannel: 'telegram',
    notificationMode: 'IMMEDIATE',
    telegramChatId: '1',
  });
  await createUser(prisma, 'alice', {
    notificationChannel: 'email',
    notificationMode: 'DIGEST',
    includePrereleases: true,
  });
  await createUser(prisma, 'bob', { notificationChannel: 'both', notificationMode: 'DIGEST' });
  await prisma.user.update({ where: { id: 'bob' }, data: { createdAt: new Date(Date.now() - 60 * 86_400_000) } });
  await prisma.linkedIdentity.create({ data: { userId: 'alice', provider: 'github', providerSubject: 'gh-a' } });

  const follow = (userId: string, ecosystem: 'NPM' | 'MAVEN', coordinates: string) =>
    prisma.followedArtifact.create({ data: { userId, ecosystem, coordinates } });
  const boot = await follow('alice', 'MAVEN', 'org.springframework.boot:spring-boot');
  await follow('bob', 'MAVEN', 'org.springframework.boot:spring-boot');
  await follow('bob', 'NPM', '@angular/core');

  const event = await prisma.artifactVersionEvent.create({
    data: { followedArtifactId: boot.id, ecosystem: 'MAVEN', coordinates: boot.coordinates, version: '4.1.2' },
  });
  await prisma.notificationDelivery.create({
    data: { eventId: event.id, userId: 'alice', channel: 'email', status: 'SENT', sentAt: new Date() },
  });
  const event2 = await prisma.artifactVersionEvent.create({
    data: { followedArtifactId: boot.id, ecosystem: 'MAVEN', coordinates: boot.coordinates, version: '4.0.9' },
  });
  await prisma.notificationDelivery.create({
    data: { eventId: event2.id, userId: 'alice', channel: 'email', status: 'FAILED', attempts: 8 },
  });
  await prisma.knownVersions.create({
    data: { ecosystem: 'MAVEN', coordinates: boot.coordinates, versions: JSON.stringify(['4.0.9', '4.1.2']) },
  });
}

describe('admin access', () => {
  beforeEach(seed);

  it('requires a session', async () => {
    expect((await api().get('/api/admin/stats')).status).toBe(401);
    expect((await api().get('/api/admin/users')).status).toBe(401);
  });

  it('refuses accounts that are not in ADMIN_USER_IDS', async () => {
    expect((await api().get('/api/admin/stats').set(as('alice'))).status).toBe(403);
    expect((await api().get('/api/admin/users').set(as('alice'))).status).toBe(403);
  });

  it('matches the account id, not the email', async () => {
    // same email as the admin, different account id
    const forged = bearer(app, { id: 'alice', email: 'admin@example.test' });
    expect((await api().get('/api/admin/stats').set(forged)).status).toBe(403);
  });

  it('tells the frontend who is admin through /me', async () => {
    expect((await api().get('/api/auth/me').set(as('admin'))).body.isAdmin).toBe(true);
    expect((await api().get('/api/auth/me').set(as('alice'))).body.isAdmin).toBe(false);
  });
});

describe('admin stats', () => {
  beforeEach(seed);

  it('aggregates users, artifacts and notifications', async () => {
    const res = await api().get('/api/admin/stats').set(as('admin'));
    expect(res.status).toBe(200);
    expect(res.body.users).toEqual({
      total: 3,
      new7d: 2,
      new30d: 2,
      byProvider: { test: 3, github: 1 },
      byChannel: { telegram: 1, email: 1, both: 1 },
      byMode: { IMMEDIATE: 1, DIGEST: 2 },
      telegramLinked: 1,
      withPrereleases: 1,
    });
    expect(res.body.artifacts).toMatchObject({
      follows: 3,
      distinct: 2,
      byEcosystem: { MAVEN: 2, NPM: 1 },
      knownVersions: 2,
    });
    expect(res.body.artifacts.top[0]).toEqual({
      ecosystem: 'MAVEN',
      coordinates: 'org.springframework.boot:spring-boot',
      followers: 2,
    });
    expect(res.body.notifications).toEqual({
      deliveriesByChannel: { email: { SENT: 1, FAILED: 1 } },
      sent24h: 1,
      sent7d: 1,
      failed7d: 1,
      events7d: 2,
    });
    expect(res.body.system).toMatchObject({ version: 'dev', databaseBytes: expect.any(Number) });
    expect(Object.keys(res.body.listeners).sort()).toEqual(['MAVEN', 'NPM', 'PYPI']);
  });
});

describe('admin users', () => {
  beforeEach(seed);

  it('lists every account, newest first, with its activity', async () => {
    const res = await api().get('/api/admin/users').set(as('admin'));
    expect(res.status).toBe(200);
    expect(res.body.map((u: any) => u.id)).toEqual(expect.arrayContaining(['admin', 'alice', 'bob']));
    expect(res.body.at(-1).id).toBe('bob'); // signed up 60 days ago

    const alice = res.body.find((u: any) => u.id === 'alice');
    expect(alice).toMatchObject({
      email: 'alice@example.test',
      providers: ['test', 'github'],
      follows: 1,
      channel: 'email',
      mode: 'DIGEST',
      telegramLinked: false,
      includePrereleases: true,
      isAdmin: false,
    });
    expect(alice.lastNotifiedAt).toEqual(expect.any(String));
    expect(res.body.find((u: any) => u.id === 'admin')).toMatchObject({ isAdmin: true, telegramLinked: true });
    expect(res.body.find((u: any) => u.id === 'bob').lastNotifiedAt).toBeNull();
  });
});
