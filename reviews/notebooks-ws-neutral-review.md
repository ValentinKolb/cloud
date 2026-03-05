# Notebooks Realtime (Yjs/WebSocket) Refactor - Code Review

**Date:** 2026-02-26
**Reviewer:** Independent (Claude Code, neutral review)
**Scope:** End-to-end review of the Yjs realtime collaboration architecture
**Static checks:** TypeScript typecheck passes for both `@valentinkolb/cloud-apps` and `@valentinkolb/cloud-lib`

---

## 1. Executive Summary

The refactor replaces a previous in-memory Y.Doc server design with a stateless, topic-stream-based architecture. WebSocket nodes publish client updates to a shared Redis topic stream; a separate snapshot worker asynchronously persists snapshots to Postgres with stale-write guards.

**Overall assessment:** The architecture is well-designed for multi-node horizontal scaling. The protocol is explicit, the error taxonomy is complete, and the stale-write protection in `notes.save()` is correct. The main risks are around (a) a client re-join gap in the WS phase machine, (b) `Number.MAX_SAFE_INTEGER` overflowing PostgreSQL BIGINT on restore, and (c) potential data loss from queued local edits during the replay window. No critical show-stoppers, but several medium-severity items warrant attention before production hardening.

---

## 2. Findings (sorted by severity)

---

### F1: Client cannot re-join or switch notes after initial join

- **Severity:** High
- **Confidence:** High
- **Location:** `packages/apps/src/notebooks/ws.ts:594-598`

**Why it matters:**
The `allowedTypesByPhase` map restricts `replayRequest` to the `open` phase only. Once the context transitions to `joined` (line 505), the client cannot send another `replayRequest` through the same socket. This means:
  - The client cannot switch notes within a single WS connection.
  - If the server-side live stream breaks (e.g., Redis reconnect), the client has no way to re-request replay without closing and reopening the entire socket.

**Evidence:**
```ts
// ws.ts:594-598
const allowedTypesByPhase: Record<WsPhase, readonly ClientMessage["type"][]> = {
  open: [WS_TYPE.replayRequest],
  joined: [WS_TYPE.syncPublish, WS_TYPE.awarenessPublish],
  closing: [],
};
```

The `handleReplayRequest` function (line 501-503) does handle note-switching (`if (ctx.noteId && ctx.noteId !== payload.noteId) { await leaveCurrentNote(ctx); }`), but this code is unreachable because the phase gate blocks `replayRequest` in the `joined` phase.

**Suggested fix:**
Add `WS_TYPE.replayRequest` to the `joined` phase's allowed types:
```ts
joined: [WS_TYPE.replayRequest, WS_TYPE.syncPublish, WS_TYPE.awarenessPublish],
```

**Impact:** Currently mitigated by the client opening a new WS on reconnect (provider.ts:234 creates a fresh `WebSocket`), but the dead code in `handleReplayRequest` suggests this was intended to work. If the client is ever updated to re-use sockets, this will silently break.

---

### F2: `Number.MAX_SAFE_INTEGER` overflows PostgreSQL BIGINT on restore

- **Severity:** High
- **Confidence:** High
- **Location:** `packages/apps/src/notebooks/service/notes.ts:731`

**Why it matters:**
`Number.MAX_SAFE_INTEGER` is `9007199254740991` (2^53 - 1). PostgreSQL BIGINT max is `9223372036854775807` (2^63 - 1), so the value itself fits. However, the real issue is that this "sentinel" sequence number permanently poisons the stale-write guard for that note. After a restore, **no future snapshot worker save will ever succeed** because the `save()` WHERE clause (lines 516-517) compares `yjs_stream_seq < ${parsedCursor.seq}`, and no real stream cursor will ever have `seq > 9007199254740991`.

This means: after restoring a version as a new page and then editing that page collaboratively, the snapshot worker will silently consider every save as "stale" and never persist a new snapshot. The content exists only in the Redis topic stream (with 7-day TTL). If the stream expires before the issue is noticed, **data is lost**.

