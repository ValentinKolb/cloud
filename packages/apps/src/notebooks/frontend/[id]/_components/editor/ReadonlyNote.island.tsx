import { onMount } from "solid-js";
import { MarkdownView } from "@valentinkolb/cloud/lib/ui";
import { markdown } from "@valentinkolb/cloud/lib/shared";
import { buildNoteUrl } from "../../../params";
type Props = { noteId: string; noteTitle: string; notebookId: string; renderedHtml: string; isLocked?: boolean };
export default function ReadonlyNote(props: Props) {
  const editUrl = buildNoteUrl(props.notebookId, props.noteId);
  let containerRef: HTMLDivElement | undefined;
  onMount(() => {
    if (containerRef) {
      markdown.client.initMarkdownEnhancements(containerRef);
    }
  });
  return (
    <div class="flex-1 min-w-0 flex flex-col overflow-hidden">
      {" "}
      {/* Content */}{" "}
      <div class="flex-1 min-h-0 paper overflow-y-auto">
        {" "}
        <div ref={containerRef} class="p-6 max-w-4xl mx-auto">
          {" "}
          <MarkdownView html={props.renderedHtml} />{" "}
        </div>{" "}
      </div>{" "}
      {/* Toolbar */}{" "}
      <div class="flex items-center justify-between px-4 py-2">
        {" "}
        <div class="flex items-center gap-2 text-xs text-dimmed">
          {" "}
          {props.isLocked ? (
            <>
              {" "}
              <i class="ti ti-lock text-sm text-amber-500" /> <span class="text-amber-600 dark:text-amber-400">
                Locked (Read-only)
              </span>{" "}
            </>
          ) : (
            <>
              {" "}
              <i class="ti ti-eye text-sm" /> <span>Read mode</span>{" "}
            </>
          )}{" "}
        </div>{" "}
        {!props.isLocked && (
          <a href={editUrl} class="btn-secondary btn-sm flex items-center gap-1.5">
            {" "}
            <i class="ti ti-pencil text-sm" /> <span>Edit</span>{" "}
          </a>
        )}{" "}
      </div>{" "}
    </div>
  );
}
