import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as crypto from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { MavenArtifactListener } from '../src/listeners/maven-artifact.listener';
import { NpmArtifactListener } from '../src/listeners/npm-artifact.listener';
import { PypiArtifactListener } from '../src/listeners/pypi-artifact.listener';
import { createUser, resetDb } from './db';

/** Whole application over HTTP, without the registry listeners (no network). */
const noListener = { refreshFollowed: async () => undefined };

const prisma = new PrismaClient();
let app: INestApplication;
let token: string;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(NpmArtifactListener)
    .useValue(noListener)
    .overrideProvider(MavenArtifactListener)
    .useValue(noListener)
    .overrideProvider(PypiArtifactListener)
    .useValue(noListener)
    .compile();
  app = moduleRef.createNestApplication({ logger: false });
  configureApp(app);
  await app.init();
});

beforeEach(async () => {
  await resetDb(prisma);
  const user = await createUser(prisma, 'u1', { notificationChannel: 'email', notificationMode: 'DIGEST' });
  token = app.get(JwtService).sign({ sub: user.id, email: user.email, provider: 'test' }, { secret: 'test-secret' });
});

afterAll(async () => {
  await app?.close();
  await prisma.$disconnect();
});

const api = () => request(app.getHttpServer());
const auth = () => ({ Authorization: `Bearer ${token}` });

describe('authentication', () => {
  it('rejects anonymous calls to protected routes', async () => {
    await api().get('/api/artifacts').expect(401);
    await api().get('/api/auth/me').expect(401);
  });

  it('rejects a token signed with another secret', async () => {
    const forged = app.get(JwtService).sign({ sub: 'u1' }, { secret: 'not-the-secret' });
    await api().get('/api/auth/me').set('Authorization', `Bearer ${forged}`).expect(401);
  });

  it('returns the current user', async () => {
    const res = await api().get('/api/auth/me').set(auth()).expect(200);
    expect(res.body).toMatchObject({ id: 'u1', email: 'u1@example.test' });
  });

  it('lists providers publicly', async () => {
    await api().get('/api/auth/providers').expect(200, []);
  });
});

describe('account linking', () => {
  it('refuses to confirm a link the session did not request', async () => {
    await api().post('/api/auth/link/confirm').set(auth()).send({ token: 'forged' }).expect(401);
  });

  it('redirects an unknown link token back to the preferences', async () => {
    const res = await api().get('/api/auth/google/link?token=nope').expect(302);
    expect(res.headers.location).toContain('/preferences?error=invalid_link_token');
  });
});

describe('artifacts', () => {
  it('validates the follow payload', async () => {
    await api().post('/api/artifacts/follow').set(auth()).send({ ecosystem: 'FOO', coordinates: 'x' }).expect(400);
    await api()
      .post('/api/artifacts/follow')
      .set(auth())
      .send({ ecosystem: 'TEST', coordinates: '<script>' })
      .expect(400);
    await api().get('/api/artifacts/search?ecosystem=FOO&q=react').set(auth()).expect(400);
  });

  it('follows, lists and unfollows', async () => {
    const created = await api()
      .post('/api/artifacts/follow')
      .set(auth())
      .send({ ecosystem: 'TEST', coordinates: 'my/pkg' })
      .expect(201);
    const list = await api().get('/api/artifacts').set(auth()).expect(200);
    expect(list.body.map((a: any) => a.coordinates)).toEqual(['my/pkg']);
    await api().delete(`/api/artifacts/${created.body.id}`).set(auth()).expect(200);
  });

  it("cannot unfollow someone else's artifact", async () => {
    await createUser(prisma, 'other');
    const fa = await prisma.followedArtifact.create({ data: { userId: 'other', ecosystem: 'TEST', coordinates: 'x' } });
    await api().delete(`/api/artifacts/${fa.id}`).set(auth()).expect(404);
  });
});

describe('preferences', () => {
  it('ignores a Telegram chat id sent through the preferences', async () => {
    const res = await api()
      .put('/api/preferences')
      .set(auth())
      .send({ telegramChatId: '123', includePrereleases: true })
      .expect(200);
    expect(res.body).toMatchObject({ telegramChatId: null, includePrereleases: true });
  });
});

describe('Telegram login', () => {
  function signed(data: Record<string, string>) {
    const checkString = Object.keys(data)
      .sort()
      .map((k) => `${k}=${data[k]}`)
      .join('\n');
    const secret = crypto.createHash('sha256').update(process.env.TELEGRAM_BOT_TOKEN!).digest();
    return { ...data, hash: crypto.createHmac('sha256', secret).update(checkString).digest('hex') };
  }

  it('opens a session and returns the token for the Bearer fallback', async () => {
    const payload = signed({ id: '777', username: 'tg', auth_date: String(Math.floor(Date.now() / 1000)) });
    const res = await api().post('/api/auth/telegram/verify').send(payload).expect(201);
    expect(res.body.token).toEqual(expect.any(String));
    expect(res.headers['set-cookie'][0]).toMatch(/^access_token=.*HttpOnly/);
    await api().get('/api/auth/me').set('Authorization', `Bearer ${res.body.token}`).expect(200);
  });

  it('rejects a bad signature', async () => {
    const payload = { ...signed({ id: '777', auth_date: String(Math.floor(Date.now() / 1000)) }), id: '778' };
    await api().post('/api/auth/telegram/verify').send(payload).expect(401);
  });
});
