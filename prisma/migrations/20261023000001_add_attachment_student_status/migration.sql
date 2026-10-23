-- ============================================================
-- Migration: add_attachment_student_status
-- ============================================================
-- SAFE: PostgreSQL ALTER TYPE ... ADD VALUE is a non-destructive
-- operation. It only adds a new label to the enum; it does NOT
-- modify, delete, or re-encode any existing rows in the Student
-- table. All current ACTIVE / GRADUATED / WITHDRAWN / DEFERRED
-- records remain 100% intact.
--
-- This migration CANNOT be rolled back inside a transaction
-- (Postgres restriction on DDL enum changes), so it runs outside
-- a transaction block. That is intentional and safe.
-- ============================================================

-- AlterEnum: Add ATTACHMENT value to StudentStatus
-- (No existing rows are changed — only new rows can use this value)
ALTER TYPE "StudentStatus" ADD VALUE IF NOT EXISTS 'ATTACHMENT';
