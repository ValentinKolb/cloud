/**
 * Buttons tab — button utility classes + button-flavoured components.
 *
 * The CSS button system composes: pick a SIZE class (`btn-sm` /
 * `btn-md`) and a VARIANT class (`btn-primary` / `btn-secondary` / …).
 * `btn-base` is the shared foundation; rarely applied directly.
 *
 * `btn-input-*` is a separate visual family used inside / next to
 * input fields where the button has to read as "input-shaped" rather
 * than "page action".
 */

import { ContextMenu, CopyButton, Dropdown, type DropdownItem, RemoveBtn, SegmentedControl, Tooltip } from "@valentinkolb/cloud/ui";
import { createSignal } from "solid-js";
import DemoCard from "./DemoCard";

const FROM_UI = "@valentinkolb/cloud/ui";

export const ButtonSizes = () => (
  <DemoCard
    id="btn-sizes"
    chip={[
      { kind: "utility", name: "btn-sm" },
      { kind: "utility", name: "btn-md" },
    ]}
    description="Compose any size with any variant — they're orthogonal classes."
    code={`<button class="btn-primary btn-sm">Small</button>
<button class="btn-primary btn-md">Medium</button>`}
  >
    <div class="flex items-center gap-2">
      <button type="button" class="btn-primary btn-sm">
        Small
      </button>
      <button type="button" class="btn-primary btn-md">
        Medium
      </button>
    </div>
  </DemoCard>
);

export const ButtonVariants = () => (
  <DemoCard
    id="btn-variants"
    chip={[
      { kind: "utility", name: "btn-primary" },
      { kind: "utility", name: "btn-secondary" },
      { kind: "utility", name: "btn-danger" },
      { kind: "utility", name: "btn-success" },
      { kind: "utility", name: "btn-simple" },
    ]}
    description="Five visual variants. `btn-simple` is the lowest-emphasis, used in toolbars and overflow menus."
    code={`<button class="btn-primary btn-sm">Primary</button>
<button class="btn-secondary btn-sm">Secondary</button>
<button class="btn-danger btn-sm">Danger</button>
<button class="btn-success btn-sm">Success</button>
<button class="btn-simple btn-sm">Simple</button>`}
  >
    <div class="flex items-center gap-2 flex-wrap">
      <button type="button" class="btn-primary btn-sm">
        Primary
      </button>
      <button type="button" class="btn-secondary btn-sm">
        Secondary
      </button>
      <button type="button" class="btn-danger btn-sm">
        Danger
      </button>
      <button type="button" class="btn-success btn-sm">
        Success
      </button>
      <button type="button" class="btn-simple btn-sm">
        Simple
      </button>
    </div>
  </DemoCard>
);

export const AiButtonMarkers = () => (
  <DemoCard
    id="ai-buttons"
    chip={[
      { kind: "utility", name: "btn-ai" },
      { kind: "utility", name: "btn-input-ai" },
      { kind: "utility", name: "icon-btn-ai" },
    ]}
    description="AI markers use the sparkles brand icon and the teal/blue script-action tint. Use them only where a control opens, runs, or configures an AI feature."
    code={`<button class="btn-ai btn-sm">
  <i class="ti ti-sparkles" />
  Ask AI
</button>

<button class="btn-input-ai btn-input-sm">
  <i class="ti ti-sparkles" />
  Improve text
</button>

<button class="icon-btn-ai" aria-label="Ask AI">
  <i class="ti ti-sparkles" />
</button>`}
  >
    <div class="flex flex-wrap items-center gap-2">
      <button type="button" class="btn-ai btn-sm">
        <i class="ti ti-sparkles" />
        Ask AI
      </button>
      <button type="button" class="btn-input-ai btn-input-sm">
        <i class="ti ti-sparkles" />
        Improve text
      </button>
      <button type="button" class="icon-btn-ai" aria-label="Ask AI">
        <i class="ti ti-sparkles" />
      </button>
      <button type="button" class="icon-btn-ai" aria-label="AI is enabled" aria-pressed="true">
        <i class="ti ti-sparkles" />
      </button>
    </div>
  </DemoCard>
);

