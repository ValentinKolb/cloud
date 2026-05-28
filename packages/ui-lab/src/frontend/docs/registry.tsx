import type { JSX } from "solid-js";
import {
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
  DataTableFullDemo,
  DataTableMinimalDemo,
  MarkdownEditorFullDemo,
  MarkdownViewDemo,
} from "../lab/content";
import {
  BadgesDemo,
  ChipsDemo,
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
  DateTimeInputDemo,
  IconInputDemo,
  ImageInputDemo,
  MarkdownEditorStandalone,
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
  FilterChipDemo,
  NavigationEnhancementDemo,
  PaginationDemo,
  PanelDialogDemo,
  PermissionEditorDemo,
  SettingsModalDemo,
} from "../lab/navigation";
import {
  AvatarDemo,
  LinkCardDemo,
  PaperUtility,
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

export type UiLabDocRenderProps = {
  markdownHtml: string;
};

export type UiLabDocPage = {
  section: string;
  slug: string;
  title: string;
  icon: string;
  summary: string;
  demoIds: string[];
  render: (props: UiLabDocRenderProps) => JSX.Element;
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
): UiLabDocPage => ({ section, slug, title, icon, summary, demoIds, render });

export const uiLabDocs: UiLabDocSection[] = [
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
        "date-time",
        "DateTimeInput",
        "ti ti-calendar",
        "Date-time and date-only input variants.",
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
        ["select-basic", "select-fetchdata", "selectchip"],
        () => (
          <DemoGrid>
            <SelectBasic />
            <SelectFetchData />
            <SelectChipDemo />
          </DemoGrid>
        ),
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
        ["btn-sizes", "btn-variants", "btn-input", "icon-btn", "icon-btn-active", "btn-icons"],
        () => (
          <DemoGrid>
            <ButtonSizes />
            <ButtonVariants />
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
        "SettingsModal",
        "ti ti-settings",
        "Tabbed settings shell for bare prompt dialogs and app settings flows.",
        ["settingsmodal"],
        () => (
          <DemoGrid columns="one">
            <SettingsModalDemo />
          </DemoGrid>
        ),
      ),
      page(
        "layout",
        "panel-dialog",
        "PanelDialog",
        "ti ti-pencil",
        "Layout-only dialog shell for complex editors with fixed header/footer and sectioned body.",
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
        "PermissionEditor",
        "ti ti-users-group",
        "Access editor for user, group, authenticated, and public grants.",
        ["permissioneditor"],
        () => (
          <DemoGrid columns="one">
            <PermissionEditorDemo />
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
        "Shared paper and thumbnail utility classes.",
        ["paper", "thumbnail"],
        () => (
          <DemoGrid>
            <PaperUtility />
            <ThumbnailUtility />
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
          "prompts-search",
          "prompts-form",
          "prompts-workflow-form",
          "prompts-custom-dialog",
          "prompts-sizes",
          "prompts-bare",
        ],
        () => (
          <DemoGrid>
            <PromptAlertDemo />
            <PromptErrorDemo />
            <PromptConfirmDemo />
            <PromptSearchDemo />
            <PromptFormDemo />
            <PromptWorkflowFormDemo />
            <PromptCustomDialogDemo />
            <PromptSizesDemo />
            <PromptBareModalDemo />
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
        "Full and minimal data table patterns.",
        ["datatable-full", "datatable-minimal"],
        () => (
          <DemoGrid columns="one">
            <DataTableFullDemo />
            <DataTableMinimalDemo />
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
