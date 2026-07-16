import { AppWorkspace, prompts, toast } from "@valentinkolb/cloud/ui";
import { type LinkNavigateEvent, refreshCurrentPath } from "@valentinkolb/ssr/nav";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createSignal, For } from "solid-js";
import { apiClient } from "../../api/client";
import type { ConversationView, MailDraft } from "../../contracts";
import type { ConversationViewCounts, MailFolderView } from "../../service/messages";
import type { SavedConversationView } from "../../service/saved-views";
import { readApiError } from "./api-response";

const VIEW_ITEMS: Array<{ id: ConversationView; label: string; icon: string }> = [
  { id: "inbox", label: "Inbox", icon: "ti ti-inbox" },
  { id: "mine", label: "Assigned to me", icon: "ti ti-user-check" },
  { id: "unassigned", label: "Unassigned", icon: "ti ti-user-question" },
  { id: "waiting", label: "Waiting", icon: "ti ti-clock-pause" },
  { id: "snoozed", label: "Snoozed", icon: "ti ti-clock" },
  { id: "done", label: "Done", icon: "ti ti-circle-check" },
  { id: "recently_active", label: "Recent activity", icon: "ti ti-activity" },
];

const folderIcon = (role: string): string =>
  role === "inbox"
    ? "ti ti-inbox"
    : role === "sent"
      ? "ti ti-send"
      : role === "drafts"
        ? "ti ti-file-pencil"
        : role === "trash"
          ? "ti ti-trash"
          : role === "junk"
            ? "ti ti-alert-octagon"
            : role === "archive"
              ? "ti ti-archive"
              : "ti ti-folder";