**Evidence:**
```ts
// notes.ts:731
const restoreStreamSeq = Number.MAX_SAFE_INTEGER;
```
```sql
-- notes.ts:516-517 (stale-write guard)
OR (yjs_stream_ms = ${parsedCursor.ms} AND COALESCE(yjs_stream_seq, -1) < ${parsedCursor.seq})
```

**Suggested fix:**
Instead of using `MAX_SAFE_INTEGER`, use `restoreStreamMs = Date.now()` and `restoreStreamSeq = 999_999` (a high but reasonable value), or better: set `yjs_stream_ms` and `yjs_stream_seq` to `NULL` after restore so the note starts fresh, and adjust the stale-write guard to handle the `NULL -> non-NULL` transition. Since restore targets an empty page, resetting the cursor is safe.

---

### F3: Local edits during pre-replayReady window may silently fail to propagate

- **Severity:** Medium
- **Confidence:** Medium
- **Location:** `packages/lib/src/browser/yjs/provider.ts:86-97, 115-123`

**Why it matters:**
Between `connect()` and receiving `replayReady`, local document updates set `needsFullResync = true` (line 119) but the data is not buffered. When `sendLocalStateIfNeeded` runs (lines 86-97), it only sends a full state if `needsFullResync` is true. However, if `needsFullResync` is `false` (no local edits happened before replayReady), `localStateSent` is set to `true` immediately and subsequent calls do nothing.

The subtle risk: if the user types during the brief reconnect window, and `sendSyncPublish` fails (returns false) inside `sendLocalStateIfNeeded` (line 90), `needsFullResync` remains `true` (line 91), `localStateSent` is never set to `true`, and there is no retry mechanism -- the function simply returns. The next trigger for `sendLocalStateIfNeeded` comes from `handleJsonMessage` (line 209) on subsequent sync pushes, but if no pushes arrive, the local state is stranded.

**Evidence:**
```ts
// provider.ts:86-97
const sendLocalStateIfNeeded = () => {
  if (!replayReady || localStateSent) return;
  if (needsFullResync) {
    const localState = Y.encodeStateAsUpdate(doc);
    if (localState.length > 0 && !sendSyncPublish(localState)) {
      needsFullResync = true; // already true, no-op
      return; // exits without localStateSent = true, no retry scheduled
    }
  }
  localStateSent = true;
  needsFullResync = false;
};
```

**Suggested fix:**
Add a short retry timer when `sendSyncPublish` fails, or trigger `sendLocalStateIfNeeded` from a WebSocket `onopen` / `onmessage` callback that guarantees re-invocation.

---

### F4: Race between `onClose` and in-flight `processing` chain

- **Severity:** Medium
- **Confidence:** Medium
- **Location:** `packages/apps/src/notebooks/ws.ts:673-678`

**Why it matters:**
In `onClose`, the code awaits `processing` (line 675) and then sets `ctx.phase = "closing"` and calls `leaveCurrentNote`. However, the `processing` chain may have already triggered `fatal()` which sets `phase = "closing"` and calls `leaveCurrentNote()`. This means `leaveCurrentNote` could run twice concurrently if the close event fires while `fatal()` is mid-execution.

`leaveCurrentNote` calls `queueSnapshotIfNeeded`, `stopAccessRefresh`, `stopSnapshotScheduler`, `stopLiveStream`, and resets `ctx` fields. Running it concurrently could:
- Double-queue snapshot saves (minor, idempotent due to cursor key)
- Clear `ctx.streamAbort` after `fatal()` already cleared it (harmless due to null checks)
- But `queueSnapshotIfNeeded` is async and modifies `ctx.dirty`; concurrent runs could read stale `dirty` state.

**Evidence:**
```ts
// ws.ts:673-678
async onClose() {
  if (!ctx) return;
  await processing.catch(() => undefined);
  ctx.phase = "closing";
  await leaveCurrentNote(ctx);
},
```
```ts
// ws.ts:220-231 (fatal sets closing + calls leaveCurrentNote)
const fatal = async (ctx, code, message, noteId) => {
  if (ctx.phase === "closing") return; // guard
  ctx.phase = "closing";
  warn(ctx.socket, code, message, noteId);
  await leaveCurrentNote(ctx);
  ctx.socket.close(closeCodeForError(code), code);
};
```

