#!/usr/bin/env bun
import "dotenv/config";
import { pool, closePool } from "./src/db.js";

async function listLargeNotes() {
  const limit = process.argv[2] ? parseInt(process.argv[2]) : 20;
  const minSize = process.argv[3] ? parseInt(process.argv[3]) : 100000; // 100KB default

  console.log(`\n📊 Notes larger than ${(minSize / 1024).toFixed(0)}KB (showing top ${limit}):\n`);

  const result = await pool.query(
    `SELECT
      title,
      folder_path,
      LENGTH(content) as content_length,
      LENGTH(html_content) as html_length,
      modification_date
    FROM notes
    WHERE LENGTH(content) > $1
    ORDER BY LENGTH(content) DESC
    LIMIT $2`,
    [minSize, limit]
  );

  if (result.rows.length === 0) {
    console.log("No notes found above the size threshold.\n");
    await closePool();
    return;
  }

  // Calculate totals
  let totalSize = 0;

  console.log("┌─────────────────────────────────────────────────────────────────────────────────┐");
  console.log("│ Title                                          │ Folder      │ Size     │ Date       │");
  console.log("├─────────────────────────────────────────────────────────────────────────────────┤");

  for (const row of result.rows) {
    const title = row.title.substring(0, 45).padEnd(45);
    const folder = (row.folder_path || "Notes").substring(0, 10).padEnd(10);
    const sizeMB = (row.content_length / 1024 / 1024).toFixed(1);
    const size = `${sizeMB} MB`.padStart(8);
    const date = row.modification_date
      ? new Date(row.modification_date).toISOString().split("T")[0]
      : "N/A";

    totalSize += row.content_length;

    console.log(`│ ${title} │ ${folder} │ ${size} │ ${date} │`);
  }

  console.log("└─────────────────────────────────────────────────────────────────────────────────┘");

  const totalMB = (totalSize / 1024 / 1024).toFixed(1);
  console.log(`\n📈 Summary:`);
  console.log(`   Large notes: ${result.rows.length}`);
  console.log(`   Total size: ${totalMB} MB`);
  console.log(`\n💡 These notes likely contain embedded images (base64).`);
  console.log(`   Consider deleting or moving attachments to reduce indexing time.\n`);

  await closePool();
}

listLargeNotes().catch(console.error);
