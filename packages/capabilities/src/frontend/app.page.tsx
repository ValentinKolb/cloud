import { AppOverview, DataTable, type DataTableColumn, StatusBadge } from "@k2b/ui";
import type { CapabilityActionManifest, CapabilityQueryManifest } from "@valentinkolb/cloud/contracts";
import type { AuthContext } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";
import { loadCapabilityApp } from "../catalog";
import { ssr } from "../config";
import { type CapabilityKind, capabilityHref } from "../routes";
import CapabilitySearchButton, { type CapabilitySearchEntry } from "./CapabilitySearchButton.island";

type OperationRow = {
  kind: CapabilityKind;
  localId: string;
  id: string;
  title: string;
  description: string;
  href: string;
  action?: CapabilityActionManifest;
};

const operationRows = (appId: string, queries: CapabilityQueryManifest[], actions: CapabilityActionManifest[]): OperationRow[] => [
  ...queries.map((operation) => ({
    kind: "query" as const,
    localId: operation.localId,
    id: operation.id,
    title: operation.title,
    description: operation.description,
    href: capabilityHref({ appId, kind: "query", capabilityId: operation.localId }),
  })),
  ...actions.map((operation) => ({
    kind: "action" as const,
    localId: operation.localId,
    id: operation.id,
    title: operation.title,
    description: operation.description,
    href: capabilityHref({ appId, kind: "action", capabilityId: operation.localId }),
    action: operation,
  })),
];

const columns: DataTableColumn<OperationRow>[] = [
  { id: "kind", header: "Type", value: "kind", class: "w-28" },
  { id: "capability", header: "Capability", value: "title" },
  { id: "id", header: "ID", value: "id", class: "w-72" },
  { id: "policy", header: "Policy", class: "w-40" },
  { id: "open", header: "", class: "w-14" },
];

const countLabel = (count: number, singular: string): string => `${count} ${count === 1 ? singular : `${singular}s`}`;

export default ssr<AuthContext>(async (c) => {
  const appId = c.req.param("appId");
  if (!appId) return c.notFound();
  const loaded = await loadCapabilityApp(appId);
  if (loaded.kind === "not-found") return c.notFound();

  c.get("page").title = loaded.app.name;
  if (loaded.kind === "unavailable") {
    return () => (
      <Layout c={c} title={[{ title: "Capabilities", href: capabilityHref({}) }, { title: loaded.app.name }]}>
        <div class="k2b-ui min-w-0 flex-1">
          <AppOverview
            title={loaded.app.name}
            subtitle="Its capability manifest is temporarily unavailable."
            icon={loaded.app.icon || "ti ti-apps"}
          >
            <AppOverview.Main title="Unavailable">
              <AppOverview.EmptyState
                title="Capability manifest unavailable"
                description="The app changed or disconnected while the catalog was loading. Refresh to try again."
                icon="ti ti-plug-connected-x"
              />
            </AppOverview.Main>
          </AppOverview>
        </div>
      </Layout>
    );
  }

  const rows = operationRows(loaded.app.id, loaded.manifest.queries, loaded.manifest.actions);
  const searchEntries: CapabilitySearchEntry[] = rows.map((row) => ({
    href: row.href,
    label: row.title,
    description: `${row.kind === "query" ? "Query" : "Action"} · ${row.description}`,
    icon: row.kind === "query" ? "ti ti-search" : "ti ti-bolt",
  }));

  return () => (
    <Layout c={c} fullWidth title={[{ title: "Capabilities", href: capabilityHref({}) }, { title: loaded.app.name }]}>
      <div class="k2b-ui min-w-0 flex-1">
        <AppOverview title={loaded.app.name} subtitle={loaded.app.description} icon={loaded.app.icon || "ti ti-apps"}>
          <AppOverview.Main
            title="Queries and actions"
            description={`${countLabel(loaded.manifest.queries.length, "query")} · ${countLabel(loaded.manifest.actions.length, "action")}`}
            toolbar={<CapabilitySearchButton entries={searchEntries} registerShortcut />}
          >
            <DataTable
              rows={rows}
              columns={columns}
              getRowId={(row) => `${row.kind}:${row.localId}`}
              ariaLabel={`${loaded.app.name} capabilities`}
              class="paper overflow-x-auto"
              density="compact"
              highlightColumns={false}
              renderCell={({ row, col }) => {
                if (col.id === "kind") {
                  return <StatusBadge tone="neutral" label={row.kind === "query" ? "Query" : "Action"} />;
                }
                if (col.id === "capability") {
                  return (
                    <a href={row.href} class="group block min-w-0" title={row.description}>
                      <span class="block truncate font-medium text-primary transition-colors group-hover:app-accent-text">{row.title}</span>
                      <span class="block truncate text-xs text-dimmed">{row.description}</span>
                    </a>
                  );
                }
                if (col.id === "id") return <code class="text-xs text-dimmed">{row.id}</code>;
                if (col.id === "policy") {
                  if (!row.action) return <span class="text-xs text-dimmed">Read only</span>;
                  return (
                    <StatusBadge
                      tone={row.action.destructive ? "warning" : "neutral"}
                      label={row.action.destructive ? "Destructive" : "Write"}
                    />
                  );
                }
                if (col.id === "open") {
                  return (
                    <a class="btn-input btn-sm btn-icon" href={row.href} aria-label={`Open ${row.title}`} title={`Open ${row.title}`}>
                      <i class="ti ti-chevron-right" aria-hidden="true" />
                      <span class="sr-only">Open {row.title}</span>
                    </a>
                  );
                }
                return null;
              }}
            />
          </AppOverview.Main>
        </AppOverview>
      </div>
    </Layout>
  );
});
