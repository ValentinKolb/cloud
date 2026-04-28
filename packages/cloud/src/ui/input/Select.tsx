import { createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { InputWrapper, createInputA11y } from "./util";

type SelectOption =
  | string
  | {
      id: string;
      label?: string;
      description?: string;
      icon?: string;
    };

type SelectInputProps = {
  label?: string;
  description?: string;
  placeholder?: string;
  icon?: string;
  activeIcon?: string;
  value?: () => string | undefined;
  onChange?: (value: string) => void;
  error?: () => string | undefined;
  options: SelectOption[];
  required?: boolean;
  clearable?: boolean;
  disabled?: boolean;
};

const SelectInput = (props: SelectInputProps) => {
  const placeholder = () => props.placeholder ?? "Select...";
  const icon = () => props.icon ?? "ti ti-chevron-down";
  const activeIcon = () => props.activeIcon ?? "ti ti-chevron-up";
  const disabled = () => props.disabled ?? false;
  const clearable = () => props.clearable ?? false;

  const options = () =>
    props.options.map((option) =>
      typeof option === "object" ? { ...option, label: option.label || option.id } : { id: option, label: option },
    );

  const [isOpen, setIsOpen] = createSignal(false);
  const [focusedIndex, setFocusedIndex] = createSignal(-1);
  const [isDarkTheme, setIsDarkTheme] = createSignal(false);
  const a11y = createInputA11y({ description: props.description, error: props.error });

  let triggerRef: HTMLDivElement | undefined;
  let dialogRef: HTMLDialogElement | undefined;
  let optionRefs: HTMLDivElement[] = [];

  const selectedOption = createMemo(() => options().find((option) => option.id === props.value?.()));

  const syncTheme = () => {
    if (typeof document === "undefined") return;
    setIsDarkTheme(document.documentElement.classList.contains("dark") || document.body.classList.contains("dark"));
  };

  const focusOption = (index: number) => {
    setFocusedIndex(index);
    optionRefs[index]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };

  const navigateOptions = (direction: "next" | "previous") => {
    const count = options().length;
    if (!count) return;

    let nextIndex = focusedIndex();
    if (direction === "next") {
      nextIndex = nextIndex < count - 1 ? nextIndex + 1 : 0;
    } else {
      nextIndex = nextIndex > 0 ? nextIndex - 1 : count - 1;
    }

    focusOption(nextIndex);
  };

  const toggleDropdown = (open: boolean) => {
    if (disabled()) return;

    syncTheme();
    setIsOpen(open);
    if (!open) {
      dialogRef?.close();
      setFocusedIndex(-1);
      return;
    }

    const currentIndex = options().findIndex((option) => option.id === props.value?.());
    setFocusedIndex(currentIndex >= 0 ? currentIndex : 0);

    if (dialogRef && triggerRef) {
      const rect = triggerRef.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      const dropdownMaxHeight = 260; // max-h-60 = 15rem ~ 240px + padding

      dialogRef.style.left = `${rect.left}px`;
      dialogRef.style.width = `${rect.width}px`;

      if (spaceBelow < dropdownMaxHeight && spaceAbove > spaceBelow) {
        // Open above
        dialogRef.style.top = "auto";
        dialogRef.style.bottom = `${window.innerHeight - rect.top + 8}px`;
      } else {
        // Open below (default)
        dialogRef.style.top = `${rect.bottom + 8}px`;
        dialogRef.style.bottom = "auto";
      }

      dialogRef.showModal();
    }
  };

  const selectOption = (option: { id: string; label: string }) => {
    props.onChange?.(option.id);
    toggleDropdown(false);
    triggerRef?.focus();
  };

  const clearValue = (event: MouseEvent) => {
    event.stopPropagation();
    props.onChange?.("");
    triggerRef?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    const open = isOpen();

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (!open) {
          toggleDropdown(true);
        } else {
          navigateOptions("next");
        }
        break;
      case "ArrowUp":
        event.preventDefault();
        if (open) {
          navigateOptions("previous");
        }
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        if (open && focusedIndex() >= 0) {
          const option = options()[focusedIndex()];
          if (option) selectOption(option);
        } else if (!open) {
          toggleDropdown(true);
        }
        break;
      case "Escape":
        if (open) {
          event.preventDefault();
          toggleDropdown(false);
        }
        break;
      case "Tab":
        if (open) {
          toggleDropdown(false);
        }
        break;
    }
  };

  const handleDialogClick = (event: MouseEvent) => {
    if (event.target === dialogRef) {
      toggleDropdown(false);
    }
  };

  onCleanup(() => dialogRef?.close());

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
      <div class="relative">
          <div class="group relative flex-1">
            <div class="pointer-events-none absolute inset-y-0 left-2 z-10 flex items-center text-zinc-500">
              <i class={`${selectedOption()?.icon || (isOpen() ? activeIcon() : icon())} ${isOpen() ? "text-blue-500" : ""}`} />
            </div>

            <div
              ref={triggerRef}
              id={a11y.inputId}
              class={`input w-full pl-9 pr-8 ${
                isOpen() ? "!border-blue-500 !bg-white dark:!border-blue-400 dark:!bg-zinc-900" : ""
              } ${disabled() ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
              onClick={() => toggleDropdown(!isOpen())}
              onKeyDown={handleKeyDown}
              tabIndex={disabled() ? -1 : 0}
              role="combobox"
              aria-expanded={isOpen()}
              aria-haspopup="listbox"
              aria-label={!props.label ? "Select an option" : undefined}
              aria-describedby={a11y.ariaDescribedBy()}
              aria-invalid={!!props.error?.()}
              aria-required={props.required}
              aria-disabled={disabled()}
            >
              <Show when={selectedOption()} fallback={<span class="text-zinc-400 dark:text-zinc-500">{placeholder()}</span>}>
                <span class="text-zinc-700 dark:text-zinc-300">{selectedOption()!.label}</span>
              </Show>
            </div>

            <Show when={clearable() && selectedOption() && !disabled()}>
              <button
                type="button"
                class="absolute inset-y-0 right-2 flex items-center px-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                onClick={clearValue}
                tabIndex={-1}
                aria-label="Clear selection"
              >
                <i class="ti ti-x text-sm" />
              </button>
            </Show>
          </div>

          <dialog
            ref={dialogRef}
            class="popup border border-zinc-200 p-1 backdrop:bg-transparent dark:border-zinc-700"
            classList={{ dark: isDarkTheme() }}
            onKeyDown={handleKeyDown}
            onClick={handleDialogClick}
            aria-label="Options"
          >
            <div class="flex max-h-60 flex-col gap-1 overflow-y-auto" role="listbox" aria-label={props.label || "Options"}>
              <For each={options()} fallback={<div class="px-3 py-2 text-sm text-zinc-500 dark:text-zinc-400">No options available</div>}>
                {(option, index) => {
                  const isSelected = () => option.id === props.value?.();
                  const isFocused = () => index() === focusedIndex();

                  return (
                    <div
                      ref={(el) => (optionRefs[index()] = el)}
                      class="group flex cursor-pointer select-none items-center px-3 py-2 text-sm transition-all"
                      onClick={() => selectOption(option)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          selectOption(option);
                        }
                      }}
                      onMouseEnter={() => setFocusedIndex(index())}
                      role="option"
                      aria-label={option.label}
                      aria-selected={isSelected()}
                      tabIndex={-1}
                    >
                      <Show when={option.icon}>
                        <i class={`${option.icon} mr-3 text-zinc-500`} />
                      </Show>

                      <div class="min-w-0 flex-1">
                        <span
                          class={`truncate text-zinc-700 dark:text-zinc-300 ${
                            isFocused()
                              ? "text-primary underline underline-offset-2"
                              : "group-hover:underline group-hover:underline-offset-2"
                          }`}
                        >
                          {option.label}
                        </span>
                        <Show when={option.description}>
                          <div class="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{option.description}</div>
                        </Show>
                      </div>
                    </div>
                  );
                }}
              </For>
            </div>
          </dialog>
      </div>
    </InputWrapper>
  );
};

export { SelectInput };
export const Select = SelectInput;
export default SelectInput;
