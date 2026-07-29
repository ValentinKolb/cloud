import {
  Button,
  ContextMenu,
  CopyButton,
  Dropdown,
  FilterChip,
  IconButton,
  openSpotlightSearch,
  RemoveButton,
  SegmentedControl,
  SpotlightButton,
  type SpotlightSearchResolver,
} from "@k2b/ui";
import { createSignal } from "solid-js";
import { DemoCard } from "../DemoCard";
import { DemoGrid, type DemoSection } from "./types";

const ButtonsDemo = () => (
  <DemoCard
    id="buttons"
    chip={[
      { kind: "component", name: "Button", from: "@k2b/ui" },
      { kind: "component", name: "IconButton", from: "@k2b/ui" },
    ]}
    description="Package-native foundations for new portable interfaces; these are additive @k2b/ui components, not migrations of Cloud Button components. Button defaults to primary, IconButton defaults to ghost."
    code={`<Button variant="primary">Save</Button>
<Button variant="danger" size="sm">Delete</Button>

{/* IconButton defaults to variant="ghost" */}
<IconButton label="Settings">
  <i class="ti ti-settings" />
</IconButton>
<IconButton label="Delete" variant="danger">
  <i class="ti ti-trash" />
</IconButton>`}
  >
    <div class="ui-demo-row">
      <Button variant="primary">Save</Button>
      <Button variant="secondary">Preview</Button>
      <Button variant="ghost">Later</Button>
      <Button variant="danger" size="sm">Delete</Button>
      <Button loading loadingLabel="Saving">Save</Button>
      <Button disabled>Disabled</Button>
    </div>
    <div class="ui-demo-row">
      <IconButton label="Settings"><i class="ti ti-settings" aria-hidden="true" /></IconButton>
      <IconButton label="Publish" variant="primary"><i class="ti ti-rocket" aria-hidden="true" /></IconButton>
      <IconButton label="Refresh" variant="secondary"><i class="ti ti-refresh" aria-hidden="true" /></IconButton>
      <IconButton label="Delete" variant="danger"><i class="ti ti-trash" aria-hidden="true" /></IconButton>
      <IconButton label="Saving" loading loadingLabel="Saving"><i class="ti ti-device-floppy" aria-hidden="true" /></IconButton>
    </div>
  </DemoCard>
);

const CopyRemoveDemo = () => {
  const [status, setStatus] = createSignal("No copy attempted");
  return (
    <DemoCard
      id="copy-remove"
      chip={[
        { kind: "component", name: "CopyButton", from: "@k2b/ui" },
        { kind: "component", name: "RemoveButton", from: "@k2b/ui" },
      ]}
      description="Neutral copy actions report success or failure while preserving rejected clipboard promises; remove actions keep their accessible target label."
      code={`const [status, setStatus] = createSignal("");

<CopyButton
  text="hello"
  label="Copy value"
  onCopied={() => setStatus("Copied")}
  onCopyError={() => setStatus("Copy failed")}
/>
<RemoveButton
  ariaLabel="Remove attachment"
  onClick={() => setStatus("Remove requested")}
/>`}
    >
      <div class="ui-demo-row">
        <CopyButton
          text="hello"
          label="Copy value"
          onCopied={() => setStatus("Copied successfully")}
          onCopyError={() => setStatus("Clipboard write failed")}
        />
        <CopyButton
          text="secret"
          onCopied={() => setStatus("Copied successfully")}
          onCopyError={() => setStatus("Clipboard write failed")}
        />
        <RemoveButton ariaLabel="Remove attachment" onClick={() => setStatus("Remove requested")} />
        <span aria-live="polite">{status()}</span>
      </div>
    </DemoCard>
  );
};

const MenusDemo = () => (
  <DemoCard
    id="menus"
    chip={[
      { kind: "component", name: "Dropdown", from: "@k2b/ui" },
      { kind: "component", name: "ContextMenu", from: "@k2b/ui" },
    ]}
    description="Top-layer menus with keyboard navigation, focus restoration, viewport clamping, and light dismiss. `width` is a CSS length, not a class name, and defaults to 12rem."
    code={`<Dropdown
  trigger={<Button variant="secondary">Actions</Button>}
  elements={[{ label: "Duplicate", action: duplicate }]}
/>

{/* width is a CSS length */}
<Dropdown width="18rem" position="bottom-left" trigger={…} elements={…} />

<ContextMenu items={items}><div>Right click</div></ContextMenu>`}
  >
    <div class="ui-demo-row">
      <Dropdown
        trigger={<Button variant="secondary">Actions</Button>}
        elements={[
          { label: "Duplicate", icon: "ti ti-copy", action: () => {} },
          { label: "Archive", icon: "ti ti-archive", action: () => {} },
          { label: "Delete", icon: "ti ti-trash", variant: "danger", action: () => {} },
        ]}
      />
      <Dropdown
        width="18rem"
        position="bottom-left"
        trigger={<Button variant="secondary">Wide menu (18rem)</Button>}
        elements={[
          { label: "Export every record as CSV", icon: "ti ti-file-export", action: () => {} },
          { label: "Recalculate derived columns", icon: "ti ti-refresh", action: () => {} },
        ]}
      />
      <ContextMenu
        label="Record actions"
        items={[
          { id: "open", label: "Open", icon: "ti ti-external-link", onSelect: () => {} },
          { id: "remove", label: "Remove", icon: "ti ti-trash", danger: true, onSelect: () => {} },
        ]}
      >
        <div class="ui-demo-context-target">Right click or press Shift+F10</div>
      </ContextMenu>
    </div>
  </DemoCard>
);

