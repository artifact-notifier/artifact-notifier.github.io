import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Configuration,
  discovery,
  randomPKCECodeVerifier,
  randomState,
  calculatePKCECodeChallenge,
  skipSubjectCheck,
  fetchUserInfo,
} from 'openid-client';
import { ProviderConfig, OidcProfile } from './oidc.types';

@Injectable()
export class OidcService {
  private readonly logger = new Logger(OidcService.name);
  private readonly providers = new Map<string, ProviderConfig>();
  private readonly clients = new Map<string, Configuration>();
  // In-memory PKCE/state verifiers keyed by state token
  private readonly verifiers = new Map<string, { codeVerifier: string; provider: string }>();

  constructor(private readonly config: ConfigService) {
    this.loadProviders();
  }

  private loadProviders() {
    const list = (this.config.get<string>('OIDC_PROVIDERS') || '')
      .split(',')
      .map((p) => p.trim().toLowerCase())
      .filter(Boolean);
    for (const key of list) {
      const p = this.buildConfig(key);
      if (p) {
        this.providers.set(key, p);
      }
    }
    if (this.providers.size === 0) {
      this.logger.warn(
        'No OIDC providers configured. Set OIDC_PROVIDERS and the related OIDC_<PROVIDER>_* env vars.',
      );
    }
  }

  private getEnv(name: string): string | undefined {
    return this.config.get<string>(name);
  }

  private buildConfig(key: string): ProviderConfig | null {
    const prefix = `OIDC_${key.toUpperCase()}`;
    const clientId = this.getEnv(`${prefix}_CLIENT_ID`);
    const clientSecret = this.getEnv(`${prefix}_CLIENT_SECRET`);
    const displayName = this.getEnv(`${prefix}_DISPLAY_NAME`) || key;
    const scopesRaw = this.getEnv(`${prefix}_SCOPES`) || 'openid email profile';
    // Scopes may be comma- and/or space-separated (e.g. GitHub "read:user user:email")
    const scopes = scopesRaw.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);

    if (!clientId || !clientSecret) {
      this.logger.warn(`OIDC provider "${key}" is missing CLIENT_ID/CLIENT_SECRET; skipping.`);
      return null;
    }

