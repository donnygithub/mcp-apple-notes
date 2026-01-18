import TurndownService from "turndown";
import {
  getAllNotesWithDetails,
  getAllNotesSummary,
  getNoteDetailsById,
  generateContentHash,
  type AppleNoteDetails,
} from "./apple-notes.js";
import {
  upsertNote,
  createIndexingJob,
  updateJobProgress,
  completeJob,
  getJobStatus,
  getAllNoteMetadata,
  deleteNotesByAppleIds,
  type IndexingJob,
} from "./db.js";
import { generateEmbedding, prepareTextForEmbedding, preloadModel } from "./embeddings.js";

const turndown = new TurndownService();

// Configuration
const BATCH_SIZE = 50;

export interface IndexingResult {
  jobId: number;
  totalNotes: number;
  processedNotes: number;
  failedNotes: number;
  status: string;
  timeMs?: number;
}

/**
 * Convert HTML content to Markdown
 */
function htmlToMarkdown(html: string): string {
  try {
    return turndown.turndown(html);
  } catch (error) {
    // If conversion fails, return stripped text
    return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  }
}

/**
 * Start a full indexing job (all notes)
 * Returns immediately with job ID - processing happens in background
 */
export async function startFullIndexing(): Promise<IndexingResult> {
  const start = performance.now();

  // Get all notes from Apple Notes
  const notes = await getAllNotesWithDetails();
  const totalNotes = notes.length;

  // Create job record
  const jobId = await createIndexingJob(totalNotes);

  // Process notes in batches
  let processedNotes = 0;
  let failedNotes = 0;

  for (let i = 0; i < notes.length; i += BATCH_SIZE) {
    const batch = notes.slice(i, i + BATCH_SIZE);

    const batchResults = await Promise.allSettled(
      batch.map(async (note) => {
        await processNote(note);
      })
    );

    // Count successes and failures
    for (const result of batchResults) {
      if (result.status === "fulfilled") {
        processedNotes++;
      } else {
        failedNotes++;
        console.error("Failed to index note:", result.reason);
      }
    }

    // Update progress
    await updateJobProgress(jobId, processedNotes, failedNotes);
  }

  // Complete job
  const status = failedNotes === 0 ? "completed" : "completed";
  await completeJob(jobId, status);

  const timeMs = performance.now() - start;

  return {
    jobId,
    totalNotes,
    processedNotes,
    failedNotes,
    status,
    timeMs,
  };
}

/**
 * Incremental sync - only process changed notes
 */
export async function syncNotes(): Promise<IndexingResult> {
  const start = performance.now();

  // Get current state from Apple Notes (lightweight - just summaries)
  console.error("🔍 Fetching note summaries from Apple Notes...");
  const appleSummaries = await getAllNotesSummary();
  const appleNoteIds = new Set(appleSummaries.map((s) => s.id));
  console.error(`   Found ${appleSummaries.length} notes in Apple Notes`);

  // Get existing metadata from database (hash + modification date)
  const existingMetadata = await getAllNoteMetadata();
  console.error(`   Found ${existingMetadata.size} notes in database`);

  // Determine what needs updating
  const notesToUpdate: string[] = [];
  const notesToDelete: string[] = [];

  // Check for deleted notes
  for (const [dbNoteId] of existingMetadata) {
    if (!appleNoteIds.has(dbNoteId)) {
      notesToDelete.push(dbNoteId);
    }
  }

  // Check for new or modified notes using modification date
  for (const summary of appleSummaries) {
    const existing = existingMetadata.get(summary.id);
    if (!existing) {
      // New note
      notesToUpdate.push(summary.id);
    } else {
      // Compare modification dates - only fetch if Apple's date is newer
      const appleModDate = new Date(summary.modification_date);
      if (appleModDate > existing.modificationDate) {
        notesToUpdate.push(summary.id);
      }
      // If dates match, skip (no need to fetch via JXA)
    }
  }

  console.error(`📊 Sync analysis: ${notesToUpdate.length} to update, ${notesToDelete.length} to delete`);

  // Create job
  const totalNotes = notesToUpdate.length + notesToDelete.length;
  const jobId = await createIndexingJob(totalNotes);

  let processedNotes = 0;
  let failedNotes = 0;

  // Delete removed notes
  if (notesToDelete.length > 0) {
    console.error(`🗑️  Deleting ${notesToDelete.length} removed notes...`);
    await deleteNotesByAppleIds(notesToDelete);
    processedNotes += notesToDelete.length;
    await updateJobProgress(jobId, processedNotes, failedNotes);
  }

  // Pre-load embedding model if there are notes to update
  if (notesToUpdate.length > 0) {
    console.error("🤖 Pre-loading embedding model...");
    await preloadModel();
  }

  // Process updates in batches
  for (let i = 0; i < notesToUpdate.length; i += BATCH_SIZE) {
    const batch = notesToUpdate.slice(i, i + BATCH_SIZE);
    console.error(`  Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(notesToUpdate.length / BATCH_SIZE)}: Processing ${batch.length} notes...`);

    const batchResults = await Promise.allSettled(
      batch.map(async (noteId) => {
        const details = await getNoteDetailsById(noteId);
        if (details) {
          // Modification date already checked - just process
          await processNote(details);
        }
      })
    );

    for (const result of batchResults) {
      if (result.status === "fulfilled") {
        processedNotes++;
      } else {
        failedNotes++;
        console.error("Failed to sync note:", result.reason);
      }
    }

    await updateJobProgress(jobId, processedNotes, failedNotes);
    console.error(`  ✅ Progress: ${processedNotes}/${totalNotes} (${failedNotes} failed)`);
  }

  await completeJob(jobId, "completed");

  return {
    jobId,
    totalNotes,
    processedNotes,
    failedNotes,
    status: "completed",
    timeMs: performance.now() - start,
  };
}

/**
 * Process a single note: convert, embed, store
 */
async function processNote(note: AppleNoteDetails): Promise<void> {
  // Convert HTML to Markdown
  const markdownContent = htmlToMarkdown(note.content);

  // Generate content hash
  const contentHash = generateContentHash(note.content);

  // Generate embedding
  const textForEmbedding = prepareTextForEmbedding(note.title, markdownContent);
  const embedding = await generateEmbedding(textForEmbedding);

  // Store in database
  await upsertNote({
    apple_note_id: note.id,
    title: note.title,
    content: markdownContent,
    html_content: note.content,
    folder_path: note.folder,
    creation_date: new Date(note.creation_date),
    modification_date: new Date(note.modification_date),
    content_hash: contentHash,
    embedding,
  });
}

/**
 * Get status of an indexing job
 */
export async function getIndexingStatus(jobId?: number): Promise<IndexingJob | null> {
  if (jobId) {
    return await getJobStatus(jobId);
  }
  // Return latest job if no ID specified
  const { getLatestJob } = await import("./db.js");
  return await getLatestJob();
}
