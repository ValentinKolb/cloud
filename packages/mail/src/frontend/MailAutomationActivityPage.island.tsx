import { StatCell, StatGrid, ButtonLink } from "@k2b/ui";
import type { MailAutomationActivityData } from "../service/automation-workspace";
import MailAutomationActivityTable from "./_components/MailAutomationActivityTable";
import MailAutomationShell from "./_components/MailAutomationShell";

export default function MailAutomationActivityPage(props: { data: MailAutomationActivityData; currentUserEmail: string | null }) {
  return (
    <MailAutomationShell
      mailbox={props.data.mailbox}
      permission={props.data.permission}
      currentUserEmail={props.currentUserEmail}
      activePage="activity"
    >
      <div class="flex flex-wrap items-start justify-between gap-3">
        <header>
          <h1 class="text-base font-semibold text-primary">Activity</h1>
          <p class="mt-0.5 text-xs text-dimmed">Workflow runs and mail-rule backfills for this mailbox during the last 30 days.</p>
        </header>
        <ButtonLink variant="secondary" size="sm" href={`/app/mail/${props.data.mailbox.id}/automations/activity`}>
          <i class="ti ti-refresh" aria-hidden="true" /> Refresh
        </ButtonLink>
      </div>
      <StatGrid columns={4}>
        <StatCell
          label="Recent activity"
          value={props.data.counts.total}
          sub="Up to 200 entries"
          accent={{ tone: "blue", icon: "ti ti-activity" }}
        />
        <StatCell
          label="In progress"
          value={props.data.counts.active}
          sub="Queued, running, or waiting"
          accent={{ tone: "blue", icon: "ti ti-loader-2" }}
        />
        <StatCell
          label="Needs attention"
          value={props.data.counts.failed}
          sub="Failed or waiting for a decision"
          accent={{
            tone: props.data.counts.failed > 0 ? "red" : "emerald",
            icon: props.data.counts.failed > 0 ? "ti ti-alert-triangle" : "ti ti-check",
          }}
        />
        <StatCell
          label="Backfills"
          value={props.data.counts.backfills}
          sub="Sender-rule history"
          accent={{ tone: "zinc", icon: "ti ti-database-import" }}
        />
      </StatGrid>
      <section class="paper overflow-hidden">
        <MailAutomationActivityTable items={props.data.items} />
      </section>
    </MailAutomationShell>
  );
}
