-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "father_email" TEXT,
ADD COLUMN     "father_name" TEXT,
ADD COLUMN     "father_occupation" TEXT,
ADD COLUMN     "father_phone" TEXT,
ADD COLUMN     "father_present" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "mother_email" TEXT,
ADD COLUMN     "mother_name" TEXT,
ADD COLUMN     "mother_occupation" TEXT,
ADD COLUMN     "mother_phone" TEXT,
ADD COLUMN     "mother_present" BOOLEAN NOT NULL DEFAULT true;
