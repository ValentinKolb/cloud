import type { WorkflowBoundPlan, WorkflowIr, WorkflowIrStep, WorkflowJsonValue } from "@valentinkolb/cloud/workflows";
import { parse, stringify } from "yaml";
import { type ResponseScheduleDefinitionInput, responseScheduleDefinitionSchema } from "../contracts";

type ScheduleLookup = (reference: string) => ResponseScheduleDefinitionInput | null;

const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

const resolveSchedule = (reference: string, lookup: ScheduleLookup): ResponseScheduleDefinitionInput => {
  const schedule = lookup(reference);
  if (!schedule) throw new Error(`Cannot migrate unknown Mail response schedule "${reference}"`);
  const parsed = responseScheduleDefinitionSchema.safeParse(schedule);
  if (!parsed.success) throw new Error(`Cannot migrate invalid Mail response schedule "${reference}"`);
  return parsed.data;
};

const scheduleWorkflowValue = (schedule: ResponseScheduleDefinitionInput): WorkflowJsonValue => ({
  timeZone: schedule.timeZone,
  activeRanges: schedule.activeRanges.map((range) => ({ from: range.from, to: range.to })),
  weeklyWindows: schedule.weeklyWindows.map((window) => ({
    weekday: window.weekday,
    start: window.start,
    end: window.end,
  })),
  exceptions: schedule.exceptions.map((exception) => ({
    date: exception.date,
    closed: exception.closed,
    windows: exception.windows.map((window) => ({ start: window.start, end: window.end })),
  })),
});

const migrateSourceValue = (value: unknown, lookup: ScheduleLookup): number => {
  if (Array.isArray(value)) return value.reduce((count, item) => count + migrateSourceValue(item, lookup), 0);
  if (!isObject(value)) return 0;
  let migrated = 0;
  const action = value.automaticReply;
  if (isObject(action) && typeof action.schedule === "string") {
    action.schedule = resolveSchedule(action.schedule, lookup);
    migrated += 1;
  }
  for (const child of Object.values(value)) migrated += migrateSourceValue(child, lookup);
  return migrated;
};

const migrateIrSteps = (steps: WorkflowIrStep[], lookup: ScheduleLookup): number => {
  let migrated = 0;
  for (const step of steps) {
    if (step.kind === "action" && step.action === "automaticReply" && typeof step.config.schedule === "string") {
      step.config.schedule = scheduleWorkflowValue(resolveSchedule(step.config.schedule, lookup));
      migrated += 1;
    } else if (step.kind === "if") {
      migrated += migrateIrSteps(step.then, lookup) + migrateIrSteps(step.else, lookup);
    } else if (step.kind === "switch") {
      for (const item of step.cases) migrated += migrateIrSteps(item.steps, lookup);
      migrated += migrateIrSteps(step.default, lookup);
    } else if (step.kind === "forEach") {
      migrated += migrateIrSteps(step.steps, lookup);
    }
  }
  return migrated;
};

export const inlineWorkflowResponseSchedules = (params: {
  source: string;
  ir: WorkflowIr;
  boundPlan: WorkflowBoundPlan;
  lookup: ScheduleLookup;
}): { source: string; ir: WorkflowIr; boundPlan: WorkflowBoundPlan; migratedActions: number } => {
  const sourceDocument = parse(params.source) as unknown;
  if (!isObject(sourceDocument)) throw new Error("Cannot migrate a non-object Mail workflow source");
  const ir = structuredClone(params.ir);
  const boundPlan = structuredClone(params.boundPlan);
  const sourceCount = migrateSourceValue(sourceDocument, params.lookup);
  const irCount = migrateIrSteps(ir.steps, params.lookup);
  const planCount = migrateIrSteps(boundPlan.steps, params.lookup);

  for (const key of Object.keys(boundPlan.bindings)) {
    if (key.endsWith(".automaticReply.schedule")) delete boundPlan.bindings[key];
  }
  if (sourceCount !== irCount || sourceCount !== planCount) {
    throw new Error("Mail response schedule migration found inconsistent workflow representations");
  }
  return {
    source: sourceCount > 0 ? stringify(sourceDocument, { lineWidth: 0 }) : params.source,
    ir,
    boundPlan,
    migratedActions: sourceCount,
  };
};
