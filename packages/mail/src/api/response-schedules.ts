import { type AuthContext, respond, v } from "@valentinkolb/cloud/server";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { createResponseScheduleSchema, updateResponseScheduleSchema } from "../contracts";
import { type MailRequestContext, responseSchedules } from "../service";

const mailboxParamSchema = z.object({ mailboxId: z.string().uuid() });
const scheduleParamSchema = z.object({ mailboxId: z.string().uuid(), scheduleId: z.string().uuid() });
const requestContext = (c: Context<AuthContext>): MailRequestContext => ({
  actor: c.get("actor"),
  accessSubject: c.get("accessSubject"),
  requestId: c.req.header("x-request-id") ?? null,
});

export default new Hono<AuthContext>()
  .get("/mailboxes/:mailboxId/response-schedules", v("param", mailboxParamSchema), async (c) =>
    respond(c, responseSchedules.listResponseSchedules(requestContext(c), c.req.valid("param").mailboxId)),
  )
  .post(
    "/mailboxes/:mailboxId/response-schedules",
    v("param", mailboxParamSchema),
    v("json", createResponseScheduleSchema),
    async (c) =>
      respond(
        c,
        responseSchedules.createResponseSchedule({
          context: requestContext(c),
          mailboxId: c.req.valid("param").mailboxId,
          input: c.req.valid("json"),
        }),
      ),
  )
  .patch(
    "/mailboxes/:mailboxId/response-schedules/:scheduleId",
    v("param", scheduleParamSchema),
    v("json", updateResponseScheduleSchema),
    async (c) =>
      respond(
        c,
        responseSchedules.updateResponseSchedule({
          context: requestContext(c),
          ...c.req.valid("param"),
          input: c.req.valid("json"),
        }),
      ),
  );
