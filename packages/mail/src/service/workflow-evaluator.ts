import type {
  WorkflowAction,
  WorkflowCondition,
  WorkflowDefinition,
  WorkflowDiagnostic,
  WorkflowStep,
  WorkflowValidation,
} from "../contracts";
import { workflowDefinitionSchema } from "../contracts";
import { sha256Json } from "./canonical";

const MAX_TREE_DEPTH = 8;
const MAX_TREE_NODES = 100;
const MAX_EXECUTION_PATHS = 512;

export type WorkflowSnapshot = {
  remoteMessageRefId: string;
  messageId: string;
  conversationId: string | null;
  subject: string;
  body: string;
  bodyAvailable: boolean;
  senderValues: string[];
  recipientValues: string[];
  attachmentNames: string[];
  attachmentsAvailable: boolean;
  hasAttachment: boolean;
  contentHash: string;
  internalDate: string;
  folderId: string;
  flags: string[];
  keywords: string[];
  collaboration: {
    revision: number;
    assigneeUserId: string | null;
    workStatus: "open" | "waiting" | "done";
    responseNeeded: boolean;
  } | null;
};

export type PlannedWorkflowAction = {
  sequence: number;
  path: string;
  action: WorkflowAction;
  expectedConversationRevision: number | null;
};

type WorkflowEvaluation = { state: "ready"; actions: PlannedWorkflowAction[] } | { state: "waiting_data"; actions: [] };

type PathAction = { path: string; action: WorkflowAction };
type ExecutionPath = { actions: PathAction[]; stopped: boolean };

const diagnosticKey = (diagnostic: WorkflowDiagnostic): string =>
  `${diagnostic.severity}:${diagnostic.code}:${diagnostic.path}:${diagnostic.message}`;

