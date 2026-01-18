import { pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";

// Singleton extractor instance
let extractor: FeatureExtractionPipeline | null = null;

// Promise to track model loading (prevents race condition)
let loadingPromise: Promise<FeatureExtractionPipeline> | null = null;

// Model configuration
const MODEL_NAME = "Xenova/all-MiniLM-L6-v2";
export const EMBEDDING_DIMENSIONS = 384;

/**
 * Initialize the embedding pipeline (lazy loading with race condition protection)
 */
async function getExtractor(): Promise<FeatureExtractionPipeline> {
  if (extractor) {
    return extractor;
  }

  // If already loading, wait for it
  if (loadingPromise) {
    return loadingPromise;
  }

  // Start loading
  loadingPromise = (async () => {
    console.error("🤖 Loading embedding model...");
    const modelStart = performance.now();
    extractor = await pipeline("feature-extraction", MODEL_NAME);
    const modelTime = Math.round(performance.now() - modelStart);
    console.error(`✅ Embedding model loaded in ${modelTime}ms`);
    loadingPromise = null;
    return extractor;
  })();

  return loadingPromise;
}

/**
 * Pre-load the model before batch processing
 */
export async function preloadModel(): Promise<void> {
  await getExtractor();
}

/**
 * Generate embedding for a single text
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const ext = await getExtractor();
  const output = await ext(text, { pooling: "mean" });
  return Array.from(output.data as Float32Array);
}

/**
 * Generate embeddings for multiple texts (batch processing)
 */
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const ext = await getExtractor();
  const results: number[][] = [];

  // Process in smaller batches to avoid memory issues
  const batchSize = 10;
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(async (text) => {
        const output = await ext(text, { pooling: "mean" });
        return Array.from(output.data as Float32Array);
      })
    );
    results.push(...batchResults);
  }

  return results;
}

/**
 * Combine title and content for embedding
 */
export function prepareTextForEmbedding(title: string, content: string): string {
  return `${title}\n\n${content}`.trim();
}
