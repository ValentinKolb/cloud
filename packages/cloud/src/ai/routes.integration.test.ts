import { describe, expect, test } from "bun:test";
import { sql } from "bun";
import { Hono } from "hono";
import type { AuthContext } from "../server";
import { migrateCloudAi } from "./migrate";
import { aiProjects } from "./projects";
import { createAiChatRoutes } from "./routes";
import { createAiShortId } from "./short-id";
import { aiConversations } from "./store";

const databaseAvailable = async () => {
  try {
    const [row] = await sql<{ users: string | null }[]>`SELECT to_regclass('auth.users')::text AS users`;
    if (!row?.users) return false;
    await migrateCloudAi();
    return true;
  } catch {
    return false;
  }
};

const suite = (await databaseAvailable()) ? describe : describe.skip;

const insertUser = async (): Promise<string> => {
  const suffix = crypto.randomUUID();
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO auth.users (uid, provider, profile, display_name, mail, given_name, sn)
    VALUES (${`ai-routes-${suffix}`}, 'local', 'user', 'AI Routes', ${`ai-routes-${suffix}@example.test`}, 'AI', 'Routes')
    RETURNING id
  `;
  return row!.id;
};

suite("AI conversation public routes", () => {
  test("changes a Project only before the first message and only to a readable Project", async () => {
    const userId = await insertUser();
    const otherUserId = await insertUser();
    const subject = { type: "user" as const, userId };
    const project = await aiProjects.create({ appId: "route-test", subject, name: "Visible Project" });
    const hiddenProject = await aiProjects.create({
      appId: "route-test",
      subject: { type: "user", userId: otherUserId },
      name: "Hidden Project",
    });
    const chat = await aiConversations.createConversation({ appId: "route-test", ownerUserId: userId });
    const app = new Hono<AuthContext>()
      .use("*", async (c, next) => {
        c.set("accessSubject", subject);
        await next();
      })
      .route(
        "/",
        createAiChatRoutes({
          appId: "route-test",
          allowConversationManagement: true,
          resolveContext: () =>
            Promise.resolve({
              actor: { kind: "user", user: { id: userId } as never },
              ownerUserId: userId,
              toolSource: { kind: "none" },
              modelPolicy: { kind: "locked", modelId: "test" },
              toolApprovalContext: { actorUserId: userId, appId: "route-test", resource: { kind: "direct" } },
            }),
        }),
      );

    try {
      const assign = await app.request(`/conversations/${chat.shortId}/project`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: project.shortId }),
      });
      expect(assign.status).toBe(200);
      expect(await assign.json()).toMatchObject({ id: chat.shortId, projectId: project.shortId });

      const detach = await app.request(`/conversations/${chat.shortId}/project`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: null }),
      });
      expect(detach.status).toBe(200);
      expect(await detach.json()).toMatchObject({ id: chat.shortId, projectId: null });

      const hidden = await app.request(`/conversations/${chat.shortId}/project`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: hiddenProject.shortId }),
      });
      expect(hidden.status).toBe(404);

      await sql`
        INSERT INTO ai.messages (short_id, conversation_id, seq, kind, role, message, search_text)
        VALUES (
          ${createAiShortId()}, ${chat.id}::uuid, 1, 'message', 'user',
          '{"role":"user","content":["Hello"]}'::jsonb, 'Hello'
        )
      `;
      const tooLate = await app.request(`/conversations/${chat.shortId}/project`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: project.shortId }),
      });
      expect(tooLate.status).toBe(409);
      const conflict = (await tooLate.json()) as { code: string; message: string };
      expect(conflict.code).toBe("CONFLICT");
      expect(conflict.message).toStartWith("Choose a Project before sending the first message.");
      expect((await aiConversations.getConversation({ conversationId: chat.id }))?.projectId).toBeNull();
    } finally {
      await sql`DELETE FROM ai.conversations WHERE id = ${chat.id}::uuid`;
      await sql`DELETE FROM ai.projects WHERE id IN (${project.id}::uuid, ${hiddenProject.id}::uuid)`;
      await sql`DELETE FROM auth.users WHERE id IN (${userId}::uuid, ${otherUserId}::uuid)`;
    }
  });

  test("uploads every attachment into the flat conversation file namespace with user provenance", async () => {
    const userId = await insertUser();
    const subject = { type: "user" as const, userId };
    const chat = await aiConversations.createConversation({ appId: "route-test", ownerUserId: userId });
    const app = new Hono<AuthContext>()
      .use("*", async (c, next) => {
        c.set("accessSubject", subject);
        await next();
      })
      .route(
        "/",
        createAiChatRoutes({
          appId: "route-test",
          resolveContext: () =>
            Promise.resolve({
              actor: { kind: "user", user: { id: userId } as never },
              ownerUserId: userId,
              toolSource: { kind: "none" },
              modelPolicy: { kind: "locked", modelId: "test" },
              toolApprovalContext: { actorUserId: userId, appId: "route-test", resource: { kind: "direct" } },
            }),
        }),
      );
    try {
      const form = new FormData();
      form.set("file", new File([new Uint8Array([1, 2, 3])], "photo.png", { type: "image/png" }));
      const upload = await app.request(`/conversations/${chat.shortId}/files`, { method: "POST", body: form });
      expect(upload.status).toBe(200);
      expect(await upload.json()).toMatchObject({ file: { path: "/photo.png", mediaType: "image/png", size: 3, origin: "user" } });
      const list = await app.request(`/conversations/${chat.shortId}/files`);
      expect(await list.json()).toMatchObject({ files: [{ path: "/photo.png", origin: "user" }] });
    } finally {
      await sql`DELETE FROM ai.conversations WHERE id = ${chat.id}::uuid`;
      await sql`DELETE FROM auth.users WHERE id = ${userId}::uuid`;
    }
  });

  test("projects every conversation and Project identifier to its public short ID", async () => {
    const userId = await insertUser();
    const subject = { type: "user" as const, userId };
    const project = await aiProjects.create({ appId: "route-test", subject, name: "Public IDs" });
    const chat = await aiConversations.createConversation({ appId: "route-test", ownerUserId: userId, projectId: project.id });
    const internalRunId = crypto.randomUUID();
    const internalTurnId = crypto.randomUUID();
    const turnShortId = createAiShortId();
    await sql`
      INSERT INTO ai.enrichment_runs (id, conversation_id, status, trigger)
      VALUES (${internalRunId}::uuid, ${chat.id}::uuid, 'ok', 'manual')
    `;
    await sql`
      INSERT INTO ai.turns (id, short_id, conversation_id, status)
      VALUES (${internalTurnId}::uuid, ${turnShortId}, ${chat.id}::uuid, 'waiting_for_action')
    `;
    await sql`
      INSERT INTO ai.pending_actions (turn_id, conversation_id, call_id, kind, tool_name, args, approval_scope)
      VALUES (${internalTurnId}::uuid, ${chat.id}::uuid, 'call-1', 'approval', 'test_tool', '{}'::jsonb, 'once')
    `;
    const app = new Hono<AuthContext>()
      .use("*", async (c, next) => {
        c.set("accessSubject", subject);
        await next();
      })
      .route(
        "/",
        createAiChatRoutes({
          appId: "route-test",
          resolveContext: () =>
            Promise.resolve({
              actor: { kind: "user", user: { id: userId } as never },
              ownerUserId: userId,
              toolSource: { kind: "none" },
              modelPolicy: { kind: "locked", modelId: "test" },
              toolApprovalContext: { actorUserId: userId, appId: "route-test", resource: { kind: "direct" } },
            }),
        }),
      );

    try {
      for (const path of ["/conversations", "/conversations/page", `/conversations/${chat.shortId}`]) {
        const response = await app.request(path);
        expect(response.status).toBe(200);
        const body = (await response.json()) as unknown;
        const serialized = JSON.stringify(body);
        expect(serialized).toContain(chat.shortId);
        expect(serialized).toContain(project.shortId);
        expect(serialized).not.toContain(chat.id);
        expect(serialized).not.toContain(project.id);
      }
      for (const path of [`/conversations/${chat.shortId}/enrichment`, `/conversations/${chat.shortId}/pending-actions/${turnShortId}`]) {
        const response = await app.request(path);
        expect(response.status).toBe(200);
        const serialized = JSON.stringify(await response.json());
        expect(serialized).toContain(chat.shortId);
        expect(serialized).not.toContain(chat.id);
        expect(serialized).not.toContain(internalRunId);
        expect(serialized).not.toContain(internalTurnId);
      }
      const pending = JSON.stringify(await (await app.request(`/conversations/${chat.shortId}/pending-actions/${turnShortId}`)).json());
      expect(pending).toContain(turnShortId);
    } finally {
      await sql`DELETE FROM ai.projects WHERE id = ${project.id}::uuid`;
      await sql`DELETE FROM auth.users WHERE id = ${userId}::uuid`;
    }
  });
});
