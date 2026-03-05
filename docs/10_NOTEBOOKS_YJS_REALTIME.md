# Notebooks Realtime (Yjs)

This document describes the current notebooks collaboration architecture.

## Goals

- Multi-node safe (no sticky session requirement)
- No shared in-memory Y.Doc on server nodes
- Durable stream of changes + async snapshot persistence
- Minimal, explicit websocket control flow (replay/sync/awareness/error)

## High-level flow

```text
Client Tab A/B
   | replay.request / sync.publish / awareness.publish
   v
WebSocket Node (stateless, phase = open|joined|closing)
   | pub/sub (sync + awareness)
   v
Redis Topic Stream (cloud:notebooks:yjs:<noteId>)
   | enqueue snapshot jobs
   v
Snapshot Queue + Worker (distributed lock per note)
   | stale-write guarded save
   v
Postgres notebooks.notes (yjs_snapshot, yjs_stream_ms, yjs_stream_seq)
```

## Protocol messages

- `notes.yjs.replay.request`: client asks server to start stream from `fromCursor` (or snapshot fallback).
- `notes.yjs.replay.ready`: server ack that replay/live streaming is active.
- `notes.yjs.sync.publish`: client sends local document updates.
- `notes.yjs.awareness.publish`: client sends local cursor/presence updates.
- `notes.yjs.sync.push`: server pushes document updates.
- `notes.yjs.awareness.push`: server pushes cursor/presence updates.
- `notes.yjs.error`: typed protocol/auth/access errors.

## Server behavior summary

1. Authenticate from `notes.yjs.replay.request.sessionToken`.
2. Check notebook permission (`read` for replay, `write` for `sync` changes).
3. Send DB snapshot once when no `fromCursor` is provided.
4. Stream topic events (`sync` + `awareness`) to the socket in small batches.
5. Mark note dirty only for `sync` events and queue snapshot jobs periodically/unload.
6. Re-check auth/access every 10 seconds; if invalid, send `notes.yjs.error` and close.

## Snapshot worker behavior

1. Consume queue jobs (`noteId + targetCursor`) idempotently.
2. Acquire per-note distributed lock.
3. Load DB snapshot + cursor.
4. Replay `sync` stream events up to `targetCursor` into a temporary Y.Doc.
5. Persist via `notes.save()` with stream cursor stale-write guard.

## Restore policy

- In-place restore is not used in the editor flow.
- Version history only exposes **Restore as New Page**.
- `notes.restoreFromSnapshot()` is intended for empty target pages.
- Existing collaborative sessions receive terminal WS errors for lock/delete/revoke/session-expire
  and reconnect only on non-terminal transport failures.

## Error envelope

Server error message shape:

```json
{
  "type": "notes.yjs.error",
  "payload": {
    "code": "ACCESS_REVOKED",
    "message": "Access was revoked",
    "noteId": "uuid"
  }
}
```

Codes:
- `LOGIN_REQUIRED`
- `SESSION_EXPIRED`
- `ACCESS_DENIED`
- `ACCESS_REVOKED`
- `NOTE_NOT_FOUND`
- `NOTE_LOCKED`
- `INVALID_JSON`
- `INVALID_MESSAGE`
- `INVALID_PAYLOAD`
- `BACKPRESSURE`
- `INTERNAL_ERROR`

## Key implementation files

- `cloud/packages/apps/src/notebooks/ws.ts`
- `cloud/packages/apps/src/notebooks/service/yjs-sync.ts`
- `cloud/packages/apps/src/notebooks/service/yjs-snapshot-worker.ts`
- `cloud/packages/apps/src/notebooks/service/notes.ts`
- `cloud/packages/lib/src/browser/yjs/provider.ts`
