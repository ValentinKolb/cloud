import { type LinkNavigateEvent, listenPopState, navigate } from "@k2b/ssr/nav";
import { AppWorkspace } from "@valentinkolb/cloud/ui";
import { createSignal, onCleanup, onMount, Show } from "solid-js";
import type { MailAutomationWorkspaceData } from "../service/automation-workspace";
import MailAutomaticReplySettings, { type AutomaticReplyPresetId } from "./_components/MailAutomaticReplySettings";
import { openMailboxSettingsDialog } from "./_components/MailboxSettingsDialog";
import MailResponsePolicySettings from "./_components/MailResponsePolicySettings";
import MailSenderRuleSettings from "./_components/MailSenderRuleSettings";
import MailWorkflowSettings from "./_components/MailWorkflowSettings";
import {
  isMailAutomationAdminSection,
  type MailAutomationSection,
  resolveMailAutomationSection,
} from "./_components/mail-automation-sections";

export default function MailAutomationWorkspace(props: {
  data: MailAutomationWorkspaceData;
  initialSection: string;
  currentUserEmail: string | null;
}) {
  const resolveSection = (value: string | null | undefined): MailAutomationSection =>
    resolveMailAutomationSection(value, Boolean(props.data.advanced));
  const [section, setSection] = createSignal<MailAutomationSection>(resolveSection(props.initialSection));
  const [settingsOpening, setSettingsOpening] = createSignal(false);
  const [automaticReplies, setAutomaticReplies] = createSignal(props.data.automaticReplies);
  const [automaticReplyPresetRequest, setAutomaticReplyPresetRequest] = createSignal<{
    id: AutomaticReplyPresetId;
    nonce: number;
  } | null>(null);
  const [referenceConfiguration, setReferenceConfiguration] = createSignal(props.data.referenceConfiguration);
  const [workflows, setWorkflows] = createSignal(
    (props.data.advanced?.workflows ?? []).filter(
      (workflow) => !props.data.automaticReplies.some((configuration) => configuration.workflowId === workflow.id),
    ),
  );
  const [senderRules, setSenderRules] = createSignal(props.data.advanced?.senderRules ?? []);
  let automaticReplyPresetNonce = 0;
  const mailboxHref = `/app/mail/${props.data.mailbox.id}`;
  const activeReply = () => automaticReplies().find((configuration) => configuration.enabled) ?? null;

  const sectionHref = (next: MailAutomationSection) => `${mailboxHref}/automations?section=${next}`;
  const selectSection = (next: MailAutomationSection, historyMode: "push" | "none" = "push") => {
    if (isMailAutomationAdminSection(next) && !props.data.advanced) return;
    setSection(next);
    if (historyMode === "push") navigate(sectionHref(next), { scroll: "preserve" });
  };
  const navigateSection = (event: LinkNavigateEvent, next: MailAutomationSection) => {
    if (isMailAutomationAdminSection(next) && !props.data.advanced) return event.fallback();
    setSection(next);
    event.push(undefined, { scroll: "preserve" });
  };

  onMount(() => {
    const stop = listenPopState(({ url }) => selectSection(resolveSection(url.searchParams.get("section")), "none"));
    onCleanup(stop);
  });

  const openSettings = async (initialTab?: string) => {
    if (settingsOpening()) return;
    setSettingsOpening(true);
    try {
      await openMailboxSettingsDialog({
        mailboxId: props.data.mailbox.id,
        currentUserEmail: props.currentUserEmail,
        initialTab,
      });
    } finally {
      setSettingsOpening(false);
    }
  };

  const primaryNavigation = (suffix: string) => (
    <>
      <AppWorkspace.SidebarItem
        href={`${mailboxHref}/automations?section=overview`}
        icon="ti ti-layout-dashboard"
        active={section() === "overview"}
        onNavigate={(event) => navigateSection(event, "overview")}
        viewTransitionName={`mail-automations-overview-${suffix}`}
      >
        Overview
      </AppWorkspace.SidebarItem>
      <AppWorkspace.SidebarItem
        href={`${mailboxHref}/automations?section=automatic-replies`}
        icon="ti ti-message-cog"
        active={section() === "automatic-replies"}
        onNavigate={(event) => navigateSection(event, "automatic-replies")}
        viewTransitionName={`mail-automations-replies-${suffix}`}
      >
        Automatic replies
      </AppWorkspace.SidebarItem>
    </>
  );

  const advancedNavigation = (suffix: string) => (
    <>
      <AppWorkspace.SidebarItem
        href={`${mailboxHref}/automations?section=sender-rules`}
        icon="ti ti-filter-cog"
        active={section() === "sender-rules"}
        onNavigate={(event) => navigateSection(event, "sender-rules")}
        viewTransitionName={`mail-automations-sender-rules-${suffix}`}
      >
        Sender rules
      </AppWorkspace.SidebarItem>
      <AppWorkspace.SidebarItem
        href={`${mailboxHref}/automations?section=workflows`}
        icon="ti ti-route"
        active={section() === "workflows"}
        onNavigate={(event) => navigateSection(event, "workflows")}
        viewTransitionName={`mail-automations-workflows-${suffix}`}
      >
        Workflows
      </AppWorkspace.SidebarItem>
      <AppWorkspace.SidebarItem
        href={`${mailboxHref}/automations?section=references`}
        icon="ti ti-hash"
        active={section() === "references"}
        onNavigate={(event) => navigateSection(event, "references")}
        viewTransitionName={`mail-automations-references-${suffix}`}
      >
        Reference numbers
      </AppWorkspace.SidebarItem>
    </>
  );

  return (
    <AppWorkspace>
      <AppWorkspace.Sidebar collapsible>
        <AppWorkspace.SidebarHeader
          title="Automations"
          subtitle={props.data.mailbox.name}
          icon="ti ti-route"
          action={
            <a href={mailboxHref} class="icon-btn" aria-label="Back to mailbox" title="Back to mailbox">
              <i class="ti ti-arrow-left" aria-hidden="true" />
              <span class="sr-only">Back to mailbox</span>
            </a>
          }
        />
        <AppWorkspace.SidebarMobile>
          <AppWorkspace.SidebarMobileItems>
            <a href={mailboxHref} class="sidebar-item-mobile">
              <i class="ti ti-inbox" aria-hidden="true" /> Back to mailbox
            </a>
          </AppWorkspace.SidebarMobileItems>
          <AppWorkspace.SidebarMobileBody>
            <AppWorkspace.SidebarSection title="Automations">{primaryNavigation("mobile")}</AppWorkspace.SidebarSection>
            <Show when={props.data.advanced}>
              <AppWorkspace.SidebarSection title="Advanced">{advancedNavigation("mobile")}</AppWorkspace.SidebarSection>
            </Show>
          </AppWorkspace.SidebarMobileBody>
        </AppWorkspace.SidebarMobile>
        <AppWorkspace.SidebarDesktop>
          <AppWorkspace.SidebarBody scrollPreserveKey={`mail-automations-sidebar-${props.data.mailbox.id}`}>
            <AppWorkspace.SidebarSection title="Automations">{primaryNavigation("desktop")}</AppWorkspace.SidebarSection>
            <Show when={props.data.advanced}>
              <AppWorkspace.SidebarSection title="Advanced">{advancedNavigation("desktop")}</AppWorkspace.SidebarSection>
            </Show>
          </AppWorkspace.SidebarBody>
          <AppWorkspace.SidebarFooter class="flex flex-col gap-1">
            <a href={mailboxHref} class="sidebar-item">
              <i class="ti ti-inbox" aria-hidden="true" />
              <span>Back to mailbox</span>
            </a>
            <button type="button" class="sidebar-item w-full" disabled={settingsOpening()} onClick={() => void openSettings("access")}>
              <i class={`ti ${settingsOpening() ? "ti-loader-2 animate-spin" : "ti-settings"}`} aria-hidden="true" />
              <span>Mailbox settings</span>
            </button>
          </AppWorkspace.SidebarFooter>
        </AppWorkspace.SidebarDesktop>
      </AppWorkspace.Sidebar>

      <AppWorkspace.Content>
        <AppWorkspace.Main class="p-[var(--ui-space-shell)]">
          <div class="min-h-0 flex-1 overflow-y-auto" style="scrollbar-gutter: stable">
            <div class="mx-auto flex w-full max-w-5xl flex-col gap-2">
              <Show when={section() === "overview"}>
                <header>
                  <div>
                    <h1 class="text-base font-semibold text-primary">Automations</h1>
                    <p class="mt-0.5 text-xs text-dimmed">Automatic responses and advanced mailbox processing in one place.</p>
                  </div>
                </header>
                <section class="paper p-4">
                  <div class="flex items-start gap-3">
                    <span class="thumbnail flex h-10 w-10 shrink-0 items-center justify-center">
                      <i class={`ti ${activeReply() ? "ti-message-check" : "ti-message-off"}`} aria-hidden="true" />
                    </span>
                    <div class="min-w-0 flex-1">
                      <h2 class="text-sm font-semibold text-primary">{activeReply()?.name ?? "No automatic reply is active"}</h2>
                      <p class="mt-0.5 text-xs text-dimmed">
                        {activeReply()
                          ? "Incoming messages are currently evaluated against this reply's dates, hours, and repeat protection."
                          : "Create an out-of-office reply or acknowledgement when this mailbox should answer automatically."}
                      </p>
                    </div>
                    <button type="button" class="btn-secondary btn-sm shrink-0" onClick={() => selectSection("automatic-replies")}>
                      <i class="ti ti-arrow-right" aria-hidden="true" />
                      {activeReply() ? "Review" : "Set up"}
                    </button>
                  </div>
                </section>
                <section class="grid gap-2 md:grid-cols-2">
                  <button
                    type="button"
                    class="paper flex items-start gap-3 p-4 text-left"
                    onClick={() => selectSection("automatic-replies")}
                  >
                    <i class="ti ti-beach mt-0.5 text-dimmed" aria-hidden="true" />
                    <span>
                      <span class="block text-sm font-semibold text-primary">Out of office</span>
                      <span class="mt-0.5 block text-xs text-dimmed">Reply during an absence without exposing workflow syntax.</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    class="paper flex items-start gap-3 p-4 text-left"
                    onClick={() => selectSection("automatic-replies")}
                  >
                    <i class="ti ti-clock-check mt-0.5 text-dimmed" aria-hidden="true" />
                    <span>
                      <span class="block text-sm font-semibold text-primary">Acknowledgement</span>
                      <span class="mt-0.5 block text-xs text-dimmed">Confirm receipt only during the dates and hours you choose.</span>
                    </span>
                  </button>
                </section>
              </Show>

              <Show when={section() === "automatic-replies"}>
                <header>
                  <h1 class="text-base font-semibold text-primary">Automatic replies</h1>
                  <p class="mt-0.5 text-xs text-dimmed">Create an absence notice or acknowledgement without editing a workflow.</p>
                </header>
                <MailAutomaticReplySettings
                  mailboxId={props.data.mailbox.id}
                  identities={props.data.identities}
                  initialConfigurations={automaticReplies()}
                  canManage={props.data.canManageAutomaticReplies}
                  onManageIdentities={props.data.permission === "admin" ? () => void openSettings("delivery") : undefined}
                  onConfigurationsChange={setAutomaticReplies}
                  referenceConfigured={Boolean(referenceConfiguration()?.enabled)}
                  onConfigureReference={props.data.advanced ? () => selectSection("references") : undefined}
                  presetRequest={automaticReplyPresetRequest}
                  onPresetRequestHandled={() => setAutomaticReplyPresetRequest(null)}
                  showHeader={false}
                />
              </Show>

              <Show when={section() === "workflows" && props.data.advanced}>
                <>
                  <header>
                    <h1 class="text-base font-semibold text-primary">Workflows</h1>
                    <p class="mt-0.5 text-xs text-dimmed">
                      Deterministic mailbox processing with canonical YAML and explicit version activation.
                    </p>
                  </header>
                  <div class="info-block-info flex items-start gap-2">
                    <i class="ti ti-info-circle mt-0.5 shrink-0" aria-hidden="true" />
                    <span>
                      Saving creates an immutable version. Runtime history and recovery are available centrally under Admin → Observability
                      → Workflows.
                    </span>
                  </div>
                  <MailWorkflowSettings mailboxId={props.data.mailbox.id} initialWorkflows={workflows()} onWorkflowsChange={setWorkflows} />
                </>
              </Show>

              <Show when={section() === "sender-rules" && props.data.advanced}>
                <>
                  <header>
                    <h1 class="text-base font-semibold text-primary">Sender rules</h1>
                    <p class="mt-0.5 text-xs text-dimmed">
                      Guided rules for routing, read state, provider keywords, tags, assignment, and conversation status.
                    </p>
                  </header>
                  <div class="info-block-info flex items-start gap-2">
                    <i class="ti ti-info-circle mt-0.5 shrink-0" aria-hidden="true" />
                    <span>
                      Rules process messages after synchronization and do not reject mail during SMTP delivery. Applying a rule to existing
                      messages is always previewed and confirmed separately.
                    </span>
                  </div>
                  <MailSenderRuleSettings
                    mailboxId={props.data.mailbox.id}
                    catalog={props.data.advanced!.catalog}
                    initialRules={senderRules()}
                    onRulesChange={setSenderRules}
                  />
                </>
              </Show>

              <Show when={section() === "references" && props.data.advanced}>
                <>
                  <header>
                    <h1 class="text-base font-semibold text-primary">Reference numbers</h1>
                    <p class="mt-0.5 text-xs text-dimmed">Configure permanent mailbox-scoped conversation identifiers.</p>
                  </header>
                  <MailResponsePolicySettings
                    mailboxId={props.data.mailbox.id}
                    initialConfiguration={referenceConfiguration()}
                    onConfigurationChange={setReferenceConfiguration}
                    onCreateAcknowledgement={() => {
                      setAutomaticReplyPresetRequest({
                        id: "reference-acknowledgement",
                        nonce: ++automaticReplyPresetNonce,
                      });
                      selectSection("automatic-replies");
                    }}
                    onOpenWorkflows={() => selectSection("workflows")}
                  />
                </>
              </Show>
            </div>
          </div>
        </AppWorkspace.Main>
      </AppWorkspace.Content>
    </AppWorkspace>
  );
}
