import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { apiPublicUrl, frontendUrl } from '../auth/session';

/** Every mail of the user (no `followedArtifactId`), or one followed artifact. */
export interface UnsubscribeTarget {
  userId: string;
  followedArtifactId?: string;
}

/** Channel left once mail is removed from it. */
const WITHOUT_MAIL: Record<string, string> = { email: 'none', both: 'telegram' };

/**
 * Links put in mails to stop them without logging in. Tokens are HMACs of the
 * target, never expiring (a link in an old mail must keep working) and signed
 * with a key derived from JWT_SECRET, so they can't pass for a session token.
 */
@Injectable()
export class UnsubscribeService {
  private readonly key: Buffer;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.key = crypto
      .createHmac('sha256', this.config.get<string>('JWT_SECRET') ?? '')
      .update('unsubscribe')
      .digest();
  }

  token(target: UnsubscribeTarget): string {
    const payload = [target.userId, target.followedArtifactId].filter(Boolean).join('.');
    return `${Buffer.from(payload).toString('base64url')}.${this.sign(payload)}`;
  }

  read(token: string | undefined): UnsubscribeTarget | null {
    const [encoded, signature, ...rest] = (token ?? '').split('.');
    if (!encoded || !signature || rest.length) return null;
    const payload = Buffer.from(encoded, 'base64url').toString();
    const expected = Buffer.from(this.sign(payload));
    const given = Buffer.from(signature);
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
    const [userId, followedArtifactId] = payload.split('.');
    return followedArtifactId ? { userId, followedArtifactId } : { userId };
  }

  /** Confirmation page (frontend) and one-click endpoint (RFC 8058, for the List-Unsubscribe header). */
  links(target: UnsubscribeTarget) {
    const token = this.token(target);
    return {
      page: `${frontendUrl(this.config)}/#/unsubscribe?token=${token}`,
      oneClick: `${apiPublicUrl(this.config)}/api/unsubscribe?token=${token}`,
    };
  }

  /** What the token stops, and whether it is still active. */
  async describe(token: string | undefined) {
    const target = this.read(token);
    if (!target) throw new NotFoundException('Invalid unsubscribe link');
    if (target.followedArtifactId) {
      const fa = await this.prisma.followedArtifact.findFirst({
        where: { id: target.followedArtifactId, userId: target.userId },
      });
      return fa
        ? { scope: 'artifact', active: true, ecosystem: fa.ecosystem, coordinates: fa.coordinates }
        : { scope: 'artifact', active: false };
    }
    const prefs = await this.prisma.userPreferences.findUnique({ where: { userId: target.userId } });
    if (!prefs) throw new NotFoundException('Invalid unsubscribe link');
    return { scope: 'all', active: prefs.notificationChannel in WITHOUT_MAIL };
  }

  /**
   * Unfollows the artifact, or removes mail from the user's channels and drops
   * the mails still waiting for the digest. Repeating it is harmless.
   */
  async apply(token: string | undefined) {
    const target = this.read(token);
    if (!target) throw new NotFoundException('Invalid unsubscribe link');
    if (target.followedArtifactId) {
      await this.prisma.followedArtifact.deleteMany({
        where: { id: target.followedArtifactId, userId: target.userId },
      });
      return { scope: 'artifact', active: false };
    }
    const prefs = await this.prisma.userPreferences.findUnique({ where: { userId: target.userId } });
    if (!prefs) throw new NotFoundException('Invalid unsubscribe link');
    const channel = WITHOUT_MAIL[prefs.notificationChannel];
    if (channel) {
      await this.prisma.userPreferences.update({
        where: { userId: target.userId },
        data: { notificationChannel: channel },
      });
    }
    await this.prisma.notificationDelivery.deleteMany({
      where: { userId: target.userId, channel: 'email', status: 'PENDING' },
    });
    return { scope: 'all', active: false };
  }

  private sign(payload: string): string {
    return crypto.createHmac('sha256', this.key).update(payload).digest('base64url');
  }
}
