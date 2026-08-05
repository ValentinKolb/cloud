import { type AuthContext, auth, respond, v } from "@valentinkolb/cloud/server";
import { Hono } from "hono";
import { z } from "zod";
import { CUSTOM_APP_REFERENCE, CustomAppDefinitionInputSchema } from "../custom-apps/contracts";
import { gridsService } from "../service";
import { currentActorUserId, gateAt } from "./permissions";
import { requireUuidParam } from "./route-params";

const DefinitionBaseSchema = z.object({ baseId: z.string().uuid() });

const gateDefinitionAdmin = async (c: Parameters<typeof gateAt>[0], input: unknown) => {
  const parsed = DefinitionBaseSchema.safeParse(input);
  if (!parsed.success) return c.json({ diagnostics: parsed.error.issues }, 400);
  const gate = await gateAt(c, { baseId: parsed.data.baseId }, "admin");
  return gate.ok ? null : respond(c, () => Promise.resolve(gate));
};

export default new Hono<AuthContext>()
  .use(auth.requireRole("authenticated"))
  .get("/reference", (c) => c.json(CUSTOM_APP_REFERENCE))
  .get("/by-base/:baseId", requireUuidParam("baseId", "Base"), async (c) => {
    const baseId = c.req.param("baseId")!;
    const gate = await gateAt(c, { baseId }, "admin");
    if (!gate.ok) return respond(c, () => Promise.resolve(gate));
    return c.json(await gridsService.customApp.listByBase(baseId));
  })
  .post("/validate", v("json", CustomAppDefinitionInputSchema), async (c) => {
    const input = c.req.valid("json").definition;
    const denied = await gateDefinitionAdmin(c, input);
    if (denied) return denied;
    const compilation = await gridsService.customApp.compile(input);
    return c.json(
      compilation.ok
        ? { valid: true, diagnostics: [], capabilities: compilation.compiled.capabilities }
        : { valid: false, diagnostics: compilation.diagnostics },
    );
  })
  .post("/plan", v("json", CustomAppDefinitionInputSchema), async (c) => {
    const input = c.req.valid("json").definition;
    const denied = await gateDefinitionAdmin(c, input);
    if (denied) return denied;
    return c.json(await gridsService.customApp.plan(input));
  })
  .post("/apply", v("json", CustomAppDefinitionInputSchema), async (c) => {
    const input = c.req.valid("json").definition;
    const denied = await gateDefinitionAdmin(c, input);
    if (denied) return denied;
    return respond(c, () => gridsService.customApp.apply(input, currentActorUserId(c)));
  })
  .get("/:appId", requireUuidParam("appId", "Custom App"), async (c) => {
    const app = await gridsService.customApp.get(c.req.param("appId")!);
    if (!app) return c.json({ message: "Custom App not found" }, 404);
    const gate = await gateAt(c, { baseId: app.baseId }, "admin");
    if (!gate.ok) return respond(c, () => Promise.resolve(gate));
    return c.json(app);
  })
  .get("/:appId/export", requireUuidParam("appId", "Custom App"), async (c) => {
    const app = await gridsService.customApp.get(c.req.param("appId")!);
    if (!app) return c.json({ message: "Custom App not found" }, 404);
    const gate = await gateAt(c, { baseId: app.baseId }, "admin");
    if (!gate.ok) return respond(c, () => Promise.resolve(gate));
    return c.json(app.draftDefinition);
  })
  .post("/:appId/publish", requireUuidParam("appId", "Custom App"), async (c) => {
    const app = await gridsService.customApp.get(c.req.param("appId")!);
    if (!app) return c.json({ message: "Custom App not found" }, 404);
    const gate = await gateAt(c, { baseId: app.baseId }, "admin");
    if (!gate.ok) return respond(c, () => Promise.resolve(gate));
    return respond(c, () => gridsService.customApp.publish(app.id, currentActorUserId(c)));
  });
