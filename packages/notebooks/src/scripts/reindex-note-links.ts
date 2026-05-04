/**
 * Backfill the cross-note link index for every existing note.
 *
 * The link index (`notebooks.note_links`) is normally maintained by
 * `notes.save()` on every successful content write. This script exists for:
 *  - first deploy after the feature lands (notes pre-date the index)
 *  - recovery after a bug or accidental TRUNCATE
 *  - forced rebuild during development
 *
 * Idempotent: each note's outgoing edges are replaced atomically by
 * `reindexLinks`, so running this twice produces the same end state.
 *
 * Usage: `bun run packages/notebooks/src/scripts/reindex-note-links.ts`
 */
import { sql } from "bun";
import { reindexLinks } from "../service/links";

const BATCH = 200;

const main = async () => {
  console.log("⟳ Reindexing notebooks.note_links from notebooks.notes …");

  let offset = 0;
  let processed = 0;
  let withLinks = 0;

  while (true) {
    const rows = await sql<{ id: string; content_md: string | null }[]>`
      SELECT id, content_md
      FROM notebooks.notes
      ORDER BY created_at ASC
      LIMIT ${BATCH} OFFSET ${offset}
    `;
    if (rows.length === 0) break;

    for (const row of rows) {
      await reindexLinks(row.id, row.content_md);
      processed++;
      if (row.content_md && /\/app\/notebooks\//.test(row.content_md)) {
        withLinks++;
      }
    }

    offset += rows.length;
    console.log(`  processed ${processed} notes (with links: ${withLinks})`);
  }

  const [counts] = await sql<{ edges: number }[]>`
    SELECT COUNT(*)::int AS edges FROM notebooks.note_links
  `;

  console.log(`✓ done — ${processed} notes scanned, ${counts?.edges ?? 0} edges in index`);
  await sql.end();
};

await main();
