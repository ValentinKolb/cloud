import { err, fail, ok, type Result } from "@valentinkolb/stdlib";
import { ephemeral, type Lock, mutex } from "@valentinkolb/sync";
import { sql } from "bun";
import type { AcquiredDraftLease, DraftLease, DraftLeaseHolder } from "../contracts";
import { requireMailboxPermission } from "./access";
import type { MailRequestContext } from "./auth";
import { hasCurrentMailboxUserPermission } from "./collaborators";

const DRAFT_LEASE_TTL_MS = 30_000;
const DRAFT_LEASE_STATE_TTL_MS = 30_000;
export const DRAFT_LEASE_HEARTBEAT_INTERVAL_MS = 10_000;

type DraftLeaseEntry = {
  holder: DraftLeaseHolder;
  token: string;
  lock: Lock;
  acquiredAt: number;
};

const leaseStore = ephemeral<DraftLeaseEntry>({
  id: "mail.draft-leases",
  ttlMs: DRAFT_LEASE_TTL_MS,
  limits: { maxEntries: 1, maxPayloadBytes: 4_000 },
});

const leaseMutex = mutex({
  id: "mail:draft-leases",
  defaultTtl: DRAFT_LEASE_TTL_MS,
  retryCount: 0,
});

const stateMutex = mutex({
  id: "mail:draft-lease-state",
  defaultTtl: DRAFT_LEASE_STATE_TTL_MS,
  retryCount: 3,
  retryDelay: 25,
});

const conflict = (message: string): Result<never> => fail({ code: "CONFLICT", message, status: 409 });

const withLeaseState = async <T>(draftId: string, operation: () => Promise<Result<T>>): Promise<Result<T>> => {
  const result = await stateMutex.withLock(draftId, operation, DRAFT_LEASE_STATE_TTL_MS);
  return result ?? conflict("Draft lease state is being updated; retry the request");
};

const holderFromContext = (context: MailRequestContext): DraftLeaseHolder => {
  if (context.actor.kind === "user") {
    return {
      kind: "user",
      id: context.actor.user.id,
      displayName: context.actor.user.displayName,
      avatarHash: context.actor.user.avatarHash,
    };
  }
  return {
    kind: "service_account",
    id: context.actor.serviceAccount.id,
    displayName: context.actor.serviceAccount.name,
    avatarHash: context.actor.delegatedUser?.avatarHash ?? null,
  };
};

const sameHolder = (left: DraftLeaseHolder, right: DraftLeaseHolder): boolean => left.kind === right.kind && left.id === right.id;

const authorizeDraft = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  draftId: string;
  permission: "read" | "write";
}): Promise<Result<void>> => {
  const allowed = await requireMailboxPermission(params.context, params.mailboxId, params.permission);
  if (!allowed.ok) return allowed;
  const [draft] = await sql<{ id: string }[]>`
    SELECT id FROM mail.drafts
    WHERE id = ${params.draftId}::uuid AND mailbox_id = ${params.mailboxId}::uuid AND state = 'draft'
  `;
  return draft ? ok() : fail(err.notFound("Editable draft"));
};

const currentEntry = async (draftId: string): Promise<{ value: DraftLeaseEntry; expiresAt: number } | null> =>
  (await leaseStore.snapshot({ tenantId: draftId, prefix: "lease" })).entries.find((entry) => entry.key === "lease") ?? null;

const removeEntry = async (draftId: string, entry: DraftLeaseEntry, reason: string): Promise<void> => {
  await leaseStore.remove({ tenantId: draftId, key: "lease", reason });
  await leaseMutex.release(entry.lock).catch(() => false);
};

const currentValidEntry = async (mailboxId: string, draftId: string) => {
  const entry = await currentEntry(draftId);
  if (!entry || entry.value.holder.kind !== "user") return entry;
  const active = await hasCurrentMailboxUserPermission({
    mailboxId,
    userId: entry.value.holder.id,
    minimumPermission: "write",
  });
  if (active) return entry;
  await removeEntry(draftId, entry.value, "access-revoked");
  return null;
};

const mapLease = (entry: { value: DraftLeaseEntry; expiresAt: number }): DraftLease => ({
  holder: entry.value.holder,
  acquiredAt: new Date(entry.value.acquiredAt).toISOString(),
  expiresAt: new Date(entry.expiresAt).toISOString(),
});

