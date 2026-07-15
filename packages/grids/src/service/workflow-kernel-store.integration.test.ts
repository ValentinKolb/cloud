import { describe, expect, test } from "bun:test";
import { sql } from "bun";
import { migrate } from "../migrate";
import { createWorkflow, updateWorkflow } from "./workflow-kernel-store";

const postgresTest = process.env.GRIDS_QUERY_DSL_DB_TEST === "1" ? test : test.skip;

describe("workflow launcher revision lifecycle", () => {
  postgresTest("rejects an invalid stored schedule when activating a workflow", async () => {
    await migrate();
    const baseId = Bun.randomUUIDv7();
    const source = `triggers:
  schedule:
    cron: "0 8 * * *"
    timezone: UTC
steps:
  - succeed:
      message: Done`;

    try {
      await sql`INSERT INTO grids.bases (id, short_id, name) VALUES (${baseId}::uuid, 'WL003', 'Schedule activation test')`;
      const created = await createWorkflow(baseId, { name: "Scheduled workflow", source, enabled: false }, null);
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      const [stored] = await sql<Array<{ revision: number }>>`
        UPDATE grids.workflows
        SET source = ${source.replace('cron: "0 8 * * *"', 'cron: "61 8 * * *"')}
        WHERE id = ${created.data.id}::uuid
        RETURNING revision
      `;
      if (!stored) throw new Error("Expected stored workflow");

      const activated = await updateWorkflow(created.data.id, { enabled: true }, null, stored.revision);

      expect(activated.ok).toBe(false);
      if (!activated.ok) {
        expect(activated.error.status).toBe(400);
        expect(activated.error.message).toContain("cron minute field is invalid");
      }
    } finally {
      await sql`DELETE FROM grids.bases WHERE id = ${baseId}::uuid`;
    }
  });

  postgresTest("preserves the record-event activation boundary for redundant enable updates", async () => {
    await migrate();
    const baseId = Bun.randomUUIDv7();
    const source = `triggers:
  recordEvent:
    event: updated
steps:
  - succeed:
      message: Done`;

    try {
      await sql`INSERT INTO grids.bases (id, short_id, name) VALUES (${baseId}::uuid, 'WL000', 'Event boundary test')`;
      const created = await createWorkflow(baseId, { name: "Event workflow", source, enabled: true }, null);
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      const [before] = await sql<Array<{ active_since: Date }>>`
        SELECT record_event_active_since AS active_since FROM grids.workflows WHERE id = ${created.data.id}::uuid
      `;

      const updated = await updateWorkflow(created.data.id, { enabled: true }, null, created.data.revision);
      expect(updated.ok).toBe(true);
      const [after] = await sql<Array<{ active_since: Date }>>`
        SELECT record_event_active_since AS active_since FROM grids.workflows WHERE id = ${created.data.id}::uuid
      `;

      expect(after?.active_since.toISOString()).toBe(before?.active_since.toISOString());
    } finally {
      await sql`DELETE FROM grids.bases WHERE id = ${baseId}::uuid`;
    }
  });

  postgresTest("preserves launchers for metadata edits and disables them for source edits", async () => {
    await migrate();
    const baseId = Bun.randomUUIDv7();

    try {
      await sql`INSERT INTO grids.bases (id, short_id, name) VALUES (${baseId}::uuid, 'WL001', 'Launcher revision test')`;
      const created = await createWorkflow(
        baseId,
        { name: "Original", source: "steps:\n  - succeed:\n      message: Original", enabled: true },
        null,
      );
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const launcherId = Bun.randomUUIDv7();
      await sql`
        INSERT INTO grids.workflow_launchers (
          id, short_id, base_id, workflow_id, name, kind, config, enabled, validated_revision, diagnostics
        ) VALUES (
          ${launcherId}::uuid, 'WL002', ${baseId}::uuid, ${created.data.id}::uuid, 'Manual launcher', 'dashboard',
          '{"kind":"dashboard"}'::jsonb, TRUE, ${created.data.revision}, '[]'::jsonb
        )
      `;

      const metadataUpdate = await updateWorkflow(created.data.id, { name: "Renamed" }, null, created.data.revision);
      expect(metadataUpdate.ok).toBe(true);
      if (!metadataUpdate.ok) return;
      const [afterMetadata] = await sql<Array<{ enabled: boolean; validated_revision: number; diagnostics: unknown[] }>>`
        SELECT enabled, validated_revision, diagnostics
        FROM grids.workflow_launchers
        WHERE id = ${launcherId}::uuid
      `;
      expect(afterMetadata).toEqual({ enabled: true, validated_revision: metadataUpdate.data.revision, diagnostics: [] });

      const sourceUpdate = await updateWorkflow(
        created.data.id,
        { source: "steps:\n  - succeed:\n      message: Done" },
        null,
        metadataUpdate.data.revision,
      );
      expect(sourceUpdate.ok).toBe(true);
      if (!sourceUpdate.ok) return;
      const [afterSource] = await sql<Array<{ enabled: boolean; validated_revision: number; diagnostics: unknown[] }>>`
        SELECT enabled, validated_revision, diagnostics
        FROM grids.workflow_launchers
        WHERE id = ${launcherId}::uuid
      `;
      expect(afterSource).toMatchObject({
        enabled: false,
        validated_revision: sourceUpdate.data.revision,
        diagnostics: [{ code: "launcher.revalidate", severity: "warning" }],
      });
    } finally {
      await sql`DELETE FROM grids.bases WHERE id = ${baseId}::uuid`;
    }
  });
});
