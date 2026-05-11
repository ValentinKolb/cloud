import { For, Show, createSignal, type JSX } from "solid-js";
import type { BaseGroup, BaseUser } from "@valentinkolb/cloud/contracts";
import { TextInput } from "@valentinkolb/cloud/ui";
import { NumberInput } from "@valentinkolb/cloud/ui";
import { Checkbox } from "@valentinkolb/cloud/ui";
import { Select } from "@valentinkolb/cloud/ui";
import { Switch } from "@valentinkolb/cloud/ui";
import { DateTimeInput } from "@valentinkolb/cloud/ui";
import { SegmentedControl } from "@valentinkolb/cloud/ui";
import { ColorInput } from "@valentinkolb/cloud/ui";
import { TagsInput } from "@valentinkolb/cloud/ui";
import { PinInput } from "@valentinkolb/cloud/ui";
import { ImageInput } from "@valentinkolb/cloud/ui";
import { Slider } from "@valentinkolb/cloud/ui";
import { SelectChip } from "@valentinkolb/cloud/ui";
import { FilterChip, type FilterChipSection } from "@valentinkolb/cloud/ui";
import { Dropdown, type DropdownItem } from "@valentinkolb/cloud/ui";
import { LinkCard } from "@valentinkolb/cloud/ui";
import { StatCell, StatGrid } from "@valentinkolb/cloud/ui";
import { ProgressBar } from "@valentinkolb/cloud/ui";
import { Pagination } from "@valentinkolb/cloud/ui";
import { MarkdownView } from "@valentinkolb/cloud/ui";
import { RemoveBtn } from "@valentinkolb/cloud/ui";
import { Avatar } from "@valentinkolb/cloud/ui";
import { UserView } from "@valentinkolb/cloud/ui";
import { GroupView } from "@valentinkolb/cloud/ui";
import { LoginBtn } from "@valentinkolb/cloud/ui";
import { prompts } from "@valentinkolb/cloud/ui";

type UiLabShowcaseProps = {
  markdownHtml: string;
};

const sampleUser: BaseUser = {
  id: "8d3f5d9d-9342-4a33-9e43-a3f0f84af3dd",
  uid: "vkolb",
  roles: ["ipa", "admin"],
  provider: "ipa",
  profile: "user",
  givenname: "Valentin",
  sn: "Kolb",
  displayName: "Valentin Kolb",
  mail: "hello@example.com",
};

const sampleGroup: BaseGroup = {
  id: "a59d7601-5e27-4f88-bc6f-2c56e7542a6e",
  provider: "ipa",
  name: "dev-cloud",
  description: "Core maintainers",
  gidnumber: 1042,
};

const filterOptions: FilterChipSection[] = [
  {
    label: "Status",
    options: [
      { value: "open", label: "Open", icon: "ti ti-circle" },
      { value: "done", label: "Done", icon: "ti ti-check" },
    ],
  },
  {
    label: "Tags",
    multiple: true,
    options: [
      { value: "urgent", label: "Urgent", color: "#ef4444" },
      { value: "backend", label: "Backend", color: "#2563eb" },
      { value: "ui", label: "UI", color: "#14b8a6" },
    ],
  },
];

const Section = (props: {
  title: string;
  description?: string;
  children: JSX.Element;
}) => (
  <section class="paper p-4 md:p-5">
    <h2 class="text-sm font-semibold text-primary">{props.title}</h2>
    {props.description ? (
      <p class="mt-1 text-xs text-dimmed">{props.description}</p>
    ) : null}
    <div class="mt-4">{props.children}</div>
  </section>
);

type SidebarTreeNode = {
  id: string;
  label: string;
  icon?: string;
  labelIcons?: string[];
  meta?: string;
  actionIcon?: string;
  children?: SidebarTreeNode[];
};

const SidebarTree = (props: {
  nodes: SidebarTreeNode[];
  expanded: () => Set<string>;
  selectedId: () => string;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
  level?: number;
}) => {
  const level = props.level ?? 0;
  return (
    <div class="sidebar-tree">
      <For each={props.nodes}>
        {(node) => {
          const hasChildren = () => (node.children?.length ?? 0) > 0;
          const isExpanded = () => props.expanded().has(node.id);
          const isSelected = () => props.selectedId() === node.id;
          return (
            <div
              class="sidebar-tree-item"
              role="treeitem"
              aria-level={level + 1}
              aria-expanded={hasChildren() ? isExpanded() : undefined}
            >
              <button
                type="button"
                class={`sidebar-tree-row ${
                  isSelected() ? "sidebar-item-active" : ""
                }`}
                style={`--sidebar-level: ${level}`}
                onClick={(event) => {
                  const target = event.target as HTMLElement;
                  if (target.closest(".sidebar-tree-toggle") && hasChildren()) {
                    props.onToggle(node.id);
                    return;
                  }
                  if (target.closest(".sidebar-item-action")) {
                    return;
                  }
                  props.onSelect(node.id);
                }}
              >
                <span class="sidebar-tree-toggle">
                  {hasChildren() ? (
                    <i
                      class={`ti ${
                        isExpanded() ? "ti-chevron-down" : "ti-chevron-right"
                      }`}
                    />
                  ) : (
                    <i class={`ti ${node.icon ?? "ti-file-text"}`} />
                  )}
                </span>
                <span class="truncate">{node.label}</span>
                <Show when={(node.labelIcons?.length ?? 0) > 0}>
                  <span class="inline-flex items-center gap-1 shrink-0">
                    <For each={node.labelIcons ?? []}>
                      {(icon) => <i class={`ti ${icon} text-xs text-dimmed`} />}
                    </For>
                  </span>
                </Show>
                {node.actionIcon ? (
                  <span class="sidebar-item-action" aria-hidden="true">
                    <i class={`ti ${node.actionIcon} text-xs`} />
                  </span>
                ) : null}
              </button>
              <Show when={hasChildren() && isExpanded()}>
                <div class="sidebar-tree-children">
                  <SidebarTree
                    nodes={node.children ?? []}
                    expanded={props.expanded}
                    selectedId={props.selectedId}
                    onToggle={props.onToggle}
                    onSelect={props.onSelect}
                    level={level + 1}
                  />
                </div>
              </Show>
            </div>
          );
        }}
      </For>
    </div>
  );
};

