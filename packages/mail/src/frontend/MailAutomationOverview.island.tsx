import { StatCell, StatGrid } from "@valentinkolb/cloud/ui";
import { Show } from "solid-js";
import type { MailAutomationOverviewData } from "../service/automation-workspace";
import MailAutomationActivityTable from "./_components/MailAutomationActivityTable";
import MailAutomationShell from "./_components/MailAutomationShell";

export default function MailAutomationOverview(props: { data: MailAutomationOverviewData; currentUserEmail: string | null }) {
  const activeReply = () => props.data.automaticReplies.find((configuration) => configuration.enabled) ?? null;
  const activeRules = () => props.data.mailRules?.filter((rule) => rule.enabled).length ?? 0;
  const activeWorkflows = () => props.data.customWorkflows?.filter((workflow) => workflow.activeVersionId).length ?? 0;
  const failures = () =>
    props.data.recentActivity?.filter((item) => item.status === "failed" || item.status === "needs_attention").length ?? 0;
  const base = `/app/mail/${props.data.mailbox.id}/automations`;

  return (
    <MailAutomationShell
      mailbox={props.data.mailbox}
      permission={props.data.permission}
      currentUserEmail={props.currentUserEmail}
      activePage="overview"
    >
      <header>
        <h1 class="text-base font-semibold text-primary">Automations</h1>
        <p class="mt-0.5 text-xs text-dimmed">Set up common mailbox behavior, then review what ran and what needs attention.</p>
      </header>

      <StatGrid columns={props.data.permission === "admin" ? 4 : 1}>
        <StatCell
          label="Automatic reply"
          value={activeReply()?.name ?? "Off"}
          sub={activeReply() ? "Active now" : "No active reply"}
          href={`${base}/replies`}
          accent={{ tone: activeReply() ? "emerald" : "zinc", icon: activeReply() ? "ti ti-message-check" : "ti ti-message-off" }}
        />
        <Show when={props.data.permission === "admin"}>
          <StatCell
            label="Rules"
            value={activeRules()}
            sub={`${props.data.mailRules?.length ?? 0} configured`}
            href={`${base}/rules`}
            accent={{ tone: "blue", icon: "ti ti-filter-cog" }}
          />
          <StatCell
            label="Custom workflows"
            value={activeWorkflows()}
            sub={`${props.data.customWorkflows?.length ?? 0} configured`}
            href={`${base}/workflows`}
            accent={{ tone: "blue", icon: "ti ti-route" }}
          />
          <StatCell
            label="Needs attention"
            value={failures()}
            sub="Recent failed runs"
            href={`${base}/activity`}
            accent={{ tone: failures() > 0 ? "red" : "emerald", icon: failures() > 0 ? "ti ti-alert-triangle" : "ti ti-check" }}
          />
        </Show>
      </StatGrid>

      <section>
        <div class="mb-2">
          <h2 class="text-sm font-semibold text-primary">Start with a task</h2>
          <p class="mt-0.5 text-xs text-dimmed">Each shortcut opens the requested setup directly.</p>
        </div>
        <div class="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          <a class="paper flex min-h-32 items-start gap-3 p-4" href={`${base}/replies?new=out-of-office`}>
            <span class="thumbnail flex h-10 w-10 shrink-0 items-center justify-center">
              <i class="ti ti-beach" aria-hidden="true" />
            </span>
            <span>
              <span class="block text-sm font-semibold text-primary">Out of office</span>
              <span class="mt-1 block text-xs leading-relaxed text-dimmed">Reply during an absence with dates and repeat protection.</span>
            </span>
          </a>
          <a class="paper flex min-h-32 items-start gap-3 p-4" href={`${base}/replies?new=office-hours`}>
            <span class="thumbnail flex h-10 w-10 shrink-0 items-center justify-center">
              <i class="ti ti-clock-check" aria-hidden="true" />
            </span>
            <span>
              <span class="block text-sm font-semibold text-primary">Office-hours acknowledgement</span>
              <span class="mt-1 block text-xs leading-relaxed text-dimmed">Confirm receipt during the hours you choose.</span>
            </span>
          </a>
          <a class="paper flex min-h-32 items-start gap-3 p-4" href={`${base}/replies?new=reference-acknowledgement`}>
            <span class="thumbnail flex h-10 w-10 shrink-0 items-center justify-center">
              <i class="ti ti-hash" aria-hidden="true" />
            </span>
            <span>
              <span class="block text-sm font-semibold text-primary">Reference acknowledgement</span>
              <span class="mt-1 block text-xs leading-relaxed text-dimmed">Assign a durable number and include it in the response.</span>
            </span>
          </a>
          <Show when={props.data.permission === "admin"}>
            <a class="paper flex min-h-32 items-start gap-3 p-4" href={`${base}/rules?new=1`}>
              <span class="thumbnail flex h-10 w-10 shrink-0 items-center justify-center">
                <i class="ti ti-filter-plus" aria-hidden="true" />
              </span>
              <span>
                <span class="block text-sm font-semibold text-primary">Create a mail rule</span>
                <span class="mt-1 block text-xs leading-relaxed text-dimmed">Route, tag, assign, or update matching messages.</span>
              </span>
            </a>
            <a class="paper flex min-h-32 items-start gap-3 p-4" href={`${base}/workflows?new=1`}>
              <span class="thumbnail flex h-10 w-10 shrink-0 items-center justify-center">
                <i class="ti ti-code-plus" aria-hidden="true" />
              </span>
              <span>
                <span class="block text-sm font-semibold text-primary">Build a custom workflow</span>
                <span class="mt-1 block text-xs leading-relaxed text-dimmed">
                  Use YAML only when the guided tools do not cover the task.
                </span>
              </span>
            </a>
          </Show>
        </div>
      </section>

      <Show when={props.data.recentActivity}>
        {(items) => (
          <section class="paper overflow-hidden">
            <div class="flex items-start justify-between gap-3 px-3 py-3">
              <div>
                <h2 class="text-sm font-semibold text-primary">Recent activity</h2>
                <p class="mt-0.5 text-xs text-dimmed">Workflow runs and mail-rule backfills for this mailbox.</p>
              </div>
              <a class="btn-simple btn-sm" href={`${base}/activity`}>
                View all <i class="ti ti-arrow-right" aria-hidden="true" />
              </a>
            </div>
            <MailAutomationActivityTable items={items()} compact />
          </section>
        )}
      </Show>
    </MailAutomationShell>
  );
}
