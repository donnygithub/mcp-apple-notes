# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an MCP (Model Context Protocol) server that enables semantic search and RAG over Apple Notes. It uses on-device embeddings (`all-MiniLM-L6-v2`) and **PostgreSQL with pgvector** for vector storage, providing AI assistants like Claude with the ability to search and reference Apple Notes content.

## Development Commands

### Setup and Running
```bash
# Install dependencies
bun install

# Set up PostgreSQL database
createdb apple_notes
psql apple_notes -c "CREATE EXTENSION vector; CREATE EXTENSION pg_trgm;"
bun run setup-db

# Create .env file
cp .env.example .env
# Edit .env to set DATABASE_URL if needed

# Start the MCP server
bun start

# Build the server
bun build index.ts --outdir dist --target node
```

### CLI Scripts
```bash
# Full indexing (all notes) - uses parallel JXA workers
bun run-index.ts

# Incremental sync (only changed notes)
bun run-sync.ts

# Find large notes slowing down indexing
bun list-large-notes.ts [limit] [min-size-bytes]
# Examples:
bun list-large-notes.ts           # Top 20 notes > 100KB
bun list-large-notes.ts 10 1000000 # Top 10 notes > 1MB
```

### Testing
```bash
# Run tests (requires PostgreSQL)
bun test
# or
npx tsx index.test.ts
```

### Database Management
```bash
# Initialize/reset schema
bun run setup-db

# Connect to database
psql apple_notes
```

### Logs and Debugging
```bash
# View MCP server logs
tail -n 50 -f ~/Library/Logs/Claude/mcp-server-local-machine.log
# or
tail -n 50 -f ~/Library/Logs/Claude/mcp.log
```

## Architecture

### File Structure

```
├── index.ts              # MCP server entry point
├── run-index.ts          # CLI: Full indexing with parallel JXA
├── run-sync.ts           # CLI: Incremental sync
├── list-large-notes.ts   # CLI: Find large notes
├── src/
│   ├── db.ts            # PostgreSQL connection pool and queries
│   ├── schema.sql       # Database schema with pgvector
│   ├── embeddings.ts    # On-device embedding generation
│   ├── apple-notes.ts   # JXA Apple Notes integration (parallel fetch)
│   ├── indexer.ts       # Batch indexing with job tracking
│   └── search.ts        # Hybrid search implementation
├── index.test.ts        # Test suite
├── .env.example         # Environment configuration template
└── package.json
```

### MCP Tools Provided

| Tool | Description |
|------|-------------|
| `list-notes` | Lists count of indexed notes |
| `index-notes` | Full indexing with batch processing and job tracking |
| `sync-notes` | Incremental sync - only processes changed notes |
| `get-indexing-status` | Check indexing job progress |
| `get-note` | Retrieve full note content by title |
| `search-notes` | Hybrid semantic + full-text search with date filtering, image filtering, custom sorting, and title-only mode |
| `create-note` | Create new Apple Note (HTML content) |

### Data Flow

1. Apple Notes accessed via JXA (`run-jxa` package)
2. Notes content (HTML) converted to Markdown (`turndown`)
3. On-device embeddings generated (`@huggingface/transformers`, Xenova/all-MiniLM-L6-v2)
4. Vectors and content stored in PostgreSQL with pgvector
5. Search combines vector similarity and trigram FTS using RRF

### Key Technical Details

**Embedding Pipeline** (`src/embeddings.ts`):
- Model: `Xenova/all-MiniLM-L6-v2`
- Dimensions: 384 (Float32)
- Pooling: Mean pooling
- Lazy loading for performance

**Database Schema** (`src/schema.sql`):
```sql
CREATE TABLE notes (
    id SERIAL PRIMARY KEY,
    apple_note_id TEXT UNIQUE,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    html_content TEXT,
    folder_path TEXT,
    creation_date TIMESTAMPTZ,
    modification_date TIMESTAMPTZ,
    content_hash TEXT,          -- For incremental sync
    has_images BOOLEAN,         -- For image filtering
    embedding vector(384),
    indexed_at TIMESTAMPTZ
);

CREATE TABLE indexing_jobs (
    id SERIAL PRIMARY KEY,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    total_notes INTEGER,
    processed_notes INTEGER,
    failed_notes INTEGER,
    status TEXT  -- pending, running, completed, failed
);
```

**Indexes**:
- `ivfflat` on embedding for vector search
- `gin_trgm_ops` on title/content for full-text search
- B-tree on modification_date, content_hash, has_images

**Search Strategy** (`src/search.ts`):
- Runs vector search and trigram FTS in parallel
- Combines results using Reciprocal Rank Fusion (RRF, k=60)
- Default limit: 20 results (customizable)
- Supports date filtering (created_before, created_after, modified_before, modified_after)
- Supports image filtering (has_images boolean)
- Custom sorting by relevance, creation_date, or modification_date
- Title-only mode to prevent context overflow with large result sets
- Optional folder filtering

**Batch Indexing** (`src/indexer.ts`):
- Processes notes in batches of 50
- Tracks progress via `indexing_jobs` table
- Supports incremental sync via content hash comparison
- Detects and flags notes containing images (via HTML analysis)
- No more timeout issues for large collections

### Apple Notes Integration (`src/apple-notes.ts`)

- Uses JXA to interact with Notes.app
- **Parallel fetching**: 4 concurrent workers fetch notes simultaneously
- **Bulk batch processing**: Fetches notes by index range, not one-by-one
- **Trash exclusion**: Automatically skips "Recently Deleted" folder
- String escaping critical for JXA execution
- Content stored/retrieved as HTML
- Note retrieval by title or Apple ID

### Performance Characteristics

- **Full indexing ~1000 notes**: ~14 minutes
  - JXA fetch: ~11 minutes (parallel)
  - Embedding: ~3 minutes
- **Incremental sync (no changes)**: ~5 seconds
- **Large notes with images**: Can significantly slow embedding (use `list-large-notes.ts` to identify)

## Environment Configuration

```bash
# .env
DATABASE_URL=postgresql://localhost:5432/apple_notes
```

## Important Constraints

1. **PostgreSQL Required**: Must have PostgreSQL with pgvector and pg_trgm extensions
2. **Note Creation**: Content must be HTML format
3. **JXA Limitations**: Special characters must be escaped
4. **macOS Only**: JXA only works on macOS

## Testing

Tests use a separate test database (`apple_notes_test`). Key test scenarios:
- Database connection
- Embedding generation
- Note upsert and retrieval
- Vector and text search
- Hybrid search with RRF

## Claude Desktop Configuration

```json
{
  "mcpServers": {
    "apple-notes": {
      "command": "/Users/<USERNAME>/.bun/bin/bun",
      "args": ["/Users/<USERNAME>/mcp/mcp-apple-notes/index.ts"],
      "env": {
        "DATABASE_URL": "postgresql://localhost:5432/apple_notes"
      }
    }
  }
}
```

Replace `<USERNAME>` with your actual username and restart Claude Desktop after configuration.
