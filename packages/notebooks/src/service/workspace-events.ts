import { logger } from "@valentinkolb/cloud/services";
import { topic } from "@valentinkolb/sync";
import type {
  NotebookWorkspaceEvent,
  NotebookWorkspaceInvalidationScope,
  NotebookWorkspaceNote,
  NotebookWorkspaceNotebook,
} from "../lib/workspace-events";

const log = logger("notebooks:workspace-events");
type InvalidationReason = Extract<NotebookWorkspaceEvent, { type: "workspace.invalidated" }>["reason"];

const TOPIC_PREFIX = "cloud:notebooks:events";
const TOPIC_RETENTION_MS = 24 * 60 * 60 * 1000;

const workspaceTopic = topic<NotebookWorkspaceEvent>({
  id: "workspace",
  prefix: TOPIC_PREFIX,
  retentionMs: TOPIC_RETENTION_MS,
  limits: { payloadBytes: 64_000 },
});

const publish = async (event: NotebookWorkspaceEvent, idempotencyKey?: string): Promise<void> => {
  try {
    await workspaceTopic.pub({
      tenantId: event.notebookId,
      orderingKey: event.notebookId,
      idempotencyKey,
      data: event,
    });
  } catch (error) {
    log.warn("Failed to publish workspace event", {
      type: event.type,
      notebookId: event.notebookId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

export const live = (config: { notebookId: string; after?: string | null; signal?: AbortSignal }) =>
  workspaceTopic.live({
    tenantId: config.notebookId,
    after: config.after ?? undefined,
    signal: config.signal,
  });

export const notebookUpdated = (notebook: NotebookWorkspaceNotebook): Promise<void> =>
  publish({
    v: 1,
    type: "notebook.updated",
    notebookId: notebook.id,
    notebook,
  });

export const noteCreated = (note: NotebookWorkspaceNote): Promise<void> =>
  publish(
    {
      v: 1,
      type: "note.created",
      notebookId: note.notebookId,
      note,
    },
    `note:${note.id}:created:${note.createdAt}`,
  );

export const noteUpdated = (note: NotebookWorkspaceNote): Promise<void> =>
  publish({
    v: 1,
    type: "note.updated",
    notebookId: note.notebookId,
    note,
  });

export const noteDeleted = (config: { notebookId: string; noteId: string; shortId: string }): Promise<void> =>
  publish(
    {
      v: 1,
      type: "note.deleted",
      notebookId: config.notebookId,
      noteId: config.noteId,
      shortId: config.shortId,
    },
    `note:${config.noteId}:deleted`,
  );

export const noteFavoriteChanged = (config: { notebookId: string; noteId: string; userId: string; favorite: boolean }): Promise<void> =>
  publish({
    v: 1,
    type: "note.favorite.changed",
    notebookId: config.notebookId,
    noteId: config.noteId,
    userId: config.userId,
    favorite: config.favorite,
  });

export const invalidated = (config: {
  notebookId: string;
  reason: InvalidationReason;
  scopes: NotebookWorkspaceInvalidationScope[];
}): Promise<void> =>
  publish({
    v: 1,
    type: "workspace.invalidated",
    notebookId: config.notebookId,
    reason: config.reason,
    scopes: config.scopes,
  });
