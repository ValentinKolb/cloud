import { z } from "zod";

/**
 * Public contract for the expeditions app — every type returned to the
 * frontend or accepted from the API is declared here as a Zod schema, then
 * inferred into a TypeScript type. Hono's `describeRoute` consumes the same
 * schemas to publish OpenAPI documentation, so contract & docs never drift.
 *
 * UUID validation matches Postgres' broader-than-RFC `uuid` text format
 * (also accepted in spaces / notebooks, kept consistent on purpose).
 */
const Uuid = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

// ── Expedition (tenancy entity) ─────────────────────────────────────────────

export const ExpeditionSchema = z.object({
  id: Uuid.describe("Expedition UUID"),
  title: z.string().describe("Expedition title"),
  description: z.string().nullable().describe("Optional description"),
  icon: z.string().describe("Tabler icon class (e.g. 'ti ti-map-2')"),
  completedAt: z.string().nullable().describe("Set when all waypoints are done (ISO)"),
  createdBy: Uuid.nullable().describe("Creator user UUID"),
  createdAt: z.string().describe("Creation timestamp (ISO)"),
  updatedAt: z.string().describe("Last update timestamp (ISO)"),
  // Aggregates loaded with the list / detail view. Cheap to compute in the
  // same query — saves the frontend a round-trip per expedition.
  totalWaypoints: z.number().int().describe("Total waypoint count"),
  doneWaypoints: z.number().int().describe("Number of waypoints already done"),
});
export type Expedition = z.infer<typeof ExpeditionSchema>;

export const CreateExpeditionSchema = z.object({
  title: z.string().min(1).max(120),
  description: z.string().max(2_000).optional(),
  icon: z.string().max(50).optional(),
});
export type CreateExpedition = z.infer<typeof CreateExpeditionSchema>;

export const UpdateExpeditionSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  description: z.string().max(2_000).nullable().optional(),
  icon: z.string().max(50).optional(),
});
export type UpdateExpedition = z.infer<typeof UpdateExpeditionSchema>;

// ── Waypoint (item) ─────────────────────────────────────────────────────────

export const WaypointSchema = z.object({
  id: Uuid.describe("Waypoint UUID"),
  expeditionId: Uuid.describe("Parent expedition UUID"),
  title: z.string().describe("Waypoint title"),
  position: z.number().int().describe("Order within the expedition"),
  doneAt: z.string().nullable().describe("ISO timestamp when ticked off, else null"),
  createdAt: z.string().describe("Creation timestamp (ISO)"),
  updatedAt: z.string().describe("Last update timestamp (ISO)"),
});
export type Waypoint = z.infer<typeof WaypointSchema>;

export const CreateWaypointSchema = z.object({
  title: z.string().min(1).max(200),
});
export type CreateWaypoint = z.infer<typeof CreateWaypointSchema>;

export const SetWaypointDoneSchema = z.object({
  done: z.boolean().describe("True = mark done, false = mark open again"),
});
export type SetWaypointDone = z.infer<typeof SetWaypointDoneSchema>;

// ── Standard error / message envelopes ──────────────────────────────────────

export const ErrorResponseSchema = z.object({
  error: z.boolean(),
  message: z.string(),
  code: z.string().optional(),
});

export const MessageResponseSchema = z.object({
  message: z.string(),
});
