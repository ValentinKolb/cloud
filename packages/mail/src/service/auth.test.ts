import { describe, expect, test } from "bun:test";
import type { MailRequestContext } from "./auth";
import { durableCredentialSnapshot } from "./auth";
import { commandStillAuthorized, type StoredCommandAuthorization } from "./command-authorization";

const serviceContext = (credential: {
  credentialId?: string | null;
  credentialExpiresAt?: string | null;
}): MailRequestContext => ({
  actor: {
    kind: "service_account",
    serviceAccount: {
      id: "9c537a43-930d-4557-aef4-00f45fb9a00f",
      kind: "resource_bound",
      status: "active",
      appId: "mail",
      resourceType: "mailbox",
      resourceId: "7d37d97c-fe73-49ab-954a-ce155e17610b",
    } as never,
    delegatedUser: null,
    scopes: ["mail:write"],
    ...credential,
  },
  accessSubject: {
    type: "service_account",
    serviceAccountId: "9c537a43-930d-4557-aef4-00f45fb9a00f",
  },
});

describe("durable Mail credential snapshots", () => {
  test("accepts an API credential with a stable database id", () => {
    expect(
      durableCredentialSnapshot(
        serviceContext({ credentialId: "446650b9-972e-4859-93f0-84d39c4efb88", credentialExpiresAt: null }),
      ),
    ).toEqual({
      scopes: ["mail:write"],
      credentialId: "446650b9-972e-4859-93f0-84d39c4efb88",
      credentialExpiresAt: null,
    });
    expect(
      durableCredentialSnapshot(
        serviceContext({
          credentialId: "446650b9-972e-4859-93f0-84d39c4efb88",
          credentialExpiresAt: new Date(Date.now() - 60_000).toISOString(),
        }),
      ),
    ).toBeNull();
  });

  test("accepts only an unexpired OAuth credential without a database id", () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(durableCredentialSnapshot(serviceContext({ credentialId: null, credentialExpiresAt: future }))).toEqual({
      scopes: ["mail:write"],
      credentialId: null,
      credentialExpiresAt: future,
    });
    expect(
      durableCredentialSnapshot(
        serviceContext({ credentialId: null, credentialExpiresAt: new Date(Date.now() - 60_000).toISOString() }),
      ),
    ).toBeNull();
  });

  test("rejects legacy service work without credential provenance", () => {
    expect(durableCredentialSnapshot(serviceContext({ credentialId: null, credentialExpiresAt: null }))).toBeNull();
  });

  test("fails a persisted legacy service command closed before database authorization", async () => {
    const command: StoredCommandAuthorization = {
      mailbox_id: "7d37d97c-fe73-49ab-954a-ce155e17610b",
      actor_kind: "service_account",
      actor_id: "9c537a43-930d-4557-aef4-00f45fb9a00f",
      initiator_actor_kind: "service_account",
      initiator_actor_id: "9c537a43-930d-4557-aef4-00f45fb9a00f",
      access_subject_kind: "service_account",
      access_subject_id: "9c537a43-930d-4557-aef4-00f45fb9a00f",
      credential_scopes: ["mail:write"],
      credential_id: null,
      credential_expires_at: null,
    };
    expect(await commandStillAuthorized(command, "write")).toBe(false);
  });
});
