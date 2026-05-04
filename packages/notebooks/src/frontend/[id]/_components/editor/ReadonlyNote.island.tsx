import { onMount } from "solid-js";
import { MarkdownView } from "@valentinkolb/cloud/ui";
import { markdown } from "@valentinkolb/cloud/shared";

type Props = {
  noteId: string;
  noteTitle: string;
  notebookId: string;
  renderedHtml: string;
  isLocked?: boolean;
};

/**
 * Distraction-free read view: just the rendered content, full height, no
 * footer chrome. The detail panel (forced open in read mode by `page.tsx`)
 * carries the Edit button and other note actions.
 */
export default function ReadonlyNote(props: Props) {
  let containerRef: HTMLDivElement | undefined;

  onMount(() => {
    if (containerRef) {
      markdown.client.initMarkdownEnhancements(containerRef);
    }
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
