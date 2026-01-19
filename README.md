# MCP Apple Notes RAG

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
- [Claude Code CLI](https://docs.anthropic.com/claude-code) or [VS Code with Roo Code extension](https://marketplace.visualstudio.com/items?itemName=ai-for-devs-community.apple-roo-code)
- macOS (required for Apple Notes access)
- Optional: [pgAdmin](https://www.pgadmin.org) - GUI for database management

## Installation

1. Clone the repository:

```bash
git clone https://github.com/donnygithub/mcp-apple-notes-rag
cd mcp-apple-notes-rag
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

**Note:** If using a non-standard port (e.g., PostgreSQL 18 on port 5434), you must update:
- Your `.env` file
- The `DATABASE_URL` in your MCP configuration (see Usage section below)

4. Configure environment:

```bash
cp .env.example .env
# Edit .env if your PostgreSQL connection differs from defaults
```

## Configuration

### For Claude Code CLI

Add to your `~/.claude/claude.json`:

```json
{
  "mcpServers": {
    "apple-notes-rag": {
      "command": "/Users/<YOUR_USER_NAME>/.bun/bin/bun",
      "args": ["/Users/<YOUR_USER_NAME>/mcp/mcp-apple-notes-rag/index.ts"],
      "env": {
        "DATABASE_URL": "postgresql://localhost:5432/apple_notes"
      }
    }
  }
}
```

### For VS Code (Roo Code)

Add to your MCP settings at `~/Library/Application Support/Code/User/globalStorage/ai-for-devs-community.apple-roo-code/settings/mcp_settings.json`:

```json
{
  "mcpServers": {
    "apple-notes-rag": {
      "command": "/Users/<YOUR_USER_NAME>/.bun/bin/bun",
      "args": ["/Users/<YOUR_USER_NAME>/mcp/mcp-apple-notes-rag/index.ts"],
      "env": {
        "DATABASE_URL": "postgresql://localhost:5432/apple_notes"
      }
    }
  }
}
```

**Important:**
- Replace `<YOUR_USER_NAME>` with your actual username
- Update the path to match where you cloned this repository
- If using a non-standard PostgreSQL port (e.g., 5434), update the port in `DATABASE_URL` to match your setup

After configuration, restart Claude Code CLI or reload VS Code to activate the MCP server.

## Getting Started

### Initial Indexing

For the first time setup or full re-indexing, **use the CLI script** to avoid MCP timeout issues:

```bash
cd /Users/don/mcp/mcp-apple-notes-rag
bun run-index.ts
```

This will index all your notes and show real-time progress. For ~1000 notes, expect about 14 minutes.

### Incremental Updates

After initial indexing, use the MCP tools to keep notes in sync:
- **Via CLI**: `bun run-sync.ts` (faster for many changes)
- **Via AI assistant**: "Sync my Apple Notes" (uses MCP `sync-notes` tool)

The sync is much faster (~5 seconds if no changes) and won't timeout.

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

## Example Prompts

Once configured, you can use natural language with Claude to interact with your Apple Notes:

### Initial Setup & Indexing

```
"Index all my Apple Notes so I can search them"

"What's the status of my notes indexing job?"

"How many notes are currently indexed?"
```

### Searching Notes

**Use natural language (not JSON format):**

```
"Search my notes for anything related to 'kubernetes deployment strategies'"

"Find notes about PostgreSQL performance tuning"

"Search for notes in my 'Work' folder about 'MCP servers'"

"What notes do I have about Python async programming?"

"Find my oldest notes created before 2020"

"Search for notes about 'docker' modified in the last month"

"Show me notes about 'MCP' sorted by creation date, oldest first"

"List all notes that contain images. Just titles only."

"Find text-only notes about Python (no images)"
```

The search tool now supports:
- **Date filtering**: Filter by creation or modification date
- **Image filtering**: Find notes with or without images
- **Custom sorting**: Sort by relevance (default), creation date, or modification date
- **Title-only results**: Get just titles for large result sets (prevents context overflow)
- **Flexible queries**: Combine semantic search with multiple filters

**Note**: When listing many notes (e.g., "all notes with images"), add "just titles only" to avoid overwhelming the context window.

### Retrieving Specific Notes

```
"Get the full content of my note titled 'Meeting Notes - Q1 Planning'"

"Show me my note called 'API Documentation'"
```

### Creating Notes

```
"Create a new Apple Note titled 'MCP Server Ideas' with:
- Explore filesystem integration
- Consider calendar sync
- Research Slack MCP"

"Create a note called 'Code Snippet - React Hook' with this code:
[paste your code here]"
```

### Keeping in Sync

```
"Sync my Apple Notes to pick up any recent changes"

"I just added some notes - sync them to the search index"
```

### Combined Workflows

```
"Search my notes for 'docker compose' examples, then show me the full content of the most relevant one"

"Find all my notes about TypeScript, then create a summary note with the key points"

"Search for notes about database migrations and help me write a new migration script based on what I've documented"
```

The MCP server uses **hybrid search** (semantic embeddings + full-text) to find the most relevant notes, so you can search by concepts and natural language, not just exact keywords!

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
