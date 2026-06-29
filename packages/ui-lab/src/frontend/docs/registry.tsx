import type { DockWorkspaceState } from "@valentinkolb/cloud/ui";
import type { JSX } from "solid-js";
import { AiChatBlocksDemo, AiComposerDemo } from "../lab/ai";
import {
  AiButtonMarkers,
  ButtonInputs,
  ButtonSizes,
  ButtonsWithIcons,
  ButtonVariants,
  ContextMenuDemo,
  CopyButtonDemo,
  DropdownDemo,
  IconButtons,
  IconButtonsActive,
  RemoveBtnDemo,
  SegmentedControlDemo,
} from "../lab/buttons";
import {
  CalendarAllDayStressDemo,
  CalendarDayDemo,
  CalendarMobileDemo,
  CalendarMonthDemo,
  CalendarOverlapDemo,
  CalendarScheduleDemo,
  CalendarYearDemo,
} from "../lab/calendar";
import {
  ChartBar,
  ChartDonut,
  ChartEmpty,
  ChartLine,
  ChartLive,
  ChartSparkline,
  CodeDisplayDemo,
  DataTableAdminPatternDemo,
  DataTableFullDemo,
  DataTableMinimalDemo,
  LightboxDemo,
  LogEntriesTableDemo,
  MarkdownEditorFullDemo,
  MarkdownViewDemo,
  PdfPreviewDemo,
  StructuredDataPreviewDemo,
} from "../lab/content";
import { DocCodeDemo, DocComponentsDemo } from "../lab/docs-components";
import {
  BadgesDemo,
  ChipsDemo,
  DialogHeaderDemo,
  InfoBlocks,
  PromptAlertDemo,
  PromptBareModalDemo,
  PromptConfirmDemo,
  PromptCustomDialogDemo,
  PromptErrorDemo,
  PromptFormDemo,
  PromptSearchDemo,
  PromptSizesDemo,
  PromptWorkflowFormDemo,
  SpotlightSearchDemo,
  StatusDotsDemo,
  TagsDemo,
  ToastDemo,
} from "../lab/feedback";
import {
  AutocompleteEditorAsync,
  AutocompleteEditorFormula,
  AutocompleteEditorMentions,
  AutocompleteEditorSingleLine,
  CheckboxCardDemo,
  CheckboxDemo,
  ColorInputDemo,
  ComboboxDemo,
  DateInputDemo,
  DatePickerDemo,
  DatePickerPlainDemo,
  DateRangePickerDemo,
  DateRangePickerWithTimeDemo,
  DateTimeInputDemo,
  DateTimePickerDemo,
  FileDropzoneAcceptDemo,
  FileDropzoneDemo,
  IconInputDemo,
  ImageInputDemo,
  MarkdownEditorStandalone,
  MultiSelectInputDemo,
  NumberInputBasic,
  NumberInputCurrency,
  NumberInputPercent,
  PinInputDemo,
  SelectBasic,
  SelectChipDemo,
  SelectFetchData,
  SliderDemo,
  SwitchDemo,
  TagsInputDemo,
  TextInputAi,
  TextInputBasic,
  TextInputClearable,
  TextInputError,
  TextInputMarkdown,
  TextInputMarkdownCompletions,
  TextInputPassword,
  TextInputWithIcon,
} from "../lab/inputs";
import {
  AppOverviewDemo,
  AppWorkspaceDemo,
  DockWorkspaceDemo,
  EntitySearchDemo,
  FilterChipDemo,
  NavigationEnhancementDemo,
  PaginationDemo,
  PanelDialogDemo,
  PanesDemo,
  PanesProgrammaticTabsDemo,
  PermissionEditorDemo,
  ResourceApiKeysDemo,
  SettingsHelpersDemo,
  SettingsModalDemo,
} from "../lab/navigation";
import {
  AvatarDemo,
  CoreUtilityPatternsDemo,
  LinkCardDemo,
  PaperUtility,
  PlaceholderDemo,
  ProgressBarDemo,
  StatCellDemo,
  StatGridDemo,
  StatHeroGridDemo,
  ThumbnailUtility,
  WidgetAdminQueueDemo,
  WidgetHeroDemo,
  WidgetRecentNotesDemo,
  WidgetServiceStatesDemo,
} from "../lab/surfaces-cards";
import { TemplateEditorDemo } from "../lab/template-editor";

