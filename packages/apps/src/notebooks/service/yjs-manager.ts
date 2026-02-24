/**
 * Yjs Document Manager
 *
 * Manages the lifecycle of collaborative Yjs documents for real-time note editing.
 * Each note has one Y.Doc that is shared across all connected clients via WebSocket.
 *
 * ## Architecture Overview
 *
 * ```
 * ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
 * │  Client A   │     │  Client B   │     │  Client C   │
 * │  (Browser)  │     │  (Browser)  │     │  (Browser)  │
 * └──────┬──────┘     └──────┬──────┘     └──────┬──────┘
 *        │ WebSocket         │ WebSocket         │ WebSocket
 *        └───────────────────┼───────────────────┘
 *                            ▼
 *                   ┌─────────────────┐
 *                   │   yjs-manager   │  ← This module
 *                   │  (In-Memory)    │
 *                   └────────┬────────┘
 *                            │ Periodic saves
 *                            ▼
 *                   ┌─────────────────┐
 *                   │    Database     │
 *                   │   (Snapshots)   │
 *                   └─────────────────┘
 * ```
 *
 * ## Document Lifecycle
 *
 * 1. **Load**: First client connects → load snapshot from DB into Y.Doc
 * 2. **Edit**: Clients send updates → apply to Y.Doc, broadcast to others
 * 3. **Snapshot**: Every 10s if dirty → save Y.Doc state to DB
 * 4. **Version**: After 100 changes or 5 min → create version for history
 * 5. **Unload**: No clients for 5min → save final snapshot, destroy Y.Doc
 *
 * ## Sync Protocol (y-protocols)
 *
 * Uses standard Yjs sync protocol:
 * - Client sends SyncStep1 (state vector) on connect
 * - Server responds with SyncStep2 (missing updates)
 * - Ongoing: clients send updates, server broadcasts to all subscribers
 *
 * ## Version Creation
 *
 * Versions (for history/restore) are created:
 * - After CHANGES_THRESHOLD (100) operations
 * - After VERSION_TIME_INTERVAL (5 min) since last version, if there are changes
 * - On document unload (if dirty)
 * - On server shutdown
 *
 * Versions are NOT created on every save to avoid bloating the database.
 *
 * ## Thread Safety
 *
 * This module is designed for single-threaded Node.js.
 * The `isSaving` flag prevents concurrent saves of the same document.
 *
 * @module yjs-manager
 */

import * as Y from "yjs";
import * as notes from "./notes";
import { logger } from "@valentinkolb/cloud/core/services";

const log = logger("yjs");

// ==========================
// Types
// ==========================

type ActiveDocument = {
  doc: Y.Doc;
  noteId: string;
  notebookId: string;
  subscribers: Map<string, string | null>; // peerId → userId
  lastActivity: number;
  isDirty: boolean;
  changesSinceVersion: number;
  lastVersionAt: number;
  isSaving: boolean;
};

// ==========================
// Configuration
// ==========================

/** How often to check for inactive documents (ms) */
const CLEANUP_INTERVAL = 60_000; // 1 minute

/** How long a document stays loaded after last activity (ms) */
const INACTIVE_TIMEOUT = 5 * 60_000; // 5 minutes

/** How often to save snapshots (ms) */
const SNAPSHOT_INTERVAL = 2_000; // 2 seconds

/** Create a version after this many operations */
const CHANGES_THRESHOLD = 100;

/** Create a version after this much time since the last version (ms) */
const VERSION_TIME_INTERVAL = 5 * 60_000; // 5 minutes

// ==========================
// In-Memory Document Store
// ==========================

const ACTIVE_DOCUMENTS = new Map<string, ActiveDocument>();

// ==========================
// Document Lifecycle
// ==========================

/**
 * Get or load a Yjs document for a note.
 */
