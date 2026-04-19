/*
  Warnings:

  - Added the required column `lookupCode` to the `Submission` table without a default value. This is not possible if the table is not empty.

*/
-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Submission" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "lookupCode" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "schemaVersion" TEXT NOT NULL,
    "ageBand" TEXT,
    "sexAtBirth" TEXT,
    "zipCodeEnc" TEXT,
    "markdownEnc" TEXT NOT NULL,
    "sectionsEnc" TEXT NOT NULL
);
INSERT INTO "new_Submission" ("ageBand", "createdAt", "id", "markdownEnc", "schemaVersion", "sectionsEnc", "sexAtBirth", "zipCodeEnc") SELECT "ageBand", "createdAt", "id", "markdownEnc", "schemaVersion", "sectionsEnc", "sexAtBirth", "zipCodeEnc" FROM "Submission";
DROP TABLE "Submission";
ALTER TABLE "new_Submission" RENAME TO "Submission";
CREATE UNIQUE INDEX "Submission_lookupCode_key" ON "Submission"("lookupCode");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
