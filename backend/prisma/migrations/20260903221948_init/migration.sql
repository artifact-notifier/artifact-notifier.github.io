-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "avatarUrl" TEXT,
    "provider" TEXT NOT NULL,
    "providerSubject" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "LinkedIdentity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerSubject" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LinkedIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UserPreferences" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "notificationMode" TEXT NOT NULL DEFAULT 'IMMEDIATE',
    "digestIntervalMinutes" INTEGER NOT NULL DEFAULT 1440,
    "locale" TEXT NOT NULL DEFAULT 'fr',
    "theme" TEXT NOT NULL DEFAULT 'system',
    "notificationChannel" TEXT NOT NULL DEFAULT 'email',
    "telegramChatId" TEXT,
    "telegramUsername" TEXT,
    "lastDigestSentAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UserPreferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FollowedArtifact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "ecosystem" TEXT NOT NULL,
    "coordinates" TEXT NOT NULL,
    "currentVersion" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FollowedArtifact_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ArtifactVersionEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "followedArtifactId" TEXT NOT NULL,
    "ecosystem" TEXT NOT NULL,
    "coordinates" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "publishedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ArtifactVersionEvent_followedArtifactId_fkey" FOREIGN KEY ("followedArtifactId") REFERENCES "FollowedArtifact" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NotificationDelivery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "channel" TEXT NOT NULL DEFAULT 'email',
    "sentAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NotificationDelivery_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "ArtifactVersionEvent" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "NotificationDelivery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ListenerSequence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "LinkedIdentity_provider_providerSubject_key" ON "LinkedIdentity"("provider", "providerSubject");

-- CreateIndex
CREATE UNIQUE INDEX "UserPreferences_telegramChatId_key" ON "UserPreferences"("telegramChatId");

-- CreateIndex
CREATE UNIQUE INDEX "FollowedArtifact_userId_ecosystem_coordinates_key" ON "FollowedArtifact"("userId", "ecosystem", "coordinates");

-- CreateIndex
CREATE UNIQUE INDEX "ArtifactVersionEvent_followedArtifactId_version_key" ON "ArtifactVersionEvent"("followedArtifactId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationDelivery_eventId_userId_channel_key" ON "NotificationDelivery"("eventId", "userId", "channel");
