import { describe, expect, test } from "bun:test";
import { createComponent } from "solid-js";
import { renderToString } from "solid-js/web";
import "../_components/ssr-test-plugin";

const { isolatedCustomAppHtml, RenderedHtml } = await import("./RenderedHtml");

describe("Rendered HTML App block", () => {
  test("prepends a deny-by-default document policy", () => {
    const html = isolatedCustomAppHtml('<img src="https://tracker.invalid/pixel"><style>.card{color:red}</style>');
    expect(html).toStartWith('<meta http-equiv="Content-Security-Policy"');
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("img-src data:");
    expect(html).toContain("connect-src 'none'");
    expect(html).toContain('name="referrer" content="no-referrer"');
  });

  test("keeps rendered markup inside a non-interactive sandbox", () => {
    const html = renderToString(() =>
      createComponent(RenderedHtml, { html: '<button onclick="alert(1)">Reserve</button>', title: "Equipment card", height: "normal" }),
    );
    expect(html).toContain("<iframe");
    expect(html).toContain("<iframe sandbox ");
    expect(html).toContain("<div inert>");
    expect(html).toContain("pointer-events-none");
    expect(html).toContain("Content-Security-Policy");
    expect(html).not.toContain('<button onclick="alert(1)">');
  });

  test("shows a bounded error state instead of rendering the template sentinel", () => {
    const html = renderToString(() =>
      createComponent(RenderedHtml, { html: "#TEMPLATE_ERROR!", title: "Equipment card", height: "compact" }),
    );
    expect(html).not.toContain("<iframe");
    expect(html).toContain("The template could not be rendered.");
  });
});
