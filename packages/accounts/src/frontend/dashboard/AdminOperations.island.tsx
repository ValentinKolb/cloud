import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { prompts } from "@valentinkolb/cloud/ui";
// Platform lifecycle endpoints are owned by cloud-lib (not by an app), so
// the typed client is a cloud-lib export and is identical regardless of
// which container loads it. POST /api/admin/lifecycle/jobs takes a typed
// `kind` discriminator that the dispatcher maps to the right job.
import { coreClient } from "@valentinkolb/cloud/clients/core";
import { navigateTo } from "@valentinkolb/ssr/nav";

type JobKind = "ipa-sync" | "ipa-backfill" | "local-user-backfill" | "guest-backfill" | "reminders";
type OperationKey = "sync" | "ipa-backfill" | "local-user-backfill" | "local-guest-backfill" | "reminders";

const JOB_KIND_BY_OPERATION: Record<OperationKey, JobKind> = {
  sync: "ipa-sync",
  "ipa-backfill": "ipa-backfill",
  "local-user-backfill": "local-user-backfill",
  "local-guest-backfill": "guest-backfill",
  reminders: "reminders",
};

type OperationConfig = {
  key: OperationKey;
  label: string;
  icon: string;
  redirectTo: string;
  confirmText: string;
  loadingText: string;
  successText: string;
  description: string;
};

const OPERATIONS: readonly OperationConfig[] = [
  {
    key: "sync",
    label: "Force Sync",
    icon: "ti ti-refresh",
    redirectTo: "/admin/observability/logs?source=auth:ipa:sync",
    confirmText: "Start sync",
    loadingText: "Starting sync...",
    successText: "Sync job started.",
    description:
      "This starts an immediate FreeIPA identity sync job. Users and groups are synced. Expired IPA accounts may be demoted during the job. Detailed progress appears in the sync logs.",
  },
  {
    key: "ipa-backfill",
    label: "Force IPA Backfill",
    icon: "ti ti-user-exclamation",
    redirectTo: "/admin/observability/logs?source=auth:ipa:backfill",
    confirmText: "Start IPA backfill",
    loadingText: "Starting IPA backfill...",
    successText: "IPA backfill job started.",
    description:
      "This updates expiry dates for FreeIPA-backed accounts when they are missing or too early. Expiry is never set earlier than now plus 7 days, and a later FreeIPA expiry is not shortened.",
  },
  {
    key: "local-user-backfill",
    label: "Force Local User Backfill",
    icon: "ti ti-user-exclamation",
    redirectTo: "/admin/observability/logs?source=auth:local-user:backfill",
    confirmText: "Start local user backfill",
    loadingText: "Starting local user backfill...",
    successText: "Local user backfill job started.",
    description:
      "This updates expiry dates for local full accounts when they are missing or too early. Expiry is never set earlier than now plus 7 days.",
  },
  {
    key: "local-guest-backfill",
    label: "Force Local Guest Backfill",
    icon: "ti ti-user-exclamation",
    redirectTo: "/admin/observability/logs?source=auth:guest:backfill",
    confirmText: "Start local guest backfill",
    loadingText: "Starting local guest backfill...",
    successText: "Local guest backfill job started.",
    description:
      "This updates expiry dates for local guest accounts when they are missing or too early. Expiry is never set earlier than now plus 7 days.",
  },
  {
    key: "reminders",
    label: "Force Reminder Run",
    icon: "ti ti-mail-share",
    redirectTo: "/admin/observability/logs?source=auth:reminder:daily",
    confirmText: "Force reminder run",
    loadingText: "Starting reminder run...",
    successText: "Reminder run started.",
    description:
      "This evaluates account reminders with the current settings. Sent reminders are deduplicated by user, reminder threshold, and target expiry. Failed deliveries may be retried later.",
  },
] as const;

export default function AdminOperations(props: { freeIpaEnabled: boolean }) {
  let activeOperationKey: OperationKey | null = null;
  const runMutation = mutations.create<{ message?: string; jobId?: string }, OperationConfig>({
    mutation: async (operation) => {
      const response = await coreClient.admin.lifecycle.jobs.$post({
        json: { kind: JOB_KIND_BY_OPERATION[operation.key] },
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message ?? "Failed to start job.");
      }

      return await response.json();
    },
  });

  const handleRun = async (operation: OperationConfig) => {
    const confirmed = await prompts.confirm(operation.description, {
      title: operation.label,
      icon: operation.icon,
      confirmText: operation.confirmText,
      cancelText: "Cancel",
    });
    if (!confirmed) return;

    try {
      activeOperationKey = operation.key;
      await runMutation.mutate(operation);
      const shouldOpenLogs = await prompts.confirm(operation.successText, {
        title: "Job started",
        icon: "ti ti-check",
        confirmText: "Show Logs",
        cancelText: "Stay here",
        variant: "success",
      });
      if (shouldOpenLogs) {
        navigateTo(operation.redirectTo);
      }
    } catch (error) {
      await prompts.error(error instanceof Error ? error.message : String(error));
    } finally {
      activeOperationKey = null;
    }
  };

  return (
    <div class="paper p-2">
      <div class="flex flex-col gap-2">
        {OPERATIONS.filter((operation) => props.freeIpaEnabled || (operation.key !== "sync" && operation.key !== "ipa-backfill")).map(
          (operation) => {
            const isLoading = () => runMutation.loading() && activeOperationKey === operation.key;
            const buttonClass = operation.key === "sync" ? "btn-primary" : "btn-secondary";
            return (
              <section class="flex flex-col gap-3 rounded-lg bg-zinc-50/80 px-4 py-4 md:flex-row md:items-center md:gap-4 dark:bg-zinc-900/65">
                <div class="flex min-w-0 flex-1 items-start gap-3">
                  <div class="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-zinc-600 shadow-sm shadow-zinc-950/[0.04] dark:bg-zinc-950/75 dark:text-zinc-300 dark:shadow-none">
                    <i class={isLoading() ? "ti ti-loader-2 animate-spin text-sm" : `${operation.icon} text-sm`} />
                  </div>
                  <div class="min-w-0">
                    <h3 class="text-sm font-medium text-primary">{operation.label}</h3>
                    <p class="text-xs text-dimmed">{operation.description}</p>
                  </div>
                </div>
                <button
                  type="button"
                  class={`${buttonClass} btn-sm w-full justify-center md:w-auto md:min-w-48`}
                  onClick={() => void handleRun(operation)}
                  disabled={runMutation.loading()}
                >
                  {isLoading() ? operation.loadingText : operation.label}
                </button>
              </section>
            );
          },
        )}
      </div>
    </div>
  );
}
