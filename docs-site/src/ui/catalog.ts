import { catalogContexts } from "./context";

export type UiCatalogScope = "portable" | "cloud";

export type UiCatalogPage = {
  slug: string;
  title: string;
  icon: string;
  summary: string;
};

export type UiCatalogEntry = {
  id: string;
  section: UiCatalogSectionId;
  sectionTitle: string;
  order: number;
  scope: UiCatalogScope;
  packageName: "@k2b/ui" | "@valentinkolb/cloud";
  page: UiCatalogPage;
  context: string;
};

export type UiCatalogSection = {
  id: UiCatalogSectionId;
  title: string;
  count: number;
  scope: UiCatalogScope;
};

const page = (slug: string, title: string, icon: string, summary: string): UiCatalogPage => ({
  slug,
  title,
  icon,
  summary,
});

const portableAiPages: UiCatalogPage[] = [
  {
    slug: "chat",
    title: "Chat",
    icon: "ti ti-messages",
    summary: "Controlled chat timeline, composer, messages, activities, attachments, and model selection.",
  },
  {
    slug: "context-usage",
    title: "Context usage",
    icon: "ti ti-chart-donut",
    summary: "Compact, accessible token and context-window usage disclosure for any AI workflow.",
  },
];

const portableSections = [
  {
    id: "ai",
    title: "AI",
    icon: "ti ti-sparkles",
    pages: portableAiPages,
  },
  {
    id: "input",
    title: "Inputs",
    icon: "ti ti-forms",
    pages: [
      page("text", "TextInput", "ti ti-cursor-text", "Text, search, password, multiline, Markdown, and AI-marked field modes."),
      page("number", "NumberInput", "ti ti-number", "Bounded and formatted numeric input with steppers and clear state."),
      page("boolean", "Boolean inputs", "ti ti-toggle-right", "Switch, checkbox, and descriptive checkbox-card controls."),
      page("select", "Selection controls", "ti ti-list-check", "Single, multi, and compact controlled selection."),
      page("combobox", "Combobox", "ti ti-list-search", "Consume-and-clear suggestions for commands and entity selection."),
      page("tags", "TagsInput", "ti ti-tags", "Comma-separated tag entry in one editable field, deduplicated on commit."),
      page("tag-editor", "Tag editing", "ti ti-tag", "Reusable tag presentation, entity management, and assignment composition."),
      page("date-picker", "Date pickers", "ti ti-calendar", "Date, date-time, and date-range selection with explicit timezone handling."),
      page("color", "ColorInput", "ti ti-palette", "Native color selection with controlled value and optional transparency."),
      page("pin", "PinInput", "ti ti-password", "Grouped one-time-code entry with paste and arrow-key navigation."),
      page("slider", "Slider", "ti ti-adjustments-horizontal", "Range input with value labels and optional centered scale."),
      page("icon", "IconInput", "ti ti-icons", "Searchable controlled icon selection."),
      page("image", "ImageInput", "ti ti-photo", "Controlled image selection, preview, transform, and removal."),
      page("image-cropper", "ImageCropper", "ti ti-crop", "Direct-manipulation crop, resize, and rotation with free or fixed aspect ratios."),
      page("file-dropzone", "FileDropzone", "ti ti-cloud-upload", "Accessible click and drag file selection with validation state."),
      page("markdown-editor", "MarkdownEditor", "ti ti-markdown", "Standalone controlled Markdown editing with native textarea behavior."),
      page("autocomplete", "AutocompleteEditor", "ti ti-sparkles", "Completion-aware editing for mentions, formulas, and custom suggestions."),
    ],
  },
  {
    id: "actions",
    title: "Actions",
    icon: "ti ti-click",
    pages: [
      page("buttons", "Buttons", "ti ti-hand-click", "Semantic button and icon-button variants with loading behavior."),
      page("copy-remove", "Copy and remove", "ti ti-copy", "Focused clipboard feedback and destructive icon actions."),
      page("menus", "Menus", "ti ti-menu-2", "Dropdown and context menus with keyboard and viewport behavior."),
      page("filters", "Filters", "ti ti-filter", "Section-aware single and multi-select filtering."),
      page("segmented-control", "SegmentedControl", "ti ti-layout-grid", "A controlled radio-group toolbar with roving focus."),
      page("tabs", "Tabs", "ti ti-folders", "Accessible controlled peer views with compositional or data-driven items."),
      page("disclosure", "Disclosure", "ti ti-chevron-down", "Native optional-detail disclosure with controlled and uncontrolled state."),
      page("toolbar", "Toolbar", "ti ti-tools", "Semantic action groups, separators, spacing, and responsive wrapping."),
      page("spotlight", "Spotlight search", "ti ti-search", "Portable search launchers and keyboard shortcut behavior."),
    ],
  },
  {
    id: "layout",
    title: "Layout",
    icon: "ti ti-layout",
    pages: [
      page("workspace", "AppWorkspace", "ti ti-layout-sidebar", "Responsive application frame with navigation, work, detail, and drawer regions."),
      page("panes", "Panes", "ti ti-columns", "Controlled serializable tabs and nested split layouts."),
      page("overview", "AppOverview", "ti ti-home", "Application landing page with primary and supporting panels."),
      page("settings-modal", "Settings", "ti ti-settings", "Accessible settings tabs, fields, and save state."),
      page("panel-dialog", "PanelDialog", "ti ti-app-window", "Contained or floating composition for complex editors."),
      page("floating-window", "FloatingWindow", "ti ti-window", "Movable and resizable utility content with mobile fallback."),
    ],
  },
  {
    id: "surfaces",
    title: "Surfaces",
    icon: "ti ti-layout-cards",
    pages: [
      page("utilities", "Theme and styles", "ti ti-palette", "Scoped styles plus configurable font and semantic color tokens."),
      page("empty-states", "Empty states", "ti ti-box-off", "Compact and panel placeholders plus route-level not-found states."),
      page("cards", "Cards and identity", "ti ti-id", "Links and portable avatar identity."),
      page("details", "Description list", "ti ti-list-details", "Semantic responsive key-value details with optional actions."),
      page("progress", "Progress", "ti ti-progress", "Determinate progress in compact sizes and semantic tones."),
      page("stats", "Statistics", "ti ti-chart-bar", "Labeled values, context, accents, trends, and grids."),
      page("observability", "Operational surfaces", "ti ti-activity", "Panel headers, data panels, notices, ranges, and status vocabulary."),
    ],
  },
  {
    id: "feedback",
    title: "Feedback",
    icon: "ti ti-message-circle",
    pages: [
      page("blocks", "Notices", "ti ti-info-circle", "Persistent informational, warning, and error findings."),
      page("badges", "Status badges", "ti ti-status-change", "Semantic status presentation in chip, dot, and text forms."),
      page("toast", "Toast", "ti ti-bell", "Scoped transient feedback with updates, actions, and dismissal."),
      page("tooltip", "Tooltip", "ti ti-message", "Concise accessible hints with viewport-aware positioning."),
      page("prompts", "Prompts", "ti ti-forms", "Alert, confirmation, search, form, and custom dialog flows."),
    ],
  },
  {
    id: "content",
    title: "Content",
    icon: "ti ti-file-description",
    pages: [
      page("charts", "Charts", "ti ti-chart-line", "Typed responsive charts and interactive state timelines."),
      page("tables", "DataTable", "ti ti-table", "Exact records with sorting, selection, footers, and incremental loading."),
      page("calendar", "Calendar", "ti ti-calendar-month", "Controlled generic calendar navigation and items."),
      page("pagination", "Pagination", "ti ti-arrow-right", "Server-friendly href pagination with compact page windows."),
      page("code", "Code", "ti ti-code", "Selectable source with language-aware highlighting and copy."),
      page("logs", "Logs", "ti ti-list-details", "Semantic timestamped log entries with structured metadata."),
      page("structured-data", "Structured data", "ti ti-braces", "Formatted and raw JSON-like data disclosure."),
      page("media", "Media previews", "ti ti-photo", "Image lightboxes and PDF preview surfaces."),
      page("files", "Files", "ti ti-folders", "Generic file trees, browser composition, and content-aware previews."),
      page("template-editor", "Template editor", "ti ti-template", "HTML and Liquid editing, sandboxed preview, and sample data."),
      page("docs", "Documentation", "ti ti-book", "In-product documentation layout and prose primitives."),
      page("markdown", "Markdown", "ti ti-markdown", "Trusted rendered HTML and controlled Markdown editing."),
    ],
  },
  {
    id: "widgets",
    title: "Widgets",
    icon: "ti ti-layout-dashboard",
    pages: [
      {
        slug: "composition",
        title: "Widget composition",
        icon: "ti ti-layout-dashboard",
        summary: "Portable dashboard blocks composed from semantic data without application contracts.",
      },
    ],
  },
] as const;

