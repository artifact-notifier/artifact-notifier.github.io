import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import { ArtifactsService } from '../artifacts/artifacts.service';
import { adminUserIds } from '../auth/admin.guard';
import { PrismaService } from '../prisma/prisma.service';

const DAY = 24 * 60 * 60 * 1000;
const MAX_USERS = 1000;

/** groupBy rows -> { key: count } */
function countBy<K extends string>(rows: ({ _count: { _all: number } } & Record<K, unknown>)[], key: K) {
  return Object.fromEntries(rows.map((r) => [String(r[key]), r._count._all]));
}

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly artifacts: ArtifactsService,
    private readonly config: ConfigService,
  ) {}

  async stats() {
    const now = Date.now();
    const since = (days: number) => new Date(now - days * DAY);
    const p = this.prisma;

    const [
      users,
      users7d,
      users30d,
      loginMethods,
      byChannel,
      byMode,
      telegramLinked,
      withPrereleases,
      follows,
      followsByEco,
      topArtifacts,
      deliveries,
      sent24h,
      sent7d,
      failed7d,
      events7d,
      knownVersions,
      syncStatus,
    ] = await Promise.all([
      p.user.count(),
      p.user.count({ where: { createdAt: { gte: since(7) } } }),
      p.user.count({ where: { createdAt: { gte: since(30) } } }),
      p.user.findMany({ select: { provider: true, identities: { select: { provider: true } } } }),
      p.userPreferences.groupBy({ by: ['notificationChannel'], _count: { _all: true } }),
      p.userPreferences.groupBy({ by: ['notificationMode'], _count: { _all: true } }),
      p.userPreferences.count({ where: { telegramChatId: { not: null } } }),
      p.userPreferences.count({ where: { includePrereleases: true } }),
      p.followedArtifact.count(),
      p.followedArtifact.groupBy({ by: ['ecosystem'], _count: { _all: true } }),
      p.followedArtifact.groupBy({
        by: ['ecosystem', 'coordinates'],
        _count: { _all: true },
        orderBy: { _count: { userId: 'desc' } },
        take: 10,
      }),
      p.notificationDelivery.groupBy({ by: ['channel', 'status'], _count: { _all: true } }),
      p.notificationDelivery.count({ where: { status: 'SENT', sentAt: { gte: since(1) } } }),
      p.notificationDelivery.count({ where: { status: 'SENT', sentAt: { gte: since(7) } } }),
      p.notificationDelivery.count({ where: { status: 'FAILED', createdAt: { gte: since(7) } } }),
      p.artifactVersionEvent.count({ where: { publishedAt: { gte: since(7) } } }),
      p.$queryRaw<{ n: bigint | number | null }[]>`SELECT SUM(json_array_length(versions)) AS n FROM KnownVersions`,
      this.artifacts.getSyncStatus(),
    ]);
    const distinctArtifacts = await p.followedArtifact.groupBy({ by: ['ecosystem', 'coordinates'] });

    const deliveriesByChannel: Record<string, Record<string, number>> = {};
    for (const d of deliveries) {
      (deliveriesByChannel[d.channel] ??= {})[d.status] = d._count._all;
    }

    return {
      users: {
        total: users,
        new7d: users7d,
        new30d: users30d,
        byProvider: this.accountsPerProvider(loginMethods),
        byChannel: countBy(byChannel, 'notificationChannel'),
        byMode: countBy(byMode, 'notificationMode'),
        telegramLinked,
        withPrereleases,
      },
      artifacts: {
        follows,
        distinct: distinctArtifacts.length,
        byEcosystem: countBy(followsByEco, 'ecosystem'),
        top: topArtifacts.map((a) => ({
          ecosystem: a.ecosystem,
          coordinates: a.coordinates,
          followers: a._count._all,
        })),
        knownVersions: Number(knownVersions[0]?.n ?? 0),
      },
      notifications: { deliveriesByChannel, sent24h, sent7d, failed7d, events7d },
      listeners: syncStatus,
      system: {
        version: this.config.get<string>('APP_VERSION') || 'dev',
        uptimeSeconds: Math.round(process.uptime()),
        databaseBytes: this.databaseBytes(),
      },
    };
  }

  async users() {
    const admins = adminUserIds(this.config);
    const rows = await this.prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      take: MAX_USERS,
      include: {
        identities: { select: { provider: true } },
        preferences: {
          select: { notificationChannel: true, notificationMode: true, telegramChatId: true, includePrereleases: true },
        },
        _count: { select: { followedArtifacts: true } },
      },
    });
    const lastSent = await this.prisma.notificationDelivery.groupBy({
      by: ['userId'],
      where: { status: 'SENT', userId: { in: rows.map((u) => u.id) } },
      _max: { sentAt: true },
    });
    const lastSentByUser = new Map(lastSent.map((l) => [l.userId, l._max.sentAt]));

    return rows.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      createdAt: u.createdAt,
      providers: [...new Set([u.provider, ...u.identities.map((i) => i.provider)])],
      follows: u._count.followedArtifacts,
      channel: u.preferences?.notificationChannel ?? null,
      mode: u.preferences?.notificationMode ?? null,
      telegramLinked: !!u.preferences?.telegramChatId,
      includePrereleases: u.preferences?.includePrereleases ?? false,
      lastNotifiedAt: lastSentByUser.get(u.id) ?? null,
      isAdmin: admins.has(u.id),
    }));
  }

  /** Accounts able to log in with each provider (primary one or any linked identity). */
  private accountsPerProvider(users: { provider: string; identities: { provider: string }[] }[]) {
    const out: Record<string, number> = {};
    for (const u of users) {
      for (const provider of new Set([u.provider, ...u.identities.map((i) => i.provider)])) {
        out[provider] = (out[provider] ?? 0) + 1;
      }
    }
    return out;
  }

  private databaseBytes(): number | null {
    const url = this.config.get<string>('DATABASE_URL') || '';
    if (!url.startsWith('file:')) return null;
    let file = url.slice('file:'.length);
    // relative paths are resolved by Prisma from the schema directory
    if (!file.startsWith('/')) file = `${process.cwd()}/prisma/${file.replace(/^\.\//, '')}`;
    try {
      return fs.statSync(file).size;
    } catch {
      return null;
    }
  }
}
