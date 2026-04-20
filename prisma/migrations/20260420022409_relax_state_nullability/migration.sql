-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ZipCentroid" (
    "zipCode" TEXT NOT NULL PRIMARY KEY,
    "latitude" REAL NOT NULL,
    "longitude" REAL NOT NULL,
    "state" TEXT
);
INSERT INTO "new_ZipCentroid" ("latitude", "longitude", "state", "zipCode") SELECT "latitude", "longitude", "state", "zipCode" FROM "ZipCentroid";
DROP TABLE "ZipCentroid";
ALTER TABLE "new_ZipCentroid" RENAME TO "ZipCentroid";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
