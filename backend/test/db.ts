import { PrismaClient } from '@prisma/client';

/** Empties every table, children first (SQLite FKs). */
export async function resetDb(prisma: PrismaClient) {
  await prisma.projectDependency.deleteMany();
  await prisma.projectSource.deleteMany();
  await prisma.project.deleteMany();
  await prisma.notificationDelivery.deleteMany();
  await prisma.artifactVersionEvent.deleteMany();
  await prisma.followedArtifact.deleteMany();
  await prisma.knownVersion.deleteMany();
  await prisma.linkedIdentity.deleteMany();
  await prisma.userPreferences.deleteMany();
  await prisma.user.deleteMany();
  await prisma.listenerSequence.deleteMany();
}

export async function createUser(
  prisma: PrismaClient,
  id: string,
  prefs: Partial<Parameters<PrismaClient['userPreferences']['create']>[0]['data']> = {},
) {
  return prisma.user.create({
    data: {
      id,
      email: `${id}@example.test`,
      provider: 'test',
      providerSubject: id,
      preferences: { create: { email: `${id}@example.test`, ...(prefs as object) } },
    },
    include: { preferences: true },
  });
}
