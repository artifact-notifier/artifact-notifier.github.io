/*
  Warnings:

  - You are about to drop the column `lastDigestSentAt` on the `UserPreferences` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_UserPreferences" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "notificationMode" TEXT NOT NULL DEFAULT 'IMMEDIATE',
    "digestIntervalMinutes" INTEGER NOT NULL DEFAULT 1440,
    "locale" TEXT NOT NULL DEFAULT 'fr',
    "theme" TEXT NOT NULL DEFAULT 'system',
    "notificationChannel" TEXT NOT NULL DEFAULT 'email',
    "includePrereleases" BOOLEAN NOT NULL DEFAULT false,
    "telegramChatId" TEXT,
    "telegramUsername" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UserPreferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_UserPreferences" ("createdAt", "digestIntervalMinutes", "email", "includePrereleases", "locale", "notificationChannel", "notificationMode", "telegramChatId", "telegramUsername", "theme", "updatedAt", "userId") SELECT "createdAt", "digestIntervalMinutes", "email", "includePrereleases", "locale", "notificationChannel", "notificationMode", "telegramChatId", "telegramUsername", "theme", "updatedAt", "userId" FROM "UserPreferences";
DROP TABLE "UserPreferences";
ALTER TABLE "new_UserPreferences" RENAME TO "UserPreferences";
CREATE UNIQUE INDEX "UserPreferences_telegramChatId_key" ON "UserPreferences"("telegramChatId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
