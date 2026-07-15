import type { AccessEntry } from "@valentinkolb/cloud/contracts/shared";
import type { DateContext } from "@valentinkolb/stdlib";
import type {
  DocumentRunBrowseResponse,
  DocumentRunSummary,
  DocumentTemplate,
  DocumentTemplateSummary,
  DslQueryPreviewResponse,
  RecordDisplayConfig,
  RecordQuery,
  RecordSnapshotSummary,
} from "../../../contracts";
import type { AuditEntry, Base, Dashboard, Field, Form, GridFile, GridRecord, Table, View, Workflow } from "../../../service";
import type { WidgetData } from "../../../service/dashboard-widget-data";
import type {
  GridsWorkflowEmailDelivery,
  GridsWorkflowLauncher,
  GridsWorkflowRun,
  GridsWorkflowRunStats,
  GridsWorkflowStepRun,
} from "../../../workflows/contracts";
import type { RecordsState } from "../records-view/query-url";
import type { GridsDocumentViewMode } from "../sidebar/GridsSettingsStore";

export type AuthUser = {
  id: string;
  memberofGroupIds: string[];
};

export type WorkspaceGroupBucket = {
  keys: unknown[];
  values: Record<string, unknown>;
};

export type WorkspaceCatalog = {
  dashboards: Dashboard[];
  workflows: Workflow[];
  workflowLevels: Record<string, "none" | "read" | "write" | "admin">;
  tables: Table[];
  tableLevels: Record<string, "none" | "read" | "write" | "admin">;
  fieldsByTable: Record<string, Field[]>;
  viewsByTable: Record<string, View[]>;
  formsByTable: Record<string, Form[]>;
  documentTemplatesByTable: Record<string, DocumentTemplateSummary[]>;
  documentTemplateLevels: Record<string, "none" | "read" | "write" | "admin">;
  tableShortIds: Record<string, string>;
  sidebarForms: Array<{ form: Form; table: Table }>;
  sidebarDocumentTemplates: Array<{ template: DocumentTemplateSummary; table: Table }>;
};

export type RuntimeView = View & {
  query: RecordQuery;
  displayConfig: RecordDisplayConfig;
};

export type WorkspaceBulkLauncher = GridsWorkflowLauncher & { workflowRevision: number };

export type WorkspaceRecordsRoute = {
  kind: "records";
  activeTable: Table;
  activeView: RuntimeView | null;
  fields: Field[];
  formsForTable: Form[];
  canWriteRecords: boolean;
  canManageActiveTable: boolean;
  activeTableAccessEntries: AccessEntry[];
  activeFormAccessEntries: Record<string, AccessEntry[]>;
  activeViewAccessEntries: AccessEntry[];
  canEditActiveView: boolean;
  otherTables: Array<{ id: string; name: string }>;
  initialState: RecordsState;
  initialData: {
    items?: GridRecord[];
    buckets?: WorkspaceGroupBucket[];
    aggregates?: Record<string, unknown>;
    nextCursor: string | null;
    explode?: boolean;
    filePreviews?: Record<
      string,
      Record<string, { fileId: string; fieldId: string; recordId: string; filename: string; mimeType: string; sizeBytes: number }>
    >;
  };
  initialSelectedRecord: GridRecord | null;
  initialSelectedRecordDetail: WorkspaceRecordDetail | null;
  documentTemplates: DocumentTemplateSummary[];
  relationLabels: Record<string, string>;
  activeViewColumns: RecordQuery["columns"] | undefined;
  searchableFields: Field[];
  groupedExplode: boolean;
  activeRecordQuery: RecordQuery | null;
  displayConfig: RecordDisplayConfig;
  bulkSelectionLaunchers: WorkspaceBulkLauncher[];
};

export type WorkspaceAnalyticalViewRoute = {
  kind: "analyticalView";
  activeTable: Table;
  activeView: View;
  fields: Field[];
  canManageActiveTable: boolean;
  canEditActiveView: boolean;
  activeViewAccessEntries: AccessEntry[];
  initialResult: DslQueryPreviewResponse | null;
};

export type WorkspaceRecordDetail = {
  recordId: string;
  filesByField: Record<string, GridFile[]>;
  documentRuns: DocumentRunSummary[];
  snapshots: RecordSnapshotSummary[];
  auditEntries: Array<AuditEntry & { userDisplayName: string | null }>;
};

