import { ssr } from "@valentinkolb/cloud/core/config";
import { type AuthContext } from "@valentinkolb/cloud/lib/server";
import { logging, type LogEntry } from "@valentinkolb/cloud/core/services";
import { AdminLayout } from "@valentinkolb/cloud/core/ssr";
import SyncAction from "./_components/SyncAction.island";

const formatDate = (dateStr: string) =>
  new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(dateStr));

const formatRelative = (dateStr: string) => {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

/** Safely parse metadata — handles both object and JSON string. */
const parseMeta = (entry: LogEntry): Record<string, unknown> | null => {
  if (!entry.metadata) return null;
  if (typeof entry.metadata === "string") {
    try {
      return JSON.parse(entry.metadata);
    } catch {
      return null;
    }
  }
  return entry.metadata;
};

/** Render metadata for a sync log entry. */
function SyncMetadata({ entry }: { entry: LogEntry }) {
  const meta = parseMeta(entry);
  if (!meta) return null;

  // Success sync: { users, groups, hosts, hostgroups }
  if (entry.level === "info" && "users" in meta) {
    return (
      <div class="flex flex-wrap gap-x-3 gap-y-1 mt-1">
        <span class="text-xs text-dimmed">
          <i class="ti ti-users text-[10px]" /> {String(meta.users)} users
        </span>
        <span class="text-xs text-dimmed">
          <i class="ti ti-users-group text-[10px]" /> {String(meta.groups)} groups
        </span>
        <span class="text-xs text-dimmed">
          <i class="ti ti-server text-[10px]" /> {String(meta.hosts)} hosts
        </span>
        <span class="text-xs text-dimmed">
          <i class="ti ti-server-cog text-[10px]" /> {String(meta.hostgroups)} hostgroups
        </span>
      </div>
    );
  }

  // Error: { error }
  if ("error" in meta) {
    return (
      <div class="mt-1">
        <span class="text-xs text-red-500">{String(meta.error)}</span>
      </div>
    );
  }

  // Fallback: show key=value pairs
  const pairs = Object.entries(meta);
  if (pairs.length === 0) return null;
  return (
    <div class="flex flex-wrap gap-x-3 gap-y-1 mt-1">
      {pairs.map(([key, value]) => (
        <span class="text-xs text-dimmed">
          {key}: {String(value)}
        </span>
      ))}
    </div>
  );
}

export default ssr<AuthContext>(async (c) => {
  const { entries } = await logging.list({ page: 1, offset: 0, perPage: 25 }, { source: "ipa-sync" });

  const lastSuccess = entries.find((e) => e.level === "info" && e.message === "Sync complete");

  return (
    <AdminLayout c={c} title="Sync">
      <div class="max-w-6xl mx-auto flex flex-col gap-4">
        {/* Header */}
        <div class="flex items-center justify-between gap-4" style="view-transition-name: page-header">
          <div class="flex items-center gap-3">
            <h1 class="text-xl font-bold text-primary">IPA Sync</h1>
            {lastSuccess && (
              <span class="text-xs text-dimmed" title={formatDate(lastSuccess.createdAt)}>
                Last sync: {formatRelative(lastSuccess.createdAt)}
              </span>
            )}
          </div>
          <SyncAction />
        </div>

        {/* Info */}
        <div class="info-block-info p-4 text-xs flex items-start gap-2">
          <i class="ti ti-info-circle shrink-0 mt-0.5" />
          <p>
            The system syncs users, groups, hosts, and hostgroups from FreeIPA to the local database automatically every 5 minutes. Use
            "Force Sync" to trigger an immediate sync.
          </p>
        </div>

        {/* Sync log */}
        <div class="flex items-center justify-between">
          <h2 class="text-sm font-semibold text-secondary">Recent Sync Log</h2>
          <a href="/admin/logs?source=ipa-sync" class="text-xs text-dimmed hover:text-primary transition-colors flex items-center gap-1">
            <i class="ti ti-arrow-right text-[10px]" />
            All logs
          </a>
        </div>

        {entries.length > 0 ? (
          <div class="flex flex-col gap-1">
            {entries.map((entry) => (
              <div class="paper px-4 py-3 flex items-start gap-3">
                <i
                  class={`ti text-xs mt-0.5 ${
                    entry.level === "error"
                      ? "ti-alert-circle text-red-500"
                      : entry.level === "warn"
                        ? "ti-alert-triangle text-yellow-500"
                        : "ti-check text-green-500"
                  }`}
                />

                <div class="flex-1 min-w-0">
                  <div class="flex items-baseline gap-2">
                    <span class="text-sm">{entry.message}</span>
                    <span class="text-xs text-dimmed whitespace-nowrap">{formatDate(entry.createdAt)}</span>
                  </div>

                  <SyncMetadata entry={entry} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div class="paper p-6 text-center text-sm text-dimmed">No sync logs yet.</div>
        )}
      </div>
    </AdminLayout>
  );
});