export default function UiLabShowcase(props: UiLabShowcaseProps) {
  const [copyState, setCopyState] = createSignal<"idle" | "copied">("idle");
  const [searchValue, setSearchValue] = createSignal("");
  const [lastAction, setLastAction] = createSignal<string | null>(null);
  const [removeClicks, setRemoveClicks] = createSignal(0);

  const [textValue, setTextValue] = createSignal("Sample value");
  const [passwordValue, setPasswordValue] = createSignal("secret");
  const [markdownValue, setMarkdownValue] = createSignal(
    "## Hello\nThis is markdown text."
  );
  const [numberValue, setNumberValue] = createSignal<number | null>(42);
  const [numberOptional, setNumberOptional] = createSignal<number | null>(null);
  const [percentValue, setPercentValue] = createSignal<number | null>(25);
  const [currencyValue, setCurrencyValue] = createSignal<number | null>(12.34);
  const [dateTimeValue, setDateTimeValue] = createSignal("2026-02-18T10:30");
  const [dateValue, setDateValue] = createSignal("2026-02-18");
  const [selectValue, setSelectValue] = createSignal("refined");
  const [tagsValue, setTagsValue] = createSignal(["backend", "ui", "core"]);
  const [pinValue, setPinValue] = createSignal("426913");
  const [checkValue, setCheckValue] = createSignal(true);
  const [switchValue, setSwitchValue] = createSignal(true);
  const [segmentValue, setSegmentValue] = createSignal<
    "list" | "board" | "calendar"
  >("board");
  const [chipValue, setChipValue] = createSignal<"day" | "week" | "month">(
    "week"
  );
  const [scopeValue, setScopeValue] = createSignal<"all" | "mine" | "assigned">(
    "all"
  );
  const [sidebarPanelSize, setSidebarPanelSize] = createSignal<"s" | "m" | "l">(
    "m"
  );
  const [sidebarView, setSidebarView] = createSignal<
    "list" | "kanban" | "calendar"
  >("list");
  const [filterValues, setFilterValues] = createSignal<string[]>([
    "open",
    "ui",
  ]);
  const [sliderValue, setSliderValue] = createSignal(64);
  const [colorValue, setColorValue] = createSignal("#06b6d4");
  const [colorTransparent, setColorTransparent] = createSignal(false);
  const [imageValue, setImageValue] = createSignal<string | null>(null);
  const [sidebarTreeSelectedId, setSidebarTreeSelectedId] =
    createSignal("launch");
  const [sidebarTreeExpanded, setSidebarTreeExpanded] = createSignal<
    Set<string>
  >(new Set(["product", "roadmap", "q2"]));

  const sidebarTreeNodes: SidebarTreeNode[] = [
    {
      id: "product",
      label: "Product",
      icon: "ti-folder",
      actionIcon: "ti-dots",
      children: [
        {
          id: "roadmap",
          label: "Roadmap",
          icon: "ti-folder",
          actionIcon: "ti-plus",
          children: [
            {
              id: "q2",
              label: "Q2",
              icon: "ti-folder",
              children: [
                {
                  id: "launch",
                  label: "Launch Notes",
                  labelIcons: ["ti-lock"],
                  meta: "Updated 2h ago",
                  actionIcon: "ti-dots",
                },
                {
                  id: "feedback",
                  label: "Stakeholder Feedback",
                  meta: "14 comments",
                  actionIcon: "ti-message",
                },
              ],
            },
            {
              id: "q3",
              label: "Q3 Draft",
              meta: "Empty",
              actionIcon: "ti-dots",
            },
          ],
        },
      ],
    },
    {
      id: "weekly",
      label: "Weekly Update",
      meta: "Last edited yesterday",
      actionIcon: "ti-dots",
    },
  ];

  const toggleSidebarTreeNode = (id: string) => {
    setSidebarTreeExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectSidebarTreeNode = (id: string) => {
    setSidebarTreeSelectedId(id);
  };

  const handleSidebarRowAction = (
    event: MouseEvent,
    row: "list" | "kanban" | "calendar"
  ) => {
    const target = event.target as HTMLElement;
    if (target.closest(".sidebar-item-action")) return;
    setSidebarView(row);
  };

  const copyId = async () => {
    await navigator.clipboard.writeText("ui-lab");
    setCopyState("copied");
    setTimeout(() => setCopyState("idle"), 1200);
  };

  const dropdownItems: DropdownItem[] = [
    {
      icon: "ti ti-pencil",
      label: "Edit",
      action: () => setLastAction("Edit clicked"),
    },
    {
      icon: "ti ti-copy",
      label: "Duplicate",
      action: () => setLastAction("Duplicate clicked"),
    },
    {
      items: [
        {
          icon: "ti ti-trash",
          label: "Delete",
          variant: "danger",
          action: () => setLastAction("Delete clicked"),
        },
      ],
    },
  ];

  const openDialogSizeDemo = async (size: "small" | "medium" | "large") => {
    const result = await prompts.dialog<"confirmed" | "cancelled">(
      (close) => (
        <div class="space-y-3">
          <p class="text-sm">
            This is a <strong>{size}</strong> prompt dialog.
          </p>
          <p class="text-xs text-dimmed">
            Use this for quick, consistent modal content in app islands.
          </p>
          <div class="flex justify-end gap-2">
            <button
              type="button"
              class="btn-secondary btn-sm"
              onClick={() => close("cancelled")}
            >
              Cancel
            </button>
            <button
              type="button"
              class="btn-primary btn-sm"
              onClick={() => close("confirmed")}
            >
              Confirm
            </button>
          </div>
        </div>
      ),
      {
        title: `Dialog ${size}`,
        icon: "ti ti-app-window",
        size,
      }
    );

    setLastAction(`Dialog ${size}: ${result ?? "closed"}`);
  };

  return (
    <div class="max-w-6xl mx-auto p-3 md:p-4 space-y-4">
      <div class="paper p-4 md:p-5">
        <div class="flex items-start justify-between gap-3">
          <div>
            <h1 class="text-lg font-semibold text-primary flex items-center gap-2">
              <i class="ti ti-palette text-cyan-500" />
              UI Lab
            </h1>
            <p class="text-xs text-dimmed mt-1">
              Interactive dummy app for visual checks of shared UI components.
            </p>
          </div>
          <button type="button" class="btn-simple btn-sm" onClick={copyId}>
            <i
              class={copyState() === "copied" ? "ti ti-check" : "ti ti-copy"}
            />
            <span>{copyState() === "copied" ? "Copied" : "Copy ID"}</span>
          </button>
        </div>
      </div>

      <Section
        title="Form Inputs"
        description="Local state only, no backend calls."
      >
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <TextInput
            label="Text Input"
            placeholder="Your text..."
            value={textValue}
            onInput={setTextValue}
          />
          <TextInput
            label="Password Input"
            placeholder="Secret"
            value={passwordValue}
            onInput={setPasswordValue}
            password
          />
          <TextInput
            label="Markdown Input"
            markdown
            value={markdownValue}
            onInput={setMarkdownValue}
          />
          <NumberInput
            label="Integer (default)"
            description="decimalPlaces defaults to 0 — no dot/comma accepted, junk chars filtered out."
            value={numberValue}
            onChange={setNumberValue}
            min={0}
            max={100}
            step={1}
          />
          <NumberInput
            label="Optional Number"
            description="Clearable, no steppers, null = no value (distinct from 0)."
            placeholder="Type a number…"
            value={numberOptional}
            onChange={setNumberOptional}
            clearable
            showSteppers={false}
          />
          <NumberInput
            label="Percent (suffix)"
            description="suffix='%' inline; decimalPlaces=1; comma auto-converts to dot."
            value={percentValue}
            onChange={setPercentValue}
            min={0}
            max={100}
            step={0.5}
            decimalPlaces={1}
            suffix={<span class="font-mono">%</span>}
          />
          <NumberInput
            label="Currency (suffix)"
            description="suffix='€'; decimalPlaces=2; placeholder hints the dot."
            placeholder="12.34 €"
            value={currencyValue}
            onChange={setCurrencyValue}
            decimalPlaces={2}
            step={0.01}
            suffix={<span class="font-mono">€</span>}
            clearable
            showSteppers={false}
          />
          <DateTimeInput
            label="Date Time Input"
            value={dateTimeValue}
            onChange={setDateTimeValue}
          />
          <DateTimeInput
            label="Date Input"
            dateOnly
            value={dateValue}
            onChange={setDateValue}
          />
          <Select
            label="Select Input"
            placeholder="Choose one..."
            options={[
              { id: "refined", label: "Refined", icon: "ti ti-sparkles" },
              { id: "compact", label: "Compact", icon: "ti ti-layout-grid" },
            ]}
            value={selectValue}
            onChange={setSelectValue}
            clearable
          />
          <Select
            label="Searchable Select (fetchData)"
            placeholder="Search a city..."
            value={selectValue}
            onChange={setSelectValue}
            clearable
            fetchData={async (q, signal) => {
              // Demo: tiny in-memory list, simulated 250ms latency, abortable.
              await new Promise((res, rej) => {
                const t = setTimeout(res, 250);
                signal.addEventListener("abort", () => {
                  clearTimeout(t);
                  rej(new DOMException("aborted", "AbortError"));
                });
              });
              const all = [
                { id: "ber", label: "Berlin", description: "Germany", icon: "ti ti-map-pin" },
                { id: "ham", label: "Hamburg", description: "Germany", icon: "ti ti-map-pin" },
                { id: "muc", label: "München", description: "Germany", icon: "ti ti-map-pin" },
                { id: "vie", label: "Vienna", description: "Austria", icon: "ti ti-map-pin" },
                { id: "zur", label: "Zürich", description: "Switzerland", icon: "ti ti-map-pin" },
                { id: "par", label: "Paris", description: "France", icon: "ti ti-map-pin" },
                { id: "lon", label: "London", description: "UK", icon: "ti ti-map-pin" },
              ];
              const term = q.toLowerCase();
              return term ? all.filter((c) => c.label.toLowerCase().includes(term)) : all;
            }}
          />
          <TagsInput
            label="Tags Input"
            value={tagsValue}
            onChange={setTagsValue}
          />
          <PinInput
            label="Pin Input"
            description="One-time code input."
            value={pinValue}
            onChange={setPinValue}
            length={6}
          />
          <div class="space-y-3">
            <Checkbox
              label="Checkbox"
              description="Boolean toggle with label."
              value={checkValue}
              onChange={setCheckValue}
            />
            <Switch
              label="Switch"
              value={switchValue}
              onChange={setSwitchValue}
            />
          </div>
        </div>
        <div class="mt-4 pt-3 border-t border-zinc-200/70 dark:border-zinc-700/60 space-y-2">
          <p class="text-xs text-dimmed">Button examples near form elements:</p>
          <div class="flex flex-wrap items-center gap-2">
            <button
              type="button"
              class="btn-primary btn-sm"
              onClick={() => setLastAction("Primary button clicked")}
            >
              Primary
            </button>
            <button
              type="button"
              class="btn-simple btn-sm"
              onClick={() => setLastAction("Simple button clicked")}
            >
              Simple
            </button>
            <button
              type="button"
              class="btn-secondary btn-sm"
              onClick={() => setLastAction("Secondary button clicked")}
            >
              Secondary
            </button>
            <button
              type="button"
              class="btn-success btn-sm"
              onClick={() => setLastAction("Success button clicked")}
            >
              Success
            </button>
            <button
              type="button"
              class="btn-danger btn-sm"
              onClick={() => setLastAction("Danger button clicked")}
            >
              Danger
            </button>
            <button type="button" class="btn-primary btn-sm" disabled>
              Disabled
            </button>
            <button
              type="button"
              class="btn-input btn-input-sm"
              onClick={() => setLastAction("Input-style action clicked")}
            >
              Input-style Action
            </button>
            <button
              type="button"
              class="icon-btn"
              aria-label="Minimal icon button"
              onClick={() => setLastAction("Icon button clicked")}
            >
              <i class="ti ti-settings" />
            </button>
          </div>
          <p class="text-xs text-dimmed mt-2">
            Medium size (`btn-md`) examples:
          </p>
          <div class="flex flex-wrap items-center gap-2">
            <button
              type="button"
              class="btn-primary btn-md"
              onClick={() => setLastAction("Primary medium button clicked")}
            >
              Primary
            </button>
            <button
              type="button"
              class="btn-secondary btn-md"
              onClick={() => setLastAction("Secondary medium button clicked")}
            >
              Secondary
            </button>
            <button
              type="button"
              class="btn-success btn-md"
              onClick={() => setLastAction("Success medium button clicked")}
            >
              Success
            </button>
            <button
              type="button"
              class="btn-danger btn-md"
              onClick={() => setLastAction("Danger medium button clicked")}
            >
              Danger
            </button>
          </div>
        </div>
      </Section>

      <Section
        title="Selectors And Controls"
        description="Basic controls with immediate visual feedback."
      >
        <div class="paper p-3 mb-4">
          <h3 class="text-xs font-semibold text-secondary mb-2">
            Search + Filter Row
          </h3>
          <div class="flex flex-wrap items-center gap-2">
            <div class="w-full min-w-60 flex-1">
              <TextInput
                placeholder="Search tasks, people, tags..."
                icon="ti ti-search"
                value={searchValue}
                onInput={setSearchValue}
              />
            </div>
            <SelectChip<"all" | "mine" | "assigned">
              value={scopeValue()}
              icon="ti ti-user-search"
              options={[
                { value: "all", label: "All" },
                { value: "mine", label: "Mine" },
                { value: "assigned", label: "Assigned" },
              ]}
              onChange={setScopeValue}
            />
            <FilterChip
              label="Filters"
              icon="ti ti-adjustments-horizontal"
              options={filterOptions}
              value={filterValues()}
              onChange={setFilterValues}
            />
            <button
              type="button"
              class="btn-input btn-input-sm"
              onClick={() => setLastAction("Apply filters clicked")}
            >
              <i class="ti ti-check" />
              Apply
            </button>
          </div>
          <Show when={lastAction()}>
            <p class="text-xs text-dimmed mt-2">{lastAction()}</p>
          </Show>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div class="space-y-4">
            <SegmentedControl<"list" | "board" | "calendar">
              options={[
                { value: "list", label: "List", icon: "ti ti-list" },
                { value: "board", label: "Board", icon: "ti ti-layout-kanban" },
                {
                  value: "calendar",
                  label: "Calendar",
                  icon: "ti ti-calendar",
                },
              ]}
              value={segmentValue}
              onChange={setSegmentValue}
            />
            <SelectChip<"day" | "week" | "month">
              value={chipValue()}
              icon="ti ti-calendar-week"
              options={[
                { value: "day", label: "Day" },
                { value: "week", label: "Week" },
                { value: "month", label: "Month" },
              ]}
              onChange={setChipValue}
            />
            <FilterChip
              label="Filters"
              icon="ti ti-adjustments-horizontal"
              options={filterOptions}
              value={filterValues()}
              onChange={setFilterValues}
            />
            <Slider
              label="Slider"
              description="Double-click slider handle to reset."
              value={sliderValue}
              onChange={setSliderValue}
              min={0}
              max={100}
            />
            <ColorInput
              label="Color Input"
              value={colorValue}
              onChange={setColorValue}
              transparent
              isTransparent={colorTransparent}
              onTransparentChange={setColorTransparent}
            />
          </div>
          <div class="space-y-4">
            <ImageInput
              label="Image Input (Large)"
              value={imageValue}
              onChange={setImageValue}
            />
            <ImageInput
              label="Image Input (Small)"
              variant="small"
              value={imageValue}
              onChange={setImageValue}
            />
          </div>
        </div>
      </Section>

      <Section
        title="Actions, Feedback And Content"
        description="Action triggers and content presentation components."
      >
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div class="space-y-4">
            <div class="paper p-3 space-y-2">
              <h3 class="text-xs font-semibold text-secondary">Dropdown</h3>
              <Dropdown
                trigger={
                  <div class="btn-simple btn-sm">
                    <i class="ti ti-dots" />
                    <span>Actions</span>
                  </div>
                }
                elements={dropdownItems}
              />
              <Show when={lastAction()}>
                <p class="text-xs text-dimmed">{lastAction()}</p>
              </Show>
            </div>

            <div class="paper p-3">
              <h3 class="text-xs font-semibold text-secondary mb-2">
                Progress Bars
              </h3>
              <div class="space-y-2">
                <ProgressBar
                  value={Math.max(0, sliderValue() - 40)}
                  size="xs"
                  showValue
                />
                <ProgressBar value={sliderValue()} tone="primary" showValue />
                <ProgressBar
                  value={Math.min(100, sliderValue() + 20)}
                  tone="success"
                  showValue
                />
              </div>
            </div>

            <div class="paper p-3">
              <h3 class="text-xs font-semibold text-secondary mb-2">
                Utility Buttons
              </h3>
              <div class="flex items-center gap-2">
                <RemoveBtn
                  ariaLabel="Remove item"
                  onClick={() => setRemoveClicks((v) => v + 1)}
                />
                <span class="text-xs text-dimmed">
                  clicked {removeClicks()}x
                </span>
                <LoginBtn redirectTo="/app/ui-lab" class="btn-primary btn-sm" />
              </div>
            </div>

            <div class="paper p-3">
              <h3 class="text-xs font-semibold text-secondary mb-2">
                Prompt Dialog Sizes
              </h3>
              <div class="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  class="btn-secondary btn-sm"
                  onClick={() => void openDialogSizeDemo("small")}
                >
                  Open Small
                </button>
                <button
                  type="button"
                  class="btn-secondary btn-sm"
                  onClick={() => void openDialogSizeDemo("medium")}
                >
                  Open Medium
                </button>
                <button
                  type="button"
                  class="btn-secondary btn-sm"
                  onClick={() => void openDialogSizeDemo("large")}
                >
                  Open Large
                </button>
              </div>
            </div>
          </div>

          <div class="space-y-4">
            <div class="paper p-3 space-y-2">
              <h3 class="text-xs font-semibold text-secondary">Search Demo</h3>
              <TextInput
                placeholder="Type to simulate search..."
                icon="ti ti-search"
                value={searchValue}
                onInput={setSearchValue}
              />
              <p class="text-xs text-dimmed">
                {searchValue() ? `Query: ${searchValue()}` : "No query"}
              </p>
            </div>

            <div class="paper p-3">
              <h3 class="text-xs font-semibold text-secondary mb-2">
                Pagination
              </h3>
              <Pagination
                currentPage={3}
                totalPages={8}
                baseUrl="/app/ui-lab?page="
              />
            </div>

            <div class="paper p-3">
              <h3 class="text-xs font-semibold text-secondary mb-2">
                Markdown View
              </h3>
              <MarkdownView html={props.markdownHtml} />
            </div>
          </div>
        </div>
      </Section>

      <Section
        title="Cards And Identity"
        description="Common display patterns for app cards and identities."
      >
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div class="space-y-2">
            <LinkCard
              href="/app/files"
              title="Files"
              description="Browse and manage shared storage."
              icon="ti ti-folders"
              color="blue"
            />
            <LinkCard
              href="/app/notebooks"
              title="Notebooks"
              description="Collaborative notes and version history."
              icon="ti ti-notebook"
              color="emerald"
            />
          </div>

          <div class="space-y-3">
            <div class="flex items-center gap-2">
              <Avatar username="vk" size="sm" />
              <Avatar username="vk" size="md" />
              <Avatar username="vk" size="lg" />
            </div>
            <div class="paper p-3">
              <UserView user={sampleUser} showRealm />
            </div>
            <div class="paper p-3">
              <GroupView group={sampleGroup} canManage />
            </div>
          </div>
        </div>
      </Section>

      <Section
        title="Stat Cards"
        description="StatGrid + StatCell primitives (cloud/ui/misc). Composition-based: <StatGrid> frames a paper container, <StatCell> renders one stat. The 1px hairlines between cells come from a `gap-px bg-zinc` bleed inside the grid body — no inner ring, so the paper border is the only outer line and the cell corners follow the paper's rounded clip."
      >
        <div class="flex flex-col gap-10">
          {/* ── Hero (Lead-Metrik + Context Grid) ──
              The hero side is plain markup (not a primitive) because
              its layout is one-off — large lead metric centered in
              its own half. The right half is a standard `StatGrid`
              with no header, just cells. They share the same `paper`
              container, with the StatGrid contributing its own outer
              edges only on the right side; visually the two halves
              continue each other. */}
          <div>
            <p class="text-[10px] uppercase tracking-wider text-dimmed mb-3">
              Hero · Lead-Metrik dominiert, 6 Kontext-Stats daneben
            </p>
            <div class="paper overflow-hidden">
              <div class="grid grid-cols-1 lg:grid-cols-[1.2fr_2fr]">
                {/* Hero half: `lg:border-r` separates it from the
                    StatGrid half on wide screens (matches the hairline
                    colour of the inter-cell dividers so it visually
                    continues the grid). At <lg the layout stacks
                    vertically, where a right-border would float
                    nowhere — so it's a `lg:`-gated rule. */}
                <div class="px-6 py-8 flex flex-col gap-3 justify-center lg:border-r border-zinc-100 dark:border-zinc-800">
                  <span class="text-[10px] uppercase tracking-wider text-dimmed">Total Requests</span>
                  <span class="text-7xl font-bold tabular-nums leading-none text-primary">112</span>
                  <div class="flex items-center gap-2">
                    <span class="text-xs text-dimmed">17 unmatched · last 24h</span>
                    <span class="tag bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">+12%</span>
                  </div>
                </div>
                {/* Inline grid (no paper frame, no header) — we're
                    inside the hero's paper already. We replicate
                    StatGrid's hairline body manually here so the two
                    halves share one outer border. Cells are real
                    `StatCell`s. */}
                <div class="grid grid-cols-2 sm:grid-cols-3 gap-px bg-zinc-100 dark:bg-zinc-800">
                  <StatCell label="Apps" value={17} sub="9·12" />
                  <StatCell label="Routes" value={106} sub="v8" />
                  <StatCell label="Search" value={5} sub="providers" />
                  <StatCell label="Uptime" value="38m" />
                  <StatCell
                    label="Healthy"
                    value="17/17"
                    accent={{ tone: "emerald", icon: "ti ti-check", text: "ok" }}
                  />
                  <StatCell
                    label="P99"
                    value="89ms"
                    valueClass="text-amber-600 dark:text-amber-400"
                    sub="trending up"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* ── StatGrid only (kein Hero) ──
              Canonical usage: 6 cells in one row, no header. Shows the
              full StatCell vocabulary — pill-with-text accent (+12%),
              icon-only accents for status hints, value-coloring for
              warnings. */}
          <div>
            <p class="text-[10px] uppercase tracking-wider text-dimmed mb-3">
              StatGrid only · 6 Cells, keine Lead-Metrik
            </p>
            <StatGrid columns={6}>
              <StatCell label="Apps" value={17} sub="9·12 admin" />
              <StatCell label="Routes" value={106} sub="v8" />
              <StatCell
                label="Requests"
                value={112}
                sub="last 24h"
                accent={{ tone: "emerald", icon: "ti ti-trending-up", text: "+12%" }}
              />
              <StatCell label="Search" value={5} sub="providers" />
              <StatCell
                label="P99"
                value="89ms"
                valueClass="text-amber-600 dark:text-amber-400"
                sub="latency"
                accent={{ tone: "amber", icon: "ti ti-alert-triangle" }}
              />
              <StatCell
                label="Healthy"
                value="17/17"
                sub="all good"
                accent={{ tone: "emerald", icon: "ti ti-check" }}
              />
            </StatGrid>
            <p class="text-[10px] text-dimmed mt-2 italic">
              ↑ Pill mit Text (Requests +12%) hat bg. Icon-only Akzente (P99 ⚠, Healthy ✓) sind plain colored icons ohne bg. Subtil eingesetzt, nicht in jeder Cell.
            </p>
          </div>

          {/* ── StatGrid with header + action ──
              Used by grids' ViewStatsRow: the header carries a title
              + an "open" link, the body is a standard cell grid. The
              header's border-b uses the same zinc tone as the inter-
              cell hairlines so the divider line is visually continuous
              from the title bar down through the cells. */}
          <div>
            <p class="text-[10px] uppercase tracking-wider text-dimmed mb-3">
              StatGrid mit Header + Action · title bar oben, optional rechts ein "Open …" Link
            </p>
            <StatGrid
              title="Account requests"
              action={{ label: "Open full view", href: "#" }}
              columns={4}
            >
              <StatCell label="Open" value={12} sub="needs review" />
              <StatCell
                label="Pending"
                value={3}
                accent={{ tone: "amber", icon: "ti ti-clock" }}
              />
              <StatCell
                label="Approved"
                value={47}
                accent={{ tone: "emerald", icon: "ti ti-check", text: "ok" }}
              />
              <StatCell
                label="Rejected"
                value={2}
                valueClass="text-red-600 dark:text-red-400"
                sub="this week"
              />
            </StatGrid>
          </div>

          {/* ── StatGrid with link cells ──
              Pass `href` to a StatCell and the whole cell becomes a
              link with a subtle hover state. Useful for dashboard rows
              where each stat drills into a filtered view. */}
          <div>
            <p class="text-[10px] uppercase tracking-wider text-dimmed mb-3">
              StatGrid mit Link-Cells · jede Cell ist klickbar (hover state)
            </p>
            <StatGrid columns={3}>
              <StatCell label="All apps" value={17} sub="registered" href="#" />
              <StatCell
                label="Admin panels"
                value={8}
                sub="manageable"
                href="#"
                accent={{ tone: "blue", icon: "ti ti-shield" }}
              />
              <StatCell
                label="With nav"
                value={12}
                sub="visible to users"
                href="#"
              />
            </StatGrid>
          </div>

          {/* ── Pill row (ultra kompakt) ── */}
          <div>
            <p class="text-[10px] uppercase tracking-wider text-dimmed mb-3">
              Pill row · ultra kompakt, single line, header-bar-tauglich
            </p>
            <div class="flex flex-wrap gap-1">
              <span class="inline-flex items-baseline gap-1.5 rounded-md bg-zinc-100 dark:bg-zinc-800/70 px-2 py-0.5">
                <span class="text-[10px] uppercase tracking-wider text-dimmed">apps</span>
                <span class="text-xs font-bold tabular-nums text-primary">17</span>
              </span>
              <span class="inline-flex items-baseline gap-1.5 rounded-md bg-zinc-100 dark:bg-zinc-800/70 px-2 py-0.5">
                <span class="text-[10px] uppercase tracking-wider text-dimmed">routes</span>
                <span class="text-xs font-bold tabular-nums text-primary">106</span>
              </span>
              <span class="inline-flex items-baseline gap-1.5 rounded-md bg-zinc-100 dark:bg-zinc-800/70 px-2 py-0.5">
                <span class="text-[10px] uppercase tracking-wider text-dimmed">requests</span>
                <span class="text-xs font-bold tabular-nums text-primary">112</span>
              </span>
              <span class="inline-flex items-baseline gap-1.5 rounded-md bg-zinc-100 dark:bg-zinc-800/70 px-2 py-0.5">
                <span class="text-[10px] uppercase tracking-wider text-dimmed">search</span>
                <span class="text-xs font-bold tabular-nums text-primary">5</span>
              </span>
              <span class="inline-flex items-baseline gap-1.5 rounded-md bg-zinc-100 dark:bg-zinc-800/70 px-2 py-0.5">
                <span class="text-[10px] uppercase tracking-wider text-dimmed">uptime</span>
                <span class="text-xs font-bold tabular-nums text-primary">38m</span>
              </span>
              <span class="inline-flex items-baseline gap-1.5 rounded-md bg-emerald-100 dark:bg-emerald-900/30 px-2 py-0.5">
                <span class="text-[10px] uppercase tracking-wider text-emerald-700 dark:text-emerald-300">healthy</span>
                <span class="text-xs font-bold tabular-nums text-emerald-700 dark:text-emerald-300">17/17</span>
              </span>
            </div>
          </div>
        </div>
      </Section>

      <Section
        title="Sidebar System (Draft)"
        description="Reference sidebar built with new utility classes: sections, items, tree, and controls."
      >
        <div class="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <aside class="sidebar min-h-[28rem]">
            <div class="md:hidden">
              <details class="group">
                <summary class="sidebar-header cursor-pointer list-none">
                  <div class="h-8 w-8 shrink-0 rounded-lg bg-blue-500 text-white grid place-items-center">
                    <i class="ti ti-folders text-sm" />
                  </div>
                  <div class="min-w-0 flex-1">
                    <p class="truncate text-sm font-semibold text-primary">
                      Workspace Alpha
                    </p>
                    <p class="text-xs text-dimmed truncate">
                      Flat list navigation
                    </p>
                  </div>
                  <span class="inline-flex h-7 w-7 items-center justify-center rounded-md text-dimmed group-open:rotate-180 transition-transform">
                    <i class="ti ti-chevron-down text-sm" />
                  </span>
                </summary>
                <div class="px-1 pb-1 space-y-2">
                  <div class="flex flex-wrap gap-2">
                    <button type="button" class="btn-input btn-input-sm">
                      <i class="ti ti-settings" />
                      Settings
                    </button>
                    <button
                      type="button"
                      class="btn-input btn-input-sm bg-zinc-200/60 dark:bg-zinc-800/60"
                    >
                      <i class="ti ti-search" />
                      Search
                    </button>
                    <button type="button" class="btn-primary btn-sm">
                      <i class="ti ti-plus" />
                      New Item
                    </button>
                  </div>
                  <div class="flex flex-wrap gap-2">
                    <a href="#" class="btn-input btn-input-sm">
                      List
                    </a>
                    <a href="#" class="btn-input btn-input-sm">
                      Kanban
                    </a>
                    <a href="#" class="btn-input btn-input-sm">
                      Calendar
                    </a>
                  </div>
                  <div class="flex flex-wrap gap-2 pt-1">
                    <a href="#" class="btn-input btn-input-sm">
                      General
                    </a>
                    <a href="#" class="btn-input btn-input-sm">
                      Copy iCal URL
                    </a>
                  </div>
                </div>
              </details>
            </div>

            <div class="hidden md:flex md:flex-col md:min-h-0 md:h-full">
              <div class="sidebar-header">
                <div class="h-8 w-8 shrink-0 rounded-lg bg-blue-500 text-white grid place-items-center">
                  <i class="ti ti-folders text-sm" />
                </div>
                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm font-semibold text-primary">
                    Workspace Alpha
                  </p>
                  <p class="text-xs text-dimmed truncate">
                    Flat list navigation
                  </p>
                </div>
                <button
                  type="button"
                  class="icon-btn"
                  aria-label="General settings"
                >
                  <i class="ti ti-settings text-sm" />
                </button>
              </div>

              <div class="sidebar-body">
                <section class="sidebar-section">
                  <p class="sidebar-section-title">Actions</p>
                  <button
                    type="button"
                    class="sidebar-item bg-zinc-200/60 dark:bg-zinc-800/60"
                  >
                    <i class="ti ti-search" />
                    <span>Search</span>
                    <span class="sidebar-item-action" aria-hidden="true">
                      <i class="ti ti-slash" />
                    </span>
                  </button>
                  <button
                    type="button"
                    class="sidebar-item text-green-600 dark:text-green-400 bg-green-500/10 hover:bg-green-500/20"
                  >
                    <i class="ti ti-plus" />
                    <span>New Item</span>
                    <span class="sidebar-item-action" aria-hidden="true">
                      <i class="ti ti-chevron-right text-[10px]" />
                    </span>
                  </button>
                </section>

                <section class="sidebar-section">
                  <p class="sidebar-section-title">Navigation</p>
                  <button
                    type="button"
                    class={`sidebar-item ${
                      sidebarView() === "list" ? "sidebar-item-active" : ""
                    }`}
                    onClick={(event) => handleSidebarRowAction(event, "list")}
                  >
                    <i class="ti ti-list-check" />
                    <span>List</span>
                    <span class="sidebar-item-action" aria-hidden="true">
                      <i class="ti ti-dots" />
                    </span>
                  </button>
                  <button
                    type="button"
                    class={`sidebar-item ${
                      sidebarView() === "kanban" ? "sidebar-item-active" : ""
                    }`}
                    onClick={(event) => handleSidebarRowAction(event, "kanban")}
                  >
                    <i class="ti ti-layout-kanban" />
                    <span>Kanban</span>
                    <span class="sidebar-item-action" aria-hidden="true">
                      <i class="ti ti-dots" />
                    </span>
                  </button>
                  <button
                    type="button"
                    class={`sidebar-item ${
                      sidebarView() === "calendar" ? "sidebar-item-active" : ""
                    }`}
                    onClick={(event) =>
                      handleSidebarRowAction(event, "calendar")
                    }
                  >
                    <i class="ti ti-calendar-event" />
                    <span>Calendar</span>
                    <span class="sidebar-item-action" aria-hidden="true">
                      <i class="ti ti-dots" />
                    </span>
                  </button>
                </section>

                <section class="sidebar-section">
                  <p class="sidebar-section-title">Panel</p>
                  <div class="sidebar-controls">
                    <SegmentedControl<"s" | "m" | "l">
                      options={[
                        { value: "s", label: "S" },
                        { value: "m", label: "M" },
                        { value: "l", label: "L" },
                      ]}
                      value={sidebarPanelSize}
                      onChange={setSidebarPanelSize}
                    />
                    <div class="sidebar-control-row">
                      <Switch
                        label="Show hidden files"
                        value={switchValue}
                        onChange={setSwitchValue}
                      />
                    </div>
                  </div>
                </section>
              </div>

              <div class="sidebar-footer">
                <a href="#" class="sidebar-item">
                  <i class="ti ti-settings" />
                  <span>General</span>
                </a>
                <a href="#" class="sidebar-item">
                  <i class="ti ti-calendar-share" />
                  <span>Copy iCal URL</span>
                </a>
              </div>
            </div>
          </aside>

          <aside class="sidebar min-h-[28rem]">
            <div class="md:hidden">
              <details class="group" open>
                <summary class="sidebar-header cursor-pointer list-none">
                  <div class="h-8 w-8 shrink-0 rounded-lg bg-emerald-500 text-white grid place-items-center">
                    <i class="ti ti-notebook text-sm" />
                  </div>
                  <div class="min-w-0 flex-1">
                    <p class="truncate text-sm font-semibold text-primary">
                      Product Notes
                    </p>
                    <p class="text-xs text-dimmed truncate">Tree navigation</p>
                  </div>
                  <span class="inline-flex h-7 w-7 items-center justify-center rounded-md text-dimmed group-open:rotate-180 transition-transform">
                    <i class="ti ti-chevron-down text-sm" />
                  </span>
                </summary>
                <div class="px-1 pb-1 space-y-2">
                  <div class="flex flex-wrap gap-2">
                    <button type="button" class="btn-input btn-input-sm">
                      <i class="ti ti-settings" />
                      Settings
                    </button>
                    <button
                      type="button"
                      class="btn-input btn-input-sm bg-zinc-200/60 dark:bg-zinc-800/60"
                    >
                      <i class="ti ti-search" />
                      Search
                    </button>
                    <button type="button" class="btn-primary btn-sm">
                      <i class="ti ti-plus" />
                      New Note
                    </button>
                  </div>
                  <div class="max-h-56 overflow-y-auto">
                    <SidebarTree
                      nodes={sidebarTreeNodes}
                      expanded={sidebarTreeExpanded}
                      selectedId={sidebarTreeSelectedId}
                      onToggle={toggleSidebarTreeNode}
                      onSelect={selectSidebarTreeNode}
                    />
                  </div>
                </div>
              </details>
            </div>

            <div class="hidden md:flex md:flex-col md:min-h-0 md:h-full">
              <div class="sidebar-header">
                <div class="h-8 w-8 shrink-0 rounded-lg bg-emerald-500 text-white grid place-items-center">
                  <i class="ti ti-notebook text-sm" />
                </div>
                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm font-semibold text-primary">
                    Product Notes
                  </p>
                  <p class="text-xs text-dimmed truncate">
                    Tree-enabled navigation
                  </p>
                </div>
                <button
                  type="button"
                  class="icon-btn"
                  aria-label="General settings"
                >
                  <i class="ti ti-settings text-sm" />
                </button>
              </div>

              <div class="sidebar-body">
                <section class="sidebar-section">
                  <p class="sidebar-section-title">Actions</p>
                  <button
                    type="button"
                    class="sidebar-item bg-zinc-200/60 dark:bg-zinc-800/60"
                  >
                    <i class="ti ti-search" />
                    <span>Search</span>
                    <span class="sidebar-item-action" aria-hidden="true">
                      <i class="ti ti-slash" />
                    </span>
                  </button>
                  <button
                    type="button"
                    class="sidebar-item text-green-600 dark:text-green-400 bg-green-500/10 hover:bg-green-500/20"
                  >
                    <i class="ti ti-plus" />
                    <span>New Note</span>
                    <span class="sidebar-item-action" aria-hidden="true">
                      <i class="ti ti-chevron-right text-[10px]" />
                    </span>
                  </button>
                </section>

                <section class="sidebar-section">
                  <p class="sidebar-section-title">Notes</p>
                  <div
                    class="max-h-64 overflow-y-auto"
                    role="tree"
                    aria-label="Notebook tree"
                  >
                    <SidebarTree
                      nodes={sidebarTreeNodes}
                      expanded={sidebarTreeExpanded}
                      selectedId={sidebarTreeSelectedId}
                      onToggle={toggleSidebarTreeNode}
                      onSelect={selectSidebarTreeNode}
                    />
                  </div>
                </section>

                <section class="sidebar-section">
                  <p class="sidebar-section-title">Saved Searches</p>
                  <button type="button" class="sidebar-item">
                    <i class="ti ti-filter" />
                    <div class="min-w-0 flex-1 text-left">
                      <span class="block truncate">Mentions me</span>
                      <span class="sidebar-item-meta block truncate">
                        12 notes
                      </span>
                    </div>
                    <span class="sidebar-item-action" aria-hidden="true">
                      <i class="ti ti-dots" />
                    </span>
                  </button>
                  <button type="button" class="sidebar-item">
                    <i class="ti ti-lock" />
                    <div class="min-w-0 flex-1 text-left">
                      <span class="block truncate">Locked notes</span>
                      <span class="sidebar-item-meta block truncate">
                        3 notes
                      </span>
                    </div>
                    <span class="sidebar-item-action" aria-hidden="true">
                      <i class="ti ti-dots" />
                    </span>
                  </button>
                </section>
              </div>

              <div class="sidebar-footer">
                <button type="button" class="sidebar-item">
                  <i class="ti ti-plus" />
                  <span>New Note</span>
                </button>
              </div>
            </div>
          </aside>
        </div>
      </Section>
    </div>
  );
}
