import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { User } from "@valentinkolb/cloud/contracts";
import type { AuthContext, PermissionLevel } from "@valentinkolb/cloud/server";
import { Hono, type MiddlewareHandler } from "hono";
import type { DocumentLink } from "../contracts";
import { gridsService } from "../service";
import { createDocumentsApi } from "./documents";

const baseId = "11111111-1111-4111-8111-111111111111";
const tableId = "22222222-2222-4222-8222-222222222222";
const runId = "33333333-3333-4333-8333-333333333333";
const linkId = "44444444-4444-4444-8444-444444444444";
const userId = "55555555-5555-4555-8555-555555555555";
const otherUserId = "66666666-6666-4666-8666-666666666666";
const recordId = "77777777-7777-4777-8777-777777777777";
const templateId = "88888888-8888-4888-8888-888888888888";
const basePublicId = "BASE01";
const tablePublicId = "TABL01";
const runPublicId = "DRUN01";
const linkPublicId = "LINK01";
const recordPublicId = "RECD01";
const templatePublicId = "TMPL01";

const publicToInternal = new Map([
  [basePublicId, baseId],
  [tablePublicId, tableId],
  [runPublicId, runId],
  [linkPublicId, linkId],
  [recordPublicId, recordId],
  [templatePublicId, templateId],
]);
const internalToPublic = new Map([...publicToInternal].map(([publicId, internalId]) => [internalId, publicId]));
mock.module("../service/public-resources", () => ({
  resolvePublicId: async (_type: string, publicId: string) => publicToInternal.get(publicId) ?? null,
  resolvePublicIds: async (_type: string, publicIds: string[]) =>
    new Map(publicIds.flatMap((publicId) => (publicToInternal.has(publicId) ? [[publicId, publicToInternal.get(publicId)!]] : []))),
  projectPublicIds: async (_type: string, internalIds: string[]) =>
    new Map(
      internalIds.flatMap((internalId) => (internalToPublic.has(internalId) ? [[internalId, internalToPublic.get(internalId)!]] : [])),
    ),
}));

const user: User = {
  id: userId,
  uid: "document-link-user",
  roles: ["user"],
  provider: "local",
  profile: "user",
  givenname: "Document",
  sn: "Link",
  displayName: "Document Link",
  mail: null,
  avatarHash: null,
  accountExpires: null,
  lastLoginLocal: null,
  memberofGroup: [],
  memberofGroupIds: [],
  manages: [],
  managesGroupIds: [],
  ipa: null,
};

type RunFixture = { id: string; templateId: string | null; baseId: string; tableId: string };
const run: RunFixture = { id: runId, templateId: null, baseId, tableId };
const link: DocumentLink = {
  id: linkId,
  shortId: linkPublicId,
  documentRunId: runId,
  baseId,
  tableId,
  recordId,
  comment: "External review",
  createdBy: userId,
  createdAt: "2026-07-11T08:00:00.000Z",
  expiresAt: "2026-08-10T08:00:00.000Z",
  revokedAt: null,
  revokedBy: null,
  lastAccessedAt: null,
  accessCount: 0,
};
const revokedLink = { ...link, revokedAt: "2026-07-11T09:00:00.000Z", revokedBy: userId };
const publicLink = ({ shortId: _shortId, ...value }: DocumentLink) => ({
  ...value,
  id: linkPublicId,
  documentRunId: runPublicId,
  baseId: basePublicId,
  tableId: tablePublicId,
  recordId: recordPublicId,
});
const forbiddenResponse = {
  message: "You do not have permission to access this resource.",
  code: "FORBIDDEN",
};

let permissionLevel: PermissionLevel = "write";
let currentRun: typeof run | null = run;
let currentLink: typeof link | null = link;
let createInput: unknown;
let revokeInput: unknown;
let publicUrlToken: string | null;
let permissionLoadInput: unknown;
let permissionTarget: unknown;

const authenticated: MiddlewareHandler<AuthContext> = async (c, next) => {
  c.set("actor", { kind: "user", user });
  c.set("accessSubject", { type: "user", userId: user.id });
  c.set("user", user);
  await next();
};

