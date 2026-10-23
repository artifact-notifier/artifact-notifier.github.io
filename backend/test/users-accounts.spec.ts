import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { UsersService } from '../src/auth/users.service';
import { createUser, resetDb } from './db';

const prisma = new PrismaClient();
const users = new UsersService(prisma as any, new ConfigService({ MAIL_MIN_DIGEST_INTERVAL_MINUTES: 1440 }));
const profile = (provider: string, sub: string, email = `${sub}@example.test`) => ({
  email,
  emailVerified: true,
  provider,
  providerSubject: sub,
});

beforeEach(() => resetDb(prisma));
afterAll(() => prisma.$disconnect());

describe('Telegram accounts', () => {
  const tg = { telegramId: '777', telegramUsername: 'jdoe', email: '777@telegram.local', name: 'J' };

  it('creates a Telegram-only account in immediate Telegram mode, then finds it again', async () => {
    const created = await users.findOrCreateFromTelegram(tg);
    expect(created.preferences).toMatchObject({
      notificationChannel: 'telegram',
      notificationMode: 'IMMEDIATE',
      telegramChatId: '777',
    });
    expect((await users.findOrCreateFromTelegram(tg)).id).toBe(created.id);
  });

  it('finds the account that linked this Telegram id', async () => {
    const u = await createUser(prisma, 'u1');
    await users.linkTelegram('u1', { telegramId: '777', telegramUsername: 'jdoe' });
    expect((await users.findOrCreateFromTelegram(tg)).id).toBe(u.id);
  });

  it('refuses to link a Telegram id owned by another account', async () => {
    await createUser(prisma, 'u1');
    await createUser(prisma, 'u2');
    await users.linkTelegram('u1', { telegramId: '777' });
    await expect(users.linkTelegram('u2', { telegramId: '777' })).rejects.toThrow('already linked');
    await expect(users.linkTelegram('missing', { telegramId: '888' })).rejects.toThrow('User not found');
  });

  it('unlinking falls back to mail', async () => {
    await createUser(prisma, 'u1', { notificationChannel: 'telegram', telegramChatId: '777' });
    const u = await users.unlinkTelegram('u1');
    expect(u!.preferences).toMatchObject({ telegramChatId: null, notificationChannel: 'email' });
  });
});

describe('OAuth identities', () => {
  it('attaches a legacy primary identity on login', async () => {
    await createUser(prisma, 'legacy'); // provider 'test', subject 'legacy', no LinkedIdentity row
    const u = await users.findOrCreateFromProfile(profile('test', 'legacy'));
    expect(u!.id).toBe('legacy');
    expect(await prisma.linkedIdentity.count({ where: { userId: 'legacy' } })).toBe(1);
  });

  it('links, lists and unlinks providers but keeps a login method', async () => {
    await createUser(prisma, 'u1', { email: 'u1@telegram.local' });
    await users.linkProvider('u1', profile('github', 'gh-1', 'real@example.test'));
    expect((await users.listLinkedProviders('u1')).sort()).toEqual(['github', 'test']);
    // a real address replaces the Telegram placeholder
    expect((await prisma.userPreferences.findUnique({ where: { userId: 'u1' } }))!.email).toBe('real@example.test');

    await users.unlinkProvider('u1', 'github');
    expect(await users.listLinkedProviders('u1')).toEqual(['test']);
    await expect(users.unlinkProvider('u1', 'google')).rejects.toThrow('not linked');
  });

  it('refuses to remove the last login method', async () => {
    const u = await users.findOrCreateFromProfile(profile('google', 'g-1'));
    await expect(users.unlinkProvider(u!.id, 'google')).rejects.toThrow('last login method');
  });

  it('refuses an identity that belongs to another account', async () => {
    await createUser(prisma, 'u1');
    const other = await users.findOrCreateFromProfile(profile('github', 'gh-1'));
    await expect(users.linkProvider('u1', profile('github', 'gh-1'))).rejects.toThrow('already linked');
    expect(await users.findIdentityOwner(profile('github', 'gh-1'))).toBe(other!.id);
    expect(await users.findIdentityOwner(profile('github', 'nobody'))).toBeNull();
    await expect(users.listLinkedProviders('missing')).rejects.toThrow('User not found');
  });
});

