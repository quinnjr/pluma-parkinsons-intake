/*
  Warnings:

  - You are about to drop the column `markdown` on the `Submission` table. All the data in the column will be lost.
  - You are about to drop the column `sectionsJson` on the `Submission` table. All the data in the column will be lost.
  - You are about to drop the column `zipPrefix` on the `Submission` table. All the data in the column will be lost.
  - Added the required column `markdownEnc` to the `Submission` table without a default value. This is not possible if the table is not empty.
  - Added the required column `sectionsEnc` to the `Submission` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Submission" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "schemaVersion" TEXT NOT NULL,
    "ageBand" TEXT,
    "sexAtBirth" TEXT,
    "zipCodeEnc" TEXT,
    "markdownEnc" TEXT NOT NULL,
    "sectionsEnc" TEXT NOT NULL
);
INSERT INTO "new_Submission" ("ageBand", "createdAt", "id", "schemaVersion", "sexAtBirth") SELECT "ageBand", "createdAt", "id", "schemaVersion", "sexAtBirth" FROM "Submission";
DROP TABLE "Submission";
ALTER TABLE "new_Submission" RENAME TO "Submission";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
