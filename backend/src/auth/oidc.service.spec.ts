import { ConfigService } from '@nestjs/config';
import { OidcService } from './oidc.service';

const PROFILE = { email: 'v@example.test', emailVerified: true, provider: 'google', providerSubject: 'g-1' };

function service(env: Record<string, string> = {}) {
  return new OidcService(new ConfigService({ OIDC_PROVIDERS: '', ...env }));
}

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('OidcService one-time tokens', () => {
  it('link tokens are single use', () => {
    const oidc = service();
    const token = oidc.createLinkToken('u1');
    expect(oidc.consumeLinkToken(token)).toBe('u1');
    expect(oidc.consumeLinkToken(token)).toBeUndefined();
  });

  it('verifiers expire after 10 minutes', () => {
    jest.useFakeTimers();
    const oidc = service();
    oidc.storeVerifier('state', 'verifier', 'google');
    jest.advanceTimersByTime(10 * 60_000 + 1);
    expect(oidc.consumeVerifier('state')).toBeUndefined();
  });

  it('a pending link can only be confirmed by the user who requested it', () => {
    const oidc = service();
    const token = oidc.createPendingLink('attacker', PROFILE);
    // someone else opening the confirmation burns it without attaching anything
    expect(oidc.consumePendingLink(token, 'victim')).toBeUndefined();
    expect(oidc.consumePendingLink(token, 'attacker')).toBeUndefined();

    const own = oidc.createPendingLink('me', PROFILE);
    expect(oidc.consumePendingLink(own, 'me')?.profile).toEqual(PROFILE);
  });

  it('merges are previewable then consumed once', () => {
    const oidc = service();
    const token = oidc.createMergeToken('to', 'from', 'github');
    expect(oidc.peekMerge(token)?.fromUserId).toBe('from');
    expect(oidc.consumeMerge(token)?.toUserId).toBe('to');
    expect(oidc.peekMerge(token)).toBeUndefined();
  });

  it('cleanup drops expired entries', () => {
    jest.useFakeTimers();
    const oidc = service();
    const link = oidc.createLinkToken('u1');
    jest.advanceTimersByTime(10 * 60_000 + 1);
    oidc.cleanupExpiredTokens();
    expect(oidc.consumeLinkToken(link)).toBeUndefined();
  });
});

describe('OidcService.fetchOAuth2Profile (GitHub)', () => {
  const github = () =>
    service({
      OIDC_PROVIDERS: 'github',
      OIDC_GITHUB_CLIENT_ID: 'id',
      OIDC_GITHUB_CLIENT_SECRET: 'secret',
      OIDC_GITHUB_TOKEN_ENDPOINT: 'https://github.com/login/oauth/access_token',
      OIDC_GITHUB_USERINFO_ENDPOINT: 'https://api.github.com/user',
    });

  function mockGithub(user: object, emails: object[]) {
    jest
      .spyOn(global, 'fetch')
      .mockImplementation(
        async (url) =>
          new Response(JSON.stringify(String(url).endsWith('/user/emails') ? emails : user), { status: 200 }),
      );
  }

  it('trusts the public email (GitHub only publishes verified addresses)', async () => {
    mockGithub({ id: 1, login: 'jdoe', email: 'pub@example.test' }, []);
    const p = await github().fetchOAuth2Profile('github', 'token');
    expect(p).toMatchObject({ email: 'pub@example.test', emailVerified: true, providerSubject: '1' });
  });

  it('prefers a verified address from /user/emails', async () => {
    mockGithub({ id: 1, login: 'jdoe', email: null }, [
      { email: 'unverified@example.test', primary: true, verified: false },
      { email: 'ok@example.test', primary: false, verified: true },
    ]);
    const p = await github().fetchOAuth2Profile('github', 'token');
    expect(p).toMatchObject({ email: 'ok@example.test', emailVerified: true });
  });

  it('flags an address nobody verified', async () => {
    mockGithub({ id: 1, login: 'jdoe', email: null }, [{ email: 'x@example.test', primary: true, verified: false }]);
    const p = await github().fetchOAuth2Profile('github', 'token');
    expect(p).toMatchObject({ email: 'x@example.test', emailVerified: false });
  });
});
