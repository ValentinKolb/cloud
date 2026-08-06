import type { MailIncomingAutomationsWorkspaceData } from "../service/automation-workspace";
import MailAutomationShell from "./_components/MailAutomationShell";
import MailIncomingAutomationSettings, { type IncomingAutomationPreset } from "./_components/MailIncomingAutomationSettings";

export default function MailIncomingAutomationsPage(props: {
  data: MailIncomingAutomationsWorkspaceData;
  currentUserEmail: string | null;
  openPreset: IncomingAutomationPreset | null;
}) {
  const base = `/app/mail/${props.data.mailbox.id}/automations/incoming`;
  return (
    <MailAutomationShell
      mailbox={props.data.mailbox}
      permission={props.data.permission}
      currentUserEmail={props.currentUserEmail}
      activePage="incoming"
    >
      <header>
        <h1 class="text-base font-semibold text-primary">Incoming mail</h1>
        <p class="mt-0.5 text-xs text-dimmed">Build one clear flow from direct mail actions, AI steps, and branches.</p>
      </header>
      <div class="info-block-info flex items-start gap-2">
        <i class="ti ti-info-circle mt-0.5 shrink-0" aria-hidden="true" />
        <span>
          Deterministic flows can also process existing mail. A flow containing AI starts with future mail and creates drafts only for human
          review; it never sends them.
        </span>
      </div>
      <MailIncomingAutomationSettings
        mailboxId={props.data.mailbox.id}
        catalog={props.data.catalog}
        initialAutomations={props.data.incomingAutomations}
        openPreset={props.openPreset}
        onOpenPresetHandled={() => window.history.replaceState(window.history.state, "", base)}
      />
    </MailAutomationShell>
  );
}
