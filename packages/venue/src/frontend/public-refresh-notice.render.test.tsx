import { describe, expect, test } from "bun:test";
import { createComponent } from "solid-js";
import { renderToString } from "solid-js/web";
import "./ssr-test-plugin";

const { PublicRefreshNotice } = await import("./public-refresh-notice.tsx");

describe("Venue public refresh notice", () => {
  test("keeps a failed live refresh visible and offers a retry", () => {
    const html = renderToString(() =>
      createComponent(PublicRefreshNotice, {
        refreshEnabled: true,
        refreshedAt: "2026-08-11T12:00:00.000Z",
        refreshError: "network unavailable",
        refreshing: false,
        retryRefresh: () => {},
      }),
    );

    expect(html).toContain('role="status"');
    expect(html).toContain("Live updates paused. Last confirmed information is still shown.");
    expect(html).toContain("Retry");
  });

  test("does not render diagnostics while live refresh is healthy", () => {
    const html = renderToString(() =>
      createComponent(PublicRefreshNotice, {
        refreshEnabled: true,
        refreshedAt: null,
        refreshError: null,
        refreshing: false,
        retryRefresh: () => {},
      }),
    );

    expect(html).toBe("");
  });
});
