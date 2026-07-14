import { expect, test } from "bun:test";
import { venueService } from "./service";

test("resource service-account venue lists fail closed without a valid binding", async () => {
  expect(
    await venueService.venues.list({
      subject: { type: "service_account", serviceAccountId: "11111111-1111-4111-8111-111111111111" },
      serviceAccountScopes: ["read"],
    }),
  ).toEqual([]);
});
