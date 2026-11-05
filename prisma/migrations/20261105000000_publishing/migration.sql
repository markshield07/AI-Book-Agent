-- Phase 2: publishing settings and book details (nullable JSON stored as TEXT in SQLite).
ALTER TABLE "Project" ADD COLUMN "publishing" JSONB;