export const getDocument = async (noteId: string, notebookId: string): Promise<Y.Doc> => {
  let active = ACTIVE_DOCUMENTS.get(noteId);

  if (!active) {
    const doc = new Y.Doc({ gc: true });

    // Try to load existing snapshot
    const snapshot = await notes.getYjsState({ noteId });
    if (snapshot) {
      Y.applyUpdate(doc, snapshot);
    }

    active = {
      doc,
      noteId,
      notebookId,
      subscribers: new Map(),
      lastActivity: Date.now(),
      isDirty: false,
      changesSinceVersion: 0,
      lastVersionAt: Date.now(),
      isSaving: false,
    };

    ACTIVE_DOCUMENTS.set(noteId, active);
    log.info("Loaded document", { noteId });
  }

  active.lastActivity = Date.now();
  return active.doc;
};

/**
 * Apply an update to a document.
 */
export const applyUpdate = (noteId: string, update: Uint8Array): void => {
  const active = ACTIVE_DOCUMENTS.get(noteId);
  if (!active) {
    throw new Error(`Document not loaded: ${noteId}`);
  }

  Y.applyUpdate(active.doc, update);
  active.lastActivity = Date.now();
  active.isDirty = true;
  active.changesSinceVersion++;
};

/**
 * Mark a document as dirty.
 */
export const markDirty = (noteId: string): void => {
  const active = ACTIVE_DOCUMENTS.get(noteId);
  if (!active) return;
  active.lastActivity = Date.now();
  active.isDirty = true;
  active.changesSinceVersion++;
};

/**
 * Get the Y.Doc for a loaded document (without creating it).
 */
export const getDoc = (noteId: string): Y.Doc | null => {
  return ACTIVE_DOCUMENTS.get(noteId)?.doc ?? null;
};

/**
 * Get the current document snapshot as a full state update.
 */
export const getSnapshot = (noteId: string): Uint8Array | null => {
  const active = ACTIVE_DOCUMENTS.get(noteId);
  if (!active) return null;
  return Y.encodeStateAsUpdate(active.doc);
};

/**
 * Get the state vector for sync protocol handshake.
 */
export const getStateVector = (noteId: string): Uint8Array | null => {
  const active = ACTIVE_DOCUMENTS.get(noteId);
  if (!active) return null;
  return Y.encodeStateVector(active.doc);
};

/**
 * Get the markdown content of the document's text.
 */
export const getMarkdown = (noteId: string): string | null => {
  const active = ACTIVE_DOCUMENTS.get(noteId);
  if (!active) return null;
  return active.doc.getText("codemirror").toString();
};

// ==========================
// Subscriber Management
// ==========================

/**
 * Add a subscriber to a document.
 */
export const addSubscriber = async (noteId: string, notebookId: string, peerId: string, userId: string | null): Promise<Y.Doc> => {
  const doc = await getDocument(noteId, notebookId);
  const active = ACTIVE_DOCUMENTS.get(noteId)!;

  active.subscribers.set(peerId, userId);
  active.lastActivity = Date.now();

  log.debug("Subscriber added", {
    noteId,
    peerId,
    total: active.subscribers.size,
  });
  return doc;
};

/**
 * Remove a subscriber from a document.
 */
export const removeSubscriber = (noteId: string, peerId: string): void => {
  const active = ACTIVE_DOCUMENTS.get(noteId);
  if (!active) return;

  active.subscribers.delete(peerId);
  active.lastActivity = Date.now();

  log.debug("Subscriber removed", {
    noteId,
    peerId,
    remaining: active.subscribers.size,
  });
};

/**
 * Get subscriber count for a note.
 */
export const getSubscriberCount = (noteId: string): number => {
  return ACTIVE_DOCUMENTS.get(noteId)?.subscribers.size ?? 0;
};

/**
 * Check if a document is loaded.
 */
export const isLoaded = (noteId: string): boolean => {
  return ACTIVE_DOCUMENTS.has(noteId);
};

/**
 * Get the list of online user IDs for a note.
 */
export const getOnlineUsers = (noteId: string): string[] => {
  const active = ACTIVE_DOCUMENTS.get(noteId);
  if (!active) return [];
  return [...new Set([...active.subscribers.values()].filter((uid): uid is string => uid !== null))];
};

// ==========================
// Snapshot Management
// ==========================

/**
 * Save a snapshot of a document to the database.
 */