export type UiLabDocRenderProps = {
  markdownHtml: string;
  dockWorkspaceInitialState?: DockWorkspaceState | null;
};

export type UiLabDocPage = {
  section: string;
  slug: string;
  title: string;
  icon: string;
  summary: string;
  demoIds: string[];
  kind?: "component" | "utility" | "pattern" | "foundation";
  aliases?: string[];
  tags?: string[];
  exports?: string[];
  source?: string;
  render: (props: UiLabDocRenderProps) => JSX.Element;
};

export type UiLabSearchEntry = {
  id: string;
  page: UiLabDocPage;
  anchor?: string;
  label: string;
  description: string;
  icon: string;
  kind: "page" | "demo";
  keywords: string;
};

export type UiLabDocSection = {
  id: string;
  title: string;
  icon: string;
  pages: UiLabDocPage[];
};

const DemoGrid = (props: { children: JSX.Element; columns?: "one" | "two" }) => (
  <div class={props.columns === "one" ? "grid grid-cols-1 gap-3" : "grid grid-cols-1 gap-3 xl:grid-cols-2"}>{props.children}</div>
);

const page = (
  section: string,
  slug: string,
  title: string,
  icon: string,
  summary: string,
  demoIds: string[],
  render: (props: UiLabDocRenderProps) => JSX.Element,
  meta: Partial<Pick<UiLabDocPage, "kind" | "aliases" | "tags" | "exports" | "source">> = {},
): UiLabDocPage => ({ section, slug, title, icon, summary, demoIds, render, ...meta });