const SegmentedDemo = () => {
  const [value, setValue] = createSignal("week");
  return (
    <DemoCard
      id="segmented"
      chip={{ kind: "component", name: "SegmentedControl", from: "@k2b/ui" }}
      description="A full-width controlled radio group with dividers, wrapping arrow-key selection, Home/End navigation, and roving focus."
      code={`<SegmentedControl
  value={view}
  onValueChange={setView}
  options={[{ value: "day", label: "Day" }, ...]}
/>`}
    >
      <SegmentedControl
        value={value}
        onValueChange={setValue}
        ariaLabel="Calendar view"
        options={[
          { value: "day", label: "Day", icon: "ti ti-calendar" },
          { value: "week", label: "Week", icon: "ti ti-calendar-week" },
          { value: "month", label: "Month", icon: "ti ti-calendar-month" },
        ]}
      />
    </DemoCard>
  );
};

export const FilterDemo = () => {
  const [clearValue, setClearValue] = createSignal<string[]>(["open", "ui"]);
  const [resetValue, setResetValue] = createSignal<string[]>(["done"]);
  const sections = [
    { label: "State", options: [{ value: "open", label: "Open" }, { value: "done", label: "Done" }] },
    {
      label: "Tags",
      multiple: true,
      options: [{ value: "ui", label: "UI", color: "#06b6d4" }, { value: "api", label: "API", color: "#8b5cf6" }],
    },
  ];
  return (
    <DemoCard
      id="filters"
      chip={{ kind: "component", name: "FilterChip", from: "@k2b/ui" }}
      description="Clear mode shows the selected count; a non-empty baseline hides the count and offers Reset when the selection differs."
      code={`<FilterChip
  label="Clear mode"
  icon="ti ti-filter"
  value={clearValue()}
  onValueChange={setClearValue}
  defaultValue={[]}
  options={sections}
/>

<FilterChip
  label="Baseline"
  icon="ti ti-filter"
  value={resetValue()}
  onValueChange={setResetValue}
  defaultValue={["open"]}
  options={sections}
/>`}
    >
      <div class="ui-demo-row">
        <FilterChip
          label="Clear mode"
          icon="ti ti-filter"
          value={clearValue()}
          onValueChange={setClearValue}
          defaultValue={[]}
          options={sections}
        />
        <FilterChip
          label="Baseline"
          icon="ti ti-filter"
          value={resetValue()}
          onValueChange={setResetValue}
          defaultValue={["open"]}
          options={sections}
        />
      </div>
    </DemoCard>
  );
};

const spotlightProjects = [
  { label: "Atlas", desc: "Customer portal", value: "atlas" },
  { label: "Beacon", desc: "Operations dashboard", value: "beacon" },
  { label: "Cedar", desc: "Documentation site", value: "cedar" },
];

const resolveSpotlightProjects: SpotlightSearchResolver<string> = ({ query }) => {
  const normalizedQuery = query.trim().toLowerCase();
  return spotlightProjects.filter((project) =>
    `${project.label} ${project.desc}`.toLowerCase().includes(normalizedQuery),
  );
};

const openSearch = async () => {
  await openSpotlightSearch<string>({
    title: "Open project",
    placeholder: "Search projects...",
    noResultsText: "No matching projects.",
    resolve: resolveSpotlightProjects,
  });
};

const SpotlightDemo = () => (
  <DemoCard
    id="spotlight"
    chip={{ kind: "component", name: "SpotlightButton", from: "@k2b/ui" }}
    description="Search launchers keep one shortcut contract while adapting to buttons, chips, sidebars, mobile navigation, and icon-only toolbars."
    code={`import {
  openSpotlightSearch,
  SpotlightButton,
  type SpotlightSearchResolver,
} from "@k2b/ui";

const spotlightProjects = [
  { label: "Atlas", desc: "Customer portal", value: "atlas" },
  { label: "Beacon", desc: "Operations dashboard", value: "beacon" },
  { label: "Cedar", desc: "Documentation site", value: "cedar" },
];

const resolveSpotlightProjects: SpotlightSearchResolver<string> = ({ query }) => {
  const normalizedQuery = query.trim().toLowerCase();
  return spotlightProjects.filter((project) =>
    \`\${project.label} \${project.desc}\`.toLowerCase().includes(normalizedQuery),
  );
};

const openSearch = async () => {
  await openSpotlightSearch<string>({
    title: "Open project",
    placeholder: "Search projects...",
    noResultsText: "No matching projects.",
    resolve: resolveSpotlightProjects,
  });
};

<div class="ui-demo-row">
  <SpotlightButton variant="default" onClick={openSearch} />
  <SpotlightButton variant="chip" onClick={openSearch} />
  <SpotlightButton variant="sidebar" onClick={openSearch} />
  <SpotlightButton variant="sidebar-mobile" onClick={openSearch} />
  <SpotlightButton variant="compact" onClick={openSearch} />
  <SpotlightButton variant="icon" onClick={openSearch} />
</div>`}
  >
    <div class="ui-demo-row">
      <SpotlightButton variant="default" onClick={openSearch} />
      <SpotlightButton variant="chip" onClick={openSearch} />
      <SpotlightButton variant="sidebar" onClick={openSearch} />
      <SpotlightButton variant="sidebar-mobile" onClick={openSearch} />
      <SpotlightButton variant="compact" onClick={openSearch} />
      <SpotlightButton variant="icon" onClick={openSearch} />
    </div>
  </DemoCard>
);

const demos: DemoSection = {
  buttons: () => <DemoGrid columns="one"><ButtonsDemo /><SpotlightDemo /></DemoGrid>,
  "copy-remove": () => <DemoGrid columns="one"><CopyRemoveDemo /></DemoGrid>,
  menus: () => <DemoGrid columns="one"><MenusDemo /></DemoGrid>,
  "segmented-control": () => <DemoGrid columns="one"><SegmentedDemo /></DemoGrid>,
};

export default demos;
