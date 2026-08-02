import { createHash } from "node:crypto";
import type { ToolContext } from "@k2b/nessi";
import { type CapabilityDispatchDependencies, dispatchCapability } from "../api/capabilities";
import type { CapabilityActionManifest } from "../contracts/capabilities";
import type { RequestActor } from "../server";
import type { AccessSubject } from "../server/services/access";
import { isAccountExpired } from "../services/account-model";
import { accounts } from "../services/accounts";
import { session } from "../services/session";
import type { AiCapabilityCatalogEntry } from "./capabilities";
import type { AiConversationStore } from "./types";

type CapabilityActor = Extract<RequestActor, { kind: "user" }>;

export const resolveAiCapabilityActor = async (input: {
  conversationId: string;
  persistedActor?: RequestActor;
  store: Pick<AiConversationStore, "getConversation">;
  getUser?: typeof accounts.users.get;
}): Promise<{ actor: CapabilityActor; accessSubject: AccessSubject }> => {
  if (input.persistedActor?.kind !== "user") throw new Error("Cloud capabilities require a current user-backed actor.");
  const conversation = await input.store.getConversation({ conversationId: input.conversationId });
  if (!conversation?.createdByUserId || conversation.createdByUserId !== input.persistedActor.user.id) {
    throw new Error("Cloud capability actor no longer owns this conversation.");
  }

  const user = await (input.getUser ?? accounts.users.get)({ id: conversation.createdByUserId });
  if (!user || isAccountExpired(user.accountExpires)) throw new Error("Cloud capability actor is no longer active.");
  return { actor: { kind: "user", user }, accessSubject: { type: "user", userId: user.id } };
};

export class AiCapabilityExecutionError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = "AiCapabilityExecutionError";
  }
}

const idempotencyKey = (conversationId: string, callId: string): string =>
  `ai-${createHash("sha256").update(`${conversationId}\0${callId}`).digest("hex")}`;

const parseCapabilityResponse = async (response: Response): Promise<unknown> => {
  const body = (await response.json().catch(() => null)) as { code?: unknown; message?: unknown } | null;
  if (response.ok) return body;
  const code = typeof body?.code === "string" ? body.code : "CAPABILITY_FAILED";
  const message = typeof body?.message === "string" ? body.message : "Capability execution failed";
  throw new AiCapabilityExecutionError(code, response.status, message);
};

export const executeAiCapability = async (input: {
  conversationId: string;
  authority: { actor: CapabilityActor; accessSubject: AccessSubject };
  entry: AiCapabilityCatalogEntry;
  args: unknown;
  context: ToolContext;
  dependencies?: CapabilityDispatchDependencies & {
    createDelegation?: (userId: string, ttlSeconds?: number) => Promise<string>;
    revokeDelegation?: (token: string) => Promise<void>;
    dispatch?: typeof dispatchCapability;
  };
}): Promise<unknown> => {
  if (input.authority.accessSubject.type !== "user" || input.authority.accessSubject.userId !== input.authority.actor.user.id) {
    throw new Error("Cloud capability authority is inconsistent.");
  }
  const createDelegation = input.dependencies?.createDelegation ?? session.createDelegation;
  const revokeDelegation = input.dependencies?.revokeDelegation ?? session.revoke;
  const dispatch = input.dependencies?.dispatch ?? dispatchCapability;
  const token = await createDelegation(input.authority.actor.user.id, 60);
  try {
    const headers = new Headers({ authorization: `Bearer ${token}` });
    const action = input.entry.kind === "action" ? (input.entry.operation as CapabilityActionManifest) : null;
    if (action?.idempotency !== "none" && input.context.callId) {
      headers.set("idempotency-key", idempotencyKey(input.conversationId, input.context.callId));
    }
    const request = new Request("http://cloud.internal/api/ai/capability", {
      method: "POST",
      headers,
      signal: input.context.signal,
    });
    return await parseCapabilityResponse(
      await dispatch({
        request,
        kind: input.entry.kind === "query" ? "queries" : "actions",
        appId: input.entry.appId,
        capabilityId: input.entry.operation.localId,
        input: input.args,
        dependencies: input.dependencies,
      }),
    );
  } finally {
    await revokeDelegation(token).catch(() => undefined);
  }
};
