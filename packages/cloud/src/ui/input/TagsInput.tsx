import { InputWrapper, createInputA11y } from "./util";

type TagsInputProps = {
  label?: string;
  description?: string;
  placeholder?: string;
  icon?: string;
  activeIcon?: string;
  value?: () => string[];
  onChange?: (tags: string[]) => void;
  error?: () => string | undefined;
  required?: boolean;
  disabled?: boolean;
};

const TagsInput = (props: TagsInputProps) => {
  const placeholder = () => props.placeholder ?? "Tags (e.g. Tag 1, Tag 2,...)";
  const icon = () => props.icon ?? "ti ti-tag";
  const activeIcon = () => props.activeIcon ?? "ti ti-pencil";
  const value = () => props.value?.() ?? [];
  const disabled = () => props.disabled ?? false;
  const a11y = createInputA11y({ description: props.description, error: props.error });
  const announcementId = crypto.randomUUID();

  const normalizeTag = (value: string) => value.replace(/\s+/g, " ").trim();

  const escapeHtml = (value: string) =>
    value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");

  const renderTags = (tags: string[]) => {
    if (tags.length === 0) return `<span class="text-zinc-400 dark:text-zinc-500">${placeholder()}</span>`;
    return `<span contenteditable="false" class="flex flex-wrap items-center gap-1 pointer-events-none">${tags
      .map(
        (tag) =>
          `<span class="inline-flex max-w-37.5 shrink-0 items-center overflow-hidden text-ellipsis whitespace-nowrap rounded px-1.5 text-xs leading-5 bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-300">${escapeHtml(tag.trim())}</span>`,
      )
      .join("")}</span>`;
  };

  return (
    <InputWrapper
      label={props.label}
      description={props.description}
      error={props.error?.()}
      required={props.required}
      inputId={a11y.inputId}
      descriptionId={a11y.descriptionId}
      errorId={a11y.errorId}
    >
      <div class="group relative flex">
        <div class={`absolute left-3 inset-y-0 items-center z-10 flex pointer-events-none text-zinc-400 dark:text-zinc-500`}>
          <i class={`${icon()} group-focus-within:hidden`} />
          <i class={`${activeIcon()} hidden text-blue-500 group-focus-within:block`} />
        </div>
        <div
          contentEditable={!disabled()}
          id={a11y.inputId}
          class={`input w-full pl-9 outline-none ${disabled() ? "cursor-not-allowed opacity-50" : "cursor-text"}`}
          role="textbox"
          aria-multiline="false"
          aria-label={!props.label ? placeholder() || "Enter tags" : undefined}
          aria-describedby={a11y.ariaDescribedBy()}
          aria-invalid={!!props.error?.()}
          aria-required={props.required}
          aria-disabled={disabled()}
          aria-placeholder={placeholder()}
          onFocus={(e) => {
            if (disabled()) return;
            const currentTags = value();
            e.currentTarget.textContent = currentTags.join(", ");
            const sel = getSelection();
            sel?.selectAllChildren(e.currentTarget);
            sel?.collapseToEnd();
          }}
          onBlur={(e) => {
            if (disabled()) return;
            const oldTags = value();
            const newTags = (e.currentTarget.textContent || "")
              .split(",")
              .map(normalizeTag)
              .filter(Boolean)
              .filter((tag, index, self) => self.indexOf(tag) === index);

            const added = newTags.filter((t) => !oldTags.includes(t));
            const removed = oldTags.filter((t) => !newTags.includes(t));

            if (added.length > 0 || removed.length > 0) {
              const announcement = document.getElementById(announcementId);
              if (announcement) {
                let message = "";
                if (added.length > 0) message += `Tags added: ${added.join(", ")}. `;
                if (removed.length > 0) message += `Tags removed: ${removed.join(", ")}.`;
                announcement.textContent = message;
              }
            }

            props.onChange?.(newTags);
            e.currentTarget.innerHTML = renderTags(newTags);
          }}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), e.currentTarget.blur())}
          innerHTML={renderTags(value())}
        />

        <div id={announcementId} class="sr-only" role="status" aria-live="polite" aria-atomic="true" />
      </div>
    </InputWrapper>
  );
};

export default TagsInput;