export const uiLabDocs: UiLabDocSection[] = [
  {
    id: "ai",
    title: "AI",
    icon: "ti ti-sparkles",
    pages: [
      page(
        "ai",
        "chat-blocks",
        "Chat Blocks",
        "ti ti-sparkles",
        "Reusable Cloud AI message blocks for Assistant and app-specific chats.",
        ["ai-chat-blocks", "ai-composer"],
        () => (
          <DemoGrid columns="one">
            <AiChatBlocksDemo />
            <AiComposerDemo />
          </DemoGrid>
        ),
      ),
    ],
  },
  {
    id: "input",
    title: "Inputs",
    icon: "ti ti-forms",
    pages: [
      page(
        "input",
        "text",
        "TextInput",
        "ti ti-forms",
        "Single-line, password, error, clearable, and markdown field modes.",
        [
          "textinput-basic",
          "textinput-icon",
          "textinput-ai",
          "textinput-clearable",
          "textinput-error",
          "textinput-password",
          "textinput-markdown",
          "textinput-markdown-completions",
        ],
        () => (
          <DemoGrid>
            <TextInputBasic />
            <TextInputWithIcon />
            <TextInputAi />
            <TextInputClearable />
            <TextInputError />
            <TextInputPassword />
            <TextInputMarkdown />
            <TextInputMarkdownCompletions />
          </DemoGrid>
        ),
      ),
      page(
        "input",
        "markdown-editor",
        "MarkdownEditor",
        "ti ti-markdown",
        "Standalone markdown editor surfaces for full-page or composer use.",
        ["markdowneditor-standalone"],
        () => (
          <DemoGrid columns="one">
            <MarkdownEditorStandalone />
          </DemoGrid>
        ),
      ),
      page(
        "input",
        "autocomplete",
        "AutocompleteEditor",
        "ti ti-sparkles",
        "Mention, formula, async, and single-line completion patterns.",
        ["autocomplete-mentions", "autocomplete-formula", "autocomplete-async", "autocomplete-singleline"],
        () => (
          <DemoGrid columns="one">
            <AutocompleteEditorMentions />
            <AutocompleteEditorFormula />
            <AutocompleteEditorAsync />
            <AutocompleteEditorSingleLine />
          </DemoGrid>
        ),
      ),
      page(
        "input",
        "number",
        "NumberInput",
        "ti ti-number",
        "Numeric fields, percent controls, and currency-style examples.",
        ["numberinput-basic", "numberinput-percent", "numberinput-currency"],
        () => (
          <DemoGrid>
            <NumberInputBasic />
            <NumberInputPercent />
            <NumberInputCurrency />
          </DemoGrid>
        ),
      ),
      page(
        "input",
        "date-picker",
        "Date Pickers",
        "ti ti-calendar",
        "Popover date, date-time, and range pickers with caller-owned presets and timezone-aware output.",
        ["datepicker-basic", "datepicker-plain", "datetimepicker-basic", "daterangepicker-basic", "daterangepicker-time"],
        () => (
          <DemoGrid>
            <DatePickerDemo />
            <DatePickerPlainDemo />
            <DateTimePickerDemo />
            <DateRangePickerDemo />
            <DateRangePickerWithTimeDemo />
          </DemoGrid>
        ),
      ),
      page(
        "input",
        "date-time",
        "DateTimeInput (deprecated)",
        "ti ti-alert-triangle",
        "Deprecated native date input wrapper kept for compatibility. Prefer DatePicker and DateTimePicker.",
        ["datetimeinput-basic", "datetimeinput-date-only"],
        () => (
          <DemoGrid>
            <DateTimeInputDemo />
            <DateInputDemo />
          </DemoGrid>
        ),
      ),
      page(
        "input",
        "select",
        "Select",
        "ti ti-selector",
        "Static options and async fetchData selects.",
        ["select-basic", "select-fetchdata", "selectchip", "multiselectinput"],
        () => (
          <DemoGrid>
            <SelectBasic />
            <SelectFetchData />
            <SelectChipDemo />
            <MultiSelectInputDemo />
          </DemoGrid>
        ),
        { aliases: ["SelectInput", "MultiSelect"] },
      ),
      page("input", "combobox", "Combobox", "ti ti-list-search", "Free-text choice with option suggestions.", ["combobox"], () => (
        <DemoGrid>
          <ComboboxDemo />
        </DemoGrid>
      )),
      page("input", "color", "ColorInput", "ti ti-palette", "Color picker input with platform styling.", ["colorinput"], () => (
        <DemoGrid>
          <ColorInputDemo />
        </DemoGrid>
      )),
      page("input", "tags", "TagsInput", "ti ti-tags", "Tokenized text input for adding and removing tags.", ["tagsinput"], () => (
        <DemoGrid>
          <TagsInputDemo />
        </DemoGrid>
      )),
      page("input", "pin", "PinInput", "ti ti-password", "Segmented short-code input for PIN and verification flows.", ["pininput"], () => (
        <DemoGrid>
          <PinInputDemo />
        </DemoGrid>
      )),
      page("input", "image", "ImageInput", "ti ti-photo", "Image upload and preview input.", ["imageinput"], () => (
        <DemoGrid>
          <ImageInputDemo />
        </DemoGrid>
      )),
      page(
        "input",
        "file-dropzone",
        "FileDropzone",
        "ti ti-cloud-upload",
        "Shared file picker and drag-drop surface for upload flows.",
        ["filedropzone-basic", "filedropzone-accept"],
        () => (
          <DemoGrid>
            <FileDropzoneDemo />
            <FileDropzoneAcceptDemo />
          </DemoGrid>
        ),
      ),
      page("input", "icon", "IconInput", "ti ti-icons", "Tabler icon picker input.", ["iconinput"], () => (
        <DemoGrid>
          <IconInputDemo />
        </DemoGrid>
      )),
      page(
        "input",
        "slider",
        "Slider",
        "ti ti-adjustments-horizontal",
        "Range slider input for bounded numeric values.",
        ["slider"],
        () => (
          <DemoGrid>
            <SliderDemo />
          </DemoGrid>
        ),
      ),
      page(
        "input",
        "filters",
        "FilterChip",
        "ti ti-filter",
        "Compact dropdown filters with single and multi-select sections.",
        ["filterchip"],
        () => (
          <DemoGrid>
            <FilterChipDemo />
          </DemoGrid>
        ),
      ),
      page(
        "input",
        "boolean",
        "Boolean Inputs",
        "ti ti-toggle-right",
        "Switches, checkboxes, and richer checkbox cards.",
        ["switch", "checkbox", "checkbox-card"],
        () => (
          <DemoGrid>
            <SwitchDemo />
            <CheckboxDemo />
            <CheckboxCardDemo />
          </DemoGrid>
        ),
        { aliases: ["SwitchInput", "CheckboxInput", "CheckboxCardInput"] },
      ),
    ],
  },
  {
    id: "actions",
    title: "Actions",
    icon: "ti ti-click",
    pages: [
      page(
        "actions",
        "buttons",
        "Button Utilities",
        "ti ti-square-rounded",
        "Button sizes, tones, input-style buttons, icon buttons, and icon composition.",
        ["btn-sizes", "btn-variants", "ai-buttons", "btn-input", "icon-btn", "icon-btn-active", "btn-icons"],
        () => (
          <DemoGrid>
            <ButtonSizes />
            <ButtonVariants />
            <AiButtonMarkers />
            <ButtonInputs />
            <IconButtons />
            <IconButtonsActive />
            <ButtonsWithIcons />
          </DemoGrid>
        ),
      ),
      page("actions", "copy-remove", "Copy & Remove", "ti ti-copy", "Small focused action components.", ["copybutton", "removebtn"], () => (
        <DemoGrid>
          <CopyButtonDemo />
          <RemoveBtnDemo />
        </DemoGrid>
      )),
      page("actions", "menus", "Menus", "ti ti-menu-2", "Dropdown and context-menu action surfaces.", ["dropdown", "contextmenu"], () => (
        <DemoGrid>
          <DropdownDemo />
          <ContextMenuDemo />
        </DemoGrid>
      )),
      page(
        "actions",
        "segmented-control",
        "SegmentedControl",
        "ti ti-layout-navbar",
        "Compact mutually exclusive mode control.",
        ["segmentedcontrol"],
        () => (
          <DemoGrid>
            <SegmentedControlDemo />
          </DemoGrid>
        ),
      ),
    ],
  },
  {
    id: "layout",
    title: "Layout",
    icon: "ti ti-layout",
    pages: [
      page(
        "layout",
        "workspace",
        "AppWorkspace",
        "ti ti-layout-sidebar",
        "Compound shell for app screens with sidebar, main content, and detail panel.",
        ["sidebarlayout"],
        () => (
          <DemoGrid columns="one">
            <AppWorkspaceDemo />
          </DemoGrid>
        ),
      ),
      page(
        "layout",
        "panes",
        "Panes",
        "ti ti-layout-kanban",
        "Controlled split-pane primitive with resize rails, movable tabs, and edge split drops.",
        ["panes"],
        () => (
          <DemoGrid columns="one">
            <PanesDemo />
            <PanesProgrammaticTabsDemo />
          </DemoGrid>
        ),
      ),
      page(
        "layout",
        "dock-workspace",
        "DockWorkspace (deprecated)",
        "ti ti-layout-dashboard",
        "Deprecated legacy result plus docked pane shell. Use Panes for new resizable, tabbed workspaces.",
        ["dockworkspace"],
        (props) => (
          <DemoGrid columns="one">
            <DockWorkspaceDemo initialState={props.dockWorkspaceInitialState} />
          </DemoGrid>
        ),
      ),
      page(
        "layout",
        "overview",
        "AppOverview",
        "ti ti-layout-dashboard",
        "Generic overview-page shell with main and aside panels.",
        ["appoverview"],
        () => (
          <DemoGrid columns="one">
            <AppOverviewDemo />
          </DemoGrid>
        ),
      ),
      page(
        "layout",
        "settings-modal",
        "Settings",
        "ti ti-settings",
        "Tabbed settings shell and field/save helpers for app settings flows.",
        ["settingsmodal", "settings-helpers"],
        () => (
          <DemoGrid columns="one">
            <SettingsModalDemo />
            <SettingsHelpersDemo />
          </DemoGrid>
        ),
      ),
      page(
        "layout",
        "panel-dialog",
        "PanelDialog",
        "ti ti-pencil",
        "Layout-only dialog shell for complex editors with contained and floating settings surfaces.",
        ["paneldialog"],
        () => (
          <DemoGrid columns="one">
            <PanelDialogDemo />
          </DemoGrid>
        ),
      ),
      page(
        "layout",
        "permissions",
        "Access Controls",
        "ti ti-users-group",
        "Access editor, principal search, and resource-bound API key management.",
        ["permissioneditor", "entity-search", "resource-api-keys"],
        () => (
          <DemoGrid columns="one">
            <PermissionEditorDemo />
            <EntitySearchDemo />
            <ResourceApiKeysDemo />
          </DemoGrid>
        ),
      ),
      page(
        "layout",
        "navigation",
        "Navigation",
        "ti ti-route",
        "Progressive navigation helpers and scroll-preserved regions.",
        ["navigation-enhancement"],
        () => (
          <DemoGrid>
            <NavigationEnhancementDemo />
          </DemoGrid>
        ),
      ),
      page(
        "layout",
        "pagination",
        "Pagination",
        "ti ti-arrows-right-left",
        "HREF-based pagination component for SSR list pages.",
        ["pagination"],
        () => (
          <DemoGrid>
            <PaginationDemo />
          </DemoGrid>
        ),
      ),
    ],
  },
  {
    id: "surfaces",
    title: "Surfaces",
    icon: "ti ti-stack",
    pages: [
      page(
        "surfaces",
        "utilities",
        "Surface Utilities",
        "ti ti-border-all",
        "Shared paper, thumbnail, placeholder, detail, app layout, and popover utilities.",
        ["paper", "thumbnail", "placeholder", "core-utility-patterns"],
        () => (
          <DemoGrid>
            <PaperUtility />
            <ThumbnailUtility />
            <PlaceholderDemo />
            <CoreUtilityPatternsDemo />
          </DemoGrid>
        ),
      ),
      page(
        "surfaces",
        "cards",
        "Cards & Identity",
        "ti ti-id",
        "Link cards, progress bars, and avatars.",
        ["linkcard", "progressbar", "avatar"],
        () => (
          <DemoGrid>
            <LinkCardDemo />
            <ProgressBarDemo />
            <AvatarDemo />
          </DemoGrid>
        ),
      ),
      page(
        "surfaces",
        "stats",
        "Stats",
        "ti ti-chart-dots",
        "Stat cells and stat grids for compact dashboards.",
        ["statcell", "statgrid", "stat-hero-grid"],
        () => (
          <DemoGrid columns="one">
            <StatCellDemo />
            <StatGridDemo />
            <StatHeroGridDemo />
          </DemoGrid>
        ),
      ),
      page(
        "surfaces",
        "calendar",
        "Calendar",
        "ti ti-calendar-week",
        "SSR-first schedule views for app calendars, from compact Spaces-style months to richer day/week/year planning.",
        [
          "calendar-schedule",
          "calendar-all-day-stress",
          "calendar-overlap-interactions",
          "calendar-day",
          "calendar-month",
          "calendar-year",
          "calendar-mobile-month",
        ],
        () => (
          <DemoGrid columns="one">
            <CalendarScheduleDemo />
            <CalendarAllDayStressDemo />
            <CalendarOverlapDemo />
            <CalendarDayDemo />
            <CalendarMonthDemo />
            <CalendarYearDemo />
            <CalendarMobileDemo />
          </DemoGrid>
        ),
      ),
    ],
  },
  {
    id: "feedback",
    title: "Feedback",
    icon: "ti ti-message-circle",
    pages: [
      page(
        "feedback",
        "blocks",
        "Info Blocks",
        "ti ti-info-circle",
        "Semantic message utilities for note, info, success, warning, and danger states.",
        ["info-blocks"],
        () => (
          <DemoGrid columns="one">
            <InfoBlocks />
          </DemoGrid>
        ),
      ),
      page(
        "feedback",
        "badges",
        "Badges & Chips",
        "ti ti-tags",
        "Inline badges, chips, tags, and status dots.",
        ["badge", "chip", "tag", "status-dot"],
        () => (
          <DemoGrid>
            <BadgesDemo />
            <ChipsDemo />
            <TagsDemo />
            <StatusDotsDemo />
          </DemoGrid>
        ),
      ),
      page("feedback", "toast", "Toast", "ti ti-bell", "Small transient feedback messages.", ["toast"], () => (
        <DemoGrid>
          <ToastDemo />
        </DemoGrid>
      )),
      page(
        "feedback",
        "prompts",
        "Prompts",
        "ti ti-window",
        "Alert, error, confirm, search, form, custom dialog, size, and bare-dialog prompt flows.",
        [
          "prompts-alert",
          "prompts-error",
          "prompts-confirm",
          "spotlight-search",
          "prompts-search",
          "prompts-form",
          "prompts-workflow-form",
          "prompts-custom-dialog",
          "prompts-sizes",
          "prompts-bare",
          "dialog-header",
        ],
        () => (
          <DemoGrid>
            <PromptAlertDemo />
            <PromptErrorDemo />
            <PromptConfirmDemo />
            <SpotlightSearchDemo />
            <PromptSearchDemo />
            <PromptFormDemo />
            <PromptWorkflowFormDemo />
            <PromptCustomDialogDemo />
            <PromptSizesDemo />
            <PromptBareModalDemo />
            <DialogHeaderDemo />
          </DemoGrid>
        ),
      ),
    ],
  },
  {
    id: "content",
    title: "Content",
    icon: "ti ti-file-text",
    pages: [
      page(
        "content",
        "charts",
        "Chart",
        "ti ti-chart-line",
        "Line, bar, donut, sparkline, live, and empty chart states.",
        ["chart-line", "chart-bar", "chart-donut", "chart-sparkline", "chart-live", "chart-empty"],
        () => (
          <DemoGrid columns="one">
            <ChartLive />
            <ChartLine />
            <ChartBar />
            <ChartDonut />
            <ChartSparkline />
            <ChartEmpty />
          </DemoGrid>
        ),
      ),
      page(
        "content",
        "tables",
        "DataTable",
        "ti ti-table",
        "Full, admin, and minimal data table patterns.",
        ["datatable-full", "datatable-admin-pattern", "datatable-minimal"],
        () => (
          <DemoGrid columns="one">
            <DataTableFullDemo />
            <DataTableAdminPatternDemo />
            <DataTableMinimalDemo />
          </DemoGrid>
        ),
      ),
      page(
        "content",
        "code",
        "Code & Logs",
        "ti ti-code",
        "Highlighted code blocks and compact log entry tables.",
        ["code-display", "log-entries-table"],
        () => (
          <DemoGrid columns="one">
            <CodeDisplayDemo />
            <LogEntriesTableDemo />
          </DemoGrid>
        ),
      ),
      page(
        "content",
        "structured-data",
        "StructuredDataPreview",
        "ti ti-braces",
        "Formatted key-value and raw JSON preview for metadata, payloads, labels, and dimensions.",
        ["structured-data-preview"],
        () => (
          <DemoGrid columns="one">
            <StructuredDataPreviewDemo />
          </DemoGrid>
        ),
      ),
      page(
        "content",
        "media",
        "Media Preview",
        "ti ti-photo-scan",
        "Lightbox and PDF preview surfaces for generated or uploaded content.",
        ["lightbox", "pdf-preview"],
        () => (
          <DemoGrid columns="one">
            <LightboxDemo />
            <PdfPreviewDemo />
          </DemoGrid>
        ),
      ),
      page(
        "content",
        "template-editor",
        "Template Editor",
        "ti ti-template",
        "HTML and Liquid template editor prototype with completions, preview, and sample values.",
        ["template-editor"],
        () => (
          <DemoGrid columns="one">
            <TemplateEditorDemo />
          </DemoGrid>
        ),
      ),
      page(
        "content",
        "docs",
        "Docs Components",
        "ti ti-file-description",
        "Shared help and documentation primitives with custom syntax highlighting support.",
        ["doc-components", "doc-code"],
        () => (
          <DemoGrid columns="one">
            <DocComponentsDemo />
            <DocCodeDemo />
          </DemoGrid>
        ),
      ),
      page(
        "content",
        "markdown",
        "Markdown Content",
        "ti ti-markdown",
        "Rendered markdown and standalone content editor examples.",
        ["markdownview", "markdowneditor-content"],
        (props) => (
          <DemoGrid columns="one">
            <MarkdownViewDemo html={props.markdownHtml} />
            <MarkdownEditorFullDemo />
          </DemoGrid>
        ),
      ),
    ],
  },
  {
    id: "widgets",
    title: "Widgets",
    icon: "ti ti-layout-dashboard",
    pages: [
      page(
        "widgets",
        "dashboard",
        "Dashboard Widgets",
        "ti ti-layout-dashboard",
        "Endpoint-driven WidgetResponse examples for stat, status, list, pills, hero, tones, links, meta, and empty states.",
        ["widget-admin-queue", "widget-recent-notes", "widget-hero", "widget-service-states"],
        () => (
          <DemoGrid columns="one">
            <WidgetAdminQueueDemo />
            <WidgetRecentNotesDemo />
            <WidgetHeroDemo />
            <WidgetServiceStatesDemo />
          </DemoGrid>
        ),
        { aliases: ["WidgetCard"] },
      ),
    ],
  },
];

