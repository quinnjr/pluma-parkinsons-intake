-- CreateTable
CREATE TABLE "SuperfundSite" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "epaId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT,
    "county" TEXT,
    "state" TEXT NOT NULL,
    "zipCode" TEXT,
    "latitude" REAL NOT NULL,
    "longitude" REAL NOT NULL,
    "status" TEXT NOT NULL,
    "listedOn" DATETIME,
    "deletedOn" DATETIME,
    "contaminants" TEXT,
    "epaUrl" TEXT,
    "updatedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ZipCentroid" (
    "zipCode" TEXT NOT NULL PRIMARY KEY,
    "latitude" REAL NOT NULL,
    "longitude" REAL NOT NULL,
    "state" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "SuperfundSite_epaId_key" ON "SuperfundSite"("epaId");

-- CreateIndex
CREATE INDEX "SuperfundSite_state_name_idx" ON "SuperfundSite"("state", "name");

-- CreateIndex
CREATE INDEX "SuperfundSite_latitude_longitude_idx" ON "SuperfundSite"("latitude", "longitude");
