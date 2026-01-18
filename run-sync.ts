#!/usr/bin/env bun
import "dotenv/config";
import { syncNotes } from "./src/indexer.js";
import { initializeSchema, closePool } from "./src/db.js";

async function main() {
  console.log("🔄 Starting incremental sync...\n");

  await initializeSchema();
  const result = await syncNotes();

  console.log("\n📊 Sync Results:");
  console.log(`   Total changes: ${result.totalNotes}`);
  console.log(`   Processed: ${result.processedNotes}`);
  console.log(`   Failed: ${result.failedNotes}`);
  console.log(`   Time: ${Math.round(result.timeMs! / 1000)}s`);

  await closePool();
}

main().catch(console.error);