export type UiCatalogSectionId = (typeof portableSections)[number]["id"] | "cloud";

const cloudPages: UiCatalogPage[] = [
  {
    slug: "assistant-chat",
    title: "Cloud assistant chat",
    icon: "ti ti-sparkles",
    summary: "Cloud AI messages and composer adapters bound to Cloud sessions, turns, tools, and attachments.",
  },
  {
    slug: "ai-skills",
    title: "AI skills manager",
    icon: "ti ti-tool",
    summary: "Cloud skill discovery and management backed by the platform AI APIs.",
  },
  {
    slug: "permissions",
    title: "Permissions and API keys",
    icon: "ti ti-lock-access",
    summary: "Cloud principals, resource permissions, entity search, and scoped API credentials.",
  },
  {
    slug: "dashboard-widgets",
    title: "Cloud dashboard widgets",
    icon: "ti ti-api-app",
    summary: "The Cloud endpoint contract that feeds portable widget presentation components.",
  },
];

const entry = (
  section: UiCatalogSectionId,
  sectionTitle: string,
  page: UiCatalogPage,
  order: number,
  scope: UiCatalogScope,
): UiCatalogEntry => {
  const id = `${section}/${page.slug}`;
  const context = catalogContexts[id as keyof typeof catalogContexts];
  if (!context) throw new Error(`Missing explicit UI catalog context for ${id}`);
  return {
    id,
    section,
    sectionTitle,
    order,
    scope,
    packageName: scope === "portable" ? "@k2b/ui" : "@valentinkolb/cloud",
    page,
    context,
  };
};

