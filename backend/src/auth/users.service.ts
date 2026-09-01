import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OidcProfile } from './oidc.types';
import { NotificationMode } from '@prisma/client';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

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
            notificationMode: NotificationMode.IMMEDIATE,
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
    // Uniqueness is now enforced via UserPreferences.telegramChatId (@unique) + provider/providerSubject
    const existing = await this.prisma.userPreferences.findFirst({
      where: { telegramChatId: data.telegramId },
      include: { user: { include: { preferences: true } } },
    });
    if (existing?.user) return existing.user;

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
      notificationMode?: NotificationMode;
      digestIntervalMinutes?: number;
      locale?: string;
      theme?: string;
      notificationChannel?: string;
      telegramChatId?: string;
    },
  ) {
    const data: any = {};
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
      create: { userId, email: (await this.prisma.user.findUnique({ where: { id: userId } }))?.email ?? '', ...data },
      update: data,
    });
  }
}
