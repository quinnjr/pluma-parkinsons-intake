-- CreateTable
CREATE TABLE "Submission" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "schemaVersion" TEXT NOT NULL,
    "zipPrefix" TEXT,
    "ageBand" TEXT,
    "sexAtBirth" TEXT,
    "markdown" TEXT NOT NULL,
    "sectionsJson" TEXT NOT NULL
);
