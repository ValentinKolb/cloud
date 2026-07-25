import { describe, expect, test } from "bun:test";

process.env.APP_SECRET ||= "test-secret-for-upload-tickets";

const { signUploadTicket, verifyUploadTicket } = await import("./upload-ticket");

const SESSION = { uploadId: "a1b2c3d4e5f60718", baseType: "group", baseId: "vorstand" };

describe("upload tickets", () => {
  test("a ticket verifies against the base it was issued for", () => {
    const ticket = signUploadTicket(SESSION);
    expect(verifyUploadTicket({ ...SESSION, ticket })).toBe(true);
  });

  test("a ticket does not carry over to another base", () => {
    const ticket = signUploadTicket(SESSION);
    expect(verifyUploadTicket({ ...SESSION, baseId: "home-of-attacker", ticket })).toBe(false);
    expect(verifyUploadTicket({ ...SESSION, baseType: "home", ticket })).toBe(false);
  });

  test("a ticket does not carry over to another upload session", () => {
    const ticket = signUploadTicket(SESSION);
    expect(verifyUploadTicket({ ...SESSION, uploadId: "0000000000000000", ticket })).toBe(false);
  });

  test("a missing or malformed ticket is rejected rather than throwing", () => {
    expect(verifyUploadTicket({ ...SESSION, ticket: "" })).toBe(false);
    expect(verifyUploadTicket({ ...SESSION, ticket: "short" })).toBe(false);
  });
});
