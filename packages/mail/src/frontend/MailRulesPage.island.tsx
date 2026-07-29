import { createSignal } from "solid-js";
import type { MailRulesWorkspaceData } from "../service/automation-workspace";
import MailAutomationShell from "./_components/MailAutomationShell";
import MailRuleSettings from "./_components/MailRuleSettings";

export default function MailRulesPage(props: { data: MailRulesWorkspaceData; currentUserEmail: string | null; openNew: boolean }) {
  const [rules, setRules] = createSignal(props.data.mailRules);
  const base = `/app/mail/${props.data.mailbox.id}/automations/rules`;
  return (
    <MailAutomationShell
      mailbox={props.data.mailbox}
      permission={props.data.permission}
      currentUserEmail={props.currentUserEmail}
      activePage="rules"
    >
      <header>
        <h1 class="text-base font-semibold text-primary">Mail rules</h1>
        <p class="mt-0.5 text-xs text-dimmed">Process future matching messages with one or more guided actions.</p>
      </header>
      <div class="info-block-info flex items-start gap-2">
        <i class="ti ti-info-circle mt-0.5 shrink-0" aria-hidden="true" />
        <span>
          Rules run after synchronization. Applying a rule to existing mail uses a resumable backfill and remains separately observable.
        </span>
      </div>
      <MailRuleSettings
        mailboxId={props.data.mailbox.id}
        catalog={props.data.catalog}
        initialRules={rules()}
        onRulesChange={setRules}
        openNew={props.openNew}
        onOpenNewHandled={() => window.history.replaceState(window.history.state, "", base)}
      />
    </MailAutomationShell>
  );
}
