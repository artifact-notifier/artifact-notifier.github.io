import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { UnsubscribeService } from '../src/notifications/unsubscribe.service';
import { bearer, createTestApp } from './app';
import { createUser, resetDb } from './db';

const prisma = new PrismaClient();
let app: INestApplication;
let tokens: UnsubscribeService;
const api = () => request(app.getHttpServer());

beforeAll(async () => {
  app = await createTestApp();
  tokens = app.get(UnsubscribeService);
});
beforeEach(() => resetDb(prisma));
afterAll(async () => {
  await app?.close();
  await prisma.$disconnect();
});

async function pendingDelivery(userId: string, channel: string) {
  const fa = await prisma.followedArtifact.create({
    data: { userId, ecosystem: 'NPM', coordinates: `pkg-${channel}` },
  });
  const event = await prisma.artifactVersionEvent.create({
    data: { followedArtifactId: fa.id, ecosystem: 'NPM', coordinates: fa.coordinates, version: '1.0.0' },
  });
  await prisma.notificationDelivery.create({ data: { eventId: event.id, userId, channel } });
}

describe('unsubscribe links', () => {
  it('reads back what it signed, and nothing else', () => {
    expect(tokens.read(tokens.token({ userId: 'u1' }))).toEqual({ userId: 'u1' });
    expect(tokens.read(tokens.token({ userId: 'u1', followedArtifactId: 'f1' }))).toEqual({
      userId: 'u1',
      followedArtifactId: 'f1',
    });
    const forged = `${Buffer.from('u2').toString('base64url')}.${tokens.token({ userId: 'u1' }).split('.')[1]}`;
    expect(tokens.read(forged)).toBeNull();
    expect(tokens.read('garbage')).toBeNull();
    expect(tokens.read(undefined)).toBeNull();
  });

  it('points to the confirmation page and the one-click endpoint', () => {
    const links = tokens.links({ userId: 'u1' });
    expect(links.page).toMatch(/^http:\/\/localhost:4200\/#\/unsubscribe\?token=[\w-]+\.[\w-]+$/);
    // BACKEND_PUBLIC_URL may come from a local .env
    expect(links.oneClick).toMatch(/\/api\/unsubscribe\?token=[\w-]+\.[\w-]+$/);
  });

  it('rejects invalid tokens', async () => {
    expect((await api().get('/api/unsubscribe?token=nope')).status).toBe(404);
    expect((await api().post('/api/unsubscribe')).status).toBe(404);
  });

  it('is not a session, and a session is not an unsubscribe token', async () => {
    const user = await createUser(prisma, 'u1');
    const token = tokens.token({ userId: 'u1' });
    expect(
      (
        await api()
          .get('/api/artifacts')
          .set({ Authorization: `Bearer ${token}` })
      ).status,
    ).toBe(401);
    const session = bearer(app, user).Authorization.slice('Bearer '.length);
    expect((await api().get(`/api/unsubscribe?token=${session}`)).status).toBe(404);
  });

  it('stops every mail: email -> paused, pending mails dropped, Telegram kept', async () => {
    await createUser(prisma, 'u1', { notificationChannel: 'email' });
    await pendingDelivery('u1', 'email');
    await pendingDelivery('u1', 'telegram');
    const token = tokens.token({ userId: 'u1' });

    expect((await api().get(`/api/unsubscribe?token=${token}`)).body).toEqual({ scope: 'all', active: true });
    // RFC 8058 one-click: form-encoded POST from the mail client
    await api()
      .post(`/api/unsubscribe?token=${token}`)
      .type('form')
      .send('List-Unsubscribe=One-Click')
      .expect(200, { scope: 'all', active: false });

    expect((await prisma.userPreferences.findUnique({ where: { userId: 'u1' } }))?.notificationChannel).toBe('none');
    expect((await prisma.notificationDelivery.findMany()).map((d) => d.channel)).toEqual(['telegram']);
    expect((await api().get(`/api/unsubscribe?token=${token}`)).body).toEqual({ scope: 'all', active: false });
    // harmless when repeated
    await api().post(`/api/unsubscribe?token=${token}`).expect(200);
  });

  it('keeps Telegram for users on both channels', async () => {
    await createUser(prisma, 'u1', { notificationChannel: 'both', telegramChatId: '42' });
    await api()
      .post(`/api/unsubscribe?token=${tokens.token({ userId: 'u1' })}`)
      .expect(200);
    expect((await prisma.userPreferences.findUnique({ where: { userId: 'u1' } }))?.notificationChannel).toBe(
      'telegram',
    );
  });

  it('unfollows one artifact, only for its owner', async () => {
    await createUser(prisma, 'u1');
    await createUser(prisma, 'u2');
    const mine = await prisma.followedArtifact.create({ data: { userId: 'u1', ecosystem: 'NPM', coordinates: 'a' } });
    const theirs = await prisma.followedArtifact.create({
      data: { userId: 'u2', ecosystem: 'NPM', coordinates: 'b' },
    });
    const token = tokens.token({ userId: 'u1', followedArtifactId: mine.id });

    expect((await api().get(`/api/unsubscribe?token=${token}`)).body).toEqual({
      scope: 'artifact',
      active: true,
      ecosystem: 'NPM',
      coordinates: 'a',
    });
    await api().post(`/api/unsubscribe?token=${token}`).expect(200, { scope: 'artifact', active: false });
    expect(await prisma.followedArtifact.findUnique({ where: { id: mine.id } })).toBeNull();
    expect((await api().get(`/api/unsubscribe?token=${token}`)).body).toEqual({ scope: 'artifact', active: false });

    await api().post(`/api/unsubscribe?token=${tokens.token({ userId: 'u1', followedArtifactId: theirs.id })}`);
    expect(await prisma.followedArtifact.findUnique({ where: { id: theirs.id } })).not.toBeNull();
  });
});
