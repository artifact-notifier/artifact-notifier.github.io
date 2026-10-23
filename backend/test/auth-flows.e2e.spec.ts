// must come first: AppModule reads the environment when it is imported
import './oauth-env';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { bearer, createTestApp } from './app';
import { createUser, resetDb } from './db';

const prisma = new PrismaClient();
let app: INestApplication;
const api = () => request(app.getHttpServer());

/** GitHub answering the token exchange and /user for `user`. */
function mockGithub(user: { id: number; login: string; email: string | null }, tokenStatus = 200) {
  return jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    if (url.endsWith('/access_token'))
      return tokenStatus === 200
        ? new Response(JSON.stringify({ access_token: 'gh-token' }))
        : new Response(JSON.stringify({ error: 'bad_verification_code' }), { status: tokenStatus });
    if (url.endsWith('/user')) return new Response(JSON.stringify(user));
    if (url.endsWith('/user/emails')) return new Response(JSON.stringify([]));
    throw new Error(`unexpected ${url}`);
  });
}

/** Starts an authorize redirect and returns the state the provider would send back. */
async function authorize(path: string) {
  const res = await api().get(path);
  expect(res.status).toBe(302);
  const location = new URL(res.headers.location);
  expect(location.origin + location.pathname).toBe('https://github.example/login/oauth/authorize');
  expect(location.searchParams.get('code_challenge_method')).toBe('S256');
  expect(location.searchParams.get('redirect_uri')).toBe('http://api.test/api/auth/github/callback');
  return location.searchParams.get('state')!;
}

const fragmentQuery = (location: string) => new URLSearchParams(location.split('?')[1]);

beforeAll(async () => {
  app = await createTestApp();
});
beforeEach(() => resetDb(prisma));
afterEach(() => jest.restoreAllMocks());
afterAll(async () => {
  await app?.close();
  await prisma.$disconnect();
});

describe('OAuth login', () => {
  it('lists the configured provider', async () => {
    const res = await api().get('/api/auth/providers');
    expect(res.body).toEqual([{ key: 'github', displayName: 'GitHub' }]);
  });

  it('logs in through the code exchange and opens a session', async () => {
    const state = await authorize('/api/auth/github');
    const fetch = mockGithub({ id: 42, login: 'jdoe', email: 'jdoe@example.test' });

    const res = await api().get(`/api/auth/github/callback?code=the-code&state=${state}`);

    expect(res.status).toBe(302);
    expect(res.headers.location.startsWith('http://front.test/#/auth/callback?access_token=')).toBe(true);
    expect(res.headers['set-cookie'][0]).toMatch(/^access_token=.*HttpOnly.*SameSite=None/);
    // PKCE: the verifier is redeemed with the code
    const exchange = JSON.parse(String(fetch.mock.calls[0][1]!.body));
    expect(exchange).toMatchObject({ code: 'the-code', client_id: 'client-id' });
    expect(exchange.code_verifier).toEqual(expect.any(String));

    const token = fragmentQuery(res.headers.location).get('access_token');
    const me = await api().get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(me.body).toMatchObject({ email: 'jdoe@example.test', provider: 'github', providerSubject: '42' });
  });

  it('rejects a replayed or unknown state', async () => {
    const res = await api().get('/api/auth/github/callback?code=x&state=forged');
    expect(res.headers.location).toBe('http://front.test/#/login?error=invalid_state');
  });

  it('forwards provider errors to the login page', async () => {
    const state = await authorize('/api/auth/github');
    const res = await api().get(`/api/auth/github/callback?error=access_denied&state=${state}`);
    expect(res.headers.location).toBe('http://front.test/#/login?error=access_denied');
  });

  it('reports a failed code exchange', async () => {
    const state = await authorize('/api/auth/github');
    mockGithub({ id: 1, login: 'x', email: null }, 401);
    const res = await api().get(`/api/auth/github/callback?code=bad&state=${state}`);
    expect(fragmentQuery(res.headers.location).get('error')).toContain('Token exchange failed');
  });

  it('refuses an unknown provider', async () => {
    const res = await api().get('/api/auth/gitlab');
    expect(res.status).toBe(401);
  });

  it('clears the session cookie on logout', async () => {
    const res = await api().get('/api/auth/logout');
    expect(res.body).toEqual({ success: true });
    expect(res.headers['set-cookie'][0]).toMatch(/^access_token=;/);
  });
});

describe('account linking', () => {
  async function linkRoundTrip(userId: string, githubUser: { id: number; login: string; email: string | null }) {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const auth = bearer(app, user);
    const { body } = await api().post('/api/auth/link-token').set(auth);
    const state = await authorize(`/api/auth/github/link?token=${body.token}`);
    mockGithub(githubUser);
    const callback = await api().get(`/api/auth/github/callback?code=c&state=${state}`);
    expect(callback.headers.location).toMatch(/^http:\/\/front\.test\/#\/preferences\?link=[0-9a-f]{64}$/);
    const confirm = await api()
      .post('/api/auth/link/confirm')
      .set(auth)
      .send({ token: fragmentQuery(callback.headers.location).get('link') });
    return { auth, confirm };
  }

  it('links a new provider once the session confirms it', async () => {
    await createUser(prisma, 'u1');
    const { auth, confirm } = await linkRoundTrip('u1', { id: 7, login: 'u1gh', email: 'u1@example.test' });
    expect(confirm.body).toEqual({ linked: 'github' });

    const links = await api().get('/api/auth/links').set(auth);
    expect(links.body).toEqual([{ key: 'github', displayName: 'GitHub', linked: true }]);

    const unlink = await api().delete('/api/auth/github/link').set(auth);
    expect(unlink.status).toBe(200);
  });

  it('stages a merge when the identity already owns another account', async () => {
    await createUser(prisma, 'u1');
    await createUser(prisma, 'other', { email: 'other@example.test' });
    await prisma.linkedIdentity.create({ data: { userId: 'other', provider: 'github', providerSubject: '9' } });

    const { auth, confirm } = await linkRoundTrip('u1', { id: 9, login: 'o', email: 'other@example.test' });
    expect(confirm.body.merge).toEqual(expect.any(String));

    const preview = await api().get(`/api/auth/merge/preview?token=${confirm.body.merge}`).set(auth);
    expect(preview.body).toMatchObject({ from: { email: 'other@example.test' }, identitiesToMove: 2 });

    const merged = await api().post('/api/auth/merge/confirm').set(auth).send({ token: confirm.body.merge });
    expect(merged.body.id).toBe('u1');
    expect(await prisma.user.findUnique({ where: { id: 'other' } })).toBeNull();
    // the merge token is single use
    const again = await api().post('/api/auth/merge/confirm').set(auth).send({ token: confirm.body.merge });
    expect(again.status).toBe(401);
  });

  it('sends link-flow errors back to the preferences', async () => {
    await createUser(prisma, 'u1');
    const user = await prisma.user.findUniqueOrThrow({ where: { id: 'u1' } });
    const { body } = await api().post('/api/auth/link-token').set(bearer(app, user));
    const state = await authorize(`/api/auth/github/link?token=${body.token}`);
    const res = await api().get(`/api/auth/github/callback?error=access_denied&state=${state}`);
    expect(res.headers.location).toBe('http://front.test/#/preferences?error=access_denied');
  });

  it('deletes the account', async () => {
    const user = await createUser(prisma, 'u1');
    const res = await api().delete('/api/auth/account').set(bearer(app, user));
    expect(res.body).toEqual({ success: true });
    expect(await prisma.user.count()).toBe(0);
  });
});
