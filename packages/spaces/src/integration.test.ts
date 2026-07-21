import { describe, expect, test } from "bun:test";
import { LinkedSpaceSummarySchema, MailSpaceCandidatesQuerySchema, ResolveMailSpacesInputSchema } from "./integration";

const UUID = "11111111-1111-4111-8111-111111111111";

describe("Spaces Mail integration contracts", () => {
  test("bounds requested ids and candidate pages", () => {
    expect(ResolveMailSpacesInputSchema.safeParse({ spaceIds: Array.from({ length: 21 }, () => UUID) }).success).toBe(false);
    expect(MailSpaceCandidatesQuerySchema.parse({ limit: "50" }).limit).toBe(50);
    expect(MailSpaceCandidatesQuerySchema.safeParse({ limit: "51" }).success).toBe(false);
  });

  test("does not permit Space secrets in the minimal projection", () => {
    const value = {
      id: UUID,
      name: "Operations",
      color: "#4d7c0f",
      href: `/app/spaces/${UUID}`,
      updatedAt: "2026-07-21T10:00:00.000Z",
    };
    expect(LinkedSpaceSummarySchema.safeParse(value).success).toBe(true);
    expect(LinkedSpaceSummarySchema.safeParse({ ...value, icalToken: "secret" }).success).toBe(false);
  });
});
