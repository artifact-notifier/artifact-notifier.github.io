import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { AuthedUser } from './decorators';

export type { AuthedUser };

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService, private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const token =
      this.extractFromCookie(req) || this.extractFromHeader(req);
    if (!token) throw new UnauthorizedException('Missing token');

    try {
      const payload = this.jwt.verify(token, {
        secret: this.config.get<string>('JWT_SECRET'),
      });
      (req as any).user = payload;
      return true;
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
  }

  private extractFromHeader(req: Request): string | undefined {
    const auth = req.headers['authorization'];
    if (auth && auth.startsWith('Bearer ')) return auth.substring(7);
    return undefined;
  }

  private extractFromCookie(req: Request): string | undefined {
    const cookies = req.cookies as Record<string, string> | undefined;
    return cookies?.['access_token'];
  }
}
