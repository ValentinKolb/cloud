import type { WorkflowDiagnostic, WorkflowIrInput } from "@valentinkolb/cloud/workflows";
import { err, fail, ok, type Result } from "@valentinkolb/stdlib";
import { sql } from "bun";
import type {
  CreateGridsWorkflowLauncherInput,
  GridsWorkflow,
  GridsWorkflowLauncher,
  GridsWorkflowLauncherConfig,
  UpdateGridsWorkflowLauncherInput,
} from "../workflows/contracts";
import { GridsWorkflowLauncherConfigSchema } from "../workflows/contracts";
import { logAudit } from "./audit";
import { parseJsonbRow } from "./jsonb";
import { insertWithShortId } from "./short-id";
import { workflowInputShapeError } from "./workflow-kernel-values";

type DbRow = Record<string, unknown>;

const selectColumns = sql`
  id, short_id, base_id, workflow_id, name, kind, config, enabled, validated_revision,
  diagnostics, deleted_at, created_at, updated_at
`;

const mapLauncher = (row: DbRow): GridsWorkflowLauncher => {
  const config = GridsWorkflowLauncherConfigSchema.safeParse(parseJsonbRow(row.config, null));
  if (!config.success) throw err.internal("stored workflow launcher config is invalid");
  return {
    id: row.id as string,
    shortId: row.short_id as string,
    baseId: row.base_id as string,
    workflowId: row.workflow_id as string,
    name: row.name as string,
    config: config.data,
    enabled: Boolean(row.enabled),
    validatedRevision: Number(row.validated_revision),
    diagnostics: parseJsonbRow<WorkflowDiagnostic[]>(row.diagnostics, []),
    deletedAt: row.deleted_at ? (row.deleted_at as Date).toISOString() : null,
    createdAt: (row.created_at as Date).toISOString(),
    updatedAt: (row.updated_at as Date).toISOString(),
  };
};

const inputByName = (workflow: GridsWorkflow, name: string): WorkflowIrInput | null =>
  workflow.plan.inputs.find((input) => input.name === name) ?? null;

export const validateLauncherConfig = (workflow: GridsWorkflow, config: GridsWorkflowLauncherConfig): WorkflowDiagnostic[] => {
  const diagnostics: WorkflowDiagnostic[] = [];
  const add = (code: string, message: string, path: Array<string | number>): void => {
    diagnostics.push({ code, message, severity: "error", path });
  };
  if (config.kind === "scanner" || config.kind === "bulk") {
    const input = inputByName(workflow, config.input);
    const expected = config.kind === "scanner" ? "record" : "recordList";
    if (!input) add("launcher.input.unknown", `Unknown workflow input "${config.input}"`, ["config", "input"]);
    else if (input.type !== expected) {
      add("launcher.input.type", `${config.kind} requires a ${expected} input`, ["config", "input"]);
    }
  }
  if (config.kind === "scanner" && config.resolve.by === "field" && !config.resolve.field) {
    add("launcher.field.required", "Field resolution requires a field", ["config", "resolve", "field"]);
  }
  if (config.kind === "dashboard") {
    for (const name of Object.keys(config.inputBindings ?? {})) {
      if (!inputByName(workflow, name))
        add("launcher.input.unknown", `Unknown workflow input "${name}"`, ["config", "inputBindings", name]);
    }
    for (const input of workflow.plan.inputs) {
      const message = workflowInputShapeError(input, config.inputBindings?.[input.name]);
      if (message) add("launcher.input.invalid", `Workflow input "${input.name}" ${message}`, ["config", "inputBindings", input.name]);
    }
  }
  return diagnostics;
};

export const getLauncher = async (id: string): Promise<GridsWorkflowLauncher | null> => {
  const [row] = await sql<DbRow[]>`
    SELECT ${selectColumns}
    FROM grids.workflow_launchers
    WHERE id = ${id}::uuid AND deleted_at IS NULL
  `;
  return row ? mapLauncher(row) : null;
};

