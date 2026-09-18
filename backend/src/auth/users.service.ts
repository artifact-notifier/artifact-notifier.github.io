import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { OidcProfile } from './oidc.types';
import { NotificationMode } from '@prisma/client';

/** Channels allowed for immediate notifications. Mail is digest-only (daily at best). */
export const IMMEDIATE_CHANNELS = ['telegram'] as const;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  mailMinDigestMinutes(): number {
    return Number(this.config.get('MAIL_MIN_DIGEST_INTERVAL_MINUTES') ?? 1440);
  }

  async findOrCreateFromProfile(profile: OidcProfile) {
    // 1. Known linked identity (any provider previously linked to an account)
    const identity = await this.prisma.linkedIdentity.findUnique({
      where: { provider_providerSubject: { provider: profile.provider, providerSubject: profile.providerSubject } },
      include: { user: { include: { preferences: true } } },
    });
    if (identity?.user) {
      return identity.user;
    }

    // 2. Legacy match on the primary (provider, providerSubject) columns
    // (accounts created before LinkedIdentity existed): attach the identity row.
    const legacy = await this.prisma.user.findFirst({
      where: { provider: profile.provider, providerSubject: profile.providerSubject },
      include: { preferences: true },
    });
    if (legacy) {
      await this.prisma.linkedIdentity.upsert({
        where: { provider_providerSubject: { provider: profile.provider, providerSubject: profile.providerSubject } },
        create: { userId: legacy.id, provider: profile.provider, providerSubject: profile.providerSubject },
        update: {},
      });
      return legacy;
    }

    // 3. Same email from another provider (e.g. Google then GitHub):
    // link the new provider to the existing account instead of failing on email uniqueness.
    const byEmail = await this.prisma.user.findUnique({
      where: { email: profile.email },
      include: { preferences: true },
    });
    if (byEmail) {
      await this.prisma.linkedIdentity.upsert({
        where: { provider_providerSubject: { provider: profile.provider, providerSubject: profile.providerSubject } },
        create: { userId: byEmail.id, provider: profile.provider, providerSubject: profile.providerSubject },
        update: {},
      });
      return byEmail;
    }

    // 4. Brand new account (+ its first identity + preferences)
    return this.prisma.user.create({
      data: {
        email: profile.email,
        name: profile.name,
        avatarUrl: profile.avatarUrl,
        provider: profile.provider,
        providerSubject: profile.providerSubject,
        identities: {
          create: { provider: profile.provider, providerSubject: profile.providerSubject },
        },
        preferences: {
          create: {
            email: profile.email,
            notificationMode: NotificationMode.DIGEST,
            digestIntervalMinutes: 1440,
          },
        },
      },
      include: { preferences: true },
    });
  }

  async findOrCreateFromTelegram(data: {
    telegramId: string;
    telegramUsername?: string;
    email: string;
    name?: string;
    avatarUrl?: string;
  }) {
    // Uniqueness is enforced via UserPreferences.telegramChatId (@unique) + provider/providerSubject.
    // Two-step lookup (no `include: { user }`): a stale UserPreferences row whose user
    // was deleted (partial DB wipe) would otherwise crash Prisma with
    // "Inconsistent query result: Field user is required to return data, got null".
    const stalePrefs = await this.prisma.userPreferences.findFirst({
      where: { telegramChatId: data.telegramId },
    });
    if (stalePrefs) {
      const owner = await this.prisma.user.findUnique({
        where: { id: stalePrefs.userId },
        include: { preferences: true },
      });
      if (owner) return owner;
      // Orphaned row: clean up so the unique constraint doesn't block re-creation.
      await this.prisma.userPreferences.delete({ where: { userId: stalePrefs.userId } });
    }

    const byProvider = await this.prisma.user.findFirst({
      where: { provider: 'telegram', providerSubject: data.telegramId },
      include: { preferences: true },
    });
    if (byProvider) return byProvider;

    return this.prisma.user.create({
      data: {
        email: data.email,
        name: data.name,
        avatarUrl: data.avatarUrl,
        provider: 'telegram',
        providerSubject: data.telegramId,
        preferences: {
          create: {
            email: data.email,
            notificationMode: NotificationMode.IMMEDIATE,
            digestIntervalMinutes: 1440,
            notificationChannel: 'telegram',
            telegramChatId: data.telegramId,
            telegramUsername: data.telegramUsername,
          },
        },
      },
      include: { preferences: true },
    });
  }

  async linkTelegram(
    userId: string,
    data: { telegramId: string; telegramUsername?: string },
  ) {
    const taken = await this.prisma.userPreferences.findFirst({ where: { telegramChatId: data.telegramId } });
    if (taken && taken.userId !== userId) throw new NotFoundException('Telegram already linked to another account');

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    await this.prisma.userPreferences.upsert({
      where: { userId },
      create: { userId, email: user.email, telegramChatId: data.telegramId, telegramUsername: data.telegramUsername },
      update: { telegramChatId: data.telegramId, telegramUsername: data.telegramUsername },
    });
    return this.findById(userId);
  }

  async unlinkTelegram(userId: string) {
    await this.prisma.userPreferences.update({
      where: { userId },
      data: { telegramChatId: null, notificationChannel: 'email' },
    });
    return this.findById(userId);
  }

  /**
   * Attach an OAuth/OIDC identity to an existing account (account linking).
   * Throws ConflictException if the identity belongs to another account.
   * Fills the notification email when it's still a placeholder (*.local)
   * and the provider gave a real address.
   */
  async linkProvider(userId: string, profile: OidcProfile) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { preferences: true, identities: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const taken = await this.prisma.linkedIdentity.findUnique({
      where: { provider_providerSubject: { provider: profile.provider, providerSubject: profile.providerSubject } },
    });
    const legacyOwner = taken
      ? null
      : await this.prisma.user.findFirst({
          where: { provider: profile.provider, providerSubject: profile.providerSubject },
        });
    const ownerId = taken?.userId ?? legacyOwner?.id ?? null;
    if (ownerId && ownerId !== userId) {
      throw new ConflictException('This account is already linked to another user');
    }
    if (!taken && !legacyOwner) {
      await this.prisma.linkedIdentity.create({
        data: { userId, provider: profile.provider, providerSubject: profile.providerSubject },
      });
    } else if (legacyOwner && legacyOwner.id === userId && !taken) {
      // Legacy primary login without a LinkedIdentity row yet: record it.
      await this.prisma.linkedIdentity.create({
        data: { userId, provider: profile.provider, providerSubject: profile.providerSubject },
      });
    }
    if (user.preferences && /\.local$/i.test(user.preferences.email) && !/\.local$/i.test(profile.email)) {
      await this.prisma.userPreferences.update({
        where: { userId },
        data: { email: profile.email },
      });
    }
    return this.findById(userId);
  }

  /** All OAuth providers usable to log into this account (primary + linked). */
  async listLinkedProviders(userId: string): Promise<string[]> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { identities: true },
    });
    if (!user) throw new NotFoundException('User not found');
    const set = new Set<string>([user.provider, ...user.identities.map((i) => i.provider)]);
    return [...set];
  }

  /** Detach an OAuth identity, refusing to remove the last login method. */
  async unlinkProvider(userId: string, provider: string) {
    const linked = await this.listLinkedProviders(userId);
    if (!linked.includes(provider)) throw new NotFoundException('Provider not linked to this account');
    const prefs = await this.prisma.userPreferences.findUnique({ where: { userId } });
    const telegramLogin = !!prefs?.telegramChatId;
    const remaining = linked.filter((p) => p !== provider).length + (telegramLogin ? 1 : 0);
    if (remaining === 0) {
      throw new BadRequestException('Cannot remove the last login method');
    }
    await this.prisma.linkedIdentity.deleteMany({ where: { userId, provider } });
    return this.findById(userId);
  }

  /**
   * Find the account owning an OAuth identity (LinkedIdentity first,
   * then legacy primary provider/providerSubject columns).
   */
  async findIdentityOwner(profile: OidcProfile): Promise<string | null> {
    const linked = await this.prisma.linkedIdentity.findUnique({
      where: { provider_providerSubject: { provider: profile.provider, providerSubject: profile.providerSubject } },
    });
    if (linked) return linked.userId;
    const legacy = await this.prisma.user.findFirst({
      where: { provider: profile.provider, providerSubject: profile.providerSubject },
    });
    return legacy?.id ?? null;
  }

  /** Describe what merging `fromUserId` into `toUserId` would move. */
  async mergePreview(toUserId: string, fromUserId: string) {
    if (toUserId === fromUserId) throw new BadRequestException('Cannot merge an account into itself');
    const [to, from] = await Promise.all([this.findById(toUserId), this.findById(fromUserId)]);
    if (!to || !from) throw new NotFoundException('Account not found');
    const [fromFollows, toFollows, fromIdentities] = await Promise.all([
      this.prisma.followedArtifact.findMany({ where: { userId: fromUserId } }),
      this.prisma.followedArtifact.findMany({ where: { userId: toUserId } }),
      this.prisma.linkedIdentity.findMany({ where: { userId: fromUserId } }),
    ]);
    const toKeys = new Set(toFollows.map((f) => `${f.ecosystem}:${f.coordinates}`));
    return {
      from: { email: from.email, provider: from.provider },
      to: { email: to.email, provider: to.provider },
      followsToMove: fromFollows.length,
      duplicateFollows: fromFollows.filter((f) => toKeys.has(`${f.ecosystem}:${f.coordinates}`)).length,
      identitiesToMove: fromIdentities.length + 1, // + primary identity
      telegramToMove: !!from.preferences?.telegramChatId && !to.preferences?.telegramChatId,
    };
  }

  /**
   * Absorb `fromUserId` into `toUserId`: follows (+ events/deliveries),
   * identities, telegram link and missing email move over; the absorbed
   * account is deleted. The surviving account's preferences win on conflict.
   */
  async mergeAccounts(toUserId: string, fromUserId: string) {
    if (toUserId === fromUserId) throw new BadRequestException('Cannot merge an account into itself');
    const [to, from] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: toUserId }, include: { preferences: true, identities: true } }),
      this.prisma.user.findUnique({ where: { id: fromUserId }, include: { preferences: true, identities: true } }),
    ]);
    if (!to || !from) throw new NotFoundException('Account not found');

    await this.prisma.$transaction(async (tx) => {
      // 1. Identities (linked rows + legacy primary identity).
      const existingLinks = new Set(
        (await tx.linkedIdentity.findMany({ where: { userId: toUserId } }))
          .map((i) => `${i.provider}:${i.providerSubject}`),
      );
      const toMove = [
        ...from.identities.map((i) => ({ provider: i.provider, providerSubject: i.providerSubject })),
        { provider: from.provider, providerSubject: from.providerSubject },
      ];
      for (const ident of toMove) {
        if (existingLinks.has(`${ident.provider}:${ident.providerSubject}`)) continue;
        const taken = await tx.linkedIdentity.findUnique({
          where: { provider_providerSubject: ident },
        });
        if (taken) continue; // owned by a third account: leave it
        await tx.linkedIdentity.create({ data: { userId: toUserId, ...ident } });
        existingLinks.add(`${ident.provider}:${ident.providerSubject}`);
      }

      // 2. Follows (+ their events and deliveries).
      const toFollows = await tx.followedArtifact.findMany({ where: { userId: toUserId } });
      const toByKey = new Map(toFollows.map((f) => [`${f.ecosystem}:${f.coordinates}`, f]));
      const fromFollows = await tx.followedArtifact.findMany({
        where: { userId: fromUserId },
        include: { events: { include: { deliveries: true } } },
      });
      for (const fb of fromFollows) {
        const fa = toByKey.get(`${fb.ecosystem}:${fb.coordinates}`);
        if (!fa) {
          // Whole follow moves over (events included); deliveries get reassigned.
          await tx.followedArtifact.update({ where: { id: fb.id }, data: { userId: toUserId } });
          await tx.notificationDelivery.updateMany({ where: { userId: fromUserId, event: { followedArtifactId: fb.id } }, data: { userId: toUserId } });
          toByKey.set(`${fb.ecosystem}:${fb.coordinates}`, { ...fb, userId: toUserId });
          continue;
        }
        // Duplicate follow: merge events version by version.
        const faEvents = await tx.artifactVersionEvent.findMany({ where: { followedArtifactId: fa.id }, include: { deliveries: true } });
        const faByVersion = new Map(faEvents.map((e) => [e.version, e]));
        for (const eb of fb.events) {
          let targetId = faByVersion.get(eb.version)?.id;
          if (!targetId) {
            const moved = await tx.artifactVersionEvent.update({ where: { id: eb.id }, data: { followedArtifactId: fa.id } });
            targetId = moved.id;
          }
          for (const db of eb.deliveries) {
            const clash = faByVersion.get(eb.version)?.deliveries.find(
              (d) => d.userId === toUserId && d.channel === db.channel,
            ) ?? (await tx.notificationDelivery.findUnique({
              where: { eventId_userId_channel: { eventId: targetId, userId: toUserId, channel: db.channel } },
            }));
            if (clash) {
              await tx.notificationDelivery.delete({ where: { id: db.id } });
            } else {
              await tx.notificationDelivery.update({ where: { id: db.id }, data: { eventId: targetId, userId: toUserId } });
            }
          }
          // Stale duplicate event row left behind (same version already existed).
          if (faByVersion.has(eb.version)) {
            await tx.artifactVersionEvent.delete({ where: { id: eb.id } }).catch(() => {});
          } else {
            faByVersion.set(eb.version, { ...(await tx.artifactVersionEvent.findUnique({ where: { id: targetId }, include: { deliveries: true } }))! });
          }
        }
        await tx.followedArtifact.delete({ where: { id: fb.id } }).catch(() => {});
      }

      // 3. Preferences: fill gaps only (survivor wins on conflict).
      const patch: any = {};
      if (!to.preferences?.telegramChatId && from.preferences?.telegramChatId) {
        patch.telegramChatId = from.preferences.telegramChatId;
        patch.telegramUsername = from.preferences.telegramUsername;
      }
      if (to.preferences && /\.local$/i.test(to.preferences.email) && !/\.local$/i.test(from.preferences?.email ?? '')) {
        patch.email = from.preferences!.email;
      }
      if (Object.keys(patch).length && to.preferences) {
        await tx.userPreferences.update({ where: { userId: toUserId }, data: patch });
      }

      // 4. Delete the absorbed account (cascades remaining rows).
      await tx.user.delete({ where: { id: fromUserId } });
    });

    return this.findById(toUserId);
  }

  /** Permanently delete an account (cascades follows, deliveries, identities, preferences). */
  async deleteAccount(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    await this.prisma.user.delete({ where: { id: userId } });
    return { success: true };
  }

  async findById(id: string) {
    return this.prisma.user.findUnique({ where: { id }, include: { preferences: true } });
  }

  async getPreferences(userId: string) {
    const prefs = await this.prisma.userPreferences.findUnique({ where: { userId } });
    if (!prefs) throw new NotFoundException('Preferences not found');
    return prefs;
  }

  async upsertPreferences(
    userId: string,
    dto: {
      email?: string;
      notificationMode?: NotificationMode;
      digestIntervalMinutes?: number;
      locale?: string;
      theme?: string;
      notificationChannel?: string;
      telegramChatId?: string;
    },
  ) {
    const existing = await this.prisma.userPreferences.findUnique({ where: { userId } });
    // Effective values after merge (for cross-field validation).
    const channel = dto.notificationChannel ?? existing?.notificationChannel ?? 'email';
    const mode = dto.notificationMode ?? existing?.notificationMode ?? NotificationMode.DIGEST;
    const includesMail = channel === 'email' || channel === 'both';
    // Notification address: editable field, falls back to the account identity.
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    const notifyEmail = dto.email ?? existing?.email ?? user?.email ?? '';

    // Placeholder identities (Telegram login: 123@telegram.local) can't receive mail.
    if (includesMail && /\.local$/i.test(notifyEmail)) {
      throw new BadRequestException(
        'A real email address is required for mail notifications (set it in preferences)',
      );
    }

    // Immediate is Telegram-only; mail is digest-only.
    if (mode === NotificationMode.IMMEDIATE && !(IMMEDIATE_CHANNELS as readonly string[]).includes(channel)) {
      throw new BadRequestException('IMMEDIATE mode is only available for the telegram channel');
    }
    const interval = dto.digestIntervalMinutes ?? existing?.digestIntervalMinutes ?? 1440;
    if (includesMail && interval < this.mailMinDigestMinutes()) {
      throw new BadRequestException(
        `digestIntervalMinutes must be >= ${this.mailMinDigestMinutes()} for mail (daily at best)`,
      );
    }

    const data: any = {};
    if (dto.email !== undefined) data.email = dto.email;
    if (dto.notificationMode) data.notificationMode = dto.notificationMode;
    if (dto.digestIntervalMinutes !== undefined)
      data.digestIntervalMinutes = dto.digestIntervalMinutes;
    if (dto.locale && ['fr', 'en', 'es', 'de', 'zh'].includes(dto.locale)) data.locale = dto.locale;
    if (dto.theme && ['light', 'dark', 'system'].includes(dto.theme)) data.theme = dto.theme;
    if (dto.notificationChannel && ['email', 'telegram', 'both'].includes(dto.notificationChannel))
      data.notificationChannel = dto.notificationChannel;
    if (dto.telegramChatId !== undefined) data.telegramChatId = dto.telegramChatId;

    return this.prisma.userPreferences.upsert({
      where: { userId },
      create: { userId, email: dto.email ?? user?.email ?? '', ...data },
      update: data,
    });
  }
}
