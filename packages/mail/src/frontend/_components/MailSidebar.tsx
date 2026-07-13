import { AppWorkspace } from "@valentinkolb/cloud/ui";
import type { ConversationView, SenderIdentity } from "../../contracts";
import type { ConversationViewCounts, MailFolderView } from "../../service/messages";
import ComposeMail from "./ComposeMail.island";
import MailboxSettingsButton from "./MailboxSettingsButton.island";
import SyncMailboxButton from "./SyncMailboxButton.island";

const VIEW_ITEMS: Array<{ id: ConversationView; label: string; icon: string }> = [
  { id: "inbox", label: "Inbox", icon: "ti ti-inbox" },
  { id: "mine", label: "Assigned to me", icon: "ti ti-user-check" },
  { id: "unassigned", label: "Unassigned", icon: "ti ti-user-question" },
  { id: "waiting", label: "Waiting", icon: "ti ti-clock-pause" },
  { id: "snoozed", label: "Snoozed", icon: "ti ti-clock" },
  { id: "done", label: "Done", icon: "ti ti-circle-check" },
  { id: "recently_active", label: "Recent activity", icon: "ti ti-activity" },
];

export default function MailSidebar(props: {
  mailboxId: string;
  mailboxName: string;
  folders: MailFolderView[];
  activeFolderId: string | null;
  activeView: ConversationView | null;
  viewCounts: ConversationViewCounts;
  identities: SenderIdentity[];
  currentUserId: string;
  currentUserEmail: string | null;
  permission: "read" | "write" | "admin";
  canWrite: boolean;
  canAdmin: boolean;
}) {
  const viewItems = (suffix: string) =>
    VIEW_ITEMS.map((view) => (
      <AppWorkspace.SidebarItem
        href={`/app/mail/${props.mailboxId}?view=${view.id}`}
        navigation="document"
        icon={view.icon}
        active={props.activeView === view.id}
        meta={<span class="tabular-nums">{props.viewCounts[view.id]}</span>}
        viewTransitionName={`mail-view-${view.id}-${suffix}`}
      >
        {view.label}
      </AppWorkspace.SidebarItem>
    ));
  const folderItem = (folder: MailFolderView, suffix: string) => (
    <AppWorkspace.SidebarItem
      href={`/app/mail/${props.mailboxId}?folder=${folder.id}`}
      navigation="document"
      icon={
        folder.role === "inbox"
          ? "ti ti-inbox"
          : folder.role === "sent"
            ? "ti ti-send"
            : folder.role === "trash"
              ? "ti ti-trash"
              : "ti ti-folder"
      }
      active={props.activeFolderId === folder.id}
      viewTransitionName={`mail-folder-${folder.id}-${suffix}`}
    >
      <span class="flex min-w-0 flex-1 items-center justify-between gap-2">
        <span class="truncate">{folder.name}</span>
        {folder.unread > 0 && <span class="text-2xs tabular-nums text-dimmed">{folder.unread}</span>}
      </span>
    </AppWorkspace.SidebarItem>
  );
  return (
    <AppWorkspace.Sidebar>
      <AppWorkspace.SidebarHeader title={props.mailboxName} icon="ti ti-mail" showDesktop={false} />
      <AppWorkspace.SidebarMobile>
        <AppWorkspace.SidebarMobileItems>
          {props.canWrite && (
            <ComposeMail mailboxId={props.mailboxId} identities={props.identities} class="sidebar-item-mobile btn-primary btn-sm" />
          )}
          <MailboxSettingsButton
            mailboxId={props.mailboxId}
            currentUserId={props.currentUserId}
            currentUserEmail={props.currentUserEmail}
            permission={props.permission}
            class="sidebar-item-mobile"
          />
        </AppWorkspace.SidebarMobileItems>
        <AppWorkspace.SidebarMobileBody scrollPreserveKey={`mail-sidebar-mobile-${props.mailboxId}`}>
          <AppWorkspace.SidebarSection title="Work">{viewItems("mobile")}</AppWorkspace.SidebarSection>
          <AppWorkspace.SidebarSection title="Folders">
            <AppWorkspace.SidebarItem
              href={`/app/mail/${props.mailboxId}`}
              navigation="document"
              icon="ti ti-mail"
              active={!props.activeFolderId && !props.activeView}
            >
              All mail
            </AppWorkspace.SidebarItem>
            {props.folders.map((folder) => folderItem(folder, "mobile"))}
          </AppWorkspace.SidebarSection>
        </AppWorkspace.SidebarMobileBody>
      </AppWorkspace.SidebarMobile>
      <AppWorkspace.SidebarDesktop>
        {props.canWrite && <ComposeMail mailboxId={props.mailboxId} identities={props.identities} class="btn-primary btn-sm mx-2 mt-2" />}
        <AppWorkspace.SidebarBody scrollPreserveKey={`mail-sidebar-${props.mailboxId}`}>
          <AppWorkspace.SidebarSection title="Work">{viewItems("desktop")}</AppWorkspace.SidebarSection>
          <AppWorkspace.SidebarSection title="Folders">
            <AppWorkspace.SidebarItem
              href={`/app/mail/${props.mailboxId}`}
              navigation="document"
              icon="ti ti-mail"
              active={!props.activeFolderId && !props.activeView}
            >
              All mail
            </AppWorkspace.SidebarItem>
            {props.folders.map((folder) => folderItem(folder, "desktop"))}
          </AppWorkspace.SidebarSection>
        </AppWorkspace.SidebarBody>
        <AppWorkspace.SidebarFooter class="flex flex-col gap-1">
          {props.canAdmin && <SyncMailboxButton mailboxId={props.mailboxId} class="sidebar-item w-full" />}
          <MailboxSettingsButton
            mailboxId={props.mailboxId}
            currentUserId={props.currentUserId}
            currentUserEmail={props.currentUserEmail}
            permission={props.permission}
            class="sidebar-item w-full"
          />
        </AppWorkspace.SidebarFooter>
      </AppWorkspace.SidebarDesktop>
    </AppWorkspace.Sidebar>
  );
}
