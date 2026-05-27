import { onCleanup, onMount } from "solid-js";
import { MarkdownView } from "@valentinkolb/cloud/ui";
import { markdown } from "@valentinkolb/cloud/shared";
import { enhanceReadModeScripts } from "../../../lib/script/read-mode";
import { NAMED_BLOCK_SCROLL_EVENT } from "../detail/events";

type Props = {
  noteId: string;
  noteTitle: string;
  notebookId: string;
  /** Per-notebook opt-in for `\`\`\`script` block execution. When
   *  false the enhancer is a no-op and the source stays visible. */
  scriptsEnabled: boolean;
  // ---- script-kit metadata snapshot (mirrors NoteEditor.client.tsx).
  // Readonly rendering has no Y.Doc, so every script metadata read returns this
  // snapshot's value at script-run time.
  noteShortId: string;
  noteContent: string;
  noteCreatedAt: string;
  noteUpdatedAt: string;
  noteLockedAt: string | null;
  noteParentId: string | null;
  notebookName: string;
  // ---- end script-kit metadata
  renderedHtml: string;
  isLocked?: boolean;
};

/**
 * Readonly note renderer: just the rendered content, full height, no footer
 * chrome. Used for locked notes and users without write permission.
 */
export default function ReadonlyNote(props: Props) {
  let containerRef: HTMLDivElement | undefined;

  onMount(() => {
    if (containerRef) {
      markdown.client.initMarkdownEnhancements(containerRef);
      // Run after the generic markdown enhancements so attachment-URL
      // rewriting / heading-id injection happen first; scripts may
      // depend on the post-enhanced DOM (Phase 2+ kit may surface
      // attachment metadata).
      enhanceReadModeScripts(containerRef, {
        scriptsEnabled: props.scriptsEnabled,
        notebookId: props.notebookId,
        note: {
          shortId: props.noteShortId,
          title: props.noteTitle,
          content: props.noteContent,
          notebookName: props.notebookName,
          parentId: props.noteParentId,
          createdAt: props.noteCreatedAt,
          updatedAt: props.noteUpdatedAt,
          lockedAt: props.noteLockedAt,
        },
      });
    }

    const onScrollToNamedBlock = (event: Event) => {
      const name = (event as CustomEvent<{ name?: string }>).detail?.name;
      if (!name || !containerRef) return;
      const target = Array.from(containerRef.querySelectorAll<HTMLElement>("[data-block-name]")).find(
        (el) => el.dataset.blockName === name,
      );
      target?.scrollIntoView({ block: "start", behavior: "smooth" });
    };

    window.addEventListener(NAMED_BLOCK_SCROLL_EVENT, onScrollToNamedBlock);
    onCleanup(() => window.removeEventListener(NAMED_BLOCK_SCROLL_EVENT, onScrollToNamedBlock));
  });

  return (
    <div class="flex-1 min-w-0 flex flex-col overflow-hidden">
      <div class="flex-1 min-h-0 paper overflow-y-auto">
        <div ref={containerRef} class="p-6 max-w-4xl mx-auto">
          <MarkdownView html={props.renderedHtml} />
        </div>
      </div>
    </div>
  );
}
