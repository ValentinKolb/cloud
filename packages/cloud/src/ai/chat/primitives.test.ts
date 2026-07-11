import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("AI chat primitives", () => {
  test("keeps pulse dots visible while using the shared animation CSS", () => {
    const primitiveSource = readFileSync(resolve(import.meta.dir, "primitives.tsx"), "utf8");
    const effectsSource = readFileSync(resolve(import.meta.dir, "../../styles/effects.css"), "utf8");

    expect(primitiveSource).toContain("ai-pulse-dots");
    expect(primitiveSource).toContain("ai-pulse-dot");
    expect(primitiveSource).toContain('class="ai-pulse-dot"');
    expect(primitiveSource).toContain('"animation-delay": delay');
    expect(primitiveSource).not.toContain('animation: "ai-dot-pulse 1s ease-in-out infinite"');
    expect(effectsSource).toContain("height: 0.3rem");
    expect(effectsSource).toContain("width: 0.3rem");
    expect(effectsSource).toContain("animation: ai-dot-pulse 1s ease-in-out infinite");
    expect(effectsSource).toContain("@keyframes ai-dot-pulse");
    expect(effectsSource).toContain("transform: translateY(-1px)");
  });

  test("renders utility rows text-only with hover emphasis instead of boxes", () => {
    const primitiveSource = readFileSync(resolve(import.meta.dir, "primitives.tsx"), "utf8");
    const toneSection = primitiveSource.slice(primitiveSource.indexOf("utilityToneClass"), primitiveSource.indexOf("utilityBlockClass"));

    // No bordered/filled boxes on the rows themselves.
    expect(toneSection).not.toContain("border-");
    expect(toneSection).not.toContain("bg-");
    expect(primitiveSource).not.toContain("rounded-md border px-2");
    // Hover darkens the text.
    expect(toneSection).toContain("hover:text-primary");
    expect(toneSection).toContain("hover:text-cyan-700");
    expect(toneSection).toContain("hover:text-red-700");
  });

  test("keeps assistant markdown stable and message actions responsive", () => {
    const primitiveSource = readFileSync(resolve(import.meta.dir, "primitives.tsx"), "utf8");
    const blocksSource = readFileSync(resolve(import.meta.dir, "blocks.tsx"), "utf8");
    const actionsSource = readFileSync(resolve(import.meta.dir, "message-actions.tsx"), "utf8");
    const composerSource = readFileSync(resolve(import.meta.dir, "composer.tsx"), "utf8");
    const messageListSource = readFileSync(resolve(import.meta.dir, "message-list.tsx"), "utf8");
    const userMessageSource = readFileSync(resolve(import.meta.dir, "user-message.tsx"), "utf8");
    const effectsSource = readFileSync(resolve(import.meta.dir, "../../styles/effects.css"), "utf8");

    expect(primitiveSource).toContain("export function AssistantMarkdownBlock");
    expect(primitiveSource).toContain("assistant-markdown-block");
    expect(primitiveSource).toContain("actions?: JSX.Element");
    expect(primitiveSource).toContain("pointer-events-auto mt-1 opacity-100");
    expect(primitiveSource).toContain("sm:absolute sm:left-0 sm:top-full");
    expect(primitiveSource).toContain("sm:opacity-0");
    expect(composerSource).toContain("opacity-100 shadow transition-opacity");
    expect(composerSource).toContain("sm:opacity-0 sm:group-hover:opacity-100");
    expect(userMessageSource).toContain("opacity-100 sm:opacity-0");
    expect(actionsSource).not.toContain("invisible flex h-7");
    expect(messageListSource).not.toContain("MarkdownView");
    expect(messageListSource).not.toContain("assistantDraftMessage");
    expect(blocksSource).toContain('props.compact ? "gap-1" : "gap-2"');
    expect(messageListSource).toContain("turnId={turnId()} compact");
    // The unified render stack renders persisted messages and the live turn through
    // one block list; no separate draft/detached-block merge remains.
    expect(messageListSource).not.toContain("buildAssistantRenderBlocks");
    expect(messageListSource).toContain("AiTurnBlockList");
    expect(effectsSource).toContain(".assistant-markdown-block :where(*)");
    expect(effectsSource).toContain("margin-block: 0");
  });
});