describe('account merge and deletion', () => {
  async function seedAccounts() {
    await createUser(prisma, 'to', { email: 'to@telegram.local' });
    await createUser(prisma, 'from', { telegramChatId: '42', telegramUsername: 'tg' });
    await prisma.linkedIdentity.create({ data: { userId: 'from', provider: 'github', providerSubject: 'gh-1' } });
    const shared = await prisma.followedArtifact.create({
      data: { userId: 'to', ecosystem: 'NPM', coordinates: 'shared' },
    });
    const dup = await prisma.followedArtifact.create({
      data: { userId: 'from', ecosystem: 'NPM', coordinates: 'shared' },
    });
    await prisma.followedArtifact.create({ data: { userId: 'from', ecosystem: 'NPM', coordinates: 'only-from' } });
    // same version on both duplicate follows, plus one only on the absorbed side
    const toEvent = await prisma.artifactVersionEvent.create({
      data: { followedArtifactId: shared.id, ecosystem: 'NPM', coordinates: 'shared', version: '1.0.0' },
    });
    await prisma.notificationDelivery.create({ data: { eventId: toEvent.id, userId: 'to', channel: 'email' } });
    for (const version of ['1.0.0', '1.1.0']) {
      const e = await prisma.artifactVersionEvent.create({
        data: { followedArtifactId: dup.id, ecosystem: 'NPM', coordinates: 'shared', version },
      });
      await prisma.notificationDelivery.create({ data: { eventId: e.id, userId: 'from', channel: 'email' } });
    }
  }

  it('previews what a merge moves', async () => {
    await seedAccounts();
    expect(await users.mergePreview('to', 'from')).toMatchObject({
      followsToMove: 2,
      duplicateFollows: 1,
      identitiesToMove: 2,
      telegramToMove: true,
    });
    await expect(users.mergePreview('to', 'to')).rejects.toThrow('into itself');
    await expect(users.mergePreview('to', 'missing')).rejects.toThrow('not found');
  });

  it('absorbs follows, events, deliveries, identities and Telegram, then deletes the account', async () => {
    await seedAccounts();
    await users.mergeAccounts('to', 'from');

    expect(await prisma.user.findUnique({ where: { id: 'from' } })).toBeNull();
    const follows = await prisma.followedArtifact.findMany({
      where: { userId: 'to' },
      include: { events: { include: { deliveries: true } } },
      orderBy: { coordinates: 'asc' },
    });
    expect(follows.map((f) => f.coordinates)).toEqual(['only-from', 'shared']);
    const shared = follows[1];
    expect(shared.events.map((e) => e.version).sort()).toEqual(['1.0.0', '1.1.0']);
    // the duplicate delivery of 1.0.0 was dropped, the other one moved
    expect(shared.events.flatMap((e) => e.deliveries).every((d) => d.userId === 'to')).toBe(true);
    expect(shared.events.find((e) => e.version === '1.0.0')!.deliveries).toHaveLength(1);

    expect((await users.listLinkedProviders('to')).sort()).toEqual(['github', 'test']);
    expect(await prisma.userPreferences.findUnique({ where: { userId: 'to' } })).toMatchObject({
      telegramChatId: '42',
      email: 'from@example.test',
    });
    await expect(users.mergeAccounts('to', 'to')).rejects.toThrow('into itself');
    await expect(users.mergeAccounts('to', 'missing')).rejects.toThrow('not found');
  });

  it('deletes an account and everything attached to it', async () => {
    await createUser(prisma, 'u1');
    await prisma.followedArtifact.create({ data: { userId: 'u1', ecosystem: 'NPM', coordinates: 'x' } });
    expect(await users.deleteAccount('u1')).toEqual({ success: true });
    expect(await prisma.followedArtifact.count()).toBe(0);
    await expect(users.deleteAccount('u1')).rejects.toThrow('User not found');
  });
});

describe('preferences edge cases', () => {
  it('requires a real address for mail and existing preferences to read', async () => {
    await createUser(prisma, 'u1', { email: 'u1@telegram.local', notificationChannel: 'email' });
    await expect(users.upsertPreferences('u1', { notificationChannel: 'email' })).rejects.toThrow('real email');
    await expect(users.getPreferences('missing')).rejects.toThrow('Preferences not found');
  });

  it('accepts locale, theme and channel changes', async () => {
    await createUser(prisma, 'u1', {
      notificationChannel: 'telegram',
      telegramChatId: '1',
      notificationMode: 'DIGEST',
    });
    const p = await users.upsertPreferences('u1', {
      locale: 'de',
      theme: 'light',
      notificationMode: 'IMMEDIATE',
      digestIntervalMinutes: 60,
      email: 'me@example.test',
    });
    expect(p).toMatchObject({ locale: 'de', theme: 'light', notificationMode: 'IMMEDIATE', digestIntervalMinutes: 60 });
  });
});
