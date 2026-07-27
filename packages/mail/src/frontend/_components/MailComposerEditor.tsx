import { AutocompleteEditor, type Completion, MarkdownEditor, Panes, type PanesNode, type PanesValue } from "@valentinkolb/cloud/ui";
import type { Accessor } from "solid-js";
import { Show } from "solid-js";
import type { ComposePreview } from "../../contracts";

export const mailComposerPaneVisible = (node: PanesNode, elementId: string): boolean => {
  if (node.type === "split") return node.children.some((child) => mailComposerPaneVisible(child, elementId));
  if (!node.elementIds.includes(elementId)) return false;
  if (node.presentation === "stack") return true;
  const activeElementId = node.elementIds.includes(node.activeElementId ?? "") ? node.activeElementId : node.elementIds[0];
  return activeElementId === elementId;
};

export default function MailComposerEditor(props: {
  format: Accessor<"plain" | "markdown">;
  body: Accessor<string>;
  onBodyInput: (value: string) => void;
  editable: Accessor<boolean>;
  completions: Accessor<Completion[]>;
  panes: Accessor<PanesValue>;
  onPanesChange: (value: PanesValue) => void;
  preview: Accessor<ComposePreview | null>;
  previewLoading: Accessor<boolean>;
  previewError: Accessor<string | undefined>;
  onRetryPreview: () => void;
}) {
  const writeSurface = () => (
    <Show
      when={props.format() === "markdown"}
      fallback={
        <AutocompleteEditor
          value={props.body}
          onInput={props.onBodyInput}
          lines={26}
          placeholder="Write your message"
          ariaLabel="Message body"
          spellcheck
          disabled={!props.editable()}
          completions={props.completions()}
          fill
        />
      }
    >
      <MarkdownEditor
        value={props.body}
        onInput={props.onBodyInput}
        placeholder="Write your message"
        ariaLabel="Message body"
        lines={26}
        spellcheck
        disabled={!props.editable()}
        completions={props.completions()}
        fill
      />
    </Show>
  );

  const previewSurface = () => (
    <div class="relative h-full min-h-72 overflow-hidden bg-white">
      <Show
        when={props.preview()}
        fallback={
          <Show
            when={props.previewError()}
            fallback={<div class="flex h-full min-h-72 items-center justify-center text-sm text-dimmed">Preparing preview...</div>}
          >
            {(message) => (
              <div class="flex h-full min-h-72 flex-col items-center justify-center gap-2 p-4 text-sm text-red-600">
                <span>{message()}</span>
                <button type="button" class="btn-secondary btn-sm" onClick={props.onRetryPreview}>
                  Retry
                </button>
              </div>
            )}
          </Show>
        }
      >
        {(value) => <iframe class="h-full min-h-72 w-full border-0 bg-white" sandbox="" srcdoc={value().html} title="Email preview" />}
      </Show>
      <Show when={props.preview() && props.previewError()}>
        <div class="absolute inset-x-2 top-2 flex items-center gap-2 border border-red-200 bg-white px-2 py-1 text-xs text-red-600 shadow-sm">
          <span class="min-w-0 flex-1 truncate">{props.previewError()}</span>
          <button type="button" class="btn-simple btn-sm" onClick={props.onRetryPreview}>
            Retry
          </button>
        </div>
      </Show>
      <Show when={props.previewLoading()}>
        <span class="absolute right-2 top-2 text-xs text-dimmed">
          <i class="ti ti-loader-2 animate-spin" aria-hidden="true" /> Updating
        </span>
      </Show>
    </div>
  );

  return (
    <div class="min-h-72 flex-1 py-2">
      <Show when={props.format() === "markdown"} fallback={<div class="h-full min-h-72 overflow-hidden">{writeSurface()}</div>}>
        <Panes.Root
          value={props.panes()}
          onChange={props.onPanesChange}
          class="h-full w-full"
          keepMounted
          allowResize
          allowMove
          allowReorder
          allowHorizontalSplit
          allowVerticalSplit={false}
        >
          <Panes.Element id="editor" title="Write" icon="ti ti-pencil">
            <div class="h-full min-h-0 overflow-hidden">{writeSurface()}</div>
          </Panes.Element>
          <Panes.Element id="preview" title="Preview" icon="ti ti-eye">
            {previewSurface()}
          </Panes.Element>
        </Panes.Root>
      </Show>
    </div>
  );
}
