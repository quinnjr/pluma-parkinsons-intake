-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Submission" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "lookupCode" TEXT NOT NULL,
    "ownerId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "schemaVersion" TEXT NOT NULL,
    "ageBand" TEXT,
    "sexAtBirth" TEXT,
    "zipCodeEnc" TEXT,
    "markdownEnc" TEXT NOT NULL,
    "sectionsEnc" TEXT NOT NULL,
    CONSTRAINT "Submission_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Submission" ("ageBand", "createdAt", "id", "lookupCode", "markdownEnc", "schemaVersion", "sectionsEnc", "sexAtBirth", "zipCodeEnc") SELECT "ageBand", "createdAt", "id", "lookupCode", "markdownEnc", "schemaVersion", "sectionsEnc", "sexAtBirth", "zipCodeEnc" FROM "Submission";
DROP TABLE "Submission";
ALTER TABLE "new_Submission" RENAME TO "Submission";
CREATE UNIQUE INDEX "Submission_lookupCode_key" ON "Submission"("lookupCode");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