const app = () => new Hono<AuthContext>().route("/documents", createDocumentsApi({ requireAuthenticated: authenticated }));
const documentsPath = (path: string) => `/documents${path}`;
const postJson = (body?: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json", "user-agent": "document-link-route-test", "x-forwarded-for": "203.0.113.7, 10.0.0.1" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

describe("document link routes", () => {
  beforeEach(() => {
    permissionLevel = "write";
    currentRun = run;
    currentLink = link;
    createInput = undefined;
    revokeInput = undefined;
    publicUrlToken = null;
    permissionLoadInput = undefined;
    permissionTarget = undefined;
    spyOn(gridsService.document, "getRun").mockImplementation(async (id) => (id === runId ? currentRun : null) as never);
    spyOn(gridsService.document, "listDocumentLinksForRun").mockImplementation(async () => [link] as never);
    spyOn(gridsService.document, "createDocumentLink").mockImplementation(async (input) => {
      createInput = input;
      return { ok: true, data: { link, token: "gdl_configured-token" } } as never;
    });
    spyOn(gridsService.document, "publicDocumentLinkUrl").mockImplementation(async (token) => {
      publicUrlToken = token;
      return `https://cloud.example.test/share/grids/documents/${token}`;
    });
    spyOn(gridsService.document, "getDocumentLink").mockImplementation(async (id) => (id === linkId ? currentLink : null) as never);
    spyOn(gridsService.document, "revokeDocumentLink").mockImplementation(async (input) => {
      revokeInput = input;
      return { ok: true, data: revokedLink } as never;
    });
    spyOn(gridsService.permission, "loadBaseGrantsForSubject").mockImplementation(async (input) => {
      permissionLoadInput = input;
      return [];
    });
    spyOn(gridsService.permission, "resolve").mockImplementation((_grants, target) => {
      permissionTarget = target;
      return permissionLevel;
    });
  });

  afterEach(() => mock.restore());

  for (const method of ["GET", "POST"] as const) {
    test(`${method} run links returns the exact 404 body for an invalid run id`, async () => {
      const response = await app().request(
        documentsPath("/runs/not-a-run-id/links"),
        method === "POST" ? postJson({ expiresIn: "30d" }) : undefined,
      );

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ message: "Document run not found" });
    });

    test(`${method} run links returns the exact 404 body for an unknown run`, async () => {
      currentRun = null;
      const response = await app().request(
        documentsPath(`/runs/${runPublicId}/links`),
        method === "POST" ? postJson({ expiresIn: "30d" }) : undefined,
      );

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ message: "Document run not found" });
    });
  }

  test("uses the owning base permission for a run whose template no longer loads", async () => {
    currentRun = { ...run, templateId };
    permissionLevel = "read";

    const response = await app().request(documentsPath(`/runs/${runPublicId}/links`));

    expect(response.status).toBe(403);
    expect(permissionLoadInput).toMatchObject({ baseId });
    expect(permissionTarget).toEqual({ baseId });
  });

  for (const method of ["GET", "POST"] as const) {
    test(`${method} run links requires effective write permission`, async () => {
      permissionLevel = "read";
      const response = await app().request(
        documentsPath(`/runs/${runPublicId}/links`),
        method === "POST" ? postJson({ expiresIn: "30d" }) : undefined,
      );

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual(forbiddenResponse);
    });
  }

  test("lists links with write permission", async () => {
    const response = await app().request(documentsPath(`/runs/${runPublicId}/links`));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ items: [publicLink(link)] });
  });

  test("creates links with write permission and returns the configured public URL", async () => {
    const response = await app().request(
      documentsPath(`/runs/${runPublicId}/links`),
      postJson({ expiresIn: "30d", comment: " External review " }),
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      link: publicLink(link),
      url: "https://cloud.example.test/share/grids/documents/gdl_configured-token",
    });
    expect(publicUrlToken).toBe("gdl_configured-token");
    expect(createInput).toEqual({
      run,
      input: { expiresIn: "30d", comment: "External review" },
      actorId: userId,
      ip: "203.0.113.7",
      userAgent: "document-link-route-test",
    });
  });

  test("revoke returns exact 404 bodies for missing links and runs", async () => {
    const invalidLink = await app().request(documentsPath("/links/not-a-link-id/revoke"), { method: "POST" });
    expect(invalidLink.status).toBe(404);
    expect(await invalidLink.json()).toEqual({ message: "Document link not found" });

    currentLink = null;
    const missingLink = await app().request(documentsPath(`/links/${linkPublicId}/revoke`), { method: "POST" });
    expect(missingLink.status).toBe(404);
    expect(await missingLink.json()).toEqual({ message: "Document link not found" });

    currentLink = link;
    currentRun = null;
    const missingRun = await app().request(documentsPath(`/links/${linkPublicId}/revoke`), { method: "POST" });
    expect(missingRun.status).toBe(404);
    expect(await missingRun.json()).toEqual({ message: "Document run not found" });
  });

  test("allows the link creator to revoke with read permission", async () => {
    permissionLevel = "read";
    const response = await app().request(documentsPath(`/links/${linkPublicId}/revoke`), postJson());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(publicLink(revokedLink));
    expect(revokeInput).toEqual({
      linkId,
      actorId: userId,
      ip: "203.0.113.7",
      userAgent: "document-link-route-test",
    });
  });

  test("rejects a non-creator who only has read permission", async () => {
    permissionLevel = "read";
    currentLink = { ...link, createdBy: otherUserId };
    const response = await app().request(documentsPath(`/links/${linkPublicId}/revoke`), { method: "POST" });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ message: "Only the creator or a document editor can revoke this link." });
    expect(revokeInput).toBeUndefined();
  });

  test("allows a writer to revoke a link created by someone else", async () => {
    currentLink = { ...link, createdBy: otherUserId };
    const response = await app().request(documentsPath(`/links/${linkPublicId}/revoke`), { method: "POST" });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(publicLink(revokedLink));
  });
});
