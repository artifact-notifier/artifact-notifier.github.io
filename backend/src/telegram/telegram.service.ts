import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { t } from '../i18n/notifications.i18n';

function escapeHtml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface TelegramAuthData {
  id: string;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: string;
  hash: string;
}

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);

  constructor(private readonly config: ConfigService) {}

  getBotToken(): string | undefined {
    return this.config.get<string>('TELEGRAM_BOT_TOKEN') || process.env.TELEGRAM_BOT_TOKEN;
  }

  getBotUsername(): string | undefined {
    return this.config.get<string>('TELEGRAM_BOT_USERNAME') || process.env.TELEGRAM_BOT_USERNAME;
  }

  isConfigured(): boolean {
    return !!this.getBotToken();
  }

  // Feature flag: Telegram login/link is temporarily disabled (does not work yet).
  // Set TELEGRAM_ENABLED=true once fixed. Defaults to false.
  isEnabled(): boolean {
    const flag =
      this.config.get<string>('TELEGRAM_ENABLED') || process.env.TELEGRAM_ENABLED;
    return flag === 'true' && this.isConfigured();
  }

  verifyAuthData(data: TelegramAuthData): boolean {
    const token = this.getBotToken();
    if (!token) throw new UnauthorizedException('Telegram bot not configured');
    const { hash, ...rest } = data;
    // Build data_check_string: sorted keys except hash, as key=value\n
    const checkString = Object.keys(rest)
      .sort()
      .map((k) => `${k}=${(rest as any)[k]}`)
      .join('\n');
    const secret = crypto.createHash('sha256').update(token).digest();
    const hmac = crypto.createHmac('sha256', secret).update(checkString).digest('hex');
    const a = Buffer.from(hmac, 'hex');
    const b = Buffer.from(hash || '', 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
    // Check auth_date freshness (24h)
    const authDate = parseInt(data.auth_date, 10);
    if (Number.isNaN(authDate)) return false;
    const now = Math.floor(Date.now() / 1000);
    if (now - authDate > 86400) return false;
    return true;
  }

  async sendMessage(chatId: string, text: string): Promise<void> {
    const token = this.getBotToken();
    if (!token) {
      throw new Error('Telegram bot token not configured (TELEGRAM_BOT_TOKEN)');
    }
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      this.logger.error(`Telegram send failed: ${res.status} ${body}`);
      throw new Error(`Telegram send failed: ${body}`);
    }
  }

  formatImmediate(artifact: { coordinates: string; ecosystem: string; version: string }, locale?: string): string {
    return t(
      locale,
      'telegramImmediate',
      escapeHtml(artifact.ecosystem),
      escapeHtml(artifact.coordinates),
      escapeHtml(artifact.version),
    );
  }

  formatDigest(items: { coordinates: string; ecosystem: string; version: string }[], locale?: string): string {
    let txt = `${t(locale, 'telegramDigestHeader', items.length)}\n\n`;
    for (const it of items) {
      txt += `• ${escapeHtml(it.ecosystem)} <code>${escapeHtml(it.coordinates)}</code> → <b>${escapeHtml(it.version)}</b>\n`;
    }
    return txt;
  }
}
