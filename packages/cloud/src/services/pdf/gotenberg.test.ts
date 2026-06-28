import { describe, expect, test } from "bun:test";
import { type GotenbergConfig, GotenbergRenderError, renderHtmlToPdfWithConfig } from "./gotenberg";

const baseConfig = {
  url: "http://gotenberg:3000",
  timeoutMs: 5000,
  maxHtmlBytes: 1024,
  maxPdfBytes: 1024,
} satisfies GotenbergConfig;

const pdfResponse = (body = "%PDF-test", init?: ResponseInit) =>
  new Response(new TextEncoder().encode(body), {
    headers: { "content-type": "application/pdf" },
    ...init,
  });

describe("Gotenberg PDF renderer", () => {
  test("posts HTML to the chromium HTML endpoint", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const files: string[] = [];
    const result = await renderHtmlToPdfWithConfig(
      { html: "<h1>Hello</h1>", headerHtml: "<p>Head</p>", footerHtml: "<p>Foot</p>", filename: "ignored.html" },
      baseConfig,
      {
        fetch: async (url, init) => {
          calls.push({ url: String(url), init: init ?? {} });
          for (const file of (init?.body as FormData).getAll("files")) {
            if (file instanceof File) files.push(file.name);
          }
          return pdfResponse();
        },
      },
    );

    expect(result.contentType).toBe("application/pdf");
    expect(result.pdf.byteLength).toBeGreaterThan(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("http://gotenberg:3000/forms/chromium/convert/html");
    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.init.body).toBeInstanceOf(FormData);
    expect(files).toEqual(["index.html", "header.html", "footer.html"]);
    expect((calls[0]?.init.body as FormData).get("preferCssPageSize")).toBe("true");
    expect((calls[0]?.init.body as FormData).get("printBackground")).toBe("true");
  });

  test("adds basic auth only when credentials are configured", async () => {
    let authHeader = "";
    await renderHtmlToPdfWithConfig(
      { html: "<h1>Hello</h1>" },
      { ...baseConfig, username: "user", password: "secret" },
      {
        fetch: async (_url, init) => {
          authHeader = new Headers(init?.headers).get("authorization") ?? "";
          return pdfResponse();
        },
      },
    );

    expect(authHeader).toBe(`Basic ${Buffer.from("user:secret").toString("base64")}`);

    await renderHtmlToPdfWithConfig({ html: "<h1>Hello</h1>" }, baseConfig, {
      fetch: async (_url, init) => {
        authHeader = new Headers(init?.headers).get("authorization") ?? "";
        return pdfResponse();
      },
    });

    expect(authHeader).toBe("");
  });

  test("rejects oversized HTML before making a request", async () => {
    let called = false;

    await expect(
      renderHtmlToPdfWithConfig(
        { html: "abcdef" },
        { ...baseConfig, maxHtmlBytes: 5 },
        {
          fetch: async () => {
            called = true;
            return pdfResponse();
          },
        },
      ),
    ).rejects.toMatchObject({ code: "html_too_large" });

    expect(called).toBe(false);
  });

  test("rejects oversized PDF responses", async () => {
    await expect(
      renderHtmlToPdfWithConfig(
        { html: "<h1>Hello</h1>" },
        { ...baseConfig, maxPdfBytes: 5 },
        { fetch: async () => pdfResponse("123456") },
      ),
    ).rejects.toMatchObject({ code: "pdf_too_large" });
  });

  test("maps HTTP errors without exposing response bodies", async () => {
    await expect(
      renderHtmlToPdfWithConfig({ html: "<h1>Hello</h1>" }, baseConfig, {
        fetch: async () => new Response("internal secret details", { status: 500 }),
      }),
    ).rejects.toMatchObject({ code: "bad_response", status: 500 });
  });

  test("requires a configured URL", async () => {
    await expect(
      renderHtmlToPdfWithConfig({ html: "<h1>Hello</h1>" }, { ...baseConfig, url: "" }, { fetch: async () => pdfResponse() }),
    ).rejects.toBeInstanceOf(GotenbergRenderError);
  });
});
