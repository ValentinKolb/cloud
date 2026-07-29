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

  test("keeps assistant markdown stable while the generic timeline owns message actions", () => {
    const primitiveSource = readFileSync(resolve(import.meta.dir, "primitives.tsx"), "utf8");
    const blocksSource = readFileSync(resolve(import.meta.dir, "blocks.tsx"), "utf8");
    const actionsSource = readFileSync(resolve(import.meta.dir, "message-actions.tsx"), "utf8");
    const presentationSource = readFileSync(resolve(import.meta.dir, "presentation.tsx"), "utf8");
    const effectsSource = readFileSync(resolve(import.meta.dir, "../../styles/effects.css"), "utf8");

    expect(primitiveSource).toContain("export function AssistantMarkdownBlock");
    expect(primitiveSource).toContain("assistant-markdown-block");
    expect(primitiveSource).not.toContain("AssistantMessageLane");
    expect(primitiveSource).not.toContain("group/assistant-message");
    expect(actionsSource).not.toContain("invisible flex h-7");
    expect(presentationSource).not.toContain("MarkdownView");
    expect(presentationSource).not.toContain("assistantDraftMessage");
    expect(blocksSource).toContain('props.compact ? "gap-1" : "gap-2"');
    expect(presentationSource).toContain("turnId={turnId()} compact");
    // The unified render stack renders persisted messages and the live turn through
    // one block list; no separate draft/detached-block merge remains.
    expect(presentationSource).not.toContain("buildAssistantRenderBlocks");
    expect(presentationSource).toContain("AiTurnBlockList");
    expect(effectsSource).toContain(".assistant-markdown-block :where(*)");
    expect(effectsSource).toContain("margin-block: 0");
  });
});
