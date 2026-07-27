import { describe, expect, test } from "bun:test";
import { plugin } from "./config";

Bun.plugin(plugin());

const { app } = await import("./server");

describe("@k2b/ui standalone SSR fixture", () => {
  test("renders without Cloud and exposes the scoped stylesheet", async () => {
    const page = await app.request("/");
    const html = await page.text();

    expect(page.status).toBe(200);
    expect(html).toContain('class="k2b-ui"');
    expect(html).toContain("Host shell outside .k2b-ui");
    expect(html).toContain("Independent package consumer");
    expect(html).toContain('const p="/_ssr"');
    expect(html).toContain("<solid-island");

    const styles = await app.request("/styles.css");
    const css = await styles.text();
    expect(styles.status).toBe(200);
    expect(styles.headers.get("content-type")).toContain("text/css");
    expect(css).toContain(".k2b-ui");
  });
});
