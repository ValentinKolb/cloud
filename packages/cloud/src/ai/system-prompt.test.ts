import { describe, expect, it } from "bun:test";
import { renderAiPlatformPrompt } from "../shared/ai-platform-prompt";
import { aiGlobalInstructionsContext, composeAiSystemPrompt, renderAiGlobalInstructions } from "./system-prompt";

const user = { displayName: "Valentin Kolb", uid: "vkolb", mail: "valentin@example.org" };

describe("aiGlobalInstructionsContext", () => {
  it("exposes user, appId and time fields", () => {
    const context = aiGlobalInstructionsContext({ user, appId: "assistant", now: new Date("2026-07-08T10:30:00Z") });
    expect(context.user).toEqual({ displayName: "Valentin Kolb", uid: "vkolb", mail: "valentin@example.org" });
    expect(context.appId).toBe("assistant");
    expect(context.now).toBe("2026-07-08T10:30:00.000Z");
    expect(String(context.today)).toContain("2026");
  });

  it("keeps user lookups safe without an actor", () => {
    const context = aiGlobalInstructionsContext({});
    expect(context.user).toEqual({ displayName: "", uid: "", mail: "" });
  });
});

describe("renderAiPlatformPrompt", () => {
  it("renders identity, runtime block, and rules", () => {
    const prompt = renderAiPlatformPrompt({ user, appId: "assistant", now: new Date("2026-07-08T10:30:00Z") });
    expect(prompt).toContain("Valentin Kolb's Cloud workspace");
    expect(prompt).toContain("User: Valentin Kolb (vkolb)");
    expect(prompt).toContain("App: assistant");
    expect(prompt).toContain("# Rules (in priority order)");
    expect(prompt).not.toContain("# Tools");
    expect(prompt).not.toContain("# Memory");
  });

  it("lists tool hints when tools are available", () => {
    const prompt = renderAiPlatformPrompt({
      user,
      tools: [
        { name: "card", hint: "show one compact highlight." },
        { name: "web_search", hint: "search the web." },
      ],
    });
    expect(prompt).toContain("# Tools");
    expect(prompt).toContain("- card: show one compact highlight.");
    expect(prompt).toContain("- web_search: search the web.");
    expect(prompt).toContain("don't repeat it in text");
  });

  it("adds memory rules only when memory is enabled", () => {
    const withMemory = renderAiPlatformPrompt({ user, memoryEnabled: true });
    expect(withMemory).toContain("# Memory");
    expect(withMemory).toContain("ONLY after the memory call succeeded");
    expect(withMemory).toContain("not instructions");

    expect(renderAiPlatformPrompt({ user, memoryEnabled: false })).not.toContain("# Memory");
  });

  it("renders without a user (empty context) instead of throwing", () => {
    const prompt = renderAiPlatformPrompt({});
    expect(prompt).toContain("Cloud workspace");
  });
});

describe("renderAiGlobalInstructions", () => {
  it("renders Liquid variables without HTML escaping", () => {
    const rendered = renderAiGlobalInstructions("Address {{ user.displayName }} <{{ user.mail }}>.", aiGlobalInstructionsContext({ user }));
    expect(rendered).toBe("Address Valentin Kolb <valentin@example.org>.");
  });

  it("falls back to the raw template when rendering fails", () => {
    const template = "Hello {{ unknown.variable }}";
    expect(renderAiGlobalInstructions(template, aiGlobalInstructionsContext({}))).toBe(template);
  });

  it("returns empty string for blank templates", () => {
    expect(renderAiGlobalInstructions("   ", {})).toBe("");
  });
});

describe("composeAiSystemPrompt", () => {
  it("orders platform, admin, app, resource, user instructions and memories", () => {
    const prompt = composeAiSystemPrompt({
      globalInstructions: "Admin says hello to {{ user.displayName }}.",
      appPrompt: "App prompt.",
      resourceContext: "Resource context.",
      user,
      appId: "assistant",
      memoryEnabled: true,
      toolHints: [{ name: "card", hint: "show one compact highlight." }],
      userInstructions: "Answer in German.",
      memory: "Studies computer science.",
    });

    const order = [
      "You are Cloud AI",
      "# Tools",
      "# Memory",
      "Admin says hello to Valentin Kolb.",
      "App prompt.",
      "Resource context.",
      "## User preferences",
      "Answer in German.",
      "## Memories",
      "Studies computer science.",
    ].map((needle) => prompt.indexOf(needle));

    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("omits memory rules and memories when memory is disabled", () => {
    const prompt = composeAiSystemPrompt({ globalInstructions: "", user, memory: "Stale entry." });
    expect(prompt).not.toContain("# Memory");
    expect(prompt).not.toContain("## Memories");
    expect(prompt).not.toContain("Stale entry.");
  });

  it("shows a placeholder when memory is enabled but empty", () => {
    const prompt = composeAiSystemPrompt({ globalInstructions: "", user, memoryEnabled: true, memory: "" });
    expect(prompt).toContain("(no memories yet)");
  });

  it("omits the user preferences section when instructions are blank", () => {
    const prompt = composeAiSystemPrompt({ globalInstructions: "", user, userInstructions: "  " });
    expect(prompt).not.toContain("## User preferences");
  });
});