const portableEntries = portableSections.flatMap((section, sectionIndex) =>
  section.pages.map((page, pageIndex) =>
    entry(section.id, section.title, page, (sectionIndex + 1) * 100 + pageIndex, "portable"),
  ),
);

const cloudEntries = cloudPages.map((page, pageIndex) =>
  entry("cloud", "Cloud components", page, 1_000 + pageIndex, "cloud"),
);

export const uiCatalogEntries: UiCatalogEntry[] = [...portableEntries, ...cloudEntries];

export const uiCatalogSections: UiCatalogSection[] = [
  ...portableSections.map((section) => ({
    id: section.id,
    title: section.title,
    count: section.pages.length,
    scope: "portable" as const,
  })),
  {
    id: "cloud",
    title: "Cloud components",
    count: cloudPages.length,
    scope: "cloud",
  },
];

/**
 * Public implementation primitives that intentionally have no user-facing
 * catalog subject. Every entry needs a reason, and the catalog checker rejects
 * stale names, blank reasons, and overlap with live or documented-only exports.
 */
export const hiddenUiCatalogExports = {
  GHOST_SENTINEL: "Internal completion-engine sentinel.",
  TRIGGER_CHARS: "Internal completion-engine character set.",
  WORD_CHAR: "Internal completion-engine character matcher.",
  applySuggestion: "Internal completion-engine state transition.",
  buildSuggestContext: "Internal completion-engine context builder.",
  clampImageCropRect: "Low-level ImageCropper geometry primitive.",
  collectKnownLabels: "Internal completion-engine label collector.",
  createDialogCore: "Low-level dialog manager factory without a standalone visual contract.",
  createFormState: "Low-level prompt form-state factory without a standalone visual contract.",
  detectQuery: "Internal completion-engine query detector.",
  displayLabel: "Internal completion-engine display helper.",
  dropdownPosition: "Low-level Dropdown geometry primitive.",
  formatChatTokens: "Low-level ChatContextUsage formatter.",
  getInitialImageCropRect: "Low-level ImageCropper geometry primitive.",
  imageCropRectToPixels: "Low-level ImageCropper geometry primitive.",
  normalizeImageCropRotation: "Low-level ImageCropper geometry primitive.",
  pickGhost: "Internal completion-engine ghost-text selector.",
  renderWithOverlay: "Internal completion-engine overlay renderer.",
  resetCompletionState: "Internal completion-engine reset helper.",
  resizeImageCropAroundCenter: "Low-level ImageCropper geometry primitive.",
  resolveSuggestions: "Internal completion-engine suggestion resolver.",
  rotateImageCropRight: "Low-level ImageCropper geometry primitive.",
  suggestSync: "Internal completion-engine synchronous adapter.",
  tryExpand: "Internal completion-engine expansion helper.",
  tryRestore: "Internal completion-engine restoration helper.",
} as const satisfies Record<string, string>;

/**
 * Public APIs that are part of a documented component contract but are not
 * sensible standalone visual demos. Coverage is explicit instead of being
 * inferred from arbitrary prose mentions.
 */
