# MCP Apple Notes

![MCP Apple Notes](./images/logo.png)

A [Model Context Protocol (MCP)](https://www.anthropic.com/news/model-context-protocol) server that enables semantic search and RAG (Retrieval Augmented Generation) over your Apple Notes. This allows AI assistants like Claude to search and reference your Apple Notes during conversations.

![MCP Apple Notes](./images/demo.png)

## Features

- 🔍 Semantic search over Apple Notes using [`all-MiniLM-L6-v2`](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2) on-device embeddings model
- 📝 Full-text search with trigram matching
- 📊 Vector storage using [PostgreSQL + pgvector](https://github.com/pgvector/pgvector)
- 🤖 MCP-compatible server for AI assistant integration
- 🍎 Native Apple Notes integration via JXA
- 🏃‍♂️ Fully local execution - no API keys needed
- ⚡ Batch indexing with progress tracking
- 🔄 Incremental sync - only re-index changed notes

## Prerequisites

- [Bun](https://bun.sh/docs/installation)
- [PostgreSQL 17+](https://www.postgresql.org/download/) with [pgvector](https://github.com/pgvector/pgvector) and pg_trgm extensions
- [Claude Desktop](https://claude.ai/download)
- macOS (required for Apple Notes access)
- Optional: [pgAdmin](https://www.pgadmin.org) - GUI for database management

## Installation

1. Clone the repository:

```bash
git clone https://github.com/donnygithub/mcp-apple-notes
cd mcp-apple-notes
```

2. Install dependencies:

```bash
bun install
```

3. Set up PostgreSQL database:

```bash
# Install PostgreSQL with pgvector (macOS)
# Requires PostgreSQL 17+ for best pgvector compatibility
brew install postgresql@17
brew install pgvector

# Start PostgreSQL
brew services start postgresql@17

# Create database and enable extensions
createdb apple_notes
psql apple_notes -c "CREATE EXTENSION vector; CREATE EXTENSION pg_trgm;"

# Initialize schema
bun run setup-db
```

**Note:** If using a non-standard port (e.g., PostgreSQL 18 on port 5434), update your `.env` file accordingly.

4. Configure environment:

```bash
cp .env.example .env
# Edit .env if your PostgreSQL connection differs from defaults
```

## Usage

1. Open Claude desktop app and go to Settings -> Developer -> Edit Config

![Claude Desktop Settings](./images/desktop_settings.png)

2. Open the `claude_desktop_config.json` and add the following entry:

```json
{
  "mcpServers": {
    "apple-notes": {
      "command": "/Users/<YOUR_USER_NAME>/.bun/bin/bun",
      "args": ["/Users/<YOUR_USER_NAME>/mcp-apple-notes/index.ts"],
      "env": {
        "DATABASE_URL": "postgresql://localhost:5432/apple_notes"
      }
    }
  }
}
```

Important: Replace `<YOUR_USER_NAME>` with your actual username.

3. Restart Claude desktop app. You should see this:

![Claude MCP Connection Status](./images/verify_installation.png)

4. Start by indexing your notes. Ask Claude to index your notes by saying something like: "Index my notes" or "Index my Apple Notes".

## CLI Scripts

Run these directly from the command line:

```bash
# Full indexing (all notes)
bun run-index.ts

# Incremental sync (only changed notes)
bun run-sync.ts

# Find large notes that slow down indexing
bun list-large-notes.ts [limit] [min-size-bytes]

# Examples:
bun list-large-notes.ts           # Top 20 notes > 100KB
bun list-large-notes.ts 50 500000 # Top 50 notes > 500KB
bun list-large-notes.ts 10 1000000 # Top 10 notes > 1MB
```

## MCP Tools

| Tool | Description |
|------|-------------|
| `list-notes` | Lists count of indexed notes |
| `index-notes` | Full indexing with batch processing |
| `sync-notes` | Incremental sync - only changed notes |
| `get-indexing-status` | Check indexing progress |
| `get-note` | Get full note content by title |
| `search-notes` | Hybrid semantic + full-text search |
| `create-note` | Create new Apple Note |

## Troubleshooting

### View Logs

```bash
tail -n 50 -f ~/Library/Logs/Claude/mcp-server-local-machine.log
# or
tail -n 50 -f ~/Library/Logs/Claude/mcp.log
```

### Database Issues

```bash
# Check PostgreSQL is running
pg_isready

# Check extensions are installed
psql apple_notes -c "SELECT * FROM pg_extension WHERE extname IN ('vector', 'pg_trgm');"

# Re-initialize schema
bun run setup-db
```

### Indexing Issues

- For large note collections, use `sync-notes` for incremental updates
- Check job status with `get-indexing-status` tool
- If indexing fails, check the database connection

## Architecture

```
├── index.ts              # MCP server entry point
├── run-index.ts          # CLI: Full indexing
├── run-sync.ts           # CLI: Incremental sync
├── list-large-notes.ts   # CLI: Find large notes
├── src/
│   ├── db.ts            # PostgreSQL connection pool
│   ├── schema.sql       # Database schema
│   ├── embeddings.ts    # On-device embeddings
│   ├── apple-notes.ts   # JXA integration (parallel fetch)
│   ├── indexer.ts       # Batch indexing
│   └── search.ts        # Hybrid search
```

## Performance

- **Parallel JXA fetching**: Uses 4 concurrent workers to fetch notes from Apple Notes
- **Bulk batch processing**: Fetches notes in ranges instead of one-by-one
- **Incremental sync**: Only re-indexes notes with newer modification dates
- **Trash exclusion**: Automatically skips notes in "Recently Deleted"
- **Embedding model caching**: Model loaded once and reused

Typical performance for ~1000 notes:
- Full index: ~14 minutes
- Incremental sync (no changes): ~5 seconds

**Note**: Notes with embedded images (base64) significantly slow down indexing. Use `list-large-notes.ts` to identify them.

## Development

```bash
# Run server
bun start

# Run tests
bun test

# Build for distribution
bun run build
```

## License

ISC
