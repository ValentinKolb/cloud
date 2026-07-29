import { AppWorkspace } from "@valentinkolb/cloud/ui";
import { createSignal, type JSX, Show } from "solid-js";
import type { Mailbox } from "../../contracts";
import { openMailboxSettingsDialog } from "./MailboxSettingsDialog";

export type MailAutomationPageId = "overview" | "replies" | "rules" | "activity" | "workflows";

const pageHref = (mailboxId: string, page: MailAutomationPageId): string =>
  page === "overview" ? `/app/mail/${mailboxId}/automations` : `/app/mail/${mailboxId}/automations/${page}`;

function NavigationItems(props: { mailboxId: string; activePage: MailAutomationPageId; admin: boolean; suffix: string }) {
  const item = (page: MailAutomationPageId, label: string, icon: string) => (
    <AppWorkspace.SidebarItem
      href={pageHref(props.mailboxId, page)}
      active={props.activePage === page}
      icon={icon}
      navigation="document"
      viewTransitionName={`mail-automations-${page}-${props.suffix}`}
    >
      {label}
    </AppWorkspace.SidebarItem>
  );
  return (
    <>
      <AppWorkspace.SidebarSection title="Automation">
        {item("overview", "Overview", "ti ti-layout-dashboard")}
        {item("replies", "Automatic replies", "ti ti-message-cog")}
        <Show when={props.admin}>{item("rules", "Rules", "ti ti-filter-cog")}</Show>
      </AppWorkspace.SidebarSection>
      <Show when={props.admin}>
        <AppWorkspace.SidebarSection title="Advanced">
          {item("activity", "Activity", "ti ti-activity")}
          {item("workflows", "Workflows", "ti ti-route")}
        </AppWorkspace.SidebarSection>
      </Show>
    </>
  );
}

export default function MailAutomationShell(props: {
  mailbox: Mailbox;
  permission: "read" | "write" | "admin";
  currentUserEmail: string | null;
  activePage: MailAutomationPageId;
  children: JSX.Element;
}) {
  const [settingsOpening, setSettingsOpening] = createSignal(false);
  const mailboxHref = `/app/mail/${props.mailbox.id}`;
  const openSettings = async () => {
    if (settingsOpening()) return;
    setSettingsOpening(true);
    try {
      await openMailboxSettingsDialog({
        mailboxId: props.mailbox.id,
        currentUserEmail: props.currentUserEmail,
        initialTab: "access",
      });
    } finally {
      setSettingsOpening(false);
    }
  };

  return (
    <AppWorkspace>
      <AppWorkspace.Sidebar collapsible>
        <AppWorkspace.SidebarHeader
          title="Automations"
          subtitle={props.mailbox.name}
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
            <NavigationItems
              mailboxId={props.mailbox.id}
              activePage={props.activePage}
              admin={props.permission === "admin"}
              suffix="mobile"
            />
          </AppWorkspace.SidebarMobileBody>
        </AppWorkspace.SidebarMobile>
        <AppWorkspace.SidebarDesktop>
          <AppWorkspace.SidebarBody scrollPreserveKey={`mail-automations-sidebar-${props.mailbox.id}`}>
            <NavigationItems
              mailboxId={props.mailbox.id}
              activePage={props.activePage}
              admin={props.permission === "admin"}
              suffix="desktop"
            />
          </AppWorkspace.SidebarBody>
          <AppWorkspace.SidebarFooter class="flex flex-col gap-1">
            <a href={mailboxHref} class="sidebar-item">
              <i class="ti ti-inbox" aria-hidden="true" />
              <span>Back to mailbox</span>
            </a>
            <button type="button" class="sidebar-item w-full" disabled={settingsOpening()} onClick={() => void openSettings()}>
              <i class={`ti ${settingsOpening() ? "ti-loader-2 animate-spin" : "ti-settings"}`} aria-hidden="true" />
              <span>Mailbox settings</span>
            </button>
          </AppWorkspace.SidebarFooter>
        </AppWorkspace.SidebarDesktop>
      </AppWorkspace.Sidebar>
      <AppWorkspace.Content>
        <AppWorkspace.Main class="p-[var(--ui-space-shell)]">
          <div class="min-h-0 flex-1 overflow-y-auto" style="scrollbar-gutter: stable">
            <div class="flex w-full flex-col gap-3">{props.children}</div>
          </div>
        </AppWorkspace.Main>
      </AppWorkspace.Content>
    </AppWorkspace>
  );
}