export const getDraftLease = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  draftId: string;
}): Promise<Result<DraftLease | null>> => {
  const allowed = await authorizeDraft({ ...params, permission: "read" });
  if (!allowed.ok) return allowed;
  return withLeaseState(params.draftId, async () => {
    const entry = await currentValidEntry(params.mailboxId, params.draftId);
    return ok(entry ? mapLease(entry) : null);
  });
};

export const acquireDraftLease = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  draftId: string;
  takeover?: boolean;
}): Promise<Result<AcquiredDraftLease>> => {
  const allowed = await authorizeDraft({ ...params, permission: "write" });
  if (!allowed.ok) return allowed;
  const holder = holderFromContext(params.context);
  return withLeaseState(params.draftId, async () => {
    const current = await currentValidEntry(params.mailboxId, params.draftId);
    if (current) {
      if (!params.takeover) {
        return conflict(
          sameHolder(current.value.holder, holder)
            ? "This draft is already being edited in another session"
            : `This draft is being edited by ${current.value.holder.displayName}`,
        );
      }
      await removeEntry(params.draftId, current.value, "taken-over");
    }

    const lock = await leaseMutex.acquire(params.draftId, DRAFT_LEASE_TTL_MS);
    if (!lock) return conflict("Another collaborator acquired the draft lease");
    const token = crypto.randomUUID();
    const acquiredAt = Date.now();
    let stored = false;
    try {
      const entry = await leaseStore.upsert({
        tenantId: params.draftId,
        key: "lease",
        value: { holder, token, lock, acquiredAt },
      });
      stored = true;
      if (current && !sameHolder(current.value.holder, holder)) {
        await sql`
          INSERT INTO mail.activity_events (
            mailbox_id, actor_kind, actor_id, action, outcome, target_type, target_id, metadata
          ) VALUES (
            ${params.mailboxId}::uuid,
            ${holder.kind},
            ${holder.id}::uuid,
            'draft.lease_taken_over',
            'confirmed',
            'draft',
            ${params.draftId}::uuid,
            ${{ previousHolder: current.value.holder }}::jsonb
          )
        `;
      }
      return ok({ ...mapLease(entry), token });
    } catch (error) {
      if (stored) await leaseStore.remove({ tenantId: params.draftId, key: "lease", reason: "acquire-failed" }).catch(() => false);
      await leaseMutex.release(lock).catch(() => false);
      throw error;
    }
  });
};

const ownedEntry = async (draftId: string, holder: DraftLeaseHolder, token: string): Promise<DraftLeaseEntry | null> => {
  const entry = await currentEntry(draftId);
  return entry && sameHolder(entry.value.holder, holder) && entry.value.token === token ? entry.value : null;
};

export const heartbeatDraftLease = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  draftId: string;
  token: string;
}): Promise<Result<AcquiredDraftLease>> => {
  const allowed = await authorizeDraft({ ...params, permission: "write" });
  if (!allowed.ok) return allowed;
  const holder = holderFromContext(params.context);
  return withLeaseState(params.draftId, async () => {
    const lease = await ownedEntry(params.draftId, holder, params.token);
    if (!lease) return conflict("Draft lease is no longer owned by this session");
    if (!(await leaseMutex.extend(lease.lock, DRAFT_LEASE_TTL_MS))) {
      await leaseStore.remove({ tenantId: params.draftId, key: "lease", reason: "mutex-expired" });
      return conflict("Draft lease expired");
    }
    const entry = await leaseStore.upsert({ tenantId: params.draftId, key: "lease", value: lease });
    return ok({ ...mapLease(entry), token: lease.token });
  });
};

export const releaseDraftLease = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  draftId: string;
  token: string;
}): Promise<Result<void>> => {
  const allowed = await authorizeDraft({ ...params, permission: "write" });
  if (!allowed.ok) return allowed;
  const holder = holderFromContext(params.context);
  return withLeaseState(params.draftId, async () => {
    const lease = await ownedEntry(params.draftId, holder, params.token);
    if (!lease) return conflict("Draft lease is no longer owned by this session");
    await removeEntry(params.draftId, lease, "released");
    return ok();
  });
};