**Suggested fix:**
In `onClose`, check `ctx.phase === "closing"` before calling `leaveCurrentNote` again:
```ts
async onClose() {
  if (!ctx) return;
  await processing.catch(() => undefined);
  if (ctx.phase === "closing") return;
  ctx.phase = "closing";
  await leaveCurrentNote(ctx);
},
```

---

### F5: `save()` lock check + update is not atomic (TOCTOU)

- **Severity:** Medium
- **Confidence:** Medium
- **Location:** `packages/apps/src/notebooks/service/notes.ts:493-527`

**Why it matters:**
`save()` first checks `isLocked()` (line 494) with a separate SELECT, then performs the UPDATE. Between these two queries, another process could lock the note. The UPDATE would succeed despite the note being locked, violating the lock invariant.

This is mitigated by:
- The WebSocket access refresh (10s interval) would eventually catch the lock and disconnect the client.
- The snapshot worker acquires a distributed mutex before calling `save()`.

However, a direct REST API call to `save()` (if one exists) or a tight race in the snapshot worker could bypass the lock.

**Evidence:**
```ts
// notes.ts:493-497
const locked = await isLocked({ id: noteId });
if (locked) {
  return { ok: false, error: "Cannot modify locked note", status: 403 };
}
// ... then UPDATE runs
```

**Suggested fix:**
Add `AND locked_at IS NULL` to the UPDATE's WHERE clause to make the check atomic:
```sql
WHERE id = ${noteId}::uuid
  AND locked_at IS NULL
  AND (...)
```

---

### F6: `accessRefreshTimeout` uses `setTimeout` (not `setInterval`) but the recursive re-scheduling has no backoff

- **Severity:** Low
- **Confidence:** High
- **Location:** `packages/apps/src/notebooks/ws.ts:325-351`

**Why it matters:**
If the access check consistently succeeds but takes a non-trivial amount of time (e.g., 2s due to DB load), the effective interval shrinks toward `10s + checkDuration`. This is correct behavior. However, if the check throws (line 343-348), `fatal()` is called and the socket closes -- this is appropriate.

The concern is subtle: if `refreshJoinedAccess` is slow enough that the phase transitions to `closing` between the `setTimeout` firing and the `if (ctx.phase !== "joined") return` check (line 330), the function exits silently without rescheduling. This is actually correct and safe. **No real issue here** -- noting for completeness.

---

### F7: Snapshot interval timer is never reset when the note becomes clean

- **Severity:** Low
- **Confidence:** High
- **Location:** `packages/apps/src/notebooks/ws.ts:199-204, 174-197`

**Why it matters:**
`startSnapshotScheduler` starts a `setInterval` (line 201) that runs every 8 seconds. Inside, `queueSnapshotIfNeeded` bails immediately if `!ctx.dirty` (line 175). The interval keeps firing even when the note is clean (no new writes). This wastes a small amount of CPU on idle connections.

**Evidence:**
```ts
const startSnapshotScheduler = (ctx: WsContext) => {
  if (ctx.snapshotInterval) return; // only starts once
  ctx.snapshotInterval = setInterval(() => {
    void queueSnapshotIfNeeded(ctx, "periodic"); // no-ops if !dirty
  }, SNAPSHOT_INTERVAL_MS);
};
```

**Suggested fix:**
Either clear the interval when `dirty` becomes `false` (inside `queueSnapshotIfNeeded` after successful queue), or accept this as a minor cost. The current approach is safe and the overhead is negligible per connection.

---

### F8: `onlineCount` is hardcoded to `0` in NoteEditor

- **Severity:** Low
- **Confidence:** High
- **Location:** `packages/apps/src/notebooks/frontend/[id]/_components/editor/NoteEditor.client.tsx:264`