const dedupeDiagnostics = (diagnostics: WorkflowDiagnostic[]): WorkflowDiagnostic[] => {
  const seen = new Set<string>();
  return diagnostics.filter((diagnostic) => {
    const key = diagnosticKey(diagnostic);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const inspectCondition = (
  condition: WorkflowCondition,
  path: string,
  depth: number,
  state: { nodes: number; diagnostics: WorkflowDiagnostic[] },
): void => {
  state.nodes += 1;
  if (depth > MAX_TREE_DEPTH) {
    state.diagnostics.push({
      severity: "error",
      code: "TREE_DEPTH",
      path,
      message: `Workflow trees may be at most ${MAX_TREE_DEPTH} levels deep.`,
    });
  }
  if (state.nodes > MAX_TREE_NODES) return;
  if ("all" in condition) condition.all.forEach((child, index) => inspectCondition(child, `${path}.all.${index}`, depth + 1, state));
  else if ("any" in condition) condition.any.forEach((child, index) => inspectCondition(child, `${path}.any.${index}`, depth + 1, state));
  else if ("not" in condition) inspectCondition(condition.not, `${path}.not`, depth + 1, state);
};

const inspectSteps = (
  steps: WorkflowStep[],
  path: string,
  depth: number,
  state: { nodes: number; diagnostics: WorkflowDiagnostic[] },
): void => {
  for (const [index, step] of steps.entries()) {
    const stepPath = `${path}.${index}`;
    state.nodes += 1;
    if (depth > MAX_TREE_DEPTH) {
      state.diagnostics.push({
        severity: "error",
        code: "TREE_DEPTH",
        path: stepPath,
        message: `Workflow trees may be at most ${MAX_TREE_DEPTH} levels deep.`,
      });
    }
    if (state.nodes > MAX_TREE_NODES) continue;
    if ("when" in step) {
      inspectCondition(step.when, `${stepPath}.when`, depth + 1, state);
      inspectSteps(step.then, `${stepPath}.then`, depth + 1, state);
      if (step.else) inspectSteps(step.else, `${stepPath}.else`, depth + 1, state);
    }
  }
};

const expandSteps = (steps: WorkflowStep[], path: string, initial: ExecutionPath[]): ExecutionPath[] => {
  let paths = initial;
  for (const [index, step] of steps.entries()) {
    const stepPath = `${path}.${index}`;
    if ("action" in step) {
      paths = paths.map((current) =>
        current.stopped ? current : { ...current, actions: [...current.actions, { path: stepPath, action: step }] },
      );
      continue;
    }
    if ("stop" in step) {
      paths = paths.map((current) => ({ ...current, stopped: true }));
      continue;
    }
    const branched: ExecutionPath[] = [];
    for (const current of paths) {
      if (current.stopped) {
        branched.push(current);
        continue;
      }
      branched.push(...expandSteps(step.then, `${stepPath}.then`, [{ actions: [...current.actions], stopped: false }]));
      branched.push(
        ...(step.else
          ? expandSteps(step.else, `${stepPath}.else`, [{ actions: [...current.actions], stopped: false }])
          : [{ actions: [...current.actions], stopped: false }]),
      );
      if (branched.length > MAX_EXECUTION_PATHS) return branched.slice(0, MAX_EXECUTION_PATHS + 1);
    }
    paths = branched;
  }
  return paths;
};

const inspectActionPath = (path: ExecutionPath): WorkflowDiagnostic[] => {
  const diagnostics: WorkflowDiagnostic[] = [];
  const keywordOperations = new Map<string, "add" | "remove">();
  let providerActionStarted = false;
  let move: PathAction | null = null;
  let assignee: { value: string | null; path: string } | null = null;
  let status: { value: string; path: string } | null = null;

  for (const item of path.actions) {
    const action = item.action;
    const providerAction = action.action.startsWith("remote.");
    if (!providerAction && providerActionStarted) {
      diagnostics.push({
        severity: "error",
        code: "ACTION_ORDER",
        path: item.path,
        message: "Collaboration actions must run before provider actions in workflow V1.",
      });
    }
    if (move) {
      diagnostics.push({
        severity: "error",
        code: "MOVE_MUST_BE_LAST",
        path: item.path,
        message: "A remote move must be the final action on its execution path.",
      });
    }
    providerActionStarted ||= providerAction;

    if (action.action === "remote.move") {
      move = item;
      continue;
    }
    if (action.action === "remote.keyword.add" || action.action === "remote.keyword.remove") {
      const keyword = action.keyword.toLowerCase();
      const operation = action.action === "remote.keyword.add" ? "add" : "remove";
      const previous = keywordOperations.get(keyword);
      if (previous && previous !== operation) {
        diagnostics.push({
          severity: "error",
          code: "KEYWORD_CONFLICT",
          path: item.path,
          message: `Keyword ${action.keyword} is both added and removed on one execution path.`,
        });
      }
      keywordOperations.set(keyword, operation);
      continue;
    }
    if (action.action === "assign") {
      if (assignee && assignee.value !== action.userId) {
        diagnostics.push({
          severity: "error",
          code: "ASSIGNMENT_CONFLICT",
          path: item.path,
          message: "One execution path assigns the conversation to different users.",
        });
      }
      assignee = { value: action.userId, path: item.path };
      continue;
    }
    if (action.action === "status.set") {
      if (status && status.value !== action.status) {
        diagnostics.push({
          severity: "error",
          code: "STATUS_CONFLICT",
          path: item.path,
          message: "One execution path sets different conversation statuses.",
        });
      }
      status = { value: action.status, path: item.path };
    }
  }
  return diagnostics;
};

export const validateWorkflowDefinition = (input: unknown): WorkflowValidation => {
  const parsed = workflowDefinitionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      valid: false,
      definition: null,
      definitionHash: null,
      diagnostics: parsed.error.issues.map((issue) => ({
        severity: "error",
        code: "SCHEMA",
        path: issue.path.join(".") || "definition",
        message: issue.message,
      })),
    };
  }

  const state = { nodes: 0, diagnostics: [] as WorkflowDiagnostic[] };
  inspectSteps(parsed.data.steps, "steps", 1, state);
  if (state.nodes > MAX_TREE_NODES) {
    state.diagnostics.push({
      severity: "error",
      code: "TREE_SIZE",
      path: "steps",
      message: `Workflow trees may contain at most ${MAX_TREE_NODES} conditions and steps.`,
    });
  }
  const paths = expandSteps(parsed.data.steps, "steps", [{ actions: [], stopped: false }]);
  if (paths.length > MAX_EXECUTION_PATHS) {
    state.diagnostics.push({
      severity: "error",
      code: "PATH_COUNT",
      path: "steps",
      message: `Workflow trees may produce at most ${MAX_EXECUTION_PATHS} execution paths.`,
    });
  } else {
    for (const path of paths) state.diagnostics.push(...inspectActionPath(path));
  }
  const diagnostics = dedupeDiagnostics(state.diagnostics);
  return {
    valid: !diagnostics.some((diagnostic) => diagnostic.severity === "error"),
    definition: parsed.data,
    definitionHash: sha256Json(parsed.data),
    diagnostics,
  };
};

type ConditionResult = true | false | "waiting_data";

const normalizeText = (value: string): string => value.normalize("NFKC").toLowerCase();

const matchesText = (values: string[], operator: "contains" | "equals" | "startsWith" | "endsWith", expected: string): boolean => {
  const needle = normalizeText(expected);
  return values.some((value) => {
    const normalized = normalizeText(value);
    if (operator === "equals") return normalized === needle;
    if (operator === "startsWith") return normalized.startsWith(needle);
    if (operator === "endsWith") return normalized.endsWith(needle);
    return normalized.includes(needle);
  });
};

const evaluateCondition = (condition: WorkflowCondition, snapshot: WorkflowSnapshot): ConditionResult => {
  if ("all" in condition) {
    let waiting = false;
    for (const child of condition.all) {
      const result = evaluateCondition(child, snapshot);
      if (result === false) return false;
      waiting ||= result === "waiting_data";
    }
    return waiting ? "waiting_data" : true;
  }
  if ("any" in condition) {
    let waiting = false;
    for (const child of condition.any) {
      const result = evaluateCondition(child, snapshot);
      if (result === true) return true;
      waiting ||= result === "waiting_data";
    }
    return waiting ? "waiting_data" : false;
  }
  if ("not" in condition) {
    const result = evaluateCondition(condition.not, snapshot);
    return result === "waiting_data" ? result : !result;
  }
  if (condition.field === "folder") return snapshot.folderId === condition.value;
  if (condition.field === "keyword") {
    const keyword = condition.value.toLowerCase();
    return snapshot.keywords.some((value) => value.toLowerCase() === keyword);
  }
  if (condition.field === "flag") return snapshot.flags.includes(condition.value);
  if (condition.field === "hasAttachment")
    return snapshot.attachmentsAvailable ? snapshot.hasAttachment === condition.value : "waiting_data";
  if (condition.field === "body" && !snapshot.bodyAvailable) return "waiting_data";
  if (condition.field === "attachmentName" && !snapshot.attachmentsAvailable) return "waiting_data";
  const values =
    condition.field === "subject"
      ? [snapshot.subject]
      : condition.field === "body"
        ? [snapshot.body]
        : condition.field === "sender"
          ? snapshot.senderValues
          : condition.field === "recipient"
            ? snapshot.recipientValues
            : snapshot.attachmentNames;
  return matchesText(values, condition.operator, condition.value);
};

const selectActions = (
  steps: WorkflowStep[],
  snapshot: WorkflowSnapshot,
  path: string,
): { state: "ready" | "waiting_data"; actions: PathAction[]; stopped: boolean } => {
  const actions: PathAction[] = [];
  for (const [index, step] of steps.entries()) {
    const stepPath = `${path}.${index}`;
    if ("action" in step) {
      actions.push({ path: stepPath, action: step });
      continue;
    }
    if ("stop" in step) return { state: "ready", actions, stopped: true };
    const condition = evaluateCondition(step.when, snapshot);
    if (condition === "waiting_data") return { state: "waiting_data", actions: [], stopped: false };
    const branch = condition ? step.then : (step.else ?? []);
    const selected = selectActions(branch, snapshot, `${stepPath}.${condition ? "then" : "else"}`);
    if (selected.state === "waiting_data") return selected;
    actions.push(...selected.actions);
    if (selected.stopped) return { state: "ready", actions, stopped: true };
  }
  return { state: "ready", actions, stopped: false };
};

const removeNoOps = (actions: PathAction[], snapshot: WorkflowSnapshot): PlannedWorkflowAction[] => {
  const keywords = new Map(snapshot.keywords.map((keyword) => [keyword.toLowerCase(), keyword]));
  let folderId = snapshot.folderId;
  let assigneeUserId = snapshot.collaboration?.assigneeUserId ?? null;
  let workStatus = snapshot.collaboration?.workStatus ?? "open";
  let conversationRevision = snapshot.collaboration?.revision ?? 0;
  const planned: PlannedWorkflowAction[] = [];

  for (const item of actions) {
    const action = item.action;
    let changed = false;
    let expectedConversationRevision: number | null = null;
    if (action.action === "remote.keyword.add") {
      const key = action.keyword.toLowerCase();
      changed = !keywords.has(key);
      if (changed) keywords.set(key, action.keyword);
    } else if (action.action === "remote.keyword.remove") {
      changed = keywords.delete(action.keyword.toLowerCase());
    } else if (action.action === "remote.move") {
      changed = folderId !== action.destinationFolderId;
      if (changed) folderId = action.destinationFolderId;
    } else if (action.action === "assign") {
      if (!snapshot.collaboration) return [];
      changed = assigneeUserId !== action.userId;
      if (changed) {
        expectedConversationRevision = conversationRevision;
        assigneeUserId = action.userId;
        conversationRevision += 1;
      }
    } else {
      if (!snapshot.collaboration) return [];
      changed = workStatus !== action.status;
      if (changed) {
        expectedConversationRevision = conversationRevision;
        workStatus = action.status;
        conversationRevision += 1;
      }
    }
    if (!changed) continue;
    planned.push({
      sequence: planned.length,
      path: item.path,
      action,
      expectedConversationRevision,
    });
  }
  return planned;
};

export const evaluateWorkflow = (definition: WorkflowDefinition, snapshot: WorkflowSnapshot): WorkflowEvaluation => {
  const selected = selectActions(definition.steps, snapshot, "steps");
  if (selected.state === "waiting_data") return { state: "waiting_data", actions: [] };
  if (selected.actions.some((item) => !item.action.action.startsWith("remote.")) && !snapshot.collaboration) {
    return { state: "waiting_data", actions: [] };
  }
  return { state: "ready", actions: removeNoOps(selected.actions, snapshot) };
};
