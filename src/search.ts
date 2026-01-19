import { generateEmbedding } from "./embeddings.js";
import { vectorSearch, textSearch, pool, type SearchResult } from "./db.js";

/**
 * Hybrid search combining vector similarity and full-text search
 * Uses Reciprocal Rank Fusion (RRF) to combine results
 */
export async function hybridSearch(
  query: string,
  limit: number = 20,
  options?: {
    created_before?: string;
    created_after?: string;
    modified_before?: string;
    modified_after?: string;
    has_images?: boolean;
    sort_by?: "relevance" | "creation_date" | "modification_date";
    sort_order?: "asc" | "desc";
  }
): Promise<SearchResult[]> {
  // If date filtering, image filtering, or custom sorting is requested, use advanced search
  if (options && (
    options.created_before ||
    options.created_after ||
    options.modified_before ||
    options.modified_after ||
    options.has_images !== undefined ||
    options.sort_by
  )) {
    return advancedHybridSearch(query, limit, undefined, options);
  }

  // Otherwise use simple hybrid search
  // Generate query embedding
  const queryEmbedding = await generateEmbedding(query);

  // Run both searches in parallel
  const [vectorResults, textResults] = await Promise.all([
    vectorSearch(queryEmbedding, limit),
    textSearch(query, limit),
  ]);

  // Combine using RRF
  const k = 60; // RRF parameter
  const scores = new Map<string, { score: number; title: string; content: string }>();

  // Process vector results
  vectorResults.forEach((result, idx) => {
    const key = `${result.title}::${result.content}`;
    const rrfScore = 1 / (k + idx);
    const existing = scores.get(key);
    if (existing) {
      existing.score += rrfScore;
    } else {
      scores.set(key, {
        score: rrfScore,
        title: result.title,
        content: result.content,
      });
    }
  });

  // Process text results
  textResults.forEach((result, idx) => {
    const key = `${result.title}::${result.content}`;
    const rrfScore = 1 / (k + idx);
    const existing = scores.get(key);
    if (existing) {
      existing.score += rrfScore;
    } else {
      scores.set(key, {
        score: rrfScore,
        title: result.title,
        content: result.content,
      });
    }
  });

  // Sort by combined score and return top results
  const results = Array.from(scores.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ title, content, score }) => ({ title, content, score }));

  return results;
}

/**
 * Vector-only search (semantic similarity)
 */
export async function semanticSearch(
  query: string,
  limit: number = 20
): Promise<SearchResult[]> {
  const queryEmbedding = await generateEmbedding(query);
  return vectorSearch(queryEmbedding, limit);
}

/**
 * Text-only search (trigram similarity)
 */
export async function fullTextSearch(
  query: string,
  limit: number = 20
): Promise<SearchResult[]> {
  return textSearch(query, limit);
}

/**
 * Advanced hybrid search with SQL-level RRF (more efficient for large datasets)
 * Supports date filtering and custom sorting
 */
export async function advancedHybridSearch(
  query: string,
  limit: number = 20,
  folderPath?: string,
  options?: {
    created_before?: string;
    created_after?: string;
    modified_before?: string;
    modified_after?: string;
    has_images?: boolean;
    sort_by?: "relevance" | "creation_date" | "modification_date";
    sort_order?: "asc" | "desc";
  }
): Promise<SearchResult[]> {
  const queryEmbedding = await generateEmbedding(query);
  const embeddingStr = `[${queryEmbedding.join(",")}]`;

  // Build filter conditions
  const filterConditions: string[] = [];
  const params: any[] = [embeddingStr, query, folderPath || null];
  let paramIndex = 4;

  if (options?.created_before) {
    filterConditions.push(`creation_date < $${paramIndex}`);
    params.push(options.created_before);
    paramIndex++;
  }
  if (options?.created_after) {
    filterConditions.push(`creation_date > $${paramIndex}`);
    params.push(options.created_after);
    paramIndex++;
  }
  if (options?.modified_before) {
    filterConditions.push(`modification_date < $${paramIndex}`);
    params.push(options.modified_before);
    paramIndex++;
  }
  if (options?.modified_after) {
    filterConditions.push(`modification_date > $${paramIndex}`);
    params.push(options.modified_after);
    paramIndex++;
  }
  if (options?.has_images !== undefined) {
    filterConditions.push(`has_images = $${paramIndex}`);
    params.push(options.has_images);
    paramIndex++;
  }

  const filters = filterConditions.length > 0
    ? `AND ${filterConditions.join(" AND ")}`
    : "";

  // Determine sorting
  const sortBy = options?.sort_by || "relevance";
  const sortOrder = options?.sort_order || "desc";

  let finalOrderBy = "ORDER BY rrf_score DESC";
  if (sortBy === "creation_date") {
    finalOrderBy = `ORDER BY creation_date ${sortOrder.toUpperCase()}`;
  } else if (sortBy === "modification_date") {
    finalOrderBy = `ORDER BY modification_date ${sortOrder.toUpperCase()}`;
  }

  // Add limit parameter
  params.push(limit);

  const sql = `WITH vector_search AS (
      SELECT id, title, content, creation_date, modification_date,
             ROW_NUMBER() OVER (ORDER BY embedding <=> $1::vector) AS rank
      FROM notes
      WHERE embedding IS NOT NULL
        AND ($3::text IS NULL OR folder_path = $3)
        ${filters}
      ORDER BY embedding <=> $1::vector
      LIMIT 50
    ),
    text_search AS (
      SELECT id, title, content, creation_date, modification_date,
             ROW_NUMBER() OVER (ORDER BY similarity(title, $2) + similarity(content, $2) DESC) AS rank
      FROM notes
      WHERE (title % $2 OR content % $2)
        AND ($3::text IS NULL OR folder_path = $3)
        ${filters}
      ORDER BY similarity(title, $2) + similarity(content, $2) DESC
      LIMIT 50
    )
    SELECT
      COALESCE(v.id, t.id) as id,
      COALESCE(v.title, t.title) as title,
      COALESCE(v.content, t.content) as content,
      COALESCE(v.creation_date, t.creation_date) as creation_date,
      COALESCE(v.modification_date, t.modification_date) as modification_date,
      (1.0 / (60 + COALESCE(v.rank, 9999))) + (1.0 / (60 + COALESCE(t.rank, 9999))) AS rrf_score
    FROM vector_search v
    FULL OUTER JOIN text_search t ON v.id = t.id
    ${finalOrderBy}
    LIMIT $${paramIndex}`;

  const result = await pool.query(sql, params);

  return result.rows.map((row) => ({
    title: row.title,
    content: row.content,
    score: row.rrf_score,
  }));
}
