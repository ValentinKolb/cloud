import { Hono } from "hono";
import { z } from "zod";
import { auth, type AuthContext, v } from "@valentinkolb/cloud/server";
import { loadGridsWorkspaceState } from "../frontend/_components/workspace/workspace-state";
import { liveRecordEvents } from "../service/record-events";
import { gridsService } from "../service";
import { gateAt } from "./permissions";

const parseWorkspaceHref = (href: string) => {
  const url = new URL(href, "http://grids.local");
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] !== "app" || parts[1] !== "grids" || !parts[2]) return null;
  const baseShortId = parts[2];
  if (parts.length === 3) return { baseShortId, activeTableSlug: null, activeViewSlug: null, activeDashboardSlug: null };
  if (parts.length === 4 && parts[3] === "automations") {
    return { baseShortId, activeTableSlug: null, activeViewSlug: null, activeDashboardSlug: null };
  }
  if (parts.length === 5 && parts[3] === "dashboard") {
    return { baseShortId, activeTableSlug: null, activeViewSlug: null, activeDashboardSlug: parts[4] };
  }
  if (parts.length === 5 && parts[3] === "table") {
    return { baseShortId, activeTableSlug: parts[4], activeViewSlug: null, activeDashboardSlug: null };
  }
  if (parts.length === 7 && parts[3] === "table" && parts[5] === "view") {
    return { baseShortId, activeTableSlug: parts[4], activeViewSlug: parts[6], activeDashboardSlug: null };
  }
  return null;
};

const app = new Hono<AuthContext>()
  .use(auth.requireRole("authenticated"))
  .get("/route", v("query", z.object({ href: z.string().min(1).max(3000) })), async (c) => {
    const target = parseWorkspaceHref(c.req.valid("query").href);
    if (!target) return c.json({ message: "Unsupported workspace route" }, 400);
    const state = await loadGridsWorkspaceState({
      user: c.get("user"),
      href: c.req.valid("query").href,
      ...target,
    });
    return c.json(state);
  })
  .get("/events/by-table/:tableId", async (c) => {
    const tableId = c.req.param("tableId")!;
    const table = await gridsService.table.get(tableId);
    if (!table) return c.json({ message: "Table not found" }, 404);
    const gate = await gateAt(c, { baseId: table.baseId, tableId }, "read");
    if (!gate.ok) return c.json({ message: gate.error.message }, gate.error.status);

    const encoder = new TextEncoder();
    const abort = new AbortController();
    let closed = false;
    let keepalive: ReturnType<typeof setInterval> | undefined;
    const send = (controller: ReadableStreamDefaultController<Uint8Array>, event: string, data: unknown) => {
      if (closed) return;
      controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
    };

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        send(controller, "ready", { baseId: table.baseId, tableId });
        keepalive = setInterval(() => send(controller, "ping", { at: new Date().toISOString() }), 25_000);

        void (async () => {
          try {
            for await (const event of liveRecordEvents({ baseId: table.baseId, signal: abort.signal })) {
              if (abort.signal.aborted) return;
              if (event.data.tableId === tableId) send(controller, event.data.type, event.data);
            }
          } catch (error) {
            if (!abort.signal.aborted) {
              send(controller, "error", { message: error instanceof Error ? error.message : "Event stream failed" });
            }
          } finally {
            if (keepalive) clearInterval(keepalive);
            if (!closed) {
              closed = true;
              controller.close();
            }
          }
        })();
      },
      cancel() {
        closed = true;
        abort.abort();
        if (keepalive) clearInterval(keepalive);
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  });

export default app;
