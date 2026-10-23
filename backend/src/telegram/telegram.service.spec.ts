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

describe('TelegramService.sendMessage', () => {
  const service = new TelegramService(new ConfigService({ TELEGRAM_BOT_TOKEN: BOT_TOKEN, TELEGRAM_ENABLED: 'true' }));

  afterEach(() => jest.restoreAllMocks());

  it('posts an HTML message to the Bot API', async () => {
    const fetch = jest.spyOn(global, 'fetch').mockResolvedValue(new Response('{"ok":true}'));
    await service.sendMessage('42', '<b>hi</b>');
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`);
    expect(JSON.parse(String(init!.body))).toMatchObject({ chat_id: '42', text: '<b>hi</b>', parse_mode: 'HTML' });
  });

  it('throws on API errors', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response('chat not found', { status: 400 }));
    jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);
    await expect(service.sendMessage('42', 'x')).rejects.toThrow('chat not found');
  });

  it('requires a bot token', async () => {
    const unconfigured = new TelegramService(new ConfigService({}));
    const saved = process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_BOT_TOKEN;
    try {
      expect(unconfigured.isEnabled()).toBe(false);
      await expect(unconfigured.sendMessage('42', 'x')).rejects.toThrow('not configured');
    } finally {
      process.env.TELEGRAM_BOT_TOKEN = saved;
    }
  });

  it('is enabled only when flagged and configured', () => {
    expect(service.isEnabled()).toBe(true);
    expect(service.getBotUsername()).toBe('notifier_test_bot');
  });
});