export const ButtonInputs = () => (
  <DemoCard
    id="btn-input"
    chip={[
      { kind: "utility", name: "btn-input" },
      { kind: "utility", name: "btn-input-recessed" },
      { kind: "utility", name: "btn-input-primary" },
      { kind: "utility", name: "btn-input-success" },
      { kind: "utility", name: "btn-segment" },
    ]}
    description="Input-shaped buttons match fields (raised + press). `btn-input-recessed` is the recessed sibling for inline select/dropdown/picker triggers — give the value `flex-1` so the chevron sits right. Segment buttons match `SegmentedControl` in compact toolbars."
    code={`<button class="btn-input btn-input-sm">Default</button>
<button class="btn-input-primary btn-input-sm">Primary</button>
<button class="btn-input-success btn-input-sm">Success</button>

<!-- recessed trigger (select/dropdown/picker) -->
<button class="btn-input-recessed btn-input-sm w-40 gap-2">
  <i class="ti ti-flag" />
  <span class="flex-1 truncate text-left">Priority</span>
  <i class="ti ti-chevron-down text-xs" />
</button>

<button class="btn-segment">Today</button>
<button class="btn-segment-icon" aria-label="Previous">
  <i class="ti ti-chevron-left" />
</button>`}
  >
    <div class="flex items-center gap-2">
      <button type="button" class="btn-input btn-input-sm">
        <i class="ti ti-search" />
        Search
      </button>
      <button type="button" class="btn-input-primary btn-input-sm">
        <i class="ti ti-plus" />
        New item
      </button>
      <button type="button" class="btn-input-success btn-input-sm">
        <i class="ti ti-check" />
        Done
      </button>
      <button type="button" class="btn-input-recessed btn-input-sm w-40 gap-2">
        <i class="ti ti-flag" />
        <span class="flex-1 truncate text-left">Priority</span>
        <i class="ti ti-chevron-down text-xs" />
      </button>
      <button type="button" class="btn-segment">
        Today
      </button>
      <button type="button" class="btn-segment-icon" aria-label="Previous">
        <i class="ti ti-chevron-left" />
      </button>
    </div>
  </DemoCard>
);

export const IconButtons = () => (
  <DemoCard
    id="icon-btn"
    chip={[
      { kind: "utility", name: "icon-btn" },
      { kind: "component", name: "Tooltip", from: FROM_UI },
    ]}
    description="Square 32×32 icon-only action. Keep the accessible name on the button and use Tooltip only to make an unfamiliar icon discoverable."
    code={`<Tooltip content="Settings">
  <button class="icon-btn" aria-label="Settings">
    <i class="ti ti-settings" />
  </button>
</Tooltip>`}
  >
    <div class="flex items-center gap-2">
      <Tooltip content="Settings">
        <button type="button" class="icon-btn" aria-label="Settings">
          <i class="ti ti-settings" />
        </button>
      </Tooltip>
      <Tooltip content="Add to favorites">
        <button type="button" class="icon-btn" aria-label="Add to favorites">
          <i class="ti ti-star" />
        </button>
      </Tooltip>
      <Tooltip content="More actions">
        <button type="button" class="icon-btn" aria-label="More actions">
          <i class="ti ti-dots" />
        </button>
      </Tooltip>
    </div>
  </DemoCard>
);

export const IconButtonsActive = () => {
  const [view, setView] = createSignal<"grid" | "list">("grid");
  return (
    <DemoCard
      id="icon-btn-active"
      chip={{ kind: "utility", name: "icon-btn" }}
      variant="active state via aria-pressed"
      description="Set `aria-pressed='true'` to mark the icon-btn as currently active — blue tint + faint background. Pairs cleanly with toolbar / view-switch toggles."
      code={`<button class="icon-btn" aria-pressed={view() === "grid"} onClick={...}>
  <i class="ti ti-layout-grid" />
</button>
<button class="icon-btn" aria-pressed={view() === "list"} onClick={...}>
  <i class="ti ti-list" />
</button>`}
    >
      <div class="flex items-center gap-1">
        <button
          type="button"
          class="icon-btn"
          aria-pressed={view() === "grid" ? "true" : "false"}
          aria-label="Grid view"
          onClick={() => setView("grid")}
        >
          <i class="ti ti-layout-grid" />
        </button>
        <button
          type="button"
          class="icon-btn"
          aria-pressed={view() === "list" ? "true" : "false"}
          aria-label="List view"
          onClick={() => setView("list")}
        >
          <i class="ti ti-list" />
        </button>
        <span class="text-xs text-dimmed ml-2">current: {view()}</span>
      </div>
    </DemoCard>
  );
};

export const ButtonsWithIcons = () => (
  <DemoCard
    id="btn-icons"
    chip={{ kind: "utility", name: "btn-primary" }}
    variant="with leading / trailing icons"
    code={`<button class="btn-primary btn-sm">
  <i class="ti ti-cloud-upload" />
  Upload
</button>`}
  >
    <div class="flex items-center gap-2 flex-wrap">
      <button type="button" class="btn-primary btn-sm">
        <i class="ti ti-cloud-upload" />
        Upload
      </button>
      <button type="button" class="btn-secondary btn-sm">
        Continue
        <i class="ti ti-arrow-right" />
      </button>
      <button type="button" class="btn-danger btn-sm">
        <i class="ti ti-trash" />
        Delete
      </button>
    </div>
  </DemoCard>
);

export const CopyButtonDemo = () => (
  <DemoCard
    id="copybutton"
    chip={{ kind: "component", name: "CopyButton", from: FROM_UI }}
    description="Copies its text to clipboard, flashes a checkmark for ~2s."
    code={`<CopyButton text="hello@example.com" label="Copy email" />`}
  >
    <div class="flex items-center gap-2 flex-wrap">
      <CopyButton text="hello@example.com" label="Copy email" />
      <CopyButton text="ssh user@host" label="Copy SSH command" />
      <CopyButton text="some token" />
    </div>
  </DemoCard>
);

