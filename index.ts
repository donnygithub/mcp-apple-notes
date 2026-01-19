import "dotenv/config";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

// Import modules
import { initializeSchema, checkConnection, getNotesCount, getNoteByTitle } from "./src/db.js";
import { getNotes, getNoteDetailsByTitle, createNote as createAppleNote } from "./src/apple-notes.js";
import { startFullIndexing, syncNotes, getIndexingStatus } from "./src/indexer.js";
import { hybridSearch } from "./src/search.js";

// Input schemas
const QueryNotesSchema = z.object({
  query: z.string(),
  created_before: z.string().optional(),
  created_after: z.string().optional(),
  modified_before: z.string().optional(),
  modified_after: z.string().optional(),
  has_images: z.boolean().optional(),
  sort_by: z.enum(["relevance", "creation_date", "modification_date"]).optional(),
  sort_order: z.enum(["asc", "desc"]).optional(),
  limit: z.number().optional(),
  title_only: z.boolean().optional(),
});

const GetNoteSchema = z.object({
  title: z.string(),
});

const CreateNoteSchema = z.object({
  title: z.string(),
  content: z.string(),
});

const GetIndexingStatusSchema = z.object({
  jobId: z.number().optional(),
});

// Initialize database on startup
let dbInitialized = false;

async function ensureDbInitialized(): Promise<boolean> {
  if (dbInitialized) return true;

  const connected = await checkConnection();
  if (!connected) {
    console.error("Database connection failed. Make sure PostgreSQL is running.");
    return false;
  }

  await initializeSchema();
  dbInitialized = true;
  return true;
}

