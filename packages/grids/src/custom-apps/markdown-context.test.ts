import { describe, expect, test } from "bun:test";
import { renderCustomAppMarkdown } from "./markdown-context";

describe("Grids App Markdown context", () => {
  test("renders fixed and route context without treating unknown @ text as a placeholder", () => {
    expect(
      renderCustomAppMarkdown("Hello @auth.name (@auth.email), open @params.record_id or mail support@example.test.", {
        "auth.name": "Valentin",
        "auth.email": "valentin@example.test",
        "params.record_id": "019fa000-0000-7000-8000-000000000001",
      }),
    ).toBe(
      "Hello Valentin (valentin&#64;example&#46;test), open 019fa000&#45;0000&#45;7000&#45;8000&#45;000000000001 or mail support@example.test.",
    );
  });

  test("renders anonymous values as empty text and escapes Markdown control characters", () => {
    expect(
      renderCustomAppMarkdown("Hello @auth.name @auth.username", { "auth.name": null, "auth.username": "*[Admin](javascript:alert(1))" }),
    ).toBe("Hello  &#42;&#91;Admin&#93;&#40;javascript&#58;alert&#40;1&#41;&#41;");
  });
});
