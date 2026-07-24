import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { ROUTE_TEMPLATE_HEADER } from "../../services/gateway";
import { routeTemplate } from "./route-template";

const buildApp = () => {
  const api = new Hono()
    .get("/bases/:baseId", (c) => c.text("ok"))
    .get("/help/:topic", (c) => c.text("ok"))
    .get("/inbox", (c) => c.text("ok"));

  return new Hono().use("*", routeTemplate).route("/api/demo", api);
};

const templateFor = async (path: string): Promise<string | null> => {
  const res = await buildApp().fetch(new Request(`http://gateway${path}`));
  return res.headers.get(ROUTE_TEMPLATE_HEADER);
};

describe("routeTemplate middleware", () => {
  test("reports the mounted template with params intact", async () => {
    expect(await templateFor("/api/demo/bases/20838fd2-8c26-42fa-a22d-904cfccda342")).toBe("/api/demo/bases/:baseId");
  });

  test("reports static routes verbatim", async () => {
    expect(await templateFor("/api/demo/inbox")).toBe("/api/demo/inbox");
  });

  test("keeps non-id params as declared", async () => {
    // The whole point of asking the app instead of guessing: `:topic` is a
    // param, `getting-started` is its value, and no heuristic could tell.
    expect(await templateFor("/api/demo/help/getting-started")).toBe("/api/demo/help/:topic");
  });

  test("drops regex constraints from param patterns", async () => {
    // Hono allows `:file{...}`; the constraint is noise in an ops table.
    const app = new Hono().use("*", routeTemplate).get("/assets/:file{.+\\.js$}", (c) => c.text("ok"));
    const res = await app.fetch(new Request("http://gateway/assets/a1b2c3.js"));
    expect(res.headers.get(ROUTE_TEMPLATE_HEADER)).toBe("/assets/:file");
  });

  test("stays silent when nothing matched", async () => {
    // Hono reports "/*" for a 404; that carries no information, so the
    // gateway should fall back to deriving a template from the path.
    expect(await templateFor("/api/demo/nope")).toBeNull();
  });

  test("never leaks the request path itself", async () => {
    const template = await templateFor("/api/demo/bases/20838fd2-8c26-42fa-a22d-904cfccda342");
    expect(template).not.toContain("20838fd2");
  });

  test("does not break the response it annotates", async () => {
    const res = await buildApp().fetch(new Request("http://gateway/api/demo/inbox"));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });
});
