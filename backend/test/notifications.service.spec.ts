import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { NotificationsService } from '../src/notifications/notifications.service';
import { createUser, resetDb } from './db';

const prisma = new PrismaClient();
const mail = { send: jest.fn(), renderDigest: jest.fn(() => '<html>') };
const telegram = {
  sendMessage: jest.fn(),
  formatImmediate: jest.fn(() => 'immediate'),
  formatDigest: jest.fn(() => 'digest'),
};
const notifications = new NotificationsService(
  prisma as any,
  mail as any,
  telegram as any,
  new ConfigService({ MAIL_MIN_DIGEST_INTERVAL_MINUTES: 1440 }),
);

async function follow(userId: string) {
  return prisma.followedArtifact.create({ data: { userId, ecosystem: 'NPM', coordinates: 'pkg' } });
}

const deliveries = (userId: string) =>
  prisma.notificationDelivery.findMany({ where: { userId }, include: { event: true }, orderBy: { channel: 'asc' } });

beforeEach(async () => {
  await resetDb(prisma);
  jest.clearAllMocks();
});
afterAll(() => prisma.$disconnect());

describe('NotificationsService', () => {
  it('sends Telegram immediately in IMMEDIATE mode, once', async () => {
    await createUser(prisma, 'u1', {
      notificationMode: 'IMMEDIATE',
      notificationChannel: 'telegram',
      telegramChatId: '42',
    });
    const fa = await follow('u1');

    await notifications.onNewVersion(fa.id, 'u1', 'NPM', 'pkg', '1.0.0');
    await notifications.processDigest();

    expect(telegram.sendMessage).toHaveBeenCalledTimes(1);
    expect(telegram.sendMessage).toHaveBeenCalledWith('42', 'immediate');
    expect((await deliveries('u1')).map((d) => d.status)).toEqual(['SENT']);
  });

  it('never sends the same digest twice when runs overlap', async () => {
    await createUser(prisma, 'u1', { notificationMode: 'DIGEST', notificationChannel: 'email' });
    const fa = await follow('u1');
    await notifications.onNewVersion(fa.id, 'u1', 'NPM', 'pkg', '1.0.0');

    await Promise.all([notifications.processDigest(), notifications.processDigest()]);

    expect(mail.send).toHaveBeenCalledTimes(1);
  });

  it('retries a transient failure after a backoff instead of dropping it', async () => {
    await createUser(prisma, 'u1', { notificationMode: 'DIGEST', notificationChannel: 'email' });
    const fa = await follow('u1');
    await notifications.onNewVersion(fa.id, 'u1', 'NPM', 'pkg', '1.0.0');

    mail.send.mockRejectedValueOnce(new Error('SMTP down'));
    await notifications.processDigest();
    let [d] = await deliveries('u1');
    expect(d).toMatchObject({ status: 'PENDING', attempts: 1 });
    expect(d.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now());

    // still in backoff: nothing is sent
    await notifications.processDigest();
    expect(mail.send).toHaveBeenCalledTimes(1);

    await prisma.notificationDelivery.update({
      where: { id: d.id },
      data: { nextAttemptAt: new Date(Date.now() - 1) },
    });
    await notifications.processDigest();
    [d] = await deliveries('u1');
    expect(d.status).toBe('SENT');
    expect(mail.send).toHaveBeenCalledTimes(2);
  });

  it('fails at once when retrying cannot help', async () => {
    await createUser(prisma, 'u1', { notificationMode: 'DIGEST', notificationChannel: 'telegram' });
    const fa = await follow('u1');
    await notifications.onNewVersion(fa.id, 'u1', 'NPM', 'pkg', '1.0.0');

    await notifications.processDigest(); // Telegram not linked

    const [d] = await deliveries('u1');
    expect(d).toMatchObject({ status: 'FAILED', attempts: 1 });
  });

  it('caps only mail at one digest a day, not Telegram', async () => {
    await createUser(prisma, 'u1', {
      notificationMode: 'DIGEST',
      notificationChannel: 'both',
      telegramChatId: '42',
      digestIntervalMinutes: 60,
    });
    const fa = await follow('u1');
    await notifications.onNewVersion(fa.id, 'u1', 'NPM', 'pkg', '1.0.0');
    await notifications.processDigest();
    expect(mail.send).toHaveBeenCalledTimes(1);
    expect(telegram.sendMessage).toHaveBeenCalledTimes(1);

    // one hour and a bit later, a new version
    await prisma.notificationDelivery.updateMany({ data: { sentAt: new Date(Date.now() - 61 * 60_000) } });
    await notifications.onNewVersion(fa.id, 'u1', 'NPM', 'pkg', '1.0.1');
    await notifications.processDigest();

    const latest = (await deliveries('u1')).filter((d) => d.event.version === '1.0.1');
    expect(latest.map((d) => `${d.channel}:${d.status}`)).toEqual(['email:PENDING', 'telegram:SENT']);
  });

  it('hands interrupted sends back to the digest on startup', async () => {
    await createUser(prisma, 'u1');
    const fa = await follow('u1');
    await notifications.onNewVersion(fa.id, 'u1', 'NPM', 'pkg', '1.0.0');
    await prisma.notificationDelivery.updateMany({ data: { status: 'SENDING' } });

    await notifications.onModuleInit();

    expect((await deliveries('u1')).map((d) => d.status)).toEqual(['PENDING']);
  });
});
