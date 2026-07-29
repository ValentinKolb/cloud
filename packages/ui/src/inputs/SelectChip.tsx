import { createMemo, type JSX, Show } from "solid-js";
import { Dropdown, type DropdownItem, type DropdownPosition } from "../actions/Dropdown";
import { createFieldMeta, Field, fieldControlAria } from "../internal/field";
import type { MaybeAccessor, ValueFieldProps } from "./field-contract";
import { commitFieldValue, resolveMaybeAccessor } from "./field-contract";

export type SelectChipOption<T extends string | number = string> = {
  value: T;
  label: string;
  icon?: string;
  disabled?: boolean;
};

export type SelectChipProps<T extends string | number = string> = ValueFieldProps<T> & {
  value: MaybeAccessor<T>;
  options: SelectChipOption<T>[];
  icon?: string;
  position?: DropdownPosition;
  name?: string;
};

export function SelectChip<T extends string | number = string>(props: SelectChipProps<T>): JSX.Element {
  const meta = createFieldMeta(props.id);
  const value = () => resolveMaybeAccessor(props.value)!;
  const selected = () => props.options.find((option) => option.value === value());
  const elements = createMemo<DropdownItem[]>(() =>
    props.options.map((option) => ({
      element: (close: () => void) => (
        <button
          type="button"
          role="menuitemradio"
          aria-checked={option.value === value()}
          aria-disabled={option.disabled ? "true" : undefined}
          tabIndex={-1}
          class="k2b-dropdown__item k2b-select-chip__option"
          disabled={option.disabled}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            commitFieldValue(props, option.value);
            close();
          }}
        >
          <Show when={option.icon}>{(icon) => <i class={icon()} aria-hidden="true" />}</Show>
          <span>{option.label}</span>
          <Show when={option.value === value()}>
            <i class="ti ti-check k2b-select-chip__check" aria-hidden="true" />
          </Show>
        </button>
      ),
    })),
  );

  return (
    <Field
      class={props.class}
      label={props.label}
      description={props.description}
      error={props.error}
      meta={meta}
      required={props.required}
      disabled={props.disabled}
    >
      <Dropdown
        position={props.position ?? "bottom-right"}
        /* Cloud opens this menu at `w-40`. */
        width="10rem"
        label="Choose option"
        elements={elements()}
        trigger={
          <button id={meta.controlId} type="button" class="k2b-select-chip" disabled={props.disabled} {...fieldControlAria(meta, props)}>
            <Show when={props.icon}>{(icon) => <i class={icon()} aria-hidden="true" />}</Show>
            <span>{selected()?.label ?? ""}</span>
            <i class="ti ti-chevron-down" aria-hidden="true" />
          </button>
        }
      />
      <Show when={props.name}>{(name) => <input type="hidden" name={name()} value={value()} />}</Show>
    </Field>
  );
}

export default SelectChip;
