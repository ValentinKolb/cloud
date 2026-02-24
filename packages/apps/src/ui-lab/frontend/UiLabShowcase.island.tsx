import { Show, createSignal, type JSX } from "solid-js";
import type { BaseGroup, BaseUser } from "@valentinkolb/cloud/contracts/shared";
import { TextInput } from "@valentinkolb/cloud/lib/ui";
import { NumberInput } from "@valentinkolb/cloud/lib/ui";
import { Checkbox } from "@valentinkolb/cloud/lib/ui";
import { Select } from "@valentinkolb/cloud/lib/ui";
import { Switch } from "@valentinkolb/cloud/lib/ui";
import { DateTimeInput } from "@valentinkolb/cloud/lib/ui";
import { SegmentedControl } from "@valentinkolb/cloud/lib/ui";
import { ColorInput } from "@valentinkolb/cloud/lib/ui";
import { TagsInput } from "@valentinkolb/cloud/lib/ui";
import { PinInput } from "@valentinkolb/cloud/lib/ui";
import { ImageInput } from "@valentinkolb/cloud/lib/ui";
import { Slider } from "@valentinkolb/cloud/lib/ui";
import { SelectChip } from "@valentinkolb/cloud/lib/ui";
import { FilterChip, type FilterChipSection } from "@valentinkolb/cloud/lib/ui";
import { Dropdown, type DropdownItem } from "@valentinkolb/cloud/lib/ui";
import { LinkCard } from "@valentinkolb/cloud/lib/ui";
import { ProgressBar } from "@valentinkolb/cloud/lib/ui";
import { Pagination } from "@valentinkolb/cloud/lib/ui";
import { MarkdownView } from "@valentinkolb/cloud/lib/ui";
import { RemoveBtn } from "@valentinkolb/cloud/lib/ui";
import { Avatar } from "@valentinkolb/cloud/lib/ui";
import { UserView } from "@valentinkolb/cloud/lib/ui";
import { GroupView } from "@valentinkolb/cloud/lib/ui";
import { LoginBtn } from "@valentinkolb/cloud/lib/ui";

type UiLabShowcaseProps = {
  markdownHtml: string;
};

const sampleUser: BaseUser = {
  id: "8d3f5d9d-9342-4a33-9e43-a3f0f84af3dd",
  uid: "vkolb",
  roles: ["ipa", "admin"],
  givenname: "Valentin",
  sn: "Kolb",
  displayName: "Valentin Kolb",
  mail: "hello@example.com",
};