export const listLaunchers = async (workflowId: string, enabledOnly = false): Promise<GridsWorkflowLauncher[]> => {
  const rows = await sql<DbRow[]>`
    SELECT ${selectColumns}
    FROM grids.workflow_launchers
    WHERE workflow_id = ${workflowId}::uuid
      AND deleted_at IS NULL
      AND (${enabledOnly} = FALSE OR enabled = TRUE)
    ORDER BY created_at, id
  `;
  return rows.map(mapLauncher);
};

export const createLauncher = async (
  workflow: GridsWorkflow,
  input: CreateGridsWorkflowLauncherInput,
  actorId: string | null,
): Promise<Result<GridsWorkflowLauncher>> => {
  const diagnostics = validateLauncherConfig(workflow, input.config);
  if (diagnostics.length > 0) return fail(err.badInput(diagnostics.map((item) => item.message).join("; ")));
  const launcher = await sql.begin(async (tx) => {
    const row = await insertWithShortId(async (shortId) => {
      const [inserted] = await tx<DbRow[]>`
        INSERT INTO grids.workflow_launchers (
          short_id, base_id, workflow_id, name, kind, config, enabled, validated_revision, diagnostics
        ) VALUES (
          ${shortId}, ${workflow.baseId}::uuid, ${workflow.id}::uuid, ${input.name.trim()}, ${input.config.kind},
          ${input.config}::jsonb, ${input.enabled ?? true}, ${workflow.revision}, '[]'::jsonb
        )
        RETURNING ${selectColumns}
      `;
      if (!inserted) throw err.internal("workflow launcher insert failed");
      return inserted;
    }, "idx_grids_workflow_launchers_short_id");
    const created = mapLauncher(row);
    await logAudit(
      {
        baseId: workflow.baseId,
        userId: actorId,
        action: "workflow.updated",
        diff: { workflowLauncher: { old: null, new: { id: created.id, workflowId: workflow.id, kind: created.config.kind } } },
      },
      tx,
    );
    return created;
  });
  return ok(launcher);
};

export const updateLauncher = async (
  launcher: GridsWorkflowLauncher,
  workflow: GridsWorkflow,
  input: UpdateGridsWorkflowLauncherInput,
  actorId: string | null,
): Promise<Result<GridsWorkflowLauncher>> => {
  const config = input.config ?? launcher.config;
  const diagnostics = validateLauncherConfig(workflow, config);
  if (diagnostics.length > 0) return fail(err.badInput(diagnostics.map((item) => item.message).join("; ")));
  const [row] = await sql<DbRow[]>`
    UPDATE grids.workflow_launchers
    SET name = ${input.name?.trim() ?? launcher.name},
        kind = ${config.kind},
        config = ${config}::jsonb,
        enabled = ${input.enabled ?? launcher.enabled},
        validated_revision = ${workflow.revision},
        diagnostics = '[]'::jsonb,
        updated_at = now()
    WHERE id = ${launcher.id}::uuid AND deleted_at IS NULL
    RETURNING ${selectColumns}
  `;
  if (!row) return fail(err.notFound("workflow launcher"));
  const updated = mapLauncher(row);
  await logAudit({
    baseId: workflow.baseId,
    userId: actorId,
    action: "workflow.updated",
    diff: { workflowLauncher: { old: { id: launcher.id }, new: { id: updated.id, kind: updated.config.kind } } },
  });
  return ok(updated);
};

export const removeLauncher = async (launcher: GridsWorkflowLauncher, actorId: string | null): Promise<void> => {
  await sql`
    UPDATE grids.workflow_launchers
    SET deleted_at = now(), enabled = FALSE, updated_at = now()
    WHERE id = ${launcher.id}::uuid AND deleted_at IS NULL
  `;
  await logAudit({
    baseId: launcher.baseId,
    userId: actorId,
    action: "workflow.updated",
    diff: { workflowLauncher: { old: { id: launcher.id, kind: launcher.config.kind }, new: null } },
  });
};
