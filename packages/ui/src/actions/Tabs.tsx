import { children, createMemo, createUniqueId, For, type JSX, Show } from "solid-js";
import type { MaybeAccessor } from "../inputs/field-contract";
import { resolveMaybeAccessor } from "../inputs/field-contract";

export type TabOption<T extends string = string> = {
  value: T;
  label: JSX.Element;
  icon?: string;
  disabled?: boolean;
  panel?: JSX.Element;
};

export type TabsItemProps<T extends string = string> = Omit<TabOption<T>, "panel"> & {
  children?: JSX.Element;
};

type TabsItemSlot<T extends string = string> = {
  readonly kind: typeof TABS_ITEM;
  readonly props: TabsItemProps<T>;
};

export type TabsProps<T extends string = string> = {
  value: MaybeAccessor<T>;
  onValueChange: (value: T) => void;
  ariaLabel: string;
  orientation?: "horizontal" | "vertical";
  class?: string;
  /** Data-driven alternative to colocated `Tabs.Item` children. */
  options?: readonly TabOption<T>[];
  children?: JSX.Element;
};

type TabsComponent = (<T extends string = string>(props: TabsProps<T>) => JSX.Element) & {
  Item: <T extends string = string>(props: TabsItemProps<T>) => JSX.Element;
};

const TABS_ITEM = Symbol("Tabs.Item");

const isTabsItem = <T extends string>(value: unknown): value is TabsItemSlot<T> =>
  !!value && typeof value === "object" && "kind" in value && value.kind === TABS_ITEM;

const collectTabsItems = <T extends string>(value: unknown): TabsItemSlot<T>[] => {
  if (Array.isArray(value)) return value.flatMap(collectTabsItems<T>);
  return isTabsItem<T>(value) ? [value] : [];
};

function TabsItem<T extends string = string>(props: TabsItemProps<T>): JSX.Element {
  return { kind: TABS_ITEM, props } satisfies TabsItemSlot<T> as unknown as JSX.Element;
}

/** Controlled, keyboard-accessible tabs with compositional or data-driven items. */
function TabsRoot<T extends string = string>(props: TabsProps<T>): JSX.Element {
  const instanceId = `k2b-tabs-${createUniqueId()}`;
  const resolvedChildren = children(() => props.children);
  const items = createMemo<readonly TabOption<T>[]>(() => {
    if (props.options) return props.options;
    return collectTabsItems<T>(resolvedChildren.toArray()).map((item) => ({
      value: item.props.value,
      label: item.props.label,
      icon: item.props.icon,
      disabled: item.props.disabled,
      panel: item.props.children,
    }));
  });
  const buttons: HTMLButtonElement[] = [];
  const current = () => resolveMaybeAccessor(props.value);
  const active = createMemo(() => items().find((option) => option.value === current()));
  const activeIndex = createMemo(() => Math.max(0, items().findIndex((option) => option.value === current())));
  const enabled = () => items().map((option, index) => ({ option, index })).filter(({ option }) => !option.disabled);
  const select = (index: number) => {
    const option = items()[index];
    if (!option || option.disabled) return;
    props.onValueChange(option.value);
    queueMicrotask(() => buttons[index]?.focus());
  };
  const move = (index: number, delta: 1 | -1) => {
    const available = enabled();
    if (available.length === 0) return;
    const currentIndex = available.findIndex((item) => item.index === index);
    const next = available[(currentIndex + delta + available.length) % available.length] ?? available[0];
    if (next) select(next.index);
  };

  return (
    <div class={`k2b-tabs ${props.class ?? ""}`} data-orientation={props.orientation ?? "horizontal"}>
      <div class="k2b-tabs__list" role="tablist" aria-label={props.ariaLabel} aria-orientation={props.orientation ?? "horizontal"}>
        <For each={items()}>
          {(option, index) => {
            const id = () => `${instanceId}-tab-${index()}`;
            const panelId = () => `${instanceId}-panel-${index()}`;
            return (
              <button
                ref={(element) => { buttons[index()] = element; }}
                id={id()}
                type="button"
                role="tab"
                aria-selected={current() === option.value}
                aria-controls={option.panel !== undefined ? panelId() : undefined}
                tabIndex={current() === option.value ? 0 : -1}
                disabled={option.disabled}
                onClick={() => props.onValueChange(option.value)}
                onKeyDown={(event) => {
                  const previous = props.orientation === "vertical" ? "ArrowUp" : "ArrowLeft";
                  const next = props.orientation === "vertical" ? "ArrowDown" : "ArrowRight";
                  if (event.key === previous || event.key === next) {
                    event.preventDefault();
                    move(index(), event.key === next ? 1 : -1);
                  } else if (event.key === "Home" || event.key === "End") {
                    event.preventDefault();
                    const available = enabled();
                    const target = event.key === "End" ? available.at(-1) : available[0];
                    if (target) select(target.index);
                  }
                }}
              >
                <Show when={option.icon}>{(icon) => <i class={icon()} aria-hidden="true" />}</Show>
                <span>{option.label}</span>
              </button>
            );
          }}
        </For>
      </div>
      <Show when={active()?.panel !== undefined}>
        <div
          id={`${instanceId}-panel-${activeIndex()}`}
          class="k2b-tabs__panel"
          role="tabpanel"
          aria-labelledby={`${instanceId}-tab-${activeIndex()}`}
          tabIndex={0}
        >
          {active()?.panel}
        </div>
      </Show>
    </div>
  );
}

export const Tabs = TabsRoot as TabsComponent;
Tabs.Item = TabsItem;

export default Tabs;