const sampleGroup: BaseGroup = {
  cn: "dev-cloud",
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

const Section = (props: { title: string; description?: string; children: JSX.Element }) => (
  <section class="paper p-4 md:p-5">
    <h2 class="text-sm font-semibold text-primary">{props.title}</h2>
    {props.description ? <p class="mt-1 text-xs text-dimmed">{props.description}</p> : null}
    <div class="mt-4">{props.children}</div>
  </section>
);

export default function UiLabShowcase(props: UiLabShowcaseProps) {
  const [copyState, setCopyState] = createSignal<"idle" | "copied">("idle");
  const [searchValue, setSearchValue] = createSignal("");
  const [lastAction, setLastAction] = createSignal<string | null>(null);
  const [removeClicks, setRemoveClicks] = createSignal(0);

  const [textValue, setTextValue] = createSignal("Sample value");
  const [passwordValue, setPasswordValue] = createSignal("secret");
  const [markdownValue, setMarkdownValue] = createSignal("## Hello\nThis is markdown text.");
  const [numberValue, setNumberValue] = createSignal(42);
  const [dateTimeValue, setDateTimeValue] = createSignal("2026-02-18T10:30");
  const [dateValue, setDateValue] = createSignal("2026-02-18");
  const [selectValue, setSelectValue] = createSignal("refined");
  const [tagsValue, setTagsValue] = createSignal(["backend", "ui", "core"]);
  const [pinValue, setPinValue] = createSignal("426913");
  const [checkValue, setCheckValue] = createSignal(true);
  const [switchValue, setSwitchValue] = createSignal(true);
  const [segmentValue, setSegmentValue] = createSignal<"list" | "board" | "calendar">("board");
  const [chipValue, setChipValue] = createSignal<"day" | "week" | "month">("week");
  const [scopeValue, setScopeValue] = createSignal<"all" | "mine" | "assigned">("all");
  const [filterValues, setFilterValues] = createSignal<string[]>(["open", "ui"]);
  const [sliderValue, setSliderValue] = createSignal(64);
  const [colorValue, setColorValue] = createSignal("#06b6d4");
  const [colorTransparent, setColorTransparent] = createSignal(false);
  const [imageValue, setImageValue] = createSignal<string | null>(null);

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

  return (
    <div class="max-w-6xl mx-auto p-3 md:p-4 space-y-4">
      <div class="paper p-4 md:p-5">
        <div class="flex items-start justify-between gap-3">
          <div>
            <h1 class="text-lg font-semibold text-primary flex items-center gap-2">
              <i class="ti ti-palette text-cyan-500" />
              UI Lab
            </h1>
            <p class="text-xs text-dimmed mt-1">Interactive dummy app for visual checks of shared UI components.</p>
          </div>
          <button type="button" class="btn-simple btn-sm" onClick={copyId}>
            <i class={copyState() === "copied" ? "ti ti-check" : "ti ti-copy"} />
            <span>{copyState() === "copied" ? "Copied" : "Copy ID"}</span>
          </button>
        </div>
      </div>

      <Section title="Form Inputs" description="Local state only, no backend calls.">
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <TextInput label="Text Input" placeholder="Your text..." value={textValue} onInput={setTextValue} />
          <TextInput label="Password Input" placeholder="Secret" value={passwordValue} onInput={setPasswordValue} password />
          <TextInput label="Markdown Input" markdown value={markdownValue} onInput={setMarkdownValue} />
          <NumberInput label="Number Input" value={numberValue} onChange={setNumberValue} min={0} max={100} step={1} />
          <DateTimeInput label="Date Time Input" value={dateTimeValue} onChange={setDateTimeValue} />
          <DateTimeInput label="Date Input" dateOnly value={dateValue} onChange={setDateValue} />
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
          <TagsInput label="Tags Input" value={tagsValue} onChange={setTagsValue} />
          <PinInput label="Pin Input" description="One-time code input." value={pinValue} onChange={setPinValue} length={6} />
          <div class="space-y-3">
            <Checkbox label="Checkbox" description="Boolean toggle with label." value={checkValue} onChange={setCheckValue} />
            <Switch label="Switch" value={switchValue} onChange={setSwitchValue} />
          </div>
        </div>
        <div class="mt-4 pt-3 border-t border-zinc-200/70 dark:border-zinc-700/60 space-y-2">
          <p class="text-xs text-dimmed">Button examples near form elements:</p>
          <div class="flex flex-wrap items-center gap-2">
            <button type="button" class="btn-primary btn-sm" onClick={() => setLastAction("Primary button clicked")}>
              Primary
            </button>
            <button type="button" class="btn-simple btn-sm" onClick={() => setLastAction("Simple button clicked")}>
              Simple
            </button>
            <button type="button" class="btn-secondary btn-sm" onClick={() => setLastAction("Secondary button clicked")}>
              Secondary
            </button>
            <button type="button" class="btn-success btn-sm" onClick={() => setLastAction("Success button clicked")}>
              Success
            </button>
            <button type="button" class="btn-danger btn-sm" onClick={() => setLastAction("Danger button clicked")}>
              Danger
            </button>
            <button type="button" class="btn-primary btn-sm" disabled>
              Disabled
            </button>
            <button type="button" class="btn-input btn-input-sm" onClick={() => setLastAction("Input-style action clicked")}>
              Input-style Action
            </button>
            <button type="button" class="icon-btn" aria-label="Minimal icon button" onClick={() => setLastAction("Icon button clicked")}>
              <i class="ti ti-settings" />
            </button>
          </div>
          <p class="text-xs text-dimmed mt-2">Medium size (`btn-md`) examples:</p>
          <div class="flex flex-wrap items-center gap-2">
            <button type="button" class="btn-primary btn-md" onClick={() => setLastAction("Primary medium button clicked")}>
              Primary
            </button>
            <button type="button" class="btn-secondary btn-md" onClick={() => setLastAction("Secondary medium button clicked")}>
              Secondary
            </button>
            <button type="button" class="btn-success btn-md" onClick={() => setLastAction("Success medium button clicked")}>
              Success
            </button>
            <button type="button" class="btn-danger btn-md" onClick={() => setLastAction("Danger medium button clicked")}>
              Danger
            </button>
          </div>
        </div>
      </Section>

      <Section title="Selectors And Controls" description="Basic controls with immediate visual feedback.">
        <div class="paper p-3 mb-4">
          <h3 class="text-xs font-semibold text-secondary mb-2">Search + Filter Row</h3>
          <div class="flex flex-wrap items-center gap-2">
            <div class="w-full min-w-60 flex-1">
              <TextInput placeholder="Search tasks, people, tags..." icon="ti ti-search" value={searchValue} onInput={setSearchValue} />
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
            <button type="button" class="btn-input btn-input-sm" onClick={() => setLastAction("Apply filters clicked")}>
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
                { value: "calendar", label: "Calendar", icon: "ti ti-calendar" },
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
            <ImageInput label="Image Input (Large)" value={imageValue} onChange={setImageValue} />
            <ImageInput label="Image Input (Small)" variant="small" value={imageValue} onChange={setImageValue} />
          </div>
        </div>
      </Section>

      <Section title="Actions, Feedback And Content" description="Action triggers and content presentation components.">
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
              <h3 class="text-xs font-semibold text-secondary mb-2">Progress Bars</h3>
              <div class="space-y-2">
                <ProgressBar value={Math.max(0, sliderValue() - 40)} size="xs" showValue />
                <ProgressBar value={sliderValue()} tone="primary" showValue />
                <ProgressBar value={Math.min(100, sliderValue() + 20)} tone="success" showValue />
              </div>
            </div>

            <div class="paper p-3">
              <h3 class="text-xs font-semibold text-secondary mb-2">Utility Buttons</h3>
              <div class="flex items-center gap-2">
                <RemoveBtn ariaLabel="Remove item" onClick={() => setRemoveClicks((v) => v + 1)} />
                <span class="text-xs text-dimmed">clicked {removeClicks()}x</span>
                <LoginBtn redirectTo="/app/ui-lab" class="btn-primary btn-sm" />
              </div>
            </div>
          </div>

          <div class="space-y-4">
            <div class="paper p-3 space-y-2">
              <h3 class="text-xs font-semibold text-secondary">Search Demo</h3>
              <TextInput placeholder="Type to simulate search..." icon="ti ti-search" value={searchValue} onInput={setSearchValue} />
              <p class="text-xs text-dimmed">{searchValue() ? `Query: ${searchValue()}` : "No query"}</p>
            </div>

            <div class="paper p-3">
              <h3 class="text-xs font-semibold text-secondary mb-2">Pagination</h3>
              <Pagination currentPage={3} totalPages={8} baseUrl="/app/ui-lab?page=" />
            </div>

            <div class="paper p-3">
              <h3 class="text-xs font-semibold text-secondary mb-2">Markdown View</h3>
              <MarkdownView html={props.markdownHtml} />
            </div>
          </div>
        </div>
      </Section>

      <Section title="Cards And Identity" description="Common display patterns for app cards and identities.">
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div class="space-y-2">
            <LinkCard href="/app/files" title="Files" description="Browse and manage shared storage." icon="ti ti-folders" color="blue" />
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
    </div>
  );
}
