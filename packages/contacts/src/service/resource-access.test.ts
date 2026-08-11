import { expect, test } from "bun:test";
import * as books from "./books";
import * as contacts from "./contacts";

const resourceSubject = {
  type: "service_account" as const,
  serviceAccountId: "11111111-1111-4111-8111-111111111111",
};

test("resource service-account collections fail closed without a valid book binding", async () => {
  expect(await books.list({ subject: resourceSubject })).toEqual([]);
  expect(await contacts.search({ subject: resourceSubject, pagination: { page: 3, perPage: 20 } })).toEqual({
    items: [],
    page: 3,
    perPage: 20,
    total: 0,
    hasNext: false,
  });
});
