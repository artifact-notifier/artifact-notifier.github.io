import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Account ids granted the admin pages (ADMIN_USER_IDS, comma-separated). */
export function adminUserIds(config: ConfigService): Set<string> {
  return new Set(
    (config.get<string>('ADMIN_USER_IDS') || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

/**
 * Use after JwtAuthGuard. Matches the immutable account id, never the email:
 * emails come from the identity providers and can change or be re-assigned.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const sub: string | undefined = context.switchToHttp().getRequest().user?.sub;
    if (!sub || !adminUserIds(this.config).has(sub)) throw new ForbiddenException('Admin only');
    return true;
  }
}
