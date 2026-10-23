import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { UsersService } from '../src/auth/users.service';
import { createUser, resetDb } from './db';

const prisma = new PrismaClient();
const users = new UsersService(prisma as any, new ConfigService({ MAIL_MIN_DIGEST_INTERVAL_MINUTES: 1440 }));

beforeEach(() => resetDb(prisma));
afterAll(() => prisma.$disconnect());

describe('UsersService.findOrCreateFromProfile', () => {
  it('joins the account with the same email only when the provider verified it', async () => {
    const victim = await createUser(prisma, 'victim');

    const attacker = await users.findOrCreateFromProfile({
      email: victim.email,
      emailVerified: false,
      provider: 'facebook',
      providerSubject: 'fb-1',
    });
    expect(attacker!.id).not.toBe(victim.id);
    // User.email is unique: the unverified claim gets a placeholder
    expect(attacker!.email).toBe('fb-1@facebook.local');

    const sameOwner = await users.findOrCreateFromProfile({
      email: victim.email,
      emailVerified: true,
      provider: 'github',
      providerSubject: 'gh-1',
    });
    expect(sameOwner!.id).toBe(victim.id);
  });

  it('finds an account again through its linked identity', async () => {
    const first = await users.findOrCreateFromProfile({
      email: 'a@example.test',
      emailVerified: true,
      provider: 'google',
      providerSubject: 'g-1',
    });
    const again = await users.findOrCreateFromProfile({
      email: 'changed@example.test',
      emailVerified: true,
      provider: 'google',
      providerSubject: 'g-1',
    });
    expect(again!.id).toBe(first!.id);
  });
});

describe('UsersService.upsertPreferences', () => {
  it('cannot set the Telegram chat id (only the signed widget can)', async () => {
    await createUser(prisma, 'u1', { notificationChannel: 'email', notificationMode: 'DIGEST' });
    const prefs = await users.upsertPreferences('u1', { telegramChatId: '999', includePrereleases: true } as any);
    expect(prefs.telegramChatId).toBeNull();
    expect(prefs.includePrereleases).toBe(true);
  });

  it('refuses immediate mode on the mail channel', async () => {
    await createUser(prisma, 'u1', { notificationChannel: 'email', notificationMode: 'DIGEST' });
    await expect(users.upsertPreferences('u1', { notificationMode: 'IMMEDIATE' })).rejects.toThrow(
      'IMMEDIATE mode is only available for the telegram channel',
    );
  });

  it('refuses a mail digest more frequent than daily', async () => {
    await createUser(prisma, 'u1', { notificationChannel: 'email', notificationMode: 'DIGEST' });
    await expect(users.upsertPreferences('u1', { digestIntervalMinutes: 60 })).rejects.toThrow('>= 1440');
  });
});
