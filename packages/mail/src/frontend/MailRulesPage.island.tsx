import { createSignal } from "solid-js";
import type { MailAiAutomationKind } from "../contracts";
import type { MailRulesWorkspaceData } from "../service/automation-workspace";
import MailAiAutomationSettings from "./_components/MailAiAutomationSettings";
import MailAutomationShell from "./_components/MailAutomationShell";
import MailRuleSettings from "./_components/MailRuleSettings";

export default function MailRulesPage(props: {
  data: MailRulesWorkspaceData;
  currentUserEmail: string | null;
  openNewRule: boolean;
  openNewAiKind: MailAiAutomationKind | null;
}) {
  const [rules, setRules] = createSignal(props.data.mailRules);
  const [aiAutomations, setAiAutomations] = createSignal(props.data.aiAutomations);
  const base = `/app/mail/${props.data.mailbox.id}/automations/rules`;
  return (
    <MailAutomationShell
      mailbox={props.data.mailbox}
      permission={props.data.permission}
      currentUserEmail={props.currentUserEmail}
      activePage="rules"
    >
      <header>
        <h1 class="text-base font-semibold text-primary">Incoming mail</h1>
        <p class="mt-0.5 text-xs text-dimmed">Process future messages with deterministic rules or bounded AI tasks.</p>
      </header>
      <div class="info-block-info flex items-start gap-2">
        <i class="ti ti-info-circle mt-0.5 shrink-0" aria-hidden="true" />
        <span>
          Rules can process existing mail through a resumable backfill. AI automations only run for future incoming messages, and each
          active matching automation makes its own AI call.
        </span>
      </div>
      <MailRuleSettings
        mailboxId={props.data.mailbox.id}
        catalog={props.data.catalog}
        initialRules={rules()}
        onRulesChange={setRules}
        openNew={props.openNewRule}
        onOpenNewHandled={() => window.history.replaceState(window.history.state, "", base)}
      />
      <MailAiAutomationSettings
        mailboxId={props.data.mailbox.id}
        catalog={props.data.catalog}
        initialAutomations={aiAutomations()}
        onAutomationsChange={setAiAutomations}
        openNewKind={props.openNewAiKind}
        onOpenNewHandled={() => window.history.replaceState(window.history.state, "", base)}
      />
    </MailAutomationShell>
  );
}
