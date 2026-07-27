-- This script creates Staff records for existing STAFF role users who don't have them
-- Run this in the production database to fix the "Staff profile not found" error

-- First, let's identify STAFF role users without Staff records
-- This is a reference query - the actual work will be done by the application script
