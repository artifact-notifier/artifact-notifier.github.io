import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from './mail/mail.service';
import { TelegramService } from '../telegram/telegram.service';
import { t } from '../i18n/notifications.i18n';
import { ArtifactVersionEvent, Ecosystem, User, UserPreferences } from '@prisma/client';

export interface NewVersionPayload {
  followedArtifactId: string;
  ecosystem: Ecosystem;
  coordinates: string;
  version: string;
  userId: string;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly telegram: TelegramService,
  ) {}

  /**
   * Called by listeners for each (followedArtifact, version) detected.
   * Creates one ArtifactVersionEvent and one NotificationDelivery per user following it.
   */
  async onNewVersion(
    followedArtifactId: string,
    userId: string,
    ecosystem: Ecosystem,
    coordinates: string,
    version: string,
  ): Promise<void> {
    const event = await this.prisma.artifactVersionEvent.upsert({
      where: { followedArtifactId_version: { followedArtifactId, version } },
      create: { followedArtifactId, ecosystem, coordinates, version },
      update: {},
    });

    const prefs = await this.prisma.userPreferences.findUnique({ where: { userId } });
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) return;
    const channels = this.getChannels(prefs as any);
    // Idempotent: one delivery per (event, user, channel)
    for (const ch of channels) {
      await this.prisma.notificationDelivery.upsert({
        where: { eventId_userId_channel: { eventId: event.id, userId, channel: ch } },
        create: { eventId: event.id, userId, channel: ch, status: 'PENDING' },
        update: {},
      });
    }
    if (!prefs || prefs.notificationMode === 'IMMEDIATE') {
      await this.sendImmediate(user, event, prefs as any);
    }
    // DIGEST: leave PENDING, the cron job processes it.
  }

  private getChatId(user: any, prefs: any): string | null {
    return prefs?.telegramChatId || null;
  }

  private getChannels(prefs: any): ('email' | 'telegram')[] {
    const ch = prefs?.notificationChannel || 'email';
    if (ch === 'both') return ['email', 'telegram'];
    if (ch === 'telegram') return ['telegram'];
    return ['email'];
  }

  private async sendImmediate(
    user: User,
    event: ArtifactVersionEvent,
    prefs?: any,
  ): Promise<void> {
    const channels = this.getChannels(prefs);
    const chatId = this.getChatId(user as any, prefs);
    for (const ch of channels) {
      const delivery = await this.prisma.notificationDelivery.findUnique({
        where: { eventId_userId_channel: { eventId: event.id, userId: user.id, channel: ch } },
      });
      if (!delivery || delivery.status !== 'PENDING') continue;
      try {
        if (ch === 'email') {
          await this.mail.send(
            user.email,
            t(prefs?.locale, 'emailImmediateSubject', event.coordinates, event.version),
            this.mail.renderImmediate({
              coordinates: event.coordinates,
              ecosystem: event.ecosystem,
              version: event.version,
            }, prefs?.locale),
          );
          await this.prisma.notificationDelivery.update({ where: { id: delivery.id }, data: { status: 'SENT', sentAt: new Date() } });
        } else if (ch === 'telegram') {
          if (!chatId) {
            this.logger.warn(`Telegram not linked for user ${user.id}, skipping`);
            await this.prisma.notificationDelivery.update({ where: { id: delivery.id }, data: { status: 'FAILED' } });
            continue;
          }
          await this.telegram.sendMessage(chatId, this.telegram.formatImmediate(event as any, prefs?.locale));
          await this.prisma.notificationDelivery.update({ where: { id: delivery.id }, data: { status: 'SENT', sentAt: new Date() } });
        }
      } catch (e) {
        await this.prisma.notificationDelivery.update({ where: { id: delivery.id }, data: { status: 'FAILED' } });
        this.logger.error(`Send ${ch} failed for ${user.id}: ${(e as Error).message}`);
      }
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async processDigest() {
    // Find users in DIGEST mode whose interval has elapsed
    const due = await this.prisma.userPreferences.findMany({
      where: { notificationMode: 'DIGEST' },
    });

    for (const prefs of due) {
      const now = Date.now();
      const last = prefs.lastDigestSentAt?.getTime() || 0;
      if (now - last < prefs.digestIntervalMinutes * 60_000) continue;

      const pending = await this.prisma.notificationDelivery.findMany({
        where: { userId: prefs.userId, status: 'PENDING' },
        include: { event: true },
      });
      if (pending.length === 0) continue;

      const user = await this.prisma.user.findUnique({ where: { id: prefs.userId } });
      if (!user) continue;

      const chatId = this.getChatId(user as any, prefs as any);
      const byChannel = new Map<string, typeof pending>();
      for (const d of pending) { const arr = byChannel.get(d.channel) || []; arr.push(d); byChannel.set(d.channel, arr); }
      let anySent = false;
      for (const [ch, items] of byChannel) {
        try {
          if (ch === 'email') {
            await this.mail.send(user.email, t(prefs.locale, 'emailDigestSubject', items.length), this.mail.renderDigest(items.map((d) => ({ coordinates: d.event.coordinates, ecosystem: d.event.ecosystem, version: d.event.version })), prefs.locale));
          } else if (ch === 'telegram') {
            if (!chatId) throw new Error('Telegram not linked');
            await this.telegram.sendMessage(chatId, this.telegram.formatDigest(items.map((d) => ({ coordinates: d.event.coordinates, ecosystem: d.event.ecosystem, version: d.event.version })), prefs.locale));
          } else continue;
          await this.prisma.notificationDelivery.updateMany({ where: { id: { in: items.map((d) => d.id) } }, data: { status: 'SENT', sentAt: new Date() } });
          anySent = true;
        } catch (e) {
          await this.prisma.notificationDelivery.updateMany({ where: { id: { in: items.map((d) => d.id) } }, data: { status: 'FAILED' } });
          this.logger.error(`Digest ${ch} failed for ${prefs.userId}: ${(e as Error).message}`);
        }
      }
      if (anySent) await this.prisma.userPreferences.update({ where: { userId: prefs.userId }, data: { lastDigestSentAt: new Date() } });
    }
  }
}
