import {
  Button,
  Dropdown,
  dialogCore,
  MarkdownEditor,
  type MarkdownEditorProps,
  PanelDialog,
  panelDialogWorkspaceOptions,
  StatusBadge,
} from "@k2b/ui";
import { createMemo, For } from "solid-js";
import type { DslQueryContextKey } from "../../../query-dsl/parameters";

type CustomAppMarkdownFieldProps = {
  contextKeys: readonly DslQueryContextKey[];
  value: () => string;
  onValueChange: (value: string) => void;
};

type MarkdownCompletion = NonNullable<MarkdownEditorProps["completions"]>[number];

const contextLabel = (key: DslQueryContextKey): string => `@${key}`;

const contextCompletion = (keys: readonly DslQueryContextKey[]): MarkdownCompletion => ({
  trigger: "@",
  dropdown: true,
  knownLabels: keys.map(contextLabel),
  suggest: (query) => {
    const normalized = query.toLowerCase();
    return keys
      .filter((key) => key.toLowerCase().startsWith(normalized))
      .map((key) => ({ text: contextLabel(key), label: contextLabel(key), hint: "App context" }));
  },
});

export function CustomAppMarkdownField(props: CustomAppMarkdownFieldProps) {
  const completions = createMemo(() => [contextCompletion(props.contextKeys)]);
  const insertPlaceholder = (key: DslQueryContextKey, textarea?: HTMLTextAreaElement) => {
    const source = props.value();
    const start = textarea?.selectionStart ?? source.length;
    const end = textarea?.selectionEnd ?? start;
    const placeholder = contextLabel(key);
    props.onValueChange(`${source.slice(0, start)}${placeholder}${source.slice(end)}`);
    queueMicrotask(() => {
      textarea?.focus();
      textarea?.setSelectionRange(start + placeholder.length, start + placeholder.length);
    });
  };
  const placeholderItems = (textarea: () => HTMLTextAreaElement | undefined) =>
    props.contextKeys.map((key) => ({
      icon: "ti ti-at",
      label: contextLabel(key),
      description: key.startsWith("auth.") ? "Signed-in reader" : "App request context",
      action: () => insertPlaceholder(key, textarea()),
    }));

  const editor = (options: { fill?: boolean; lines: number }) => {
    let textarea: HTMLTextAreaElement | undefined;
    return (
      <div class="flex min-h-0 flex-1 flex-col gap-2">
        <MarkdownEditor
          label="Content"
          description="Type @ or add a placeholder. Values are inserted safely when the published app renders."
          value={props.value}
          onValueChange={props.onValueChange}
          completions={completions()}
          fill={options.fill}
          lines={options.lines}
          textareaRef={(element) => {
            textarea = element;
          }}
        />
        <Dropdown.Root items={placeholderItems(() => textarea)} position="bottom-left" width="18rem" label="Add placeholder">
          <Dropdown.Trigger size="xs" variant="secondary" class="self-start">
            <i class="ti ti-at" aria-hidden="true" /> Add placeholder
          </Dropdown.Trigger>
        </Dropdown.Root>
      </div>
    );
  };

  const openLargeEditor = () =>
    dialogCore.open<void>((close) => {
      let textarea: HTMLTextAreaElement | undefined;
      return (
        <PanelDialog>
          <PanelDialog.Header
            title="Markdown content"
            subtitle="The content edits the same automatically saved draft as the inspector."
            icon="ti ti-markdown"
            close={close}
            closeLabel="Close Markdown editor"
          />
          <PanelDialog.Body scrollPreserveKey="custom-app-markdown-editor">
            <div class="flex min-h-0 flex-1 flex-col gap-3">
              <MarkdownEditor
                label="Content"
                description="Type @ or add a placeholder. Values are inserted safely when the published app renders."
                value={props.value}
                onValueChange={props.onValueChange}
                completions={completions()}
                fill
                lines={24}
                textareaRef={(element) => {
                  textarea = element;
                }}
              />
              <div class="flex flex-wrap items-center gap-2">
                <Dropdown.Root items={placeholderItems(() => textarea)} position="top-left" width="18rem" label="Add placeholder">
                  <Dropdown.Trigger size="xs" variant="secondary">
                    <i class="ti ti-at" aria-hidden="true" /> Add placeholder
                  </Dropdown.Trigger>
                </Dropdown.Root>
                <div class="flex flex-wrap items-center gap-1.5" role="group" aria-label="Available Markdown placeholders">
                  <For each={props.contextKeys}>{(key) => <StatusBadge tone="neutral" icon={null} label={contextLabel(key)} />}</For>
                </div>
              </div>
            </div>
          </PanelDialog.Body>
          <PanelDialog.Footer>
            <span class="mr-auto text-xs text-dimmed">Changes save automatically.</span>
            <Button size="sm" onClick={() => close()}>
              Done
            </Button>
          </PanelDialog.Footer>
        </PanelDialog>
      );
    }, panelDialogWorkspaceOptions);

  return (
    <div class="flex flex-col gap-2">
      {editor({ lines: 6 })}
      <Button size="xs" variant="secondary" class="self-start" onClick={() => void openLargeEditor()}>
        <i class="ti ti-arrows-maximize" aria-hidden="true" /> Open large editor
      </Button>
    </div>
  );
}
