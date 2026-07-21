import { z } from "zod";

export const SPACE_LIVE_WS_TYPE = {
  subscribe: "spaces.live.subscribe",
  ready: "spaces.live.ready",
  event: "spaces.live.event",
  revoked: "spaces.live.revoked",
  error: "spaces.live.error",
} as const;

export const SpaceServiceEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.enum(["item.created", "item.updated", "item.deleted", "item.moved", "item.completed", "item.transferred"]),
    spaceId: z.uuid(),
    itemId: z.uuid(),
    at: z.string().datetime(),
  }),
  z.object({
    type: z.enum(["wormhole.created", "wormhole.updated", "wormhole.deleted"]),
    spaceId: z.uuid(),
    wormholeId: z.uuid(),
    at: z.string().datetime(),
  }),
  z.object({
    type: z.enum(["space.updated", "space.deleted", "access.changed"]),
    spaceId: z.uuid(),
    at: z.string().datetime(),
  }),
]);

export type SpaceServiceEvent = z.infer<typeof SpaceServiceEventSchema>;
export type SpaceServiceEventData = SpaceServiceEvent extends infer Event
  ? Event extends { at: string }
    ? Omit<Event, "at">
    : never
  : never;

const StreamCursorSchema = z.string().regex(/^\d+-\d+$/);

export const SpaceLiveClientMessageSchema = z.object({
  type: z.literal(SPACE_LIVE_WS_TYPE.subscribe),
  payload: z.object({
    spaceId: z.uuid(),
    fromCursor: StreamCursorSchema.nullable(),
  }),
});

export type SpaceLiveClientMessage = z.infer<typeof SpaceLiveClientMessageSchema>;

export const SpaceLiveServerMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal(SPACE_LIVE_WS_TYPE.ready),
    payload: z.object({ spaceId: z.uuid(), cursor: StreamCursorSchema }),
  }),
  z.object({
    type: z.literal(SPACE_LIVE_WS_TYPE.event),
    payload: z.object({ spaceId: z.uuid(), cursor: StreamCursorSchema, event: SpaceServiceEventSchema }),
  }),
  z.object({
    type: z.literal(SPACE_LIVE_WS_TYPE.revoked),
    payload: z.object({ spaceId: z.uuid(), code: z.string().min(1), message: z.string().min(1) }),
  }),
  z.object({
    type: z.literal(SPACE_LIVE_WS_TYPE.error),
    payload: z.object({ spaceId: z.uuid().optional(), code: z.string().min(1), message: z.string().min(1) }),
  }),
]);

export type SpaceLiveServerMessage = z.infer<typeof SpaceLiveServerMessageSchema>;

export const parseSpaceLiveServerMessage = (raw: string): SpaceLiveServerMessage | null => {
  try {
    const parsed = SpaceLiveServerMessageSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};
