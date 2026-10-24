-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Project_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProjectSource" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "ecosystem" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProjectSource_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProjectDependency" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceId" TEXT NOT NULL,
    "coordinates" TEXT NOT NULL,
    "declared" TEXT,
    "version" TEXT,
    "scope" TEXT NOT NULL,
    CONSTRAINT "ProjectDependency_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "ProjectSource" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Project_userId_name_key" ON "Project"("userId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectSource_projectId_label_key" ON "ProjectSource"("projectId", "label");

-- CreateIndex
CREATE INDEX "ProjectDependency_coordinates_idx" ON "ProjectDependency"("coordinates");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectDependency_sourceId_coordinates_key" ON "ProjectDependency"("sourceId", "coordinates");
