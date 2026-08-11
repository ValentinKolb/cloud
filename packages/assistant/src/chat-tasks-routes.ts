import { AiChatTaskIdempotencyConflictError, aiChatTasks } from "@valentinkolb/cloud/ai";
import { CapabilityIdempotencyKeySchema, capabilityIdempotencyConflict } from "@valentinkolb/cloud/contracts";
import { type AuthContext, err, fail, ok, respond, v } from "@valentinkolb/cloud/server";
import { type Context, Hono } from "hono";
import { z } from "zod";
import {
  AssistantChatIdSchema,
  ChatTaskIdSchema,
  chatTaskCreateFingerprint,
  getChatTaskTimezone,
  normalizeChatTaskSchedule,
  ChatTaskScheduleInputSchema as ScheduleInputSchema,
  toAssistantChatTask,
  toAssistantChatTaskOccurrence,
} from "./chat-tasks-contracts";
import { assistantChatTaskRuntime, reconcileAssistantChatTasks } from "./chat-tasks-runtime";

const APP_ID = "assistant";
const CreateSchema = z
  .object({ chatId: AssistantChatIdSchema, prompt: z.string().trim().min(1).max(10_000), schedule: ScheduleInputSchema })
  .strict();
const UpdateSchema = z
  .object({ prompt: z.string().trim().min(1).max(10_000).optional(), schedule: ScheduleInputSchema.optional() })
  .strict()
  .refine((value) => value.prompt !== undefined || value.schedule !== undefined, "Provide a prompt or schedule");