const saveDocumentSnapshot = async (noteId: string, createVersion: boolean): Promise<void> => {
  const active = ACTIVE_DOCUMENTS.get(noteId);
  if (!active || !active.isDirty || active.isSaving) return;

  active.isSaving = true;

  try {
    const snapshot = Y.encodeStateAsUpdate(active.doc);
    const contentMd = active.doc.getText("codemirror").toString();

    const result = await notes.save({
      noteId,
      yjsState: snapshot,
      contentMd,
      createdBy: null,
      createVersion,
    });

    if (!result.ok) {
      if (result.error === "Cannot modify locked note") {
        log.info("Note locked, skipping save", { noteId });
        active.isDirty = false;
        return;
      }
      throw new Error(result.error);
    }

    active.isDirty = false;
    if (createVersion) {
      active.changesSinceVersion = 0;
      active.lastVersionAt = Date.now();
    }

    log.info("Saved snapshot", { noteId, version: createVersion });
  } finally {
    active.isSaving = false;
  }
};

/**
 * Save dirty documents. Creates a version if changes threshold or time interval is reached.
 */
const checkSnapshots = async (): Promise<void> => {
  const now = Date.now();

  for (const [noteId, active] of ACTIVE_DOCUMENTS) {
    if (!active.isDirty || active.isSaving) continue;

    const createVersion =
      active.changesSinceVersion >= CHANGES_THRESHOLD ||
      (active.changesSinceVersion > 0 && now - active.lastVersionAt >= VERSION_TIME_INTERVAL);

    try {
      await saveDocumentSnapshot(noteId, createVersion);
    } catch (err) {
      log.error("Failed to save snapshot", {
        noteId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
};

// ==========================
// Cleanup
// ==========================

/**
 * Unload a document from memory.
 */
const unloadDocument = async (noteId: string): Promise<void> => {
  const active = ACTIVE_DOCUMENTS.get(noteId);
  if (!active || active.subscribers.size > 0) return;

  // Save final snapshot with version if dirty
  if (active.isDirty) {
    try {
      await saveDocumentSnapshot(noteId, true);
    } catch (err) {
      log.error("Failed to save final snapshot", {
        noteId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  active.doc.destroy();
  ACTIVE_DOCUMENTS.delete(noteId);
  log.info("Unloaded document", { noteId });
};

/**
 * Cleanup inactive documents.
 */
const cleanupInactive = async (): Promise<void> => {
  const now = Date.now();

  for (const [noteId, active] of ACTIVE_DOCUMENTS) {
    if (active.subscribers.size > 0) continue;
    if (now - active.lastActivity > INACTIVE_TIMEOUT) {
      await unloadDocument(noteId);
    }
  }
};

// ==========================
// Initialization
// ==========================

let cleanupInterval: ReturnType<typeof setInterval> | null = null;
let snapshotInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start the Yjs document manager.
 */
export const start = (): void => {
  if (cleanupInterval) return;

  cleanupInterval = setInterval(cleanupInactive, CLEANUP_INTERVAL);
  snapshotInterval = setInterval(checkSnapshots, SNAPSHOT_INTERVAL);

  log.info("Document manager started");
};

/**
 * Stop the Yjs document manager and save all documents.
 */
export const stop = async (): Promise<void> => {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
  if (snapshotInterval) {
    clearInterval(snapshotInterval);
    snapshotInterval = null;
  }

  // Save all dirty documents with version
  for (const [noteId, active] of ACTIVE_DOCUMENTS) {
    if (active.isDirty) {
      try {
        await saveDocumentSnapshot(noteId, true);
      } catch (err) {
        log.error("Failed to save snapshot", {
          noteId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    active.doc.destroy();
  }

  ACTIVE_DOCUMENTS.clear();
  log.info("Document manager stopped");
};

/**
 * Get stats about loaded documents.
 */
export const getStats = (): {
  loadedDocuments: number;
  totalSubscribers: number;
  dirtyDocuments: number;
} => {
  let totalSubscribers = 0;
  let dirtyDocuments = 0;

  for (const active of ACTIVE_DOCUMENTS.values()) {
    totalSubscribers += active.subscribers.size;
    if (active.isDirty) dirtyDocuments++;
  }

  return {
    loadedDocuments: ACTIVE_DOCUMENTS.size,
    totalSubscribers,
    dirtyDocuments,
  };
};
