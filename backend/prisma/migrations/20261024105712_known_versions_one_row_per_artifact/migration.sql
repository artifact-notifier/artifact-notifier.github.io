-- One row per artifact (JSON array) instead of one row per version:
-- following a few dozen popular packages wrote tens of thousands of rows.

-- CreateTable
CREATE TABLE "KnownVersions" (
    "ecosystem" TEXT NOT NULL,
    "coordinates" TEXT NOT NULL,
    "versions" TEXT NOT NULL,

    PRIMARY KEY ("ecosystem", "coordinates")
);

-- Keep what is already known (else every artifact would be re-baselined)
INSERT INTO "KnownVersions" ("ecosystem", "coordinates", "versions")
SELECT "ecosystem", "coordinates", json_group_array("version")
FROM "KnownVersion"
GROUP BY "ecosystem", "coordinates";

-- DropTable
DROP TABLE "KnownVersion";
