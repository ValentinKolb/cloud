import { AppWorkspace } from "@valentinkolb/cloud/ui";
import type { SenderIdentity } from "../../contracts";
import type { MailFolderView } from "../../service/messages";
import ComposeMail from "./ComposeMail.island";
import SyncMailboxButton from "./SyncMailboxButton.island";

export default function MailSidebar(props: {
  mailboxId: string;
  mailboxName: string;
  folders: MailFolderView[];
  activeFolderId: string | null;
  identities: SenderIdentity[];
  canWrite: boolean;
  canAdmin: boolean;
}) {
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
          <SyncMailboxButton mailboxId={props.mailboxId} class="sidebar-item-mobile" />
        </AppWorkspace.SidebarMobileItems>
        <AppWorkspace.SidebarMobileBody scrollPreserveKey={`mail-sidebar-mobile-${props.mailboxId}`}>
          <AppWorkspace.SidebarSection>{props.folders.map((folder) => folderItem(folder, "mobile"))}</AppWorkspace.SidebarSection>
        </AppWorkspace.SidebarMobileBody>
      </AppWorkspace.SidebarMobile>
      <AppWorkspace.SidebarDesktop>
        <div class="flex flex-col gap-2">
          {props.canWrite && <ComposeMail mailboxId={props.mailboxId} identities={props.identities} class="btn-primary btn-sm w-full" />}
          <div class="grid grid-cols-2 gap-2">
            <SyncMailboxButton mailboxId={props.mailboxId} class="btn-secondary btn-sm" />
            {props.canAdmin && (
              <a href={`/app/mail/${props.mailboxId}/settings`} class="btn-secondary btn-sm">
                <i class="ti ti-settings" /> Settings
              </a>
            )}
          </div>
        </div>
        <AppWorkspace.SidebarBody scrollPreserveKey={`mail-sidebar-${props.mailboxId}`}>
          <AppWorkspace.SidebarSection title="Folders">
            <AppWorkspace.SidebarItem
              href={`/app/mail/${props.mailboxId}`}
              navigation="document"
              icon="ti ti-messages"
              active={!props.activeFolderId}
            >
              All mail
            </AppWorkspace.SidebarItem>
            {props.folders.map((folder) => folderItem(folder, "desktop"))}
          </AppWorkspace.SidebarSection>
        </AppWorkspace.SidebarBody>
      </AppWorkspace.SidebarDesktop>
    </AppWorkspace.Sidebar>
  );
}
