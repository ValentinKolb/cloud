import { createUniqueId, type JSX, Show } from "solid-js";
import { createFieldMeta, Field, fieldControlAria } from "../internal/field";
import type { ValueFieldProps } from "./field-contract";
import { commitFieldValue, resolveMaybeAccessor } from "./field-contract";

export type TagsInputProps = ValueFieldProps<string[]> & {
  placeholder?: string;
  icon?: string;
  activeIcon?: string;
  maxTags?: number;
  name?: string;
};

export function TagsInput(props: TagsInputProps): JSX.Element {
  const meta = createFieldMeta(props.id);
  const announcementId = `k2b-tags-${createUniqueId()}`;
  const value = () => resolveMaybeAccessor(props.value) ?? [];
  const error = () => resolveMaybeAccessor(props.error);
  const placeholder = () => props.placeholder ?? "Tags (e.g. Tag 1, Tag 2,...)";
  const normalize = (text: string) => text.replace(/\s+/g, " ").trim();
  const escapeHtml = (text: string) =>
    text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
  const renderTags = (tags: readonly string[]) =>
    tags.length === 0
      ? `<span class="k2b-tags-input__placeholder">${escapeHtml(placeholder())}</span>`
      : `<span class="k2b-tags-input__values" contenteditable="false">${tags.map((tag) => `<span class="k2b-tag">${escapeHtml(tag.trim())}</span>`).join("")}</span>`;

  return (
    <Field
      class={props.class}
      label={props.label}
      description={props.description}
      error={error()}
      meta={meta}
      required={props.required}
      disabled={props.disabled}
    >
      <div class="k2b-tags-input" data-invalid={error() ? "true" : undefined} data-disabled={props.disabled ? "true" : undefined}>
        <span class="k2b-tags-input__icon" aria-hidden="true">
          <i class={`${props.icon ?? "ti ti-tag"} k2b-tags-input__icon-idle`} />
          <i class={`${props.activeIcon ?? "ti ti-pencil"} k2b-tags-input__icon-active`} />
        </span>
        <div
          contentEditable={!props.disabled}
          id={meta.controlId}
          role="textbox"
          aria-multiline="false"
          {...fieldControlAria(meta, props)}
          aria-disabled={props.disabled}
          aria-placeholder={placeholder()}
          onFocus={(event) => {
            if (props.disabled) return;
            event.currentTarget.textContent = value().join(", ");
            const selection = getSelection();
            selection?.selectAllChildren(event.currentTarget);
            selection?.collapseToEnd();
          }}
          onBlur={(event) => {
            if (props.disabled) return;
            const previous = value();
            const next = (event.currentTarget.textContent ?? "").split(",").map(normalize).filter(Boolean).filter((tag, index, all) => all.indexOf(tag) === index).slice(0, props.maxTags);
            const added = next.filter((tag) => !previous.includes(tag));
            const removed = previous.filter((tag) => !next.includes(tag));
            const announcement = document.getElementById(announcementId);
            if (announcement) announcement.textContent = `${added.length ? `Tags added: ${added.join(", ")}. ` : ""}${removed.length ? `Tags removed: ${removed.join(", ")}.` : ""}`;
            commitFieldValue(props, next);
            event.currentTarget.innerHTML = renderTags(next);
          }}
          onKeyDown={(event) => event.key === "Enter" && (event.preventDefault(), event.currentTarget.blur())}
          innerHTML={renderTags(value())}
        />
      </div>
      <Show when={props.name}>{(name) => <input type="hidden" name={name()} value={value().join(",")} />}</Show>
      <div id={announcementId} class="k2b-sr-only" role="status" aria-live="polite" aria-atomic="true" />
    </Field>
  );
}

export default TagsInput;
