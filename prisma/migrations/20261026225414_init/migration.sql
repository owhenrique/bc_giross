-- CreateTable
CREATE TABLE "cep" (
    "cep" CHAR(8) NOT NULL,
    "uf" CHAR(2) NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "cep_pkey" PRIMARY KEY ("cep")
);

-- CreateIndex
CREATE INDEX "cep_latitude_longitude_idx" ON "cep"("latitude", "longitude");