export const allDocPages = uiLabDocs.flatMap((section) => section.pages);

export const defaultDocPage = allDocPages[0]!;

export const findDocPage = (section: string | undefined, slug: string | undefined): UiLabDocPage | null =>
  allDocPages.find((page) => page.section === section && page.slug === slug) ?? null;

export const docHref = (page: UiLabDocPage): string => `/app/ui-lab/${page.section}/${page.slug}`;

export const allMappedDemoIds = (): string[] => allDocPages.flatMap((page) => page.demoIds);

export const hiddenUiLabExports = [
  { name: "LAYOUT_UPDATE_EVENT", reason: "Internal layout event constant used by the layout helper." },
  { name: "confirmDiscardIfDirty", reason: "Small PanelDialog workflow helper documented through PanelDialog usage." },
  { name: "createAvatarDataUrlFromFile", reason: "Low-level avatar upload helper; account avatar UX is intentionally app-owned." },
  { name: "createDialogCore", reason: "Factory behind the shared dialogCore singleton; app code normally uses dialogCore directly." },
  { name: "createFormState", reason: "Prompt implementation helper, not a standalone visual component." },
  { name: "normalizeDockWorkspaceState", reason: "State normalization helper covered by DockWorkspace behavior." },
  { name: "openAvatarUploadDialog", reason: "Niche account avatar flow; profile pages are the source for that UX." },
  { name: "panelDialogPanelClass", reason: "Dialog option class constant covered by panelDialogOptions." },
  { name: "panelDialogWorkspaceOptions", reason: "Specialized PanelDialog option bundle for workspace-sized dialogs." },
  { name: "panelDialogWorkspacePanelClass", reason: "Class constant behind panelDialogWorkspaceOptions." },
  { name: "pickAvatarDataUrl", reason: "Low-level file picker helper behind account avatar upload." },
  { name: "readSettingsError", reason: "Settings API error parser, not a visual UI element." },
  { name: "sameSettingValue", reason: "Settings dirty-state equality helper, demonstrated conceptually by Settings helpers." },
] as const;

const demoIdToLabel = (id: string): string =>
  id
    .split("-")
    .map((part) => (part.length > 0 ? part[0]!.toUpperCase() + part.slice(1) : part))
    .join(" ");

export const uiLabSearchEntries: UiLabSearchEntry[] = allDocPages.flatMap((page) => {
  const pageKeywords = [
    page.section,
    page.slug,
    page.title,
    page.summary,
    page.kind,
    page.source,
    ...(page.aliases ?? []),
    ...(page.tags ?? []),
    ...(page.exports ?? []),
    ...page.demoIds,
  ]
    .filter(Boolean)
    .join(" ");

  return [
    {
      id: `${page.section}/${page.slug}`,
      page,
      label: page.title,
      description: page.summary,
      icon: page.icon,
      kind: "page" as const,
      keywords: pageKeywords,
    },
    ...page.demoIds.map((demoId) => ({
      id: `${page.section}/${page.slug}#${demoId}`,
      page,
      anchor: demoId,
      label: demoIdToLabel(demoId),
      description: `${page.title} demo`,
      icon: page.icon,
      kind: "demo" as const,
      keywords: `${pageKeywords} ${demoId} ${demoIdToLabel(demoId)}`,
    })),
  ];
});