**Why it matters:**
The `EditorToolbar` has UI for displaying online user count, but it's always passed `0`. The awareness protocol already carries user presence data. This is likely a known TODO, but means the collaboration presence indicator never works.

**Evidence:**
```tsx
<EditorToolbar
  connected={connected()}
  onlineCount={0} // hardcoded
  ...
/>
```

---

### F9: Base64 validation regex accepts empty string edge cases

- **Severity:** Low
- **Confidence:** Low (needs verification)
- **Location:** `packages/apps/src/notebooks/ws.ts:42, 233-234`

**Why it matters:**
The `BASE64_REGEX` on line 42 uses `*` quantifier for the 4-char groups: `(?:[A-Za-z0-9+/]{4})*`. This means an empty string matches the regex (zero repetitions). However, `ensureValidBase64` also checks `payload.length > 0` (line 234), so this is protected. The Zod schema also enforces `z.string().min(1)`.

**No actual bug** -- the defense is layered correctly.

---

### F10: Version compaction query runs inside the same transaction-less flow as save

- **Severity:** Low
- **Confidence:** Medium
- **Location:** `packages/apps/src/notebooks/service/notes.ts:570-617`

**Why it matters:**
The version compaction DELETE (lines 570-616) runs after version INSERT without an explicit transaction. If the process crashes between INSERT and DELETE, extra versions accumulate. This is benign (compaction will catch up on the next save). However, the compaction query itself is complex (4 UNION ALL branches with DISTINCT ON) and runs on every version insert. For notes with many versions, this could be slow.

**Suggested fix:**
Consider running compaction asynchronously or on a less frequent cadence (e.g., every Nth version insert) rather than synchronously on every save.

---

### F11: Provider reconnect uses fixed 2s delay with no jitter or exponential backoff

- **Severity:** Low
- **Confidence:** High
- **Location:** `packages/lib/src/browser/yjs/provider.ts:234`

**Why it matters:**
On connection close, the client reconnects after a fixed 2-second delay. If the server goes down and many clients reconnect simultaneously, they'll all hit the server at once (thundering herd). For a small deployment this is fine; at scale it could cause spikes.

**Evidence:**
```ts
ws.onclose = () => {
  // ...
  if (!isDisposed && !isTerminated) reconnectTimer = setTimeout(connect, 2_000);
};
```

**Suggested fix:**
Add jitter: `2_000 + Math.random() * 2_000`. Exponential backoff would be even better for sustained outages.

---

### F12: Provider `appUrl` parsing is fragile

- **Severity:** Low
- **Confidence:** Medium
- **Location:** `packages/lib/src/browser/yjs/provider.ts:215-217`

**Why it matters:**
The protocol/host extraction uses string manipulation rather than `URL` parsing:
```ts
const protocol = appUrl.startsWith("https") ? "wss:" : "ws:";
const host = appUrl.replace(/^https?:\/\//, "");
```

If `appUrl` has a path (e.g., `https://example.com/app`), the resulting WebSocket URL becomes `wss://example.com/app/ws` which may or may not be correct depending on routing. If `appUrl` has a trailing slash, the result is `wss://example.com//ws` (double slash).

**Suggested fix:**
Use `new URL("/ws", appUrl)` and convert the protocol:
```ts
const url = new URL("/ws", appUrl);
url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
ws = new WebSocket(url.href);
```

---

## 3. Positive Observations

1. **Solid architecture:** The stateless WS node + topic stream + async snapshot worker pattern is a good fit for horizontal scaling. No sticky sessions required.

2. **Stale-write protection is well-designed:** The `save()` function's WHERE clause with `yjs_stream_ms/seq` comparison (notes.ts:514-518) correctly prevents out-of-order snapshot persists across nodes.

3. **Comprehensive error taxonomy:** The shared `notebooks-yjs.ts` defines a complete set of error codes with clear terminal vs. non-terminal classification. Both server and client handle these consistently.

4. **Message serialization is sequential and safe:** The `processing` promise chain (ws.ts:659-670) ensures messages are handled in order per-socket, preventing concurrent handler execution.

