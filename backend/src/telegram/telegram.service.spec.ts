import * as crypto from 'crypto';
import { ConfigService } from '@nestjs/config';
import { TelegramAuthData, TelegramService } from './telegram.service';

const BOT_TOKEN = '123456:TEST-TOKEN';

function signed(data: Omit<TelegramAuthData, 'hash'>): TelegramAuthData {
  const checkString = Object.keys(data)
    .sort()
    .map((k) => `${k}=${(data as any)[k]}`)
    .join('\n');
  const secret = crypto.createHash('sha256').update(BOT_TOKEN).digest();
  return { ...data, hash: crypto.createHmac('sha256', secret).update(checkString).digest('hex') };
}

describe('TelegramService', () => {
  const service = new TelegramService(new ConfigService({ TELEGRAM_BOT_TOKEN: BOT_TOKEN }));
  const now = () => String(Math.floor(Date.now() / 1000));

  describe('verifyAuthData', () => {
    it('accepts a payload signed with the bot token', () => {
      expect(service.verifyAuthData(signed({ id: '42', username: 'jdoe', auth_date: now() }))).toBe(true);
    });

    it('rejects a tampered payload', () => {
      const data = signed({ id: '42', auth_date: now() });
      expect(service.verifyAuthData({ ...data, id: '43' })).toBe(false);
    });

    it('rejects a malformed hash', () => {
      expect(service.verifyAuthData({ id: '42', auth_date: now(), hash: 'zz' })).toBe(false);
    });

    it('rejects payloads older than 24h', () => {
      const old = String(Math.floor(Date.now() / 1000) - 86_401);
      expect(service.verifyAuthData(signed({ id: '42', auth_date: old }))).toBe(false);
    });
  });

  describe('message formatting', () => {
    it('escapes HTML in immediate messages', () => {
      const msg = service.formatImmediate({ ecosystem: 'NPM', coordinates: '<b>&x', version: '1.0"' }, 'en');
      expect(msg).toContain('&lt;b&gt;&amp;x');
      expect(msg).toContain('1.0&quot;');
      expect(msg).not.toContain('<b>&x');
    });

    it('escapes HTML in digests', () => {
      const msg = service.formatDigest([{ ecosystem: 'MAVEN', coordinates: 'g:a<script>', version: '1' }], 'fr');
      expect(msg).toContain('g:a&lt;script&gt;');
    });
  });
});