export const RemoveBtnDemo = () => {
  const [count, setCount] = createSignal(0);
  return (
    <DemoCard
      id="removebtn"
      chip={{ kind: "component", name: "RemoveBtn", from: FROM_UI }}
      description="Standardised destructive icon-button — hover paints red, click fires the handler."
      code={`<RemoveBtn ariaLabel="Remove item" onClick={() => setCount(c => c + 1)} />`}
    >
      <div class="flex items-center gap-3">
        <RemoveBtn ariaLabel="Remove item" onClick={() => setCount((c) => c + 1)} />
        <span class="text-xs text-dimmed">clicked {count()}×</span>
      </div>
    </DemoCard>
  );
};

export const DropdownDemo = () => {
  const [last, setLast] = createSignal<string | null>(null);
  const items: DropdownItem[] = [
    { label: "Edit", icon: "ti ti-pencil", action: () => setLast("edit") },
    { label: "Duplicate", icon: "ti ti-copy", action: () => setLast("duplicate") },
    { label: "Archive", icon: "ti ti-archive", action: () => setLast("archive") },
    { label: "Delete", icon: "ti ti-trash", variant: "danger", action: () => setLast("delete") },
  ];
  return (
    <DemoCard
      id="dropdown"
      chip={{ kind: "component", name: "Dropdown", from: FROM_UI }}
      description="Click trigger to open a list of items. Supports icons, danger variant, sections, and arbitrary JSX elements."
      code={`<Dropdown
  trigger={<div class="btn-simple btn-sm"><i class="ti ti-dots" /> Actions</div>}
  elements={[
    { label: "Edit", icon: "ti ti-pencil", action: () => ... },
    { label: "Delete", icon: "ti ti-trash", variant: "danger", action: () => ... },
  ]}
/>`}
    >
      <div class="flex items-center gap-3">
        <Dropdown
          trigger={
            <div class="btn-simple btn-sm">
              <i class="ti ti-dots" />
              <span>Actions</span>
            </div>
          }
          elements={items}
        />
        <span class="text-xs text-dimmed">{last() ? `clicked: ${last()}` : "—"}</span>
      </div>
    </DemoCard>
  );
};

export const ContextMenuDemo = () => {
  const [last, setLast] = createSignal<string | null>(null);
  return (
    <DemoCard
      id="contextmenu"
      chip={{ kind: "component", name: "ContextMenu", from: FROM_UI }}
      description="Wraps any element so right-click opens a Dropdown-style menu at the cursor."
      code={`<ContextMenu
  elements={[
    { label: "Open", icon: "ti ti-external-link", action: () => ... },
    { label: "Delete", icon: "ti ti-trash", variant: "danger", action: () => ... },
  ]}
>
  <div class="paper p-4">Right-click me</div>
</ContextMenu>`}
    >
      <div class="flex items-center gap-3">
        <ContextMenu
          elements={[
            { label: "Open", icon: "ti ti-external-link", action: () => setLast("open") },
            { label: "Rename", icon: "ti ti-pencil", action: () => setLast("rename") },
            { label: "Delete", icon: "ti ti-trash", variant: "danger", action: () => setLast("delete") },
          ]}
        >
          <div class="paper p-3 select-none cursor-context-menu text-sm">Right-click me</div>
        </ContextMenu>
        <span class="text-xs text-dimmed">{last() ? `clicked: ${last()}` : "—"}</span>
      </div>
    </DemoCard>
  );
};

export const SegmentedControlDemo = () => {
  const [v, setV] = createSignal<"list" | "board" | "calendar">("board");
  return (
    <DemoCard
      id="segmentedcontrol"
      chip={{ kind: "component", name: "SegmentedControl", from: FROM_UI }}
      description="A row of mutually-exclusive options styled like a single button. Use for view-mode switches and toolbar mode toggles where a `<Select>` would feel heavyweight."
      code={`<SegmentedControl<"list" | "board" | "calendar">
  options={[
    { value: "list", label: "List", icon: "ti ti-list" },
    { value: "board", label: "Board", icon: "ti ti-layout-board" },
    { value: "calendar", label: "Calendar", icon: "ti ti-calendar" },
  ]}
  value={v}
  onChange={setV}
/>`}
    >
      <SegmentedControl<"list" | "board" | "calendar">
        options={[
          { value: "list", label: "List", icon: "ti ti-list" },
          { value: "board", label: "Board", icon: "ti ti-layout-board" },
          { value: "calendar", label: "Calendar", icon: "ti ti-calendar" },
        ]}
        value={v}
        onChange={setV}
      />
    </DemoCard>
  );
};

export const ButtonsTab = () => (
  <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
    <ButtonSizes />
    <ButtonVariants />
    <AiButtonMarkers />
    <ButtonInputs />
    <IconButtons />
    <IconButtonsActive />
    <ButtonsWithIcons />
    <SegmentedControlDemo />
    <CopyButtonDemo />
    <RemoveBtnDemo />
    <DropdownDemo />
    <ContextMenuDemo />
  </div>
);
