import { DataPanel, DataTable, type DataTableColumn, Pagination, SettingsPage, StatCell, StatGrid, StatusBadge } from "@k2b/ui";
import type { AiProjectAdminListItem, AiProjectAdminSummary } from "@valentinkolb/cloud/ai";
import { formatDateTime } from "@valentinkolb/cloud/shared";
import { SearchBar } from "@valentinkolb/cloud/ssr/islands";
import AiProjectAdminActions from "./AiProjectAdminActions.island";

type Props = {
  projects: AiProjectAdminListItem[];
  summary: AiProjectAdminSummary;
  total: number;
  page: number;
  perPage: number;
  search: string;
};

export default function AiProjectsAdminPanel(props: Props) {
  const totalPages = Math.ceil(props.total / props.perPage);
  const baseUrl = props.search
    ? `/admin/settings?tab=ai-projects&search=${encodeURIComponent(props.search)}&page=`
    : "/admin/settings?tab=ai-projects&page=";
  const columns: DataTableColumn<AiProjectAdminListItem>[] = [
    { id: "project", header: "Project", value: (project) => project.name },
    { id: "updated", header: "Updated", value: (project) => project.updatedAt, cellClass: "whitespace-nowrap" },
    { id: "access", header: "Access", value: (project) => project.accessCount, cellClass: "whitespace-nowrap" },
    { id: "admins", header: "Admins", value: (project) => project.adminCount, cellClass: "whitespace-nowrap" },
    { id: "actions", header: "Settings", headerClass: "w-px text-right", cellClass: "text-right whitespace-nowrap" },
  ];

  return (
    <SettingsPage
      title="AI Projects"
      subtitle="Recover and manage access to shared AI Projects."
      icon="ti ti-folders"
      scrollPreserveKey="admin-ai-projects"
    >
      <StatGrid columns={3}>
        <StatCell label="Projects" value={props.summary.total} sub={props.search ? "filtered" : "shared Projects"} />
        <StatCell
          label="Without admins"
          value={props.summary.unmanaged}
          sub={props.summary.unmanaged > 0 ? "recovery required" : "all manageable"}
          valueClass={props.summary.unmanaged > 0 ? "text-red-500" : "text-primary"}
          accent={props.summary.unmanaged > 0 ? { tone: "red", icon: "ti ti-alert-circle" } : undefined}
        />
        <StatCell label="Access entries" value={props.summary.totalAccess} sub={props.search ? "in search" : "across all Projects"} />
      </StatGrid>

      <div class="flex items-center gap-2">
        <div class="min-w-0 flex-1">
          <SearchBar
            action="/admin/settings?tab=ai-projects"
            value={props.search}
            placeholder="Search Projects by name or ID..."
            ariaLabel="Search AI Projects"
          />
        </div>
        <span class="shrink-0 text-xs tabular-nums text-dimmed">
          {props.projects.length} of {props.total}
        </span>
      </div>

      <DataPanel
        title="Project records"
        subtitle="Platform-wide Projects remain listed even when their last administrator account was deleted."
        class="overflow-hidden"
        footer={<Pagination currentPage={props.page} totalPages={totalPages} baseUrl={baseUrl} />}
      >
        <DataTable
          rows={props.projects}
          columns={columns}
          getRowId={(project) => project.shortId}
          hoverRows
          class="overflow-x-auto"
          empty={props.search ? `No Projects matching "${props.search}".` : "No AI Projects found."}
          renderCell={({ row: project, col }) => {
            if (col.id === "project") {
              return (
                <div class="flex min-w-52 items-center gap-2">
                  <i class={`${project.icon || "ti ti-folders"} text-dimmed`} aria-hidden="true" />
                  <div class="min-w-0">
                    <div class="truncate font-medium text-primary">{project.name}</div>
                    <div class="truncate text-[10px] text-dimmed">{project.shortId}</div>
                  </div>
                </div>
              );
            }
            if (col.id === "updated") return <span class="text-xs text-dimmed">{formatDateTime(project.updatedAt)}</span>;
            if (col.id === "access") return <span class="text-xs tabular-nums text-dimmed">{project.accessCount}</span>;
            if (col.id === "admins") {
              return (
                <StatusBadge
                  label={project.adminCount === 0 ? "No admins" : `${project.adminCount} ${project.adminCount === 1 ? "admin" : "admins"}`}
                  tone={project.adminCount === 0 ? "error" : "neutral"}
                />
              );
            }
            if (col.id === "actions") return <AiProjectAdminActions projectId={project.shortId} projectName={project.name} />;
            return "";
          }}
        />
      </DataPanel>
    </SettingsPage>
  );
}