// Create MCP server
const server = new Server(
  {
    name: "apple-notes-mcp",
    version: "2.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Register available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "list-notes",
        description: "Lists the count of all Apple Notes in the database",
        inputSchema: {
          type: "object",
          properties: {},
          required: [],
        },
      },
      {
        name: "index-notes",
        description:
          "Index all Apple Notes for semantic search. This processes notes in batches and returns a job ID for tracking progress.",
        inputSchema: {
          type: "object",
          properties: {},
          required: [],
        },
      },
      {
        name: "sync-notes",
        description:
          "Incrementally sync Apple Notes - only processes new or modified notes since last sync. Much faster than full indexing.",
        inputSchema: {
          type: "object",
          properties: {},
          required: [],
        },
      },
      {
        name: "get-indexing-status",
        description: "Get the status of an indexing job. If no job ID provided, returns the latest job status.",
        inputSchema: {
          type: "object",
          properties: {
            jobId: { type: "number", description: "Optional job ID to check" },
          },
          required: [],
        },
      },
      {
        name: "get-note",
        description: "Get a note's full content and details by title",
        inputSchema: {
          type: "object",
          properties: {
            title: { type: "string" },
          },
          required: ["title"],
        },
      },
      {
        name: "search-notes",
        description:
          "Search for notes using hybrid semantic + full-text search. Returns the most relevant notes matching your query. Supports date filtering, image filtering, and custom sorting.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query text" },
            created_before: { type: "string", description: "Filter notes created before this date (ISO 8601 format, e.g., '2020-01-01')" },
            created_after: { type: "string", description: "Filter notes created after this date (ISO 8601 format)" },
            modified_before: { type: "string", description: "Filter notes modified before this date (ISO 8601 format)" },
            modified_after: { type: "string", description: "Filter notes modified after this date (ISO 8601 format)" },
            has_images: { type: "boolean", description: "Filter by notes that contain images (true) or don't contain images (false)" },
            sort_by: {
              type: "string",
              enum: ["relevance", "creation_date", "modification_date"],
              description: "Sort results by relevance (default), creation date, or modification date"
            },
            sort_order: {
              type: "string",
              enum: ["asc", "desc"],
              description: "Sort order: ascending (oldest first) or descending (newest first). Default: desc for dates, desc for relevance"
            },
            limit: { type: "number", description: "Maximum number of results to return (default: 20)" },
            title_only: { type: "boolean", description: "Return only note titles without content (useful for large result sets)" },
          },
          required: ["query"],
        },
      },
      {
        name: "create-note",
        description:
          "Create a new Apple Note with specified title and content. Content should be in HTML format.",
        inputSchema: {
          type: "object",
          properties: {
            title: { type: "string" },
            content: { type: "string" },
          },
          required: ["title", "content"],
        },
      },
    ],
  };
});

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    // Ensure database is initialized
    const dbReady = await ensureDbInitialized();
    if (!dbReady && name !== "list-notes" && name !== "get-note" && name !== "create-note") {
      return createTextResponse(
        "Database not connected. Please ensure PostgreSQL is running and DATABASE_URL is configured."
      );
    }

    switch (name) {
      case "list-notes": {
        if (dbReady) {
          const count = await getNotesCount();
          return createTextResponse(
            `There are ${count} notes indexed in the database.`
          );
        } else {
          // Fallback to Apple Notes directly
          const titles = await getNotes();
          return createTextResponse(
            `There are ${titles.length} notes in Apple Notes (database not connected).`
          );
        }
      }

      case "index-notes": {
        const result = await startFullIndexing();
        return createTextResponse(
          `Indexing completed!\n` +
          `- Job ID: ${result.jobId}\n` +
          `- Total notes: ${result.totalNotes}\n` +
          `- Processed: ${result.processedNotes}\n` +
          `- Failed: ${result.failedNotes}\n` +
          `- Time: ${Math.round(result.timeMs || 0)}ms\n\n` +
          `You can now search for notes using the "search-notes" tool.`
        );
      }

      case "sync-notes": {
        const result = await syncNotes();
        return createTextResponse(
          `Sync completed!\n` +
          `- Job ID: ${result.jobId}\n` +
          `- Notes checked: ${result.totalNotes}\n` +
          `- Processed: ${result.processedNotes}\n` +
          `- Failed: ${result.failedNotes}\n` +
          `- Time: ${Math.round(result.timeMs || 0)}ms`
        );
      }

      case "get-indexing-status": {
        const { jobId } = GetIndexingStatusSchema.parse(args);
        const status = await getIndexingStatus(jobId);
        if (!status) {
          return createTextResponse("No indexing jobs found.");
        }
        return createTextResponse(
          `Job #${status.id}:\n` +
          `- Status: ${status.status}\n` +
          `- Progress: ${status.processed_notes}/${status.total_notes}\n` +
          `- Failed: ${status.failed_notes}\n` +
          `- Started: ${status.started_at}\n` +
          (status.completed_at ? `- Completed: ${status.completed_at}` : "")
        );
      }

      case "get-note": {
        const { title } = GetNoteSchema.parse(args);
        // Try database first
        if (dbReady) {
          const note = await getNoteByTitle(title);
          if (note) {
            return createTextResponse(
              JSON.stringify({
                title: note.title,
                content: note.content,
                folder: note.folder_path,
                creation_date: note.creation_date,
                modification_date: note.modification_date,
              }, null, 2)
            );
          }
        }
        // Fallback to Apple Notes directly
        const appleNote = await getNoteDetailsByTitle(title);
        if (appleNote) {
          return createTextResponse(JSON.stringify(appleNote, null, 2));
        }
        return createTextResponse(`Note "${title}" not found.`);
      }

      case "search-notes": {
        const params = QueryNotesSchema.parse(args);
        const results = await hybridSearch(
          params.query,
          params.limit || 20,
          {
            created_before: params.created_before,
            created_after: params.created_after,
            modified_before: params.modified_before,
            modified_after: params.modified_after,
            has_images: params.has_images,
            sort_by: params.sort_by,
            sort_order: params.sort_order,
          }
        );
        if (results.length === 0) {
          return createTextResponse(
            "No matching notes found. Make sure notes are indexed using 'index-notes' first."
          );
        }

        // If title_only is requested, strip content
        if (params.title_only) {
          const titleResults = results.map(r => ({ title: r.title }));
          return createTextResponse(JSON.stringify(titleResults, null, 2));
        }

        // Otherwise truncate content to prevent overflow
        const truncatedResults = results.map(r => ({
          title: r.title,
          content: r.content.length > 500 ? r.content.substring(0, 500) + "..." : r.content,
          score: r.score
        }));
        return createTextResponse(JSON.stringify(truncatedResults, null, 2));
      }

      case "create-note": {
        const { title, content } = CreateNoteSchema.parse(args);
        await createAppleNote(title, content);
        return createTextResponse(`Created note "${title}" successfully.`);
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(
        `Invalid arguments: ${error.errors
          .map((e) => `${e.path.join(".")}: ${e.message}`)
          .join(", ")}`
      );
    }
    throw error;
  }
});

// Helper function
function createTextResponse(text: string) {
  return {
    content: [{ type: "text" as const, text }],
  };
}

// Start the server
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("Apple Notes MCP Server (PostgreSQL) running on stdio");
