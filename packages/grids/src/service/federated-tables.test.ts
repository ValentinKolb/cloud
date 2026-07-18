import { describe, expect, test } from "bun:test";
import type { FederatedDraftInput, FederatedRevision } from "../contracts";
import { sourceIdsRequiringAuthorization } from "./federated-tables";

const sourceA = "11111111-1111-4111-8111-111111111111";
const sourceB = "22222222-2222-4222-8222-222222222222";
const targetField = "33333333-3333-4333-8333-333333333333";
const sourceField = "44444444-4444-4444-8444-444444444444";

const revision = (revokedAt: string | null = null): FederatedRevision => ({
  id: "55555555-5555-4555-8555-555555555555",
  tableId: "66666666-6666-4666-8666-666666666666",
  revision: 1,
  status: revokedAt ? "degraded" : "active",
  diagnostics: [],
  createdBy: null,
  publishedBy: null,
  createdAt: "2026-07-17T00:00:00.000Z",
  updatedAt: "2026-07-17T00:00:00.000Z",
  publishedAt: "2026-07-17T00:00:00.000Z",
  sources: [
    {
      id: "77777777-7777-4777-8777-777777777777",
      revisionId: "55555555-5555-4555-8555-555555555555",
      sourceTableId: sourceA,
      position: 0,
      authorizedBy: null,
      authorizedAt: "2026-07-17T00:00:00.000Z",
      revokedBy: null,
      revokedAt,
    },
  ],
  mappings: [
    {
      revisionId: "55555555-5555-4555-8555-555555555555",
      targetFieldId: targetField,
      sourceTableId: sourceA,
      sourceFieldId: sourceField,
      config: { optionMap: { open: "available" } },
    },
  ],
});

const input = (overrides: Partial<FederatedDraftInput> = {}): FederatedDraftInput => ({
  sourceTableIds: [sourceA],
  mappings: [
    {
      targetFieldId: targetField,
      sourceTableId: sourceA,
      sourceFieldId: sourceField,
      config: { optionMap: { open: "available" } },
    },
  ],
  ...overrides,
});

describe("combined table publication authorization", () => {
  test("requires source authorization for the first publication", () => {
    expect(sourceIdsRequiringAuthorization(null, input())).toEqual([sourceA]);
  });

  test("retains or narrows an existing publication without reauthorization", () => {
    expect(sourceIdsRequiringAuthorization(revision(), input())).toEqual([]);
    expect(sourceIdsRequiringAuthorization(revision(), input({ mappings: [] }))).toEqual([]);
    expect(sourceIdsRequiringAuthorization(revision(), input({ sourceTableIds: [], mappings: [] }))).toEqual([]);
  });

  test("requires authorization for new, changed, or revoked source scope", () => {
    expect(
      sourceIdsRequiringAuthorization(
        revision(),
        input({
          mappings: [
            {
              targetFieldId: targetField,
              sourceTableId: sourceA,
              sourceFieldId: sourceField,
              config: { optionMap: { open: "other" } },
            },
          ],
        }),
      ),
    ).toEqual([sourceA]);
    expect(sourceIdsRequiringAuthorization(revision(), input({ sourceTableIds: [sourceA, sourceB] }))).toEqual([sourceB]);
    expect(sourceIdsRequiringAuthorization(revision("2026-07-17T01:00:00.000Z"), input())).toEqual([sourceA]);
  });
});
