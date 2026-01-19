-- Apple Notes MCP Server - PostgreSQL Schema
-- Requires: pgvector and pg_trgm extensions

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Main notes table
CREATE TABLE IF NOT EXISTS notes (
    id SERIAL PRIMARY KEY,
    apple_note_id TEXT UNIQUE,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    html_content TEXT,
    folder_path TEXT,
    creation_date TIMESTAMPTZ,
    modification_date TIMESTAMPTZ,
    content_hash TEXT,
    has_images BOOLEAN DEFAULT FALSE,
    embedding vector(384),
    indexed_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexing jobs for tracking batch progress
CREATE TABLE IF NOT EXISTS indexing_jobs (
    id SERIAL PRIMARY KEY,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    total_notes INTEGER DEFAULT 0,
    processed_notes INTEGER DEFAULT 0,
    failed_notes INTEGER DEFAULT 0,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'paused'))
);

-- Vector similarity search index (IVFFlat)
-- Note: For best performance, create this AFTER initial data load
CREATE INDEX IF NOT EXISTS idx_notes_embedding ON notes
    USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Full-text search indexes using trigrams
CREATE INDEX IF NOT EXISTS idx_notes_title_trgm ON notes USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_notes_content_trgm ON notes USING gin (content gin_trgm_ops);

-- Utility indexes
CREATE INDEX IF NOT EXISTS idx_notes_modification ON notes (modification_date DESC);
CREATE INDEX IF NOT EXISTS idx_notes_content_hash ON notes (content_hash);
CREATE INDEX IF NOT EXISTS idx_notes_apple_note_id ON notes (apple_note_id);
CREATE INDEX IF NOT EXISTS idx_notes_has_images ON notes (has_images);
