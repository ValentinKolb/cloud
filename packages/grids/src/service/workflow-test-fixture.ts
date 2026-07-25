/**
 * Creating a workflow in a test, the way the app creates one now.
 *
 * A workflow is three rows: identity and an immutable version in the kernel,
 * and the Grids profile that scopes it to a base. Tests used to write a single
 * `grids.workflows` row, so this exists to keep that convenience without
 * pretending the table is still there.
 *
 * Raw SQL rather than the store, because fixtures need to pin ids and skip
 * compilation — a test asserting run behaviour should not also depend on its
 * source compiling.
 */
import { type SQL, sql } from "bun";

const hex = (seed: string) => new Bun.CryptoHasher("sha256").update(seed).digest("hex");

let counter = 0;
/** Five alphanumerics, unique per call — the format the profile's check enforces. */
const nextShortId = (): string => {
  counter += 1;
  return `T${counter.toString(36).toUpperCase().padStart(4, "0")}`.slice(0, 5);
};

export type TestWorkflowInput = {
  baseId: string;
  /** The connection the fixture belongs to — migration tests use an isolated one. */
  db?: SQL;
  id?: string;
  name?: string;
  shortId?: string;
  source?: string;
  /** Defaults to an empty bound plan, which is enough for anything not executing it. */
  plan?: Record<string, unknown>;
  diagnostics?: unknown[];
  enabled?: boolean;
  position?: number;
  ownerUserId?: string | null;
  recordEventActiveSince?: Date | null;
};

const EMPTY_PLAN = {
  schemaVersion: 2,
  languageId: "grids",
  languageVersion: 1,
  sourceHash: hex("fixture"),
  manifestHash: hex("fixture-manifest"),
  catalogHash: hex("fixture-catalog"),
  maxLoopItems: 10_000,
  actionPolicies: {},
  inputs: [],
  triggers: [],
  steps: [],
  bindings: {},
};

/** Returns the workflow id, which is the kernel's and the profile's alike. */
export const insertTestWorkflow = async (input: TestWorkflowInput): Promise<string> => {
  const db = input.db ?? sql;
  const id = input.id ?? Bun.randomUUIDv7();
  const source = input.source ?? "steps: []";
  const plan = input.plan ?? EMPTY_PLAN;

  await db`
    INSERT INTO workflows.workflow (id, app_id, scope_id, key, name, created_by_kind)
    VALUES (${id}::uuid, 'grids', ${input.baseId}, ${id}, ${input.name ?? "Test workflow"}, 'system')
    ON CONFLICT (id) DO NOTHING
  `;
  await db`
    INSERT INTO workflows.version (
      workflow_id, revision, source, source_hash, plan, diagnostics, language_id, language_version, manifest_hash, created_by_kind
    )
    SELECT ${id}::uuid, COALESCE(max(revision), 0) + 1, ${source}, ${hex(source)}, ${plan}, ${input.diagnostics ?? []},
           'grids', 1, ${hex("fixture-manifest")}, 'system'
    FROM workflows.version WHERE workflow_id = ${id}::uuid
  `;
  await db`
    INSERT INTO grids.workflow_profile (id, base_id, short_id, position, owner_user_id, enabled, record_event_active_since)
    VALUES (
      ${id}::uuid, ${input.baseId}::uuid, ${input.shortId ?? nextShortId()}, ${input.position ?? 0},
      ${input.ownerUserId ?? null}::uuid, ${input.enabled ?? false}, ${input.recordEventActiveSince ?? null}
    )
    ON CONFLICT (id) DO UPDATE SET enabled = EXCLUDED.enabled, position = EXCLUDED.position
  `;
  return id;
};

/** Publishes another version, the way saving a changed source does. */
export const publishTestWorkflowVersion = async (id: string, source: string, plan?: Record<string, unknown>): Promise<number> => {
  const [row] = await sql<Array<{ revision: number }>>`
    INSERT INTO workflows.version (
      workflow_id, revision, source, source_hash, plan, diagnostics, language_id, language_version, manifest_hash, created_by_kind
    )
    SELECT ${id}::uuid, COALESCE(max(revision), 0) + 1, ${source}, ${hex(source)}, ${plan ?? EMPTY_PLAN}, '[]'::jsonb,
           'grids', 1, ${hex("fixture-manifest")}, 'system'
    FROM workflows.version WHERE workflow_id = ${id}::uuid
    RETURNING revision
  `;
  return row?.revision ?? 1;
};

/** Soft-deletes it the way removeWorkflow does. */
export const deleteTestWorkflow = async (id: string): Promise<void> => {
  await sql`
    UPDATE grids.workflow_profile SET deleted_at = now(), enabled = FALSE, record_event_active_since = NULL WHERE id = ${id}::uuid
  `;
};

/** Renames it. The name lives on the kernel row, not on the profile. */
export const renameTestWorkflow = async (id: string, name: string): Promise<void> => {
  await sql`UPDATE workflows.workflow SET name = ${name}, updated_at = now() WHERE id = ${id}::uuid`;
};