5. **Clean separation of concerns:** The code is well-decomposed: `yjs-sync.ts` for topic/cursor utilities, `yjs-snapshot-worker.ts` for persistence, `ws.ts` for socket lifecycle, `provider.ts` for client state machine.

6. **Snapshot worker is robust:** Proper lease keep-alive, distributed mutex, idempotent queue jobs, and graceful shutdown handling. The worker-per-note locking prevents duplicate work.

7. **Version history with retention policy:** The tiered retention (24h -> hourly -> daily -> weekly) is a pragmatic approach to managing version bloat without losing important checkpoints.

8. **TypeScript typecheck passes cleanly** for both packages.

9. **Good use of Zod for protocol validation:** Both inbound WS messages and queue job payloads are schema-validated.

10. **Documentation matches implementation:** `docs/10_NOTEBOOKS_YJS_REALTIME.md` accurately describes the actual protocol and behavior.

---

## 4. Open Questions / Uncertainties

1. **Is the client provider ever expected to re-use a WS connection for note switching?** The dead code in `handleReplayRequest` (lines 501-503) suggests this was intended but the phase gate blocks it. Clarify intent and either enable it or remove the dead code.

2. **What happens when the Redis topic stream for a note expires (7-day TTL) but the snapshot worker hasn't caught up?** If the snapshot queue backs up or the worker is down for extended periods, stream entries may expire before being replayed into a snapshot. Is there monitoring/alerting for this?

3. **How does the system handle a note being deleted while a client is connected?** The access refresh would eventually detect NOTE_NOT_FOUND, but within the 10s window, writes to the deleted note would be published to the topic stream and never persisted.

4. **Is `notes.save()` called from any REST endpoint directly?** If so, the TOCTOU lock check (F5) is a real vulnerability. If it's only called from the snapshot worker (which holds a distributed mutex), the risk is lower.

5. **What is the expected behavior when `noteTopic.live()` falls behind?** If the consumer is slower than producers, does the topic stream apply backpressure or does it drop messages?

---

## 5. Quick Wins (small, high-impact improvements)

| # | Change | Files | Impact |
|---|--------|-------|--------|
| 1 | Allow `replayRequest` in `joined` phase | `ws.ts:596` | Unlocks note-switching and in-socket re-join |
| 2 | Guard `onClose` against double `leaveCurrentNote` | `ws.ts:673-678` | Prevents potential double snapshot queue |
| 3 | Add `AND locked_at IS NULL` to `save()` UPDATE | `notes.ts:513` | Makes lock check atomic |
| 4 | Replace `MAX_SAFE_INTEGER` in restore with cursor reset to NULL | `notes.ts:729-731` | Prevents permanent stale-write guard poisoning |
| 5 | Add jitter to reconnect delay | `provider.ts:234` | Prevents thundering herd on server restart |
| 6 | Use `new URL()` for WS URL construction | `provider.ts:215-217` | Handles edge cases in appUrl format |
| 7 | Wire up `onlineCount` from awareness state | `NoteEditor.client.tsx:264` | Enables presence indicator |

---

## 6. Optional Deeper Refactor Ideas

### 6.1 Unified phase machine with explicit transitions

The current phase management uses string assignments scattered across handlers. A more formal state machine with `transition(from, to)` would:
- Make impossible transitions compile-time errors
- Centralize cleanup logic per transition
- Make the re-join (F1) fix natural

This is a nice-to-have; the current approach works and the code is readable.

### 6.2 Snapshot worker: batch processing

Currently the worker processes one job at a time (`runWorker` loop, line 336-357). For deployments with many active notes, a small concurrency pool (e.g., 3-5 concurrent jobs with per-note mutex) would improve throughput. The current design is correct and simpler; only consider this if snapshot lag becomes an issue.

### 6.3 Client-side retry queue for failed publishes

Currently, if `sendSyncPublish` fails (provider returns false), the client sets `needsFullResync = true` and waits for the next trigger. A small retry mechanism with the actual update bytes would be more efficient than re-encoding the full document state on retry.
