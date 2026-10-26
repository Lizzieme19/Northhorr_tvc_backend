-- ============================================================
-- Migration: add_registrar_role
-- ============================================================
-- SAFE: ALTER TYPE ... ADD VALUE only adds a new label to the
-- "Role" enum. No existing user rows are modified.
-- Cannot run inside a transaction block (Postgres restriction).
-- ============================================================

-- AlterEnum: Add REGISTRAR value to Role
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'REGISTRAR';
