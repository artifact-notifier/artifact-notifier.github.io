import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { CookieOptions } from 'express';

export const SESSION_COOKIE = 'access_token';

/** Linear (no regex backtracking on attacker-controlled-length input). */
export function trimTrailingSlashes(s: string): string {
  let end = s.length;
  while (end > 0 && s[end - 1] === '/') end--;
  return s.slice(0, end);
}

export function frontendUrl(config: ConfigService): string {
  const raw = config.get<string>('FRONTEND_URL')?.split(',')[0]?.trim() || 'http://localhost:4200';
  return trimTrailingSlashes(raw);
}

export function apiPublicUrl(config: ConfigService): string {
  const raw = config.get<string>('BACKEND_PUBLIC_URL')?.trim() || frontendUrl(config);
  return trimTrailingSlashes(raw);
}

function isCrossSite(config: ConfigService): boolean {
  try {
    return new URL(frontendUrl(config)).origin !== new URL(apiPublicUrl(config)).origin;
  } catch {
    return false;
  }
}

/**
 * Session cookie carried by the API.
 * Same-origin: Lax is enough. Cross-origin (frontend on another domain):
 * SameSite=None + Secure are required, otherwise the browser rejects the cookie.
 */
export function sessionCookieOptions(config: ConfigService): CookieOptions {
  const crossSite = isCrossSite(config);
  return {
    httpOnly: true,
    sameSite: crossSite ? 'none' : 'lax',
    secure: config.get<string>('NODE_ENV') === 'production' || crossSite,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
  };
}

export function signSession(
  jwt: JwtService,
  config: ConfigService,
  user: { id: string; email: string; provider: string },
): string {
  return jwt.sign(
    { sub: user.id, email: user.email, provider: user.provider },
    {
      secret: config.get<string>('JWT_SECRET'),
      expiresIn: (config.get<string>('JWT_EXPIRES_IN') || '7d') as any,
    },
  );
}
