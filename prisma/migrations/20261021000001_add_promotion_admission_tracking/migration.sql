-- Migration: add_promotion_admission_tracking
-- Safe: adds two NULLABLE columns only. Zero data loss. Idempotent (IF NOT EXISTS).

ALTER TABLE "StudentProgression"
  ADD COLUMN IF NOT EXISTS "old_admission_no" TEXT,
  ADD COLUMN IF NOT EXISTS "new_admission_no" TEXT;