export const documentedOnlyUiCatalogExports = {
  APP_WORKSPACE_DETAIL_DEFAULT: "Documented AppWorkspace detail sizing constant.",
  APP_WORKSPACE_DETAIL_MAX: "Documented AppWorkspace detail sizing constant.",
  APP_WORKSPACE_DETAIL_MIN: "Documented AppWorkspace detail sizing constant.",
  APP_WORKSPACE_DRAWER_DEFAULT: "Documented AppWorkspace drawer sizing constant.",
  APP_WORKSPACE_DRAWER_MAX: "Documented AppWorkspace drawer sizing constant.",
  APP_WORKSPACE_DRAWER_MIN: "Documented AppWorkspace drawer sizing constant.",
  APP_WORKSPACE_MAIN_MIN: "Documented AppWorkspace main-area sizing constant.",
  APP_WORKSPACE_MAIN_MIN_HEIGHT: "Documented AppWorkspace main-area sizing constant.",
  APP_WORKSPACE_PANE_DEFAULT: "Documented AppWorkspace pane sizing constant.",
  APP_WORKSPACE_PANE_MAX: "Documented AppWorkspace pane sizing constant.",
  APP_WORKSPACE_PANE_MIN: "Documented AppWorkspace pane sizing constant.",
  APP_WORKSPACE_SIDEBAR_COLLAPSED: "Documented AppWorkspace sidebar sizing constant.",
  APP_WORKSPACE_SIDEBAR_COLLAPSE_THRESHOLD: "Documented AppWorkspace sidebar sizing constant.",
  APP_WORKSPACE_SIDEBAR_DEFAULT: "Documented AppWorkspace sidebar sizing constant.",
  APP_WORKSPACE_SIDEBAR_MAX: "Documented AppWorkspace sidebar sizing constant.",
  APP_WORKSPACE_SIDEBAR_MIN: "Documented AppWorkspace sidebar sizing constant.",
  ChatActivity: "Documented ChatTimeline item component rendered through the timeline demo.",
  ChatMessage: "Documented ChatTimeline item component rendered through the timeline demo.",
  DEFAULT_ICON_OPTIONS: "Documented default option set used by the IconInput demo.",
  DialogHeader: "Documented prompt composition helper.",
  DocInlineCode: "Documented inline member of the documentation component family.",
  DropdownItem: "Documented compositional child of Dropdown.",
  FileTree: "Documented child composed by the FileBrowserPanel demo.",
  FileView: "Documented child composed by the FileBrowserPanel demo.",
  PANES_VALUE_VERSION: "Documented Panes serialization version.",
  SPOTLIGHT_SHORTCUT: "Documented Spotlight keyboard shortcut constant.",
  SPOTLIGHT_SHORTCUT_LABEL: "Documented Spotlight keyboard shortcut label.",
  SPOTLIGHT_SHORTCUT_TITLE: "Documented Spotlight keyboard shortcut title.",
  abbreviations: "Documented completion dictionary used by editor examples.",
  activatePanesElement: "Documented imperative Panes focus helper.",
  appWorkspaceLayoutStyle: "Documented AppWorkspace layout-state helper.",
  appWorkspacePanelVariable: "Documented AppWorkspace panel-variable helper.",
  appWorkspaceResizeLimits: "Documented AppWorkspace resize helper.",
  canPreviewFile: "Documented FileView capability helper.",
  confirmDiscardIfDirty: "Documented TemplateEditor dirty-state helper.",
  createCroppedImageCanvas: "Documented ImageCropper export helper.",
  createCroppedImageDataUrl: "Documented ImageCropper export helper.",
  createTemplateEditorPanesValue: "Documented TemplateEditor layout helper.",
  dialogCore: "Documented shared dialog manager used by prompt APIs.",
  fitFloatingWindowRect: "Documented FloatingWindow geometry helper.",
  formatFileViewSize: "Documented FileView metadata formatter.",
  getFileViewPreviewKind: "Documented FileView preview classifier.",
  installAppWorkspaceController: "Documented AppWorkspace resize-controller installer.",
  isPointInsideToast: "Documented toast interaction helper.",
  isSpotlightShortcut: "Documented Spotlight keyboard helper.",
  normalizeAppWorkspaceLayoutState: "Documented AppWorkspace persisted-state helper.",
  normalizePanesValue: "Documented Panes serialization helper.",
  openFileBrowser: "Documented imperative FileBrowserPanel opener.",
  openFloatingWindow: "Documented imperative FloatingWindow opener.",
  panelDialogFixedOptions: "Documented PanelDialog fixed-mode preset.",
  panelDialogFixedPanelClass: "Documented PanelDialog fixed-mode class helper.",
  panelDialogOptions: "Documented PanelDialog default preset.",
  panelDialogPanelClass: "Documented PanelDialog default class helper.",
  panelDialogWorkspaceOptions: "Documented PanelDialog workspace-mode preset.",
  panelDialogWorkspacePanelClass: "Documented PanelDialog workspace-mode class helper.",
  parseAppWorkspaceLayoutState: "Documented AppWorkspace persisted-state parser.",
  readSettingsError: "Documented Settings error-normalization helper.",
  registerFileViewRenderer: "Documented FileView renderer extension hook.",
  resolveAppWorkspaceSidebarWidth: "Documented AppWorkspace sidebar-state helper.",
  safeAppWorkspacePanelId: "Documented AppWorkspace panel-id helper.",
  sameSettingValue: "Documented Settings dirty-state helper.",
  serializeAppWorkspaceLayoutState: "Documented AppWorkspace persisted-state serializer.",
  shouldCollapseAppWorkspaceSidebar: "Documented AppWorkspace responsive-state helper.",
} as const satisfies Record<string, string>;