const ListSchema = z
  .object({
    chatId: AssistantChatIdSchema.optional(),
    state: z.enum(["active", "paused", "completed", "needs_attention"]).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

const userId = (c: Context<AuthContext>): string | null => {
  const actor = c.get("actor");
  return actor.kind === "user" ? actor.user.id : (actor.delegatedUser?.id ?? null);
};

const reconcileSoon = (): void => {
  void reconcileAssistantChatTasks().catch(() => undefined);
};

export const chatTaskRoutes = new Hono<AuthContext>()
  .get("/tasks", v("query", ListSchema), async (c) => {
    const owner = userId(c);
    if (!owner) return respond(c, fail(err.forbidden("Scheduled tasks require a user-backed actor")));
    const query = c.req.valid("query");
    return respond(c, ok((await aiChatTasks.list({ appId: APP_ID, userId: owner, ...query })).map(toAssistantChatTask)));
  })
  .get("/tasks/status", async (c) => {
    const owner = userId(c);
    if (!owner) return respond(c, fail(err.forbidden("Scheduled tasks require a user-backed actor")));
    return respond(c, ok({ timezone: await getChatTaskTimezone() }));
  })
  .post("/tasks", v("json", CreateSchema), async (c) => {
    const owner = userId(c);
    if (!owner) return respond(c, fail(err.forbidden("Scheduled tasks require a user-backed actor")));
    const input = c.req.valid("json");
    const idempotencyKey = CapabilityIdempotencyKeySchema.safeParse(c.req.header("Idempotency-Key"));
    if (!idempotencyKey.success) return respond(c, fail(err.badInput("A valid Idempotency-Key is required")));
    const idempotencyFingerprint = chatTaskCreateFingerprint(input);
    try {
      const replay = await aiChatTasks.getCreateByIdempotency({
        appId: APP_ID,
        userId: owner,
        idempotencyKey: idempotencyKey.data,
        idempotencyFingerprint,
      });
      if (replay) return respond(c, ok(toAssistantChatTask(replay)), 201);
    } catch (error) {
      if (error instanceof AiChatTaskIdempotencyConflictError) return respond(c, fail(capabilityIdempotencyConflict(error.message)));
      throw error;
    }
    let normalized: Awaited<ReturnType<typeof normalizeChatTaskSchedule>>;
    try {
      normalized = await normalizeChatTaskSchedule(input.schedule);
    } catch (error) {
      return respond(c, fail(err.badInput(error instanceof Error ? error.message : "Invalid schedule")));
    }
    let task: Awaited<ReturnType<typeof aiChatTasks.create>>;
    try {
      task = await aiChatTasks.create({
        appId: APP_ID,
        userId: owner,
        chatId: input.chatId,
        prompt: input.prompt,
        ...normalized,
        idempotencyKey: idempotencyKey.data,
        idempotencyFingerprint,
      });
    } catch (error) {
      if (error instanceof AiChatTaskIdempotencyConflictError) return respond(c, fail(capabilityIdempotencyConflict(error.message)));
      throw error;
    }
    if (!task) return respond(c, fail(err.notFound("Chat")));
    reconcileSoon();
    return respond(c, ok(toAssistantChatTask(task)), 201);
  })
  .get("/tasks/:taskId", async (c) => {
    const owner = userId(c);
    if (!owner) return respond(c, fail(err.forbidden("Scheduled tasks require a user-backed actor")));
    const parsed = ChatTaskIdSchema.safeParse(c.req.param("taskId"));
    if (!parsed.success) return respond(c, fail(err.badInput("Invalid task ID")));
    const task = await aiChatTasks.get({ appId: APP_ID, userId: owner, taskId: parsed.data });
    if (!task) return respond(c, fail(err.notFound("Task")));
    const occurrences = await aiChatTasks.listOccurrences({ appId: APP_ID, userId: owner, taskId: parsed.data });
    return respond(
      c,
      ok({
        task: toAssistantChatTask(task),
        occurrences: (occurrences ?? []).map((entry) => toAssistantChatTaskOccurrence(entry, task.shortId)),
      }),
    );
  })
  .patch("/tasks/:taskId", v("json", UpdateSchema), async (c) => {
    const owner = userId(c);
    if (!owner) return respond(c, fail(err.forbidden("Scheduled tasks require a user-backed actor")));
    const parsed = ChatTaskIdSchema.safeParse(c.req.param("taskId"));
    if (!parsed.success) return respond(c, fail(err.badInput("Invalid task ID")));
    const input = c.req.valid("json");
    let normalized: Partial<Awaited<ReturnType<typeof normalizeChatTaskSchedule>>> = {};
    try {
      if (input.schedule) normalized = await normalizeChatTaskSchedule(input.schedule);
    } catch (error) {
      return respond(c, fail(err.badInput(error instanceof Error ? error.message : "Invalid schedule")));
    }
    const task = await aiChatTasks.update({ appId: APP_ID, userId: owner, taskId: parsed.data, prompt: input.prompt, ...normalized });
    if (!task) return respond(c, fail(err.notFound("Task")));
    reconcileSoon();
    return respond(c, ok(toAssistantChatTask(task)));
  })
  .delete("/tasks/:taskId", async (c) => {
    const owner = userId(c);
    if (!owner) return respond(c, fail(err.forbidden("Scheduled tasks require a user-backed actor")));
    const parsed = ChatTaskIdSchema.safeParse(c.req.param("taskId"));
    if (!parsed.success) return respond(c, fail(err.badInput("Invalid task ID")));
    if (!(await aiChatTasks.delete({ appId: APP_ID, userId: owner, taskId: parsed.data }))) return respond(c, fail(err.notFound("Task")));
    reconcileSoon();
    return respond(c, ok({ deleted: true }));
  })
  .post("/tasks/:taskId/pause", async (c) => {
    const owner = userId(c);
    if (!owner) return respond(c, fail(err.forbidden("Scheduled tasks require a user-backed actor")));
    const parsed = ChatTaskIdSchema.safeParse(c.req.param("taskId"));
    if (!parsed.success) return respond(c, fail(err.badInput("Invalid task ID")));
    const current = await aiChatTasks.get({ appId: APP_ID, userId: owner, taskId: parsed.data });
    if (!current) return respond(c, fail(err.notFound("Task")));
    if (current.state !== "active" && current.state !== "paused")
      return respond(c, fail(err.conflict(`Task ${current.shortId} cannot be paused while ${current.state}`)));
    const task = await aiChatTasks.setState({ appId: APP_ID, userId: owner, taskId: parsed.data, state: "paused" });
    if (!task) return respond(c, fail(err.conflict("Task state changed; read it and retry")));
    reconcileSoon();
    return respond(c, ok(toAssistantChatTask(task)));
  })
  .post("/tasks/:taskId/resume", async (c) => {
    const owner = userId(c);
    if (!owner) return respond(c, fail(err.forbidden("Scheduled tasks require a user-backed actor")));
    const parsed = ChatTaskIdSchema.safeParse(c.req.param("taskId"));
    if (!parsed.success) return respond(c, fail(err.badInput("Invalid task ID")));
    const current = await aiChatTasks.get({ appId: APP_ID, userId: owner, taskId: parsed.data });
    if (!current) return respond(c, fail(err.notFound("Task")));
    if (current.state === "needs_attention" && current.schedule.kind === "once")
      return respond(c, fail(err.conflict(`Task ${current.shortId} needs a new future schedule before it can resume`)));
    if (current.state === "completed")
      return respond(c, fail(err.conflict(`Task ${current.shortId} cannot be resumed while ${current.state}`)));
    const task = await aiChatTasks.setState({ appId: APP_ID, userId: owner, taskId: parsed.data, state: "active" });
    if (!task) return respond(c, fail(err.conflict("Task state changed; read it and retry")));
    reconcileSoon();
    return respond(c, ok(toAssistantChatTask(task)));
  })
  .post("/tasks/:taskId/run", async (c) => {
    const owner = userId(c);
    if (!owner) return respond(c, fail(err.forbidden("Scheduled tasks require a user-backed actor")));
    const parsed = ChatTaskIdSchema.safeParse(c.req.param("taskId"));
    if (!parsed.success) return respond(c, fail(err.badInput("Invalid task ID")));
    const task = await aiChatTasks.get({ appId: APP_ID, userId: owner, taskId: parsed.data });
    if (!task) return respond(c, fail(err.notFound("Task")));
    const key = CapabilityIdempotencyKeySchema.safeParse(c.req.header("Idempotency-Key"));
    if (!key.success) return respond(c, fail(err.badInput("A valid Idempotency-Key is required")));
    let occurrence: Awaited<ReturnType<typeof aiChatTasks.createOccurrence>>;
    try {
      occurrence = await aiChatTasks.createOccurrence({
        taskId: task.id,
        scheduledFor: new Date().toISOString(),
        trigger: "manual",
        requestKey: `manual:${APP_ID}:${owner}:${key.data}`,
      });
    } catch (error) {
      if (error instanceof AiChatTaskIdempotencyConflictError) return respond(c, fail(capabilityIdempotencyConflict(error.message)));
      throw error;
    }
    if (!occurrence) return respond(c, fail(err.conflict("The task is not active or already has a queued or running occurrence")));
    void assistantChatTaskRuntime.recover().catch(() => undefined);
    return respond(c, ok(toAssistantChatTaskOccurrence(occurrence, task.shortId)));
  });