export default function MailSidebar(props: {
  mailboxId: string;
  mailboxName: string;
  folders: MailFolderView[];
  savedViews: SavedConversationView[];
  drafts: MailDraft[];
  activeFolderId: string | null;
  activeView: ConversationView | null;
  activeSavedViewId: string | null;
  viewCounts: ConversationViewCounts;
  canWrite: boolean;
  canAdmin: boolean;
  settingsOpening: boolean;
  onOpenSettings: () => void;
  onNavigate: (event: LinkNavigateEvent) => void | Promise<void>;
}) {
  const [dropFolderId, setDropFolderId] = createSignal<string | null>(null);
  const sync = mutations.create<void, void>({
    mutation: async () => {
      const response = await apiClient.mailboxes[":mailboxId"].commands.$post({
        param: { mailboxId: props.mailboxId },
        json: { kind: "sync_mailbox", idempotencyKey: crypto.randomUUID() },
      });
      if (!response.ok) throw new Error(await readApiError(response, "Failed to start synchronization"));
    },
    onSuccess: () => {
      toast.success("Mailbox synchronization started");
      refreshCurrentPath();
    },
    onError: (error) => prompts.error(error.message),
  });

  const moveConversation = mutations.create<void, { conversationId: string; sourceFolderId: string; destinationFolderId: string }>({
    mutation: async (input) => {
      if (input.sourceFolderId === input.destinationFolderId) return;
      const response = await apiClient.mailboxes[":mailboxId"].conversations[":conversationId"].actions.$post({
        param: { mailboxId: props.mailboxId, conversationId: input.conversationId },
        json: { kind: "move_to_folder", ...input, idempotencyKey: crypto.randomUUID() },
      });
      if (!response.ok) throw new Error(await readApiError(response, "Failed to move conversation"));
    },
    onSuccess: () => {
      toast.success("Conversation move queued");
      refreshCurrentPath();
    },
    onError: (error) => prompts.error(error.message),
  });

  const dropConversation = (event: DragEvent, destinationFolderId: string) => {
    event.preventDefault();
    setDropFolderId(null);
    try {
      const value = JSON.parse(event.dataTransfer?.getData("application/x-cloud-mail-conversation") ?? "") as {
        conversationId?: unknown;
        sourceFolderId?: unknown;
      };
      if (typeof value.conversationId !== "string" || typeof value.sourceFolderId !== "string") return;
      moveConversation.mutate({ conversationId: value.conversationId, sourceFolderId: value.sourceFolderId, destinationFolderId });
    } catch {
      // Ignore unrelated drags; only Mail conversation payloads are accepted.
    }
  };

  const viewItems = (suffix: string) => (
    <For each={VIEW_ITEMS}>
      {(view) => (
        <AppWorkspace.SidebarItem
          href={`/app/mail/${props.mailboxId}?view=${view.id}`}
          icon={view.icon}
          active={props.activeView === view.id}
          meta={<span class="tabular-nums">{props.viewCounts[view.id]}</span>}
          viewTransitionName={`mail-view-${view.id}-${suffix}`}
          onNavigate={props.onNavigate}
          scroll="preserve"
        >
          {view.label}
        </AppWorkspace.SidebarItem>
      )}
    </For>
  );

  const savedViewItems = (suffix: string) => (
    <For each={props.savedViews}>
      {(view) => (
        <AppWorkspace.SidebarItem
          href={`/app/mail/${props.mailboxId}?savedView=${view.id}`}
          icon={view.scope === "private" ? "ti ti-user" : "ti ti-users"}
          active={props.activeSavedViewId === view.id}
          viewTransitionName={`mail-saved-view-${view.id}-${suffix}`}
          onNavigate={props.onNavigate}
          scroll="preserve"
        >
          {view.name}
        </AppWorkspace.SidebarItem>
      )}
    </For>
  );

  const folderItems = (suffix: string) => (
    <For each={props.folders}>
      {(folder) => (
        <div
          class="rounded-md"
          role="group"
          aria-label={`Folder ${folder.name}; drop a conversation here to move it`}
          classList={{ "bg-[var(--ui-selected)]": dropFolderId() === folder.id }}
          onDragEnter={(event) => {
            if (!props.canWrite || !folder.selectable) return;
            event.preventDefault();
            setDropFolderId(folder.id);
          }}
          onDragOver={(event) => {
            if (!props.canWrite || !folder.selectable) return;
            event.preventDefault();
            if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropFolderId(null);
          }}
          onDrop={(event) => props.canWrite && folder.selectable && dropConversation(event, folder.id)}
        >
          <AppWorkspace.SidebarItem
            href={`/app/mail/${props.mailboxId}?folder=${folder.id}`}
            icon={folderIcon(folder.role)}
            active={props.activeFolderId === folder.id}
            meta={folder.unread > 0 ? <span class="tabular-nums">{folder.unread}</span> : undefined}
            title={folder.name}
            viewTransitionName={`mail-folder-${folder.id}-${suffix}`}
            onNavigate={props.onNavigate}
            scroll="preserve"
          >
            {folder.name}
          </AppWorkspace.SidebarItem>
        </div>
      )}
    </For>
  );

  const draftItems = (suffix: string) => (
    <For each={props.drafts}>
      {(draft) => (
        <AppWorkspace.SidebarItem
          href={`/app/mail/${props.mailboxId}/compose/${draft.id}?return=${encodeURIComponent(`/app/mail/${props.mailboxId}`)}`}
          icon={draft.state === "scheduled" ? "ti ti-clock" : draft.state === "sending" ? "ti ti-send" : "ti ti-file-pencil"}
          meta={draft.state === "draft" ? undefined : <span>{draft.state}</span>}
          title={draft.subject || "Untitled draft"}
          viewTransitionName={`mail-draft-${draft.id}-${suffix}`}
          navigation="document"
        >
          {draft.subject || "Untitled draft"}
        </AppWorkspace.SidebarItem>
      )}
    </For>
  );

  const allMail = () => (
    <AppWorkspace.SidebarItem
      href={`/app/mail/${props.mailboxId}`}
      icon="ti ti-mail"
      active={!props.activeFolderId && !props.activeView && !props.activeSavedViewId}
      onNavigate={props.onNavigate}
      scroll="preserve"
    >
      All mail
    </AppWorkspace.SidebarItem>
  );

  return (
    <AppWorkspace.Sidebar collapsible>
      <AppWorkspace.SidebarHeader
        title={props.mailboxName}
        subtitle="Mailbox"
        icon="ti ti-mail"
        action={
          <a href="/app/mail" class="icon-btn" aria-label="All mailboxes" title="All mailboxes">
            <i class="ti ti-switch-horizontal" aria-hidden="true" />
            <span class="sr-only">All mailboxes</span>
          </a>
        }
      />
      <AppWorkspace.SidebarMobile>
        <AppWorkspace.SidebarMobileItems>
          {props.canWrite && (
            <a href={`/app/mail/${props.mailboxId}/compose`} class="sidebar-item-mobile btn-primary btn-sm">
              <i class="ti ti-pencil" aria-hidden="true" /> Compose
            </a>
          )}
          <button type="button" class="sidebar-item-mobile" disabled={props.settingsOpening} onClick={props.onOpenSettings}>
            <i class="ti ti-settings" aria-hidden="true" /> Settings
          </button>
        </AppWorkspace.SidebarMobileItems>
        <AppWorkspace.SidebarMobileBody scrollPreserveKey={`mail-sidebar-mobile-${props.mailboxId}`}>
          <AppWorkspace.SidebarSection title="Work">{viewItems("mobile")}</AppWorkspace.SidebarSection>
          {props.savedViews.length > 0 && (
            <AppWorkspace.SidebarSection title="Saved views">{savedViewItems("mobile")}</AppWorkspace.SidebarSection>
          )}
          <AppWorkspace.SidebarSection title="Folders">
            {allMail()}
            {folderItems("mobile")}
          </AppWorkspace.SidebarSection>
          {props.canWrite && props.drafts.length > 0 && (
            <AppWorkspace.SidebarSection title="Drafts">{draftItems("mobile")}</AppWorkspace.SidebarSection>
          )}
        </AppWorkspace.SidebarMobileBody>
      </AppWorkspace.SidebarMobile>
      <AppWorkspace.SidebarDesktop>
        {props.canWrite && (
          <a href={`/app/mail/${props.mailboxId}/compose`} class="btn-primary btn-sm mx-2 mt-2">
            <i class="ti ti-pencil" aria-hidden="true" />
            <span>Compose</span>
          </a>
        )}
        <AppWorkspace.SidebarBody scrollPreserveKey={`mail-sidebar-${props.mailboxId}`}>
          <AppWorkspace.SidebarSection title="Work">{viewItems("desktop")}</AppWorkspace.SidebarSection>
          {props.savedViews.length > 0 && (
            <AppWorkspace.SidebarSection title="Saved views">{savedViewItems("desktop")}</AppWorkspace.SidebarSection>
          )}
          <AppWorkspace.SidebarSection title="Folders">
            {allMail()}
            {folderItems("desktop")}
          </AppWorkspace.SidebarSection>
          {props.canWrite && props.drafts.length > 0 && (
            <AppWorkspace.SidebarSection title="Drafts">{draftItems("desktop")}</AppWorkspace.SidebarSection>
          )}
        </AppWorkspace.SidebarBody>
        <AppWorkspace.SidebarFooter class="flex flex-col gap-1">
          {props.canAdmin && (
            <button type="button" class="sidebar-item w-full" onClick={() => sync.mutate()} disabled={sync.loading()}>
              <i class={`ti ${sync.loading() ? "ti-loader-2 animate-spin" : "ti-refresh"}`} aria-hidden="true" />
              <span>Sync mailbox</span>
            </button>
          )}
          <button type="button" class="sidebar-item w-full" disabled={props.settingsOpening} onClick={props.onOpenSettings}>
            <i class={`ti ${props.settingsOpening ? "ti-loader-2 animate-spin" : "ti-settings"}`} aria-hidden="true" />
            <span>Settings</span>
          </button>
        </AppWorkspace.SidebarFooter>
      </AppWorkspace.SidebarDesktop>
    </AppWorkspace.Sidebar>
  );
}