export type WorkspaceDashboardRoute = {
  kind: "dashboard";
  dashboard: Dashboard;
  widgetData: Record<string, WidgetData>;
  recordLiveTableIds?: string[];
  activeDashboardAccessEntries: AccessEntry[];
  canEditActiveDashboard: boolean;
  isBaseDefault: boolean;
  dashboardWorkflows: Workflow[];
};

type WorkspaceEmptyRoute = {
  kind: "empty";
};

export type WorkspaceWorkflowsRoute = {
  kind: "workflows";
  activeWorkflow: Workflow | null;
  canRunActiveWorkflow: boolean;
  canManageActiveWorkflow: boolean;
  selectedRunId: string | null;
  initialOverview: WorkspaceWorkflowOverview;
  initialSelectedRun: WorkspaceWorkflowRunDetail | null;
};

export type WorkspaceWorkflowOverview = {
  stats: GridsWorkflowRunStats;
  runs: { items: GridsWorkflowRun[]; nextCursor: string | null };
  emailDeliveries: { items: GridsWorkflowEmailDelivery[]; nextCursor: string | null };
  launchers: GridsWorkflowLauncher[];
};

export type WorkspaceWorkflowRunDetail = {
  run: GridsWorkflowRun;
  steps: GridsWorkflowStepRun[];
  documents: {
    items: DocumentRunSummary[];
    total: number;
    hasMore: boolean;
  };
};

export type WorkspaceQueryRoute = {
  kind: "query";
  initialQuery: string;
  initialPreview?: DslQueryPreviewResponse | null;
  queryPath: string;
  currentSource?:
    | { kind: "table"; tableId: string; label: string; ref: string }
    | { kind: "view"; viewId: string; label: string; ref: string };
};

export type WorkspaceDocumentTemplateRoute = {
  kind: "documentTemplate";
  table: Table;
  template: DocumentTemplateSummary;
  editableTemplate: DocumentTemplate | null;
  canWriteTemplate: boolean;
  canManageTemplate: boolean;
  activeTemplateAccessEntries: AccessEntry[];
  initialRecordId: string | null;
  initialDocumentViewMode: GridsDocumentViewMode;
  initialBrowserPage: DocumentRunBrowseResponse;
};

export type GridsWorkspaceRoute =
  | WorkspaceRecordsRoute
  | WorkspaceAnalyticalViewRoute
  | WorkspaceDashboardRoute
  | WorkspaceWorkflowsRoute
  | WorkspaceQueryRoute
  | WorkspaceDocumentTemplateRoute
  | WorkspaceEmptyRoute;

export type GridsWorkspaceState =
  | { kind: "notFound"; title: string; message: string }
  | { kind: "accessDenied"; title: string; message: string }
  | { kind: "invalidQuery"; title: string; message: string }
  | {
      kind: "ok";
      base: Base;
      baseShortId: string;
      title: Array<{ title: string; href?: string }>;
      rememberPath: string;
      adminModeRequested: boolean;
      editModeToggleHref: string;
      canManageBase: boolean;
      canCreateTables: boolean;
      canUseEditMode: boolean;
      canUseQueryWorkspace: boolean;
      metadataEventCursor: string | null;
      recordEventCursor: string | null;
      dateConfig?: DateContext;
      catalog: WorkspaceCatalog;
      route: GridsWorkspaceRoute;
    };

export type LoadWorkspaceParams = {
  user: AuthUser;
  baseShortId: string;
  href: string;
  activeTableSlug?: string | null;
  activeViewSlug?: string | null;
  activeDashboardSlug?: string | null;
  activeWorkflowSlug?: string | null;
  activeDocumentTableSlug?: string | null;
  activeDocumentTemplateSlug?: string | null;
  initialDocumentViewMode?: GridsDocumentViewMode;
  dateConfig?: DateContext;
};

export type WorkspaceChrome = {
  url: URL;
  adminModeRequested: boolean;
  trashMode: boolean;
  rememberPath: string;
  editModeToggleHref: string;
  titleBase: Array<{ title: string; href?: string }>;
};

export type WorkspaceCommon = {
  params: LoadWorkspaceParams;
  base: Base;
  chrome: WorkspaceChrome;
  catalog: WorkspaceCatalog;
  canManageBase: boolean;
  canCreateTables: boolean;
  canUseEditMode: boolean;
  canUseQueryWorkspace: boolean;
  metadataEventCursor: string | null;
  recordEventCursor: string | null;
};

export type OkWorkspaceState = Extract<GridsWorkspaceState, { kind: "ok" }>;
