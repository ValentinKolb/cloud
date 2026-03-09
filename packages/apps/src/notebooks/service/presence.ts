import { type NotebookPresenceParticipant, NotebookPresenceParticipantSchema } from "@valentinkolb/cloud/contracts/shared";
import { getNotebookPresenceColor } from "@valentinkolb/cloud/lib/shared";
import { ephemeral } from "@valentinkolb/sync";
import { z } from "zod";
import { NODE_ID } from "./yjs-sync";

const PRESENCE_TTL_MS = 30_000;
export const PRESENCE_HEARTBEAT_INTERVAL_MS = 10_000;

const PresenceEntrySchema = z.object({
  userId: z.uuid(),
  displayName: z.string().min(1),
  color: z.string().min(1),
  peerId: z.string().min(1),
  nodeId: z.string().min(1),
  joinedAt: z.number().int().nonnegative(),
});

type PresenceEntry = z.infer<typeof PresenceEntrySchema>;

const presenceStore = ephemeral({
  id: "notebooks.presence",
  schema: PresenceEntrySchema,
  ttlMs: PRESENCE_TTL_MS,
});

export type NotebookPresenceSnapshot = {
  participants: NotebookPresenceParticipant[];
  cursor: string;
};

const toParticipants = (
  entries: Array<{
    value: PresenceEntry;
  }>,
): NotebookPresenceParticipant[] => {
  const deduped = new Map<
    string,
    {
      userId: string;
      displayName: string;
      color: string;
      peerCount: number;
      joinedAt: number;
    }
  >();

  for (const entry of entries) {
    const current = deduped.get(entry.value.userId);
    if (current) {
      current.peerCount += 1;
      current.joinedAt = Math.min(current.joinedAt, entry.value.joinedAt);
      continue;
    }

    deduped.set(entry.value.userId, {
      userId: entry.value.userId,
      displayName: entry.value.displayName,
      color: entry.value.color,
      peerCount: 1,
      joinedAt: entry.value.joinedAt,
    });
  }

  return [...deduped.values()]
    .map((participant) =>
      NotebookPresenceParticipantSchema.parse({
        ...participant,
        joinedAt: new Date(participant.joinedAt).toISOString(),
      }),
    )
    .sort((left, right) => left.displayName.localeCompare(right.displayName));
};

export const snapshot = async (config: { noteId: string }): Promise<NotebookPresenceSnapshot> => {
  const state = await presenceStore.snapshot({ tenantId: config.noteId });
  return {
    participants: toParticipants(state.entries),
    cursor: state.cursor,
  };
};

export const reader = (config: { noteId: string; after?: string }) =>
  presenceStore.reader({
    tenantId: config.noteId,
    after: config.after,
  });

export const join = async (config: { noteId: string; peerId: string; userId: string; displayName: string }): Promise<void> => {
  await presenceStore.upsert({
    tenantId: config.noteId,
    key: config.peerId,
    value: {
      userId: config.userId,
      displayName: config.displayName,
      color: getNotebookPresenceColor(config.userId),
      peerId: config.peerId,
      nodeId: NODE_ID,
      joinedAt: Date.now(),
    },
  });
};

export const heartbeat = async (config: { noteId: string; peerId: string }): Promise<{ ok: boolean }> => {
  const result = await presenceStore.touch({
    tenantId: config.noteId,
    key: config.peerId,
  });

  return { ok: result.ok };
};

export const leave = async (config: { noteId: string; peerId: string; reason?: string }): Promise<boolean> =>
  presenceStore.remove({
    tenantId: config.noteId,
    key: config.peerId,
    reason: config.reason,
  });
