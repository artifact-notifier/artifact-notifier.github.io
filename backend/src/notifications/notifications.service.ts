import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from './mail/mail.service';
import { TelegramService } from '../telegram/telegram.service';
import { t } from '../i18n/notifications.i18n';
import { groupByProject, indexProjects, ProjectsByArtifact, projectsOf } from './digest';
import {
  ArtifactVersionEvent,
  Ecosystem,
  NotificationDelivery,
  NotificationMode,
  User,
  UserPreferences,
} from '@prisma/client';

const MAX_ATTEMPTS = 8;
// Retry delay after the n-th failure: 1, 2, 4… 128 min (~4h in total)
const retryDelayMs = (attempts: number) => 2 ** (attempts - 1) * 60_000;

/** A send that cannot succeed by retrying (no address, Telegram not linked). */
class PermanentDeliveryError extends Error {}

@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);
  private digestRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly telegram: TelegramService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit() {
    // Sends interrupted by a restart: hand them back to the digest
    const { count } = await this.prisma.notificationDelivery.updateMany({
      where: { status: 'SENDING' },
      data: { status: 'PENDING' },
    });
    if (count) this.logger.warn(`${count} interrupted deliveries reset to PENDING`);
  }

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
    publishedAt?: Date,
  ): Promise<void> {
    const event = await this.prisma.artifactVersionEvent.upsert({
      where: { followedArtifactId_version: { followedArtifactId, version } },
      create: { followedArtifactId, ecosystem, coordinates, version, publishedAt: publishedAt ?? new Date() },
      update: {},
    });

    const prefs = await this.prisma.userPreferences.findUnique({ where: { userId } });
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) return;
    const channels = this.getChannels(prefs);
    // Idempotent: one delivery per (event, user, channel)
    for (const ch of channels) {
      await this.prisma.notificationDelivery.upsert({
        where: { eventId_userId_channel: { eventId: event.id, userId, channel: ch } },
        create: { eventId: event.id, userId, channel: ch, status: 'PENDING' },
        update: {},
      });
    }
    if (!prefs || prefs.notificationMode === 'IMMEDIATE') {
      // Immediate is Telegram-only: mail deliveries stay PENDING for the digest cron,
      // even if a stale IMMEDIATE+mail preference row exists.
      await this.sendImmediate(user, event, prefs);
    }
    // DIGEST: leave PENDING, the cron job processes it.
  }

  private getChatId(_user: User, prefs: UserPreferences | null): string | null {
    return prefs?.telegramChatId || null;
  }

  private getChannels(prefs: UserPreferences | null): ('email' | 'telegram')[] {
    const ch = prefs?.notificationChannel || 'email';
    if (ch === 'both') return ['email', 'telegram'];
    if (ch === 'telegram') return ['telegram'];
    return ['email'];
  }

  private async sendImmediate(user: User, event: ArtifactVersionEvent, prefs: UserPreferences | null): Promise<void> {
    // Telegram-only: never send mail immediately (digest cron handles it).
    if (!this.getChannels(prefs).includes('telegram')) return;
    const delivery = await this.prisma.notificationDelivery.findUnique({
      where: { eventId_userId_channel: { eventId: event.id, userId: user.id, channel: 'telegram' } },
    });
    if (!delivery || !(await this.claim([delivery])).length) return;
    try {
      const chatId = this.getChatId(user, prefs);
      if (!chatId) throw new PermanentDeliveryError('Telegram not linked');
      const projects = projectsOf(await this.projectsByArtifact(user.id), event);
      await this.telegram.sendMessage(chatId, this.telegram.formatImmediate(event, prefs?.locale, projects));
      await this.markSent([delivery]);
    } catch (e) {
      await this.markFailed([delivery], e as Error, user.id);
    }
  }

  /** The user's project names using each artifact, to group notifications by project. */
  private async projectsByArtifact(userId: string): Promise<ProjectsByArtifact> {
    return indexProjects(
      await this.prisma.projectSource.findMany({
        where: { project: { userId } },
        select: {
          ecosystem: true,
          project: { select: { name: true } },
          dependencies: { select: { coordinates: true } },
        },
      }),
    );
  }

  /** PENDING -> SENDING, one by one: returns only the deliveries this caller now owns. */
  private async claim<D extends NotificationDelivery>(deliveries: D[]): Promise<D[]> {
    const claimed: D[] = [];
    for (const d of deliveries) {
      const { count } = await this.prisma.notificationDelivery.updateMany({
        where: { id: d.id, status: 'PENDING' },
        data: { status: 'SENDING' },
      });
      if (count === 1) claimed.push(d);
    }
    return claimed;
  }

  private async markSent(deliveries: NotificationDelivery[]) {
    await this.prisma.notificationDelivery.updateMany({
      where: { id: { in: deliveries.map((d) => d.id) } },
      data: { status: 'SENT', sentAt: new Date(), nextAttemptAt: null },
    });
  }

  /** Transient errors are retried later (backoff); permanent ones or too many attempts give FAILED. */
  private async markFailed(deliveries: NotificationDelivery[], error: Error, userId: string) {
    const permanent = error instanceof PermanentDeliveryError;
    for (const d of deliveries) {
      const attempts = d.attempts + 1;
      const giveUp = permanent || attempts >= MAX_ATTEMPTS;
      await this.prisma.notificationDelivery.update({
        where: { id: d.id },
        data: giveUp
          ? { status: 'FAILED', attempts }
          : { status: 'PENDING', attempts, nextAttemptAt: new Date(Date.now() + retryDelayMs(attempts)) },
      });
    }
    this.logger.error(
      `Send ${deliveries[0]?.channel} failed for ${userId} (${deliveries.length} deliveries${permanent ? ', permanent' : ''}): ${error.message}`,
    );
  }

  /** Minimum time between two digests of a channel. Only mail is capped (daily at best). */
  private digestIntervalMs(channel: string, prefs: UserPreferences | null): number {
    const userInterval = prefs?.digestIntervalMinutes ?? 1440;
    if (channel === 'email') {
      const minMail = Number(this.config.get('MAIL_MIN_DIGEST_INTERVAL_MINUTES') ?? 1440);
      return Math.max(userInterval, minMail) * 60_000;
    }
    // Immediate mode: what is left PENDING are retries, due right away
    return prefs?.notificationMode === NotificationMode.IMMEDIATE ? 0 : userInterval * 60_000;
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async processDigest() {
    // A slow run (SMTP) must not overlap the next tick
    if (this.digestRunning) return;
    this.digestRunning = true;
    try {
      await this.runDigest();
    } finally {
      this.digestRunning = false;
    }
  }

  private async runDigest() {
    const now = new Date();
    const due = await this.prisma.notificationDelivery.findMany({
      where: { status: 'PENDING', OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
      include: { event: true },
    });
    const byUserChannel = new Map<string, typeof due>();
    for (const d of due) {
      const key = `${d.userId}\n${d.channel}`;
      byUserChannel.set(key, [...(byUserChannel.get(key) ?? []), d]);
    }

    for (const [key, items] of byUserChannel) {
      const [userId, ch] = key.split('\n');
      const [prefs, user] = await Promise.all([
        this.prisma.userPreferences.findUnique({ where: { userId } }),
        this.prisma.user.findUnique({ where: { id: userId } }),
      ]);
      if (!user) continue;

      // Interval per channel, from the last digest actually sent on it
      const last = await this.prisma.notificationDelivery.aggregate({
        _max: { sentAt: true },
        where: { userId, channel: ch, status: 'SENT' },
      });
      const lastSent = last._max.sentAt?.getTime() ?? 0;
      if (now.getTime() - lastSent < this.digestIntervalMs(ch, prefs)) continue;

      const claimed = await this.claim(items);
      if (!claimed.length) continue;
      const lines = claimed.map((d) => ({
        coordinates: d.event.coordinates,
        ecosystem: d.event.ecosystem,
        version: d.event.version,
      }));
      const groups = groupByProject(lines, await this.projectsByArtifact(userId));
      try {
        if (ch === 'email') {
          // Notification address (editable in preferences), not the account identity.
          const to = prefs?.email && !/\.local$/i.test(prefs.email) ? prefs.email : user.email;
          if (/\.local$/i.test(to))
            throw new PermanentDeliveryError('No real email address set (Telegram-only account)');
          await this.mail.send(
            to,
            t(prefs?.locale, 'emailDigestSubject', lines.length),
            this.mail.renderDigest(groups, prefs?.locale),
          );
        } else if (ch === 'telegram') {
          const chatId = this.getChatId(user, prefs);
          if (!chatId) throw new PermanentDeliveryError('Telegram not linked');
          await this.telegram.sendMessage(chatId, this.telegram.formatDigest(groups, prefs?.locale));
        } else {
          throw new PermanentDeliveryError(`Unknown channel ${ch}`);
        }
        await this.markSent(claimed);
      } catch (e) {
        await this.markFailed(claimed, e as Error, userId);
      }
    }
  }
}
