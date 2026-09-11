-- CreateEnum
CREATE TYPE "DoctorStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- AlterTable
ALTER TABLE "doctors" ADD COLUMN     "status" "DoctorStatus" NOT NULL DEFAULT 'ACTIVE';
