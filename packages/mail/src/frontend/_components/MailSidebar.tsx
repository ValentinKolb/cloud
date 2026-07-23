import { AppWorkspace, prompts, toast } from "@valentinkolb/cloud/ui";
import { type LinkNavigateEvent, refreshCurrentPath } from "@valentinkolb/ssr/nav";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createMemo, createSignal, For, type JSX, Show } from "solid-js";
import { apiClient } from "../../api/client";
import type { ConversationView } from "../../contracts";
import type { ConversationViewCounts, MailFolderView } from "../../service/messages";
import type { SavedConversationView } from "../../service/saved-views";
import { readApiError } from "./api-response";
import { buildVisibleMailFolderTree, flattenMailFolderTree, type MailFolderTreeNode } from "./mail-folder-tree";

type MailViewItem = {
  id: ConversationView;
  label: string;
  icon: string;
  description?: string;
};

const WORK_VIEW_ITEMS: MailViewItem[] = [
  { id: "needs_action", label: "Needs action", icon: "ti ti-message-reply" },
  { id: "mine", label: "Assigned to me", icon: "ti ti-user-check" },
  { id: "unassigned", label: "Unassigned", icon: "ti ti-user-question" },
  {
    id: "waiting",
    label: "Waiting for reply",
    icon: "ti ti-hourglass",
    description: "Waiting for someone else. New mail moves the conversation to Needs action.",
  },
  { id: "done", label: "Done", icon: "ti ti-checkbox" },
  { id: "recently_active", label: "Recent activity", icon: "ti ti-activity" },
];

