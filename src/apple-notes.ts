import { runJxa } from "run-jxa";
import { createHash } from "node:crypto";

// Types
export interface AppleNoteDetails {
  id: string;
  title: string;
  content: string; // HTML content
  folder: string;
  creation_date: string;
  modification_date: string;
}

export interface AppleNoteSummary {
  id: string;
  title: string;
  folder: string;
  modification_date: string;
}

/**
 * Generate a content hash for change detection
 */
export function generateContentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex").substring(0, 16);
}

/**
 * Get all note titles (lightweight)
 * Excludes notes in trash (Recently Deleted)
 */
export async function getNotes(): Promise<string[]> {
  const notes = await runJxa(`
    const app = Application('Notes');
    app.includeStandardAdditions = true;
    const notes = Array.from(app.notes());
    const titles = notes
      .filter(note => {
        const container = note.container();
        return container ? container.name() !== 'Recently Deleted' : true;
      })
      .map(note => note.properties().name);
    return titles;
  `);
  return notes as string[];
}

/**
 * Get all notes with summary info (for incremental sync)
 * Excludes notes in trash (Recently Deleted)
 */
export async function getAllNotesSummary(): Promise<AppleNoteSummary[]> {
  const result = await runJxa(`
    const app = Application('Notes');
    app.includeStandardAdditions = true;
    const notes = Array.from(app.notes());
    const summaries = notes
      .map(note => {
        const props = note.properties();
        const container = note.container();
        const folderName = container ? container.name() : 'Notes';
        return {
          id: props.id,
          title: props.name,
          folder: folderName,
          modification_date: props.modificationDate.toISOString()
        };
      })
      .filter(note => note.folder !== 'Recently Deleted');
    return JSON.stringify(summaries);
  `);
  return JSON.parse(result as string) as AppleNoteSummary[];
}

/**
 * Get full details for a single note by title
 */
export async function getNoteDetailsByTitle(title: string): Promise<AppleNoteDetails | null> {
  // Escape the title for JXA
  const escapedTitle = title.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

  const result = await runJxa(`
    const app = Application('Notes');
    const title = "${escapedTitle}";

    try {
      const note = app.notes.whose({name: title})[0];
      const props = note.properties();
      const container = note.container();

      const noteInfo = {
        id: props.id,
        title: props.name,
        content: note.body(),
        folder: container ? container.name() : 'Notes',
        creation_date: props.creationDate.toISOString(),
        modification_date: props.modificationDate.toISOString()
      };

      return JSON.stringify(noteInfo);
    } catch (error) {
      return "null";
    }
  `);

  const parsed = JSON.parse(result as string);
  return parsed as AppleNoteDetails | null;
}

/**
 * Get full details for a single note by Apple ID
 */
export async function getNoteDetailsById(noteId: string): Promise<AppleNoteDetails | null> {
  const escapedId = noteId.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

  const result = await runJxa(`
    const app = Application('Notes');
    const noteId = "${escapedId}";

    try {
      const note = app.notes.whose({id: noteId})[0];
      const props = note.properties();
      const container = note.container();

      const noteInfo = {
        id: props.id,
        title: props.name,
        content: note.body(),
        folder: container ? container.name() : 'Notes',
        creation_date: props.creationDate.toISOString(),
        modification_date: props.modificationDate.toISOString()
      };

      return JSON.stringify(noteInfo);
    } catch (error) {
      return "null";
    }
  `);

  const parsed = JSON.parse(result as string);
  return parsed as AppleNoteDetails | null;
}

/**
 * Get all notes with full details (for initial indexing)
 * Returns notes in batches to handle large collections
 */
export async function getAllNotesWithDetails(
  onProgress?: (processed: number, total: number) => void
): Promise<AppleNoteDetails[]> {
  // First get all summaries
  const summaries = await getAllNotesSummary();
  const total = summaries.length;
  const results: AppleNoteDetails[] = [];

  // Fetch full details in batches
  const batchSize = 20;
  for (let i = 0; i < summaries.length; i += batchSize) {
    const batch = summaries.slice(i, i + batchSize);

    const batchResults = await Promise.all(
      batch.map(async (summary) => {
        try {
          const details = await getNoteDetailsById(summary.id);
          return details;
        } catch (error) {
          console.error(`Error fetching note ${summary.title}:`, error);
          return null;
        }
      })
    );

    results.push(...batchResults.filter((r): r is AppleNoteDetails => r !== null));

    if (onProgress) {
      onProgress(Math.min(i + batchSize, total), total);
    }
  }

  return results;
}

/**
 * Create a new Apple Note
 */
export async function createNote(title: string, content: string): Promise<boolean> {
  // Escape special characters for JXA
  const escapedTitle = title
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"');

  const escapedContent = content
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "");

  await runJxa(`
    const app = Application('Notes');
    const note = app.make({new: 'note', withProperties: {
      name: "${escapedTitle}",
      body: "${escapedContent}"
    }});
    return true;
  `);

  return true;
}
