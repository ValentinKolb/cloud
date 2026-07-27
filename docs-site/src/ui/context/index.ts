import actionButtons from "./actions/buttons.md" with { type: "text" };
import actionCopyRemove from "./actions/copy-remove.md" with { type: "text" };
import actionMenus from "./actions/menus.md" with { type: "text" };
import actionSegmentedControl from "./actions/segmented-control.md" with { type: "text" };
import contentAiSkills from "./content/ai-skills.md" with { type: "text" };
import contentCharts from "./content/charts.md" with { type: "text" };
import contentCode from "./content/code.md" with { type: "text" };
import contentDocs from "./content/docs.md" with { type: "text" };
import contentFiles from "./content/files.md" with { type: "text" };
import contentMarkdown from "./content/markdown.md" with { type: "text" };
import contentMedia from "./content/media.md" with { type: "text" };
import contentStructuredData from "./content/structured-data.md" with { type: "text" };
import contentTables from "./content/tables.md" with { type: "text" };
import contentTemplateEditor from "./content/template-editor.md" with { type: "text" };
import feedbackBadges from "./feedback/badges.md" with { type: "text" };
import feedbackBlocks from "./feedback/blocks.md" with { type: "text" };
import feedbackPrompts from "./feedback/prompts.md" with { type: "text" };
import feedbackToast from "./feedback/toast.md" with { type: "text" };
import feedbackTooltip from "./feedback/tooltip.md" with { type: "text" };
import inputAutocomplete from "./input/autocomplete.md" with { type: "text" };
import inputBoolean from "./input/boolean.md" with { type: "text" };
import inputColor from "./input/color.md" with { type: "text" };
import inputCombobox from "./input/combobox.md" with { type: "text" };
import inputDatePicker from "./input/date-picker.md" with { type: "text" };
import inputDateTime from "./input/date-time.md" with { type: "text" };
import inputFileDropzone from "./input/file-dropzone.md" with { type: "text" };
import inputFilters from "./filter-chip.md" with { type: "text" };
import inputIcon from "./input/icon.md" with { type: "text" };
import inputImage from "./input/image.md" with { type: "text" };
import inputImageCropper from "./input/image-cropper.md" with { type: "text" };
import inputMarkdownEditor from "./markdown-editor.md" with { type: "text" };
import inputNumber from "./input/number.md" with { type: "text" };
import inputPin from "./input/pin.md" with { type: "text" };
import inputSelect from "./input/select.md" with { type: "text" };
import inputSlider from "./input/slider.md" with { type: "text" };
import inputTags from "./input/tags.md" with { type: "text" };
import inputText from "./input/text.md" with { type: "text" };
import layoutDockWorkspace from "./layout/dock-workspace.md" with { type: "text" };
import layoutFloatingWindow from "./layout/floating-window.md" with { type: "text" };
import layoutNavigation from "./layout/navigation.md" with { type: "text" };
import layoutOverview from "./layout/overview.md" with { type: "text" };
import layoutPagination from "./layout/pagination.md" with { type: "text" };
import layoutPanelDialog from "./layout/panel-dialog.md" with { type: "text" };
import layoutPanes from "./layout/panes.md" with { type: "text" };
import layoutPermissions from "./layout/permissions.md" with { type: "text" };
import layoutSettingsModal from "./layout/settings-modal.md" with { type: "text" };
import layoutWorkspace from "./layout/workspace.md" with { type: "text" };
import surfaceCalendar from "./surfaces/calendar.md" with { type: "text" };
import surfaceCards from "./surfaces/cards.md" with { type: "text" };
import surfaceEmptyStates from "./surfaces/empty-states.md" with { type: "text" };
import surfaceObservability from "./surfaces/observability.md" with { type: "text" };
import surfaceStats from "./surfaces/stats.md" with { type: "text" };
import surfaceUtilities from "./surfaces/utilities.md" with { type: "text" };
import widgetDashboard from "./widgets/dashboard.md" with { type: "text" };

export const catalogContexts = {
  "input/text": inputText,
  "input/markdown-editor": inputMarkdownEditor,
  "input/autocomplete": inputAutocomplete,
  "input/number": inputNumber,
  "input/date-picker": inputDatePicker,
  "input/date-time": inputDateTime,
  "input/select": inputSelect,
  "input/combobox": inputCombobox,
  "input/color": inputColor,
  "input/tags": inputTags,
  "input/pin": inputPin,
  "input/image": inputImage,
  "input/image-cropper": inputImageCropper,
  "input/file-dropzone": inputFileDropzone,
  "input/icon": inputIcon,
  "input/slider": inputSlider,
  "input/filters": inputFilters,
  "input/boolean": inputBoolean,
  "actions/buttons": actionButtons,
  "actions/copy-remove": actionCopyRemove,
  "actions/menus": actionMenus,
  "actions/segmented-control": actionSegmentedControl,
  "layout/workspace": layoutWorkspace,
  "layout/panes": layoutPanes,
  "layout/dock-workspace": layoutDockWorkspace,
  "layout/overview": layoutOverview,
  "layout/settings-modal": layoutSettingsModal,
  "layout/panel-dialog": layoutPanelDialog,
  "layout/floating-window": layoutFloatingWindow,
  "layout/permissions": layoutPermissions,
  "layout/navigation": layoutNavigation,
  "layout/pagination": layoutPagination,
  "surfaces/utilities": surfaceUtilities,
  "surfaces/empty-states": surfaceEmptyStates,
  "surfaces/cards": surfaceCards,
  "surfaces/stats": surfaceStats,
  "surfaces/observability": surfaceObservability,
  "surfaces/calendar": surfaceCalendar,
  "feedback/blocks": feedbackBlocks,
  "feedback/badges": feedbackBadges,
  "feedback/toast": feedbackToast,
  "feedback/tooltip": feedbackTooltip,
  "feedback/prompts": feedbackPrompts,
  "content/charts": contentCharts,
  "content/tables": contentTables,
  "content/code": contentCode,
  "content/structured-data": contentStructuredData,
  "content/media": contentMedia,
  "content/files": contentFiles,
  "content/ai-skills": contentAiSkills,
  "content/template-editor": contentTemplateEditor,
  "content/docs": contentDocs,
  "content/markdown": contentMarkdown,
  "widgets/dashboard": widgetDashboard,
} as const satisfies Record<string, string>;