const FOLLOW_UP_VIEW_ITEMS: MailViewItem[] = [
  {
    id: "snoozed",
    label: "Snoozed",
    icon: "ti ti-alarm-snooze",
    description: "Hidden until its snooze time. New mail returns the conversation sooner.",
  },
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
  syncEnabled: boolean;
  folders: MailFolderView[];
  savedViews: SavedConversationView[];
  scheduledMode: boolean;
  scheduledCount: number;
  activeFolderId: string | null;
  activeView: ConversationView | null;
  activeSavedViewId: string | null;
  viewCounts: ConversationViewCounts;
  canWrite: boolean;
  canAdmin: boolean;
  settingsOpening: boolean;
  onOpenSettings: () => void;
  onMoveConversation: (input: { conversationId: string; sourceFolderId: string; destinationFolderId: string }) => void | Promise<void>;
  onNavigate: (event: LinkNavigateEvent) => void | Promise<void>;
}) {
  const [dropFolderId, setDropFolderId] = createSignal<string | null>(null);
  const [collapsedFolders, setCollapsedFolders] = createSignal<Set<string>>(new Set());
  const folderTree = createMemo(() => buildVisibleMailFolderTree(props.folders));
  const hasVisibleDrafts = createMemo(() => flattenMailFolderTree(folderTree()).some(({ folder }) => folder.role === "drafts"));
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

  const dropConversation = (event: DragEvent, destinationFolderId: string) => {
    event.preventDefault();
    setDropFolderId(null);
    try {
      const value = JSON.parse(event.dataTransfer?.getData("application/x-cloud-mail-conversation") ?? "") as {
        conversationId?: unknown;
        sourceFolderId?: unknown;
      };
      if (typeof value.conversationId !== "string" || typeof value.sourceFolderId !== "string") return;
      void props.onMoveConversation({
        conversationId: value.conversationId,
        sourceFolderId: value.sourceFolderId,
        destinationFolderId,
      });
    } catch {
      // Ignore unrelated drags; only Mail conversation payloads are accepted.
    }
  };

  const viewItems = (items: MailViewItem[], suffix: string) => (
    <>
      <For each={items}>
        {(view) => (
          <AppWorkspace.SidebarItem
            href={`/app/mail/${props.mailboxId}?view=${view.id}`}
            icon={view.icon}
            active={!props.scheduledMode && props.activeView === view.id}
            meta={<span class="tabular-nums">{props.viewCounts[view.id]}</span>}
            title={view.description}
            viewTransitionName={`mail-view-${view.id}-${suffix}`}
            onNavigate={props.onNavigate}
            scroll="preserve"
          >
            {view.label}
          </AppWorkspace.SidebarItem>
        )}
      </For>
    </>
  );

  const scheduledItem = (suffix: string) => (
    <AppWorkspace.SidebarItem
      href={`/app/mail/${props.mailboxId}?scheduled=1`}
      icon="ti ti-calendar-time"
      active={props.scheduledMode}
      meta={<span class="tabular-nums">{props.scheduledCount}</span>}
      viewTransitionName={`mail-scheduled-${suffix}`}
      onNavigate={props.onNavigate}
      scroll="preserve"
    >
      Scheduled
    </AppWorkspace.SidebarItem>
  );

  const automationsItem = (suffix: string) => (
    <AppWorkspace.SidebarItem
      href={`/app/mail/${props.mailboxId}/automations`}
      icon="ti ti-route"
      navigation="document"
      viewTransitionName={`mail-automations-${suffix}`}
    >
      Automations
    </AppWorkspace.SidebarItem>
  );

  const toggleFolder = (folderId: string) =>
    setCollapsedFolders((current) => {
      const next = new Set(current);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });

  const folderNode = (node: MailFolderTreeNode, suffix: string, depth: number): JSX.Element => {
    const folder = node.folder;
    const hasChildren = node.children.length > 0;
    const collapsed = () => collapsedFolders().has(folder.id);
    return (
      <>
        <div
          class="flex items-center rounded-md"
          role="group"
          aria-label={`Folder ${folder.name}; drop a conversation here to move it`}
          style={{ "padding-left": `${depth * 12}px` }}
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
          <Show when={hasChildren} fallback={<span class="h-7 w-5 shrink-0" aria-hidden="true" />}>
            <button
              type="button"
              class="icon-btn h-7 w-5 shrink-0"
              aria-label={`${collapsed() ? "Expand" : "Collapse"} ${folder.name}`}
              aria-expanded={!collapsed()}
              onClick={() => toggleFolder(folder.id)}
            >
              <i class={`ti ${collapsed() ? "ti-chevron-right" : "ti-chevron-down"} text-xs`} aria-hidden="true" />
            </button>
          </Show>
          <div class="min-w-0 flex-1">
            <AppWorkspace.SidebarItem
              href={folder.selectable ? `/app/mail/${props.mailboxId}?folder=${folder.id}` : undefined}
              icon={folderIcon(folder.role)}
              active={props.activeFolderId === folder.id}
              meta={folder.unread > 0 ? <span class="tabular-nums">{folder.unread}</span> : undefined}
              title={folder.name}
              viewTransitionName={`mail-folder-${folder.id}-${suffix}`}
              onNavigate={folder.selectable ? props.onNavigate : undefined}
              scroll="preserve"
            >
              {folder.name}
            </AppWorkspace.SidebarItem>
          </div>
        </div>
        <Show when={folder.role === "drafts"}>{scheduledItem(suffix)}</Show>
        <Show when={!collapsed()}>
          <For each={node.children}>{(child) => folderNode(child, suffix, depth + 1)}</For>
        </Show>
      </>
    );
  };

  const folderItems = (suffix: string) => <For each={folderTree()}>{(node) => folderNode(node, suffix, 0)}</For>;

  const allMail = () => (
    <AppWorkspace.SidebarItem
      href={`/app/mail/${props.mailboxId}`}
      icon="ti ti-mail"
      active={!props.scheduledMode && !props.activeFolderId && !props.activeView && !props.activeSavedViewId}
      onNavigate={props.onNavigate}
      scroll="preserve"
    >
      All mail
    </AppWorkspace.SidebarItem>
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
            <a href={`/app/mail/${props.mailboxId}/compose`} class="mail-compose-action sidebar-item-mobile btn-primary btn-sm">
              <i class="ti ti-pencil" aria-hidden="true" /> Compose
            </a>
          )}
          {automationsItem("mobile-action")}
          <button type="button" class="sidebar-item-mobile" disabled={props.settingsOpening} onClick={props.onOpenSettings}>
            <i class="ti ti-settings" aria-hidden="true" /> Settings
          </button>
        </AppWorkspace.SidebarMobileItems>
        <AppWorkspace.SidebarMobileBody scrollPreserveKey={`mail-sidebar-mobile-${props.mailboxId}`}>
          <AppWorkspace.SidebarSection title="Work">{viewItems(WORK_VIEW_ITEMS, "mobile")}</AppWorkspace.SidebarSection>
          <AppWorkspace.SidebarSection title="Follow-up">{viewItems(FOLLOW_UP_VIEW_ITEMS, "mobile")}</AppWorkspace.SidebarSection>
          {props.savedViews.length > 0 && (
            <AppWorkspace.SidebarSection title="Saved views">{savedViewItems("mobile")}</AppWorkspace.SidebarSection>
          )}
          <AppWorkspace.SidebarSection title="Folders">
            {allMail()}
            <Show when={!hasVisibleDrafts()}>{scheduledItem("mobile")}</Show>
            {folderItems("mobile")}
          </AppWorkspace.SidebarSection>
        </AppWorkspace.SidebarMobileBody>
      </AppWorkspace.SidebarMobile>
      <AppWorkspace.SidebarDesktop>
        {props.canWrite && (
          <a href={`/app/mail/${props.mailboxId}/compose`} class="mail-compose-action btn-primary btn-sm mx-2 mt-2">
            <i class="ti ti-pencil" aria-hidden="true" />
            <span>Compose</span>
          </a>
        )}
        <AppWorkspace.SidebarBody scrollPreserveKey={`mail-sidebar-${props.mailboxId}`}>
          <AppWorkspace.SidebarSection title="Work">{viewItems(WORK_VIEW_ITEMS, "desktop")}</AppWorkspace.SidebarSection>
          <AppWorkspace.SidebarSection title="Follow-up">{viewItems(FOLLOW_UP_VIEW_ITEMS, "desktop")}</AppWorkspace.SidebarSection>
          {props.savedViews.length > 0 && (
            <AppWorkspace.SidebarSection title="Saved views">{savedViewItems("desktop")}</AppWorkspace.SidebarSection>
          )}
          <AppWorkspace.SidebarSection title="Folders">
            {allMail()}
            <Show when={!hasVisibleDrafts()}>{scheduledItem("desktop")}</Show>
            {folderItems("desktop")}
          </AppWorkspace.SidebarSection>
        </AppWorkspace.SidebarBody>
        <AppWorkspace.SidebarFooter class="flex flex-col gap-1">
          {props.canAdmin && (
            <button
              type="button"
              class="sidebar-item w-full"
              onClick={() => sync.mutate()}
              disabled={sync.loading() || !props.syncEnabled}
              title={props.syncEnabled ? "Synchronize mailbox now" : "Resume the mailbox in Status settings before synchronizing"}
            >
              <i class={`ti ${sync.loading() ? "ti-loader-2 animate-spin" : "ti-refresh"}`} aria-hidden="true" />
              <span>{props.syncEnabled ? "Sync mailbox" : "Mailbox paused"}</span>
            </button>
          )}
          {automationsItem("desktop-footer")}
          <button type="button" class="sidebar-item w-full" disabled={props.settingsOpening} onClick={props.onOpenSettings}>
            <i class={`ti ${props.settingsOpening ? "ti-loader-2 animate-spin" : "ti-settings"}`} aria-hidden="true" />
            <span>Settings</span>
          </button>
        </AppWorkspace.SidebarFooter>
      </AppWorkspace.SidebarDesktop>
    </AppWorkspace.Sidebar>
  );
}
