import { dropzone } from "@valentinkolb/stdlib/solid";
import { type Accessor, type JSX, Show } from "solid-js";
import { createInputA11y, InputWrapper } from "./util";

export type FileDropzoneProps = {
  label?: string | JSX.Element;
  description?: string | JSX.Element;
  ariaLabel?: string;
  accept?: string;
  multiple?: boolean;
  required?: boolean;
  disabled?: boolean;
  busy?: boolean | Accessor<boolean>;
  error?: string | Accessor<string | null | undefined>;
  icon?: string;
  title?: string;
  subtitle?: string;
  hint?: string;
  class?: string;
  onDrop: (files: File[]) => void | Promise<void>;
};

const resolveMaybe = <T,>(value: T | Accessor<T> | undefined): T | undefined =>
  typeof value === "function" ? (value as Accessor<T>)() : value;

export default function FileDropzone(props: FileDropzoneProps) {
  let inputRef: HTMLInputElement | undefined;
  const busy = () => resolveMaybe(props.busy) ?? false;
  const disabled = () => (props.disabled ?? false) || busy();
  const error = () => resolveMaybe(props.error) ?? undefined;
  const a11y = createInputA11y({ description: props.description, error });

  const emitFiles = (files: File[]) => {
    if (disabled() || files.length === 0) return;
    void props.onDrop(props.multiple === false ? files.slice(0, 1) : files);
  };

  const dz = dropzone.create({
    accept: props.accept,
    onDrop: emitFiles,
  });

  const zoneClass = () => {
    const base =
      "group relative flex min-h-28 w-full flex-col items-center justify-center gap-2 rounded-lg border px-4 py-5 text-center text-sm transition-[background-color,border-color,box-shadow,color] duration-150 focus-ui";
    const enabled = disabled() ? "cursor-not-allowed opacity-60" : "cursor-pointer";
    const state = dz.invalidDrag()
      ? "border-red-400 bg-red-50/80 text-red-700 dark:border-red-500/70 dark:bg-red-950/35 dark:text-red-200"
      : dz.isDragging()
        ? "border-blue-400 bg-blue-50/80 text-blue-700 dark:border-blue-500/70 dark:bg-blue-950/35 dark:text-blue-200"
        : "border-zinc-200/80 bg-zinc-50/80 text-secondary hover:border-zinc-300 hover:bg-white dark:border-zinc-800 dark:bg-zinc-900/55 dark:hover:border-zinc-700 dark:hover:bg-zinc-900";

    return `${base} ${enabled} ${state} ${props.class ?? ""}`;
  };

  const title = () => {
    if (busy()) return "Uploading...";
    if (dz.invalidDrag()) return "File type not accepted";
    if (dz.isDragging()) return "Drop to upload";
    return props.title ?? "Drop files or click to choose";
  };

  const subtitle = () => {
    if (dz.invalidDrag()) return "Choose a file that matches this field.";
    return props.subtitle;
  };

  return (
    <InputWrapper
      label={props.label}
      description={props.description}
      error={error()}
      required={props.required}
      inputId={a11y.inputId}
      descriptionId={a11y.descriptionId}
      errorId={a11y.errorId}
    >
      <button
        id={a11y.inputId}
        type="button"
        class={zoneClass()}
        onClick={() => inputRef?.click()}
        disabled={disabled()}
        aria-label={props.ariaLabel ?? (typeof props.label === "string" ? props.label : props.title)}
        aria-describedby={a11y.ariaDescribedBy()}
        {...dz.handlers}
      >
        <span class="flex h-10 w-10 items-center justify-center rounded-lg bg-white text-lg text-blue-600 shadow-[var(--theme-shadow-elevated)] transition-colors group-hover:text-blue-700 dark:bg-zinc-950 dark:text-blue-300">
          <i class={`ti ${busy() ? "ti-loader-2 animate-spin" : (props.icon ?? "ti-cloud-upload")}`} aria-hidden="true" />
        </span>
        <span class="flex flex-col gap-0.5">
          <span class="font-medium text-primary">{title()}</span>
          <Show when={subtitle()}>
            <span class="text-xs text-dimmed">{subtitle()}</span>
          </Show>
          <Show when={props.hint}>
            <span class="text-[11px] text-dimmed">{props.hint}</span>
          </Show>
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        class="hidden"
        accept={props.accept}
        multiple={props.multiple ?? true}
        disabled={disabled()}
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = "";
          emitFiles(files);
        }}
      />
    </InputWrapper>
  );
}
