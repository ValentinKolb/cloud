import type { AuthContext } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";
import type { Context } from "hono";
import { currentActorUser } from "../../api/permissions";
import { ssr } from "../../config";
import { gridsService } from "../../service";
import { loadWorkflowCatalog, resolveWorkflowTableRef } from "../../service/workflows";
import ScanWorkflowPage, { type ScannerWorkflowOption, type ScanWorkflowPageState } from "../_components/workflows/ScanWorkflowPage.island";

const recordLabel = async (tableId: string, recordId: string): Promise<string> => {
  const [fields, record] = await Promise.all([gridsService.field.listByTable(tableId), gridsService.record.get(tableId, recordId)]);
  if (!record) return recordId;
  const labelField =
    fields.find((field) => field.name.trim().toLowerCase() === "name") ??
    fields.find((field) => field.type === "text") ??
    fields.find((field) => field.type === "longtext");
  const value = labelField ? record.data[labelField.id] : null;
  return value === null || value === undefined || value === "" ? recordId : String(value);
};

const permissionLevel = async (
  user: AuthContext["Variables"]["user"],
  target: { baseId: string; tableId?: string; workflowId?: string },
) => {
  const grants = await gridsService.permission.loadGrants({
    userId: user.id,
    userGroups: user.memberofGroupIds,
    baseId: target.baseId,
    tableId: target.tableId ?? null,
    workflowId: target.workflowId ?? null,
  });
  return gridsService.permission.resolve(
    grants,
    target.workflowId
      ? { baseId: target.baseId, workflowId: target.workflowId }
      : target.tableId
        ? { baseId: target.baseId, tableId: target.tableId }
        : { baseId: target.baseId },
  );
};

const scannerWorkflowOptions = async (
  user: AuthContext["Variables"]["user"],
  baseId: string,
  tableId: string,
): Promise<ScannerWorkflowOption[]> => {
  const catalog = await loadWorkflowCatalog(baseId);
  const workflows = await gridsService.workflow.listEnabledForBase(baseId);
  const options: ScannerWorkflowOption[] = [];
  for (const workflow of workflows) {
    const scanner = workflow.compiled.triggers.scanner;
    if (!scanner) continue;
    const input = workflow.compiled.inputs?.[scanner.input];
    const inputTable = input?.type === "record" && input.table ? resolveWorkflowTableRef(catalog, input.table) : null;
    if (inputTable?.id !== tableId) continue;
    const level = await permissionLevel(user, { baseId, workflowId: workflow.id });
    if (!gridsService.permission.hasAtLeast(level, "write")) continue;
    options.push({ id: workflow.id, name: workflow.name, description: workflow.description });
  }
  return options.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
};

const loadScanState = async <T extends AuthContext>(c: Context<T>): Promise<ScanWorkflowPageState> => {
  const user = currentActorUser(c);
  if (!user) return { initialCode: "", scan: null, error: "Sign in to use scanner workflows." };

  const url = new URL(c.req.url);
  const initialCode = (url.searchParams.get("code") ?? "").trim();
  if (!initialCode) return { initialCode, scan: null, error: null };

  const scanCode = await gridsService.workflow.getRecordScanCode(initialCode);
  if (!scanCode) return { initialCode, scan: null, error: "Scan code not found." };
  const [base, table] = await Promise.all([gridsService.base.get(scanCode.baseId), gridsService.table.get(scanCode.tableId)]);
  if (!base || !table) return { initialCode, scan: null, error: "Scanned record no longer exists." };

  const tableLevel = await permissionLevel(user, { baseId: scanCode.baseId, tableId: scanCode.tableId });
  if (!gridsService.permission.hasAtLeast(tableLevel, "read")) {
    return { initialCode, scan: null, error: "You do not have permission to read this scanned record." };
  }

  return {
    initialCode,
    error: null,
    scan: {
      baseName: base.name,
      tableName: table.name,
      recordId: scanCode.recordId,
      recordLabel: await recordLabel(scanCode.tableId, scanCode.recordId),
      workflows: await scannerWorkflowOptions(user, scanCode.baseId, scanCode.tableId),
    },
  };
};

export default ssr<AuthContext>(async (c) => {
  const state = await loadScanState(c);
  return () => (
    <Layout c={c} fullWidth title={[{ title: "Grids", href: "/app/grids" }, { title: "Scan" }]}>
      <ScanWorkflowPage state={state} />
    </Layout>
  );
});
