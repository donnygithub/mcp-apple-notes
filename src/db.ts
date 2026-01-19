import pg from "pg";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Connection pool
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://localhost:5432/apple_notes",
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Types
export interface NoteRecord {
  id: number;
  apple_note_id: string | null;
  title: string;
  content: string;
  html_content: string | null;
  folder_path: string | null;
  creation_date: Date | null;
  modification_date: Date | null;
  content_hash: string | null;
  has_images: boolean | null;
  embedding: number[] | null;
  indexed_at: Date;
}

export interface IndexingJob {
  id: number;
  started_at: Date;
  completed_at: Date | null;
  total_notes: number;
  processed_notes: number;
  failed_notes: number;
  status: "pending" | "running" | "completed" | "failed" | "paused";
}

export interface SearchResult {
  title: string;
  content: string;
  score?: number;
}

// Initialize database schema
export async function initializeSchema(): Promise<void> {
  const schemaPath = join(__dirname, "schema.sql");
  const schema = readFileSync(schemaPath, "utf-8");
  await pool.query(schema);
}

// Health check
export async function checkConnection(): Promise<boolean> {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch (error) {
    console.error("Database connection failed:", error);
    return false;
  }
}

// Notes CRUD operations
export async function upsertNote(note: {
  apple_note_id: string;
  title: string;
  content: string;
  html_content?: string;
  folder_path?: string;
  creation_date?: Date;
  modification_date?: Date;
  content_hash?: string;
  has_images?: boolean;
  embedding?: number[];
}): Promise<number> {
  const result = await pool.query(
    `INSERT INTO notes (apple_note_id, title, content, html_content, folder_path,
                        creation_date, modification_date, content_hash, has_images, embedding, indexed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
     ON CONFLICT (apple_note_id)
     DO UPDATE SET
       title = EXCLUDED.title,
       content = EXCLUDED.content,
       html_content = EXCLUDED.html_content,
       folder_path = EXCLUDED.folder_path,
       creation_date = EXCLUDED.creation_date,
       modification_date = EXCLUDED.modification_date,
       content_hash = EXCLUDED.content_hash,
       has_images = EXCLUDED.has_images,
       embedding = EXCLUDED.embedding,
       indexed_at = NOW()
     RETURNING id`,
    [
      note.apple_note_id,
      note.title,
      note.content,
      note.html_content || null,
      note.folder_path || null,
      note.creation_date || null,
      note.modification_date || null,
      note.content_hash || null,
      note.has_images || false,
      note.embedding ? `[${note.embedding.join(",")}]` : null,
    ]
  );
  return result.rows[0].id;
}

export async function getNoteByTitle(title: string): Promise<NoteRecord | null> {
  const result = await pool.query(
    "SELECT * FROM notes WHERE title = $1 LIMIT 1",
    [title]
  );
  return result.rows[0] || null;
}

export async function getNoteByAppleId(appleNoteId: string): Promise<NoteRecord | null> {
  const result = await pool.query(
    "SELECT * FROM notes WHERE apple_note_id = $1 LIMIT 1",
    [appleNoteId]
  );
  return result.rows[0] || null;
}

export async function getNotesCount(): Promise<number> {
  const result = await pool.query("SELECT COUNT(*) as count FROM notes");
  return parseInt(result.rows[0].count, 10);
}

export async function getAllNoteHashes(): Promise<Map<string, string>> {
  const result = await pool.query(
    "SELECT apple_note_id, content_hash FROM notes WHERE apple_note_id IS NOT NULL"
  );
  const map = new Map<string, string>();
  for (const row of result.rows) {
    if (row.content_hash) {
      map.set(row.apple_note_id, row.content_hash);
    }
  }
  return map;
}

export async function getAllNoteMetadata(): Promise<Map<string, { hash: string; modificationDate: Date }>> {
  const result = await pool.query(
    "SELECT apple_note_id, content_hash, modification_date FROM notes WHERE apple_note_id IS NOT NULL"
  );
  const map = new Map<string, { hash: string; modificationDate: Date }>();
  for (const row of result.rows) {
    if (row.content_hash && row.modification_date) {
      map.set(row.apple_note_id, {
        hash: row.content_hash,
        modificationDate: new Date(row.modification_date),
      });
    }
  }
  return map;
}

export async function deleteNotesByAppleIds(appleNoteIds: string[]): Promise<number> {
  if (appleNoteIds.length === 0) return 0;
  const result = await pool.query(
    "DELETE FROM notes WHERE apple_note_id = ANY($1)",
    [appleNoteIds]
  );
  return result.rowCount || 0;
}

// Vector search
export async function vectorSearch(
  embedding: number[],
  limit: number = 20
): Promise<SearchResult[]> {
  const result = await pool.query(
    `SELECT title, content,
            1 - (embedding <=> $1::vector) as similarity
     FROM notes
     WHERE embedding IS NOT NULL
     ORDER BY embedding <=> $1::vector
     LIMIT $2`,
    [`[${embedding.join(",")}]`, limit]
  );
  return result.rows.map((row) => ({
    title: row.title,
    content: row.content,
    score: row.similarity,
  }));
}

// Full-text search using trigrams
export async function textSearch(
  query: string,
  limit: number = 20
): Promise<SearchResult[]> {
  const result = await pool.query(
    `SELECT title, content,
            similarity(title, $1) + similarity(content, $1) as score
     FROM notes
     WHERE title % $1 OR content % $1
     ORDER BY score DESC
     LIMIT $2`,
    [query, limit]
  );
  return result.rows.map((row) => ({
    title: row.title,
    content: row.content,
    score: row.score,
  }));
}

// Indexing job management
export async function createIndexingJob(totalNotes: number): Promise<number> {
  const result = await pool.query(
    `INSERT INTO indexing_jobs (total_notes, status) VALUES ($1, 'running') RETURNING id`,
    [totalNotes]
  );
  return result.rows[0].id;
}

export async function updateJobProgress(
  jobId: number,
  processedNotes: number,
  failedNotes: number
): Promise<void> {
  await pool.query(
    `UPDATE indexing_jobs
     SET processed_notes = $2, failed_notes = $3
     WHERE id = $1`,
    [jobId, processedNotes, failedNotes]
  );
}

export async function completeJob(jobId: number, status: "completed" | "failed"): Promise<void> {
  await pool.query(
    `UPDATE indexing_jobs
     SET status = $2, completed_at = NOW()
     WHERE id = $1`,
    [jobId, status]
  );
}

export async function getJobStatus(jobId: number): Promise<IndexingJob | null> {
  const result = await pool.query(
    "SELECT * FROM indexing_jobs WHERE id = $1",
    [jobId]
  );
  return result.rows[0] || null;
}

export async function getLatestJob(): Promise<IndexingJob | null> {
  const result = await pool.query(
    "SELECT * FROM indexing_jobs ORDER BY started_at DESC LIMIT 1"
  );
  return result.rows[0] || null;
}

// Cleanup
export async function closePool(): Promise<void> {
  await pool.end();
}

// Export pool for direct queries if needed
export { pool };