    return {
      key,
      displayName,
      issuer: this.getEnv(`${prefix}_ISSUER`),
      authorizationEndpoint: this.getEnv(`${prefix}_AUTHORIZATION_ENDPOINT`),
      tokenEndpoint: this.getEnv(`${prefix}_TOKEN_ENDPOINT`),
      userinfoEndpoint: this.getEnv(`${prefix}_USERINFO_ENDPOINT`),
      clientId,
      clientSecret,
      scopes,
    };
  }

  listProviders(): { key: string; displayName: string }[] {
    return [...this.providers.values()].map((p) => ({
      key: p.key,
      displayName: p.displayName,
    }));
  }

  async getClient(provider: string): Promise<Configuration> {
    const cached = this.clients.get(provider);
    if (cached) return cached;

    const cfg = this.providers.get(provider);
    if (!cfg) throw new UnauthorizedException(`Unknown provider "${provider}"`);

    const clientMetadata = {
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      response_types: ['code'],
    };

    let oidcConfig: Configuration;
    if (cfg.issuer) {
      oidcConfig = await discovery(new URL(cfg.issuer), cfg.clientId, clientMetadata);
    } else {
      // Manual endpoints (e.g. GitHub which lacks standard OIDC discovery)
      oidcConfig = new Configuration(
        {
          issuer: cfg.authorizationEndpoint?.replace(/\/authorize$/, '') || `https://${cfg.key}.com`,
          authorization_endpoint: cfg.authorizationEndpoint!,
          token_endpoint: cfg.tokenEndpoint!,
          userinfo_endpoint: cfg.userinfoEndpoint,
        },
        cfg.clientId,
        clientMetadata,
      );
    }

    this.clients.set(provider, oidcConfig);
    return oidcConfig;
  }

  redirectUriFor(provider: string): string {
    return this.redirectUri(provider);
  }

  private redirectUri(provider: string): string {
    // The redirect_uri must point to the API (it exchanges the code),
    // not to the frontend. Empty BACKEND_PUBLIC_URL = legacy same-origin mode
    // (the frontend proxies /api to the backend).
    const publicBase =
      this.config.get<string>('BACKEND_PUBLIC_URL')?.trim() ||
      this.config.get<string>('FRONTEND_URL')?.split(',')[0]?.trim() ||
      'http://localhost:4200';
    return `${publicBase.replace(/\/+$/, '')}/api/auth/${provider}/callback`;
  }

  getProviderConfig(provider: string): ProviderConfig {
    const cfg = this.providers.get(provider);
    if (!cfg) throw new UnauthorizedException(`Unknown provider "${provider}"`);
    return cfg;
  }

  /** True for plain OAuth2 providers (manual endpoints, no OIDC discovery/issuer). */
  isOAuth2Only(provider: string): boolean {
    const cfg = this.getProviderConfig(provider);
    return !cfg.issuer && !!cfg.tokenEndpoint;
  }

  /**
   * Plain OAuth2 code exchange (e.g. GitHub): openid-client's authorizationCodeGrant
   * expects an OIDC token response (id_token) and fails with "invalid response
   * encountered". GitHub only returns an access_token (JSON when requested).
   */
  async exchangeOAuth2Code(provider: string, code: string, redirectUri: string, codeVerifier?: string): Promise<string> {
    const cfg = this.getProviderConfig(provider);
    const res = await fetch(cfg.tokenEndpoint!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        code,
        redirect_uri: redirectUri,
        // Required when the authorize request carried a code_challenge (we always send PKCE)
        ...(codeVerifier ? { code_verifier: codeVerifier } : {}),
      }),
      signal: AbortSignal.timeout(10000),
    });
    const raw = await res.text().catch(() => '');
    let json: any = null;
    try { json = raw ? JSON.parse(raw) : null; } catch { json = null; }
    if (!res.ok) {
      throw new UnauthorizedException(`Token exchange failed: ${res.status} ${json?.error_description || json?.error || raw || res.statusText}`);
    }
    if (!json?.access_token) {
      throw new UnauthorizedException(`Token exchange failed: ${json?.error_description || json?.error || 'no access_token'}`);
    }
    return json.access_token as string;
  }

  /**
   * Plain OAuth2 profile fetch (e.g. GitHub): maps GitHub's user shape
   * (numeric `id`, `login`, `avatar_url`, possibly null email) to OidcProfile,
   * falling back to /user/emails for private emails.
   */
  async fetchOAuth2Profile(provider: string, accessToken: string): Promise<OidcProfile> {
    const cfg = this.getProviderConfig(provider);
    const res = await fetch(cfg.userinfoEndpoint!, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github+json', 'User-Agent': 'artifact-notifier' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new UnauthorizedException(`Userinfo failed: ${res.status} ${res.statusText}`);
    const u = await res.json();
    let email: string | undefined = u.email || undefined;
    if (!email && provider === 'github') {
      try {
        const er = await fetch('https://api.github.com/user/emails', {
          headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github+json', 'User-Agent': 'artifact-notifier' },
          signal: AbortSignal.timeout(10000),
        });
        if (er.ok) {
          const emails = await er.json();
          email = emails?.find((e: any) => e.primary && e.verified)?.email || emails?.find((e: any) => e.verified)?.email || emails?.[0]?.email;
        }
      } catch {
        // ignore, fallback below applies
      }
    }
    if (!email) email = `${u.id ?? u.login ?? 'user'}@${provider}.local`;
    return {
      email,
      name: u.name || u.login || u.preferred_username,
      avatarUrl: u.avatar_url || u.picture,
      provider,
      providerSubject: String(u.id ?? u.sub ?? u.login),
    };
  }

  storeVerifier(state: string, codeVerifier: string, provider: string) {
    this.verifiers.set(state, { codeVerifier, provider });
  }

  consumeVerifier(state: string): { codeVerifier: string; provider: string } | undefined {
    const v = this.verifiers.get(state);
    if (v) this.verifiers.delete(state);
    return v;
  }

  async fetchProfile(
    provider: string,
    tokenset: { access_token?: string; claims(): Record<string, any> | undefined },
  ): Promise<OidcProfile> {
    const cfg = this.getProviderConfig(provider);
    const oidcConfig = await this.getClient(provider);
    let claims: Record<string, any> = {};

    if (tokenset.access_token && cfg.userinfoEndpoint) {
      const userinfo = await fetchUserInfo(oidcConfig, tokenset.access_token, skipSubjectCheck);
      claims = { ...userinfo };
    } else {
      claims = tokenset.claims() || {};
    }

    const email =
      claims.email || (claims.emails && claims.emails[0]) || `${claims.sub}@${provider}.local`;
    return {
      email,
      name: claims.name || claims.login || claims.preferred_username,
      avatarUrl: claims.picture || claims.avatar_url,
      provider,
      providerSubject: String(claims.sub),
    };
  }
}
