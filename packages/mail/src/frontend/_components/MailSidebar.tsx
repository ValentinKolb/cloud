import { type LinkNavigateEvent, refreshCurrentPath } from "@k2b/ssr/nav";
import { AppWorkspace, Dropdown, prompts, toast } from "@valentinkolb/cloud/ui";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createMemo, createSignal, For, type JSX, onCleanup, Show } from "solid-js";
import { apiClient } from "../../api/client";
import type { ConversationView } from "../../contracts";
import type { ConversationViewCounts, MailFolderView } from "../../service/messages";
import type { SavedConversationView } from "../../service/saved-views";
import { readApiError } from "./api-response";
import { registerMailtoHandler } from "./mail-compose-route";
import { buildVisibleMailFolderTree, excludeMailFolderTreeRoles, flattenMailFolderTree, type MailFolderTreeNode } from "./mail-folder-tree";

type MailViewItem = {
  id: ConversationView;
  label: string;
  icon: string;
  description?: string;
};

const WORK_VIEW_ITEMS: MailViewItem[] = [
  { id: "needs_action", label: "Needs action", icon: "ti ti-message-reply" },
  { id: "mine", label: "Assigned to me", icon: "ti ti-user-check" },
  {
    id: "waiting",
    label: "Waiting for reply",
    icon: "ti ti-hourglass",
    description: "Waiting for someone else. New mail moves the conversation to Needs action.",
  },
  {
    id: "snoozed",
    label: "Snoozed",
    icon: "ti ti-alarm-snooze",
    description: "Hidden until its snooze time. New mail returns the conversation sooner.",
  },
  { id: "done", label: "Done", icon: "ti ti-checkbox" },
];

const SECONDARY_VIEW_ITEMS: MailViewItem[] = [
  { id: "unassigned", label: "Unassigned", icon: "ti ti-user-question" },
  { id: "recently_active", label: "Recent activity", icon: "ti ti-activity" },
];

const PRIMARY_FOLDER_ROLES = new Set(["inbox", "drafts", "sent"]);
const SECONDARY_FOLDER_ROLES = new Set(["archive", "trash", "junk"]);
const SYSTEM_FOLDER_ROLES = new Set([...PRIMARY_FOLDER_ROLES, ...SECONDARY_FOLDER_ROLES]);

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
  managementOpening: "health" | "links" | "remote-content" | null;
  settingsOpening: boolean;
  onOpenHealth: () => void;
  onOpenSharedLinks: () => void;
  onOpenRemoteContent: () => void;
  onOpenSettings: () => void;
  onMoveConversation: (input: { conversationId: string; sourceFolderId: string; destinationFolderId: string }) => void | Promise<void>;
  onNavigate: (event: LinkNavigateEvent) => void | Promise<void>;
}) {
  const [dropFolderId, setDropFolderId] = createSignal<string | null>(null);
  const [collapsedFolders, setCollapsedFolders] = createSignal<Set<string>>(new Set());
  const [moreExpanded, setMoreExpanded] = createSignal(false);
  const folderTree = createMemo(() => buildVisibleMailFolderTree(props.folders));
  const flatFolders = createMemo(() => flattenMailFolderTree(folderTree()).map(({ folder }) => folder));
  const primaryFolders = createMemo(() => flatFolders().filter((folder) => PRIMARY_FOLDER_ROLES.has(folder.role)));
  const secondaryFolders = createMemo(() => flatFolders().filter((folder) => SECONDARY_FOLDER_ROLES.has(folder.role)));
  const customFolderTree = createMemo(() => excludeMailFolderTreeRoles(folderTree(), SYSTEM_FOLDER_ROLES));
  const moreOpen = () =>
    moreExpanded() ||
    SECONDARY_VIEW_ITEMS.some((view) => props.activeView === view.id) ||
    secondaryFolders().some((folder) => props.activeFolderId === folder.id);
  const sync = mutations.create<void, void>({
    mutation: async (_input, { abortSignal }) => {
      const response = await apiClient.mailboxes[":mailboxId"].commands.$post(
        {
          param: { mailboxId: props.mailboxId },
          json: { kind: "sync_mailbox", idempotencyKey: crypto.randomUUID() },
        },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Failed to start synchronization"));
    },
    onSuccess: () => {
      toast.success("Mailbox synchronization started");
      refreshCurrentPath();
    },
    onError: (error) => prompts.error(error.message),
  });
  onCleanup(() => sync.abort());

  const registerEmailLinks = async () => {
    const result = registerMailtoHandler(navigator, window.location.origin);
    if (result.kind === "registered") {
      await prompts.alert(
        "Your browser has been asked to open email links with Cloud Mail. Confirm the browser prompt if one appears. This choice belongs to this browser or device, not to the mailbox.",
        { title: "Email link registration requested" },
      );
      return;
    }
    if (result.kind === "unsupported") {
      await prompts.alert(
        "This browser cannot register Cloud Mail for email links from the page. You can still open Cloud Mail and compose normally, or choose Cloud Mail through your browser or operating-system app settings when available.",
        { title: "Email links are not supported here" },
      );
      return;
    }
    await prompts.error(result.message, { title: "Could not register email links" });
  };

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

  const mailboxTools = (className: string) => (
    <Dropdown
      trigger={
        <button type="button" class={className} disabled={props.managementOpening !== null}>
          <i class={`ti ${props.managementOpening ? "ti-loader-2 animate-spin" : "ti-tool"}`} aria-hidden="true" />
          <span>Mailbox tools</span>
        </button>
      }
      elements={[
        ...(props.canAdmin ? [{ label: "Mailbox health", icon: "ti ti-heartbeat", action: props.onOpenHealth }] : []),
        { label: "Remote images", icon: "ti ti-photo-shield", action: props.onOpenRemoteContent },
        ...(props.canAdmin ? [{ label: "Subscriptions", icon: "ti ti-news", href: `/app/mail/${props.mailboxId}/subscriptions` }] : []),
        ...(props.canAdmin
          ? [{ label: "Sender rules", icon: "ti ti-filter-cog", href: `/app/mail/${props.mailboxId}/automations?section=sender-rules` }]
          : []),
        ...(props.canAdmin ? [{ label: "Shared links", icon: "ti ti-link", action: props.onOpenSharedLinks }] : []),
        {
          sectionLabel: "This browser",
          items: [{ label: "Open email links with Cloud Mail", icon: "ti ti-link", action: () => void registerEmailLinks() }],
        },
      ]}
      position="top-right"
    />
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
          <Show
            when={hasChildren}
            fallback={
              <Show when={depth > 0}>
                <span class="h-7 w-5 shrink-0" aria-hidden="true" />
              </Show>
            }
          >
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
        <Show when={!collapsed()}>
          <For each={node.children}>{(child) => folderNode(child, suffix, depth + 1)}</For>
        </Show>
      </>
    );
  };

  const customFolderItems = (suffix: string) => <For each={customFolderTree()}>{(node) => folderNode(node, suffix, 0)}</For>;
  const primaryFolderItems = (role: "inbox" | "drafts" | "sent", suffix: string) => (
    <For each={primaryFolders().filter((folder) => folder.role === role)}>
      {(folder) => folderNode({ folder, children: [] }, suffix, 0)}
    </For>
  );

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

  const mailItems = (suffix: string) => (
    <>
      {primaryFolderItems("inbox", suffix)}
      {primaryFolderItems("drafts", suffix)}
      {scheduledItem(suffix)}
      {primaryFolderItems("sent", suffix)}
      {allMail()}
    </>
  );

  const moreItems = (suffix: string) => (
    <AppWorkspace.SidebarSection>
      <button type="button" class="sidebar-item w-full" aria-expanded={moreOpen()} onClick={() => setMoreExpanded((current) => !current)}>
        <i class={`ti ${moreOpen() ? "ti-chevron-down" : "ti-chevron-right"}`} aria-hidden="true" />
        <span>More</span>
      </button>
      <Show when={moreOpen()}>
        {viewItems(SECONDARY_VIEW_ITEMS, `${suffix}-more`)}
        <For each={secondaryFolders()}>{(folder) => folderNode({ folder, children: [] }, suffix, 0)}</For>
      </Show>
    </AppWorkspace.SidebarSection>
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
            <a href={`/app/mail/compose?mailbox=${props.mailboxId}`} class="mail-compose-action sidebar-item-mobile btn-primary btn-sm">
              <i class="ti ti-pencil" aria-hidden="true" /> Compose
            </a>
          )}
          {automationsItem("mobile-action")}
          {mailboxTools("sidebar-item-mobile")}
          <button type="button" class="sidebar-item-mobile" disabled={props.settingsOpening} onClick={props.onOpenSettings}>
            <i class="ti ti-settings" aria-hidden="true" /> Settings
          </button>
        </AppWorkspace.SidebarMobileItems>
        <AppWorkspace.SidebarMobileBody scrollPreserveKey={`mail-sidebar-mobile-${props.mailboxId}`}>
          <AppWorkspace.SidebarSection title="Work">{viewItems(WORK_VIEW_ITEMS, "mobile")}</AppWorkspace.SidebarSection>
          <AppWorkspace.SidebarSection title="Mail">{mailItems("mobile")}</AppWorkspace.SidebarSection>
          <Show when={flattenMailFolderTree(customFolderTree()).length > 0}>
            <AppWorkspace.SidebarSection title="Folders">{customFolderItems("mobile")}</AppWorkspace.SidebarSection>
          </Show>
          {props.savedViews.length > 0 && (
            <AppWorkspace.SidebarSection title="Saved views">{savedViewItems("mobile")}</AppWorkspace.SidebarSection>
          )}
          {moreItems("mobile")}
        </AppWorkspace.SidebarMobileBody>
      </AppWorkspace.SidebarMobile>
      <AppWorkspace.SidebarDesktop>
        {props.canWrite && (
          <a href={`/app/mail/compose?mailbox=${props.mailboxId}`} class="mail-compose-action btn-primary btn-sm mx-2 mt-2">
            <i class="ti ti-pencil" aria-hidden="true" />
            <span>Compose</span>
          </a>
        )}
        <AppWorkspace.SidebarBody scrollPreserveKey={`mail-sidebar-${props.mailboxId}`}>
          <AppWorkspace.SidebarSection title="Work">{viewItems(WORK_VIEW_ITEMS, "desktop")}</AppWorkspace.SidebarSection>
          <AppWorkspace.SidebarSection title="Mail">{mailItems("desktop")}</AppWorkspace.SidebarSection>
          <Show when={flattenMailFolderTree(customFolderTree()).length > 0}>
            <AppWorkspace.SidebarSection title="Folders">{customFolderItems("desktop")}</AppWorkspace.SidebarSection>
          </Show>
          {props.savedViews.length > 0 && (
            <AppWorkspace.SidebarSection title="Saved views">{savedViewItems("desktop")}</AppWorkspace.SidebarSection>
          )}
          {moreItems("desktop")}
        </AppWorkspace.SidebarBody>
        <AppWorkspace.SidebarFooter class="flex flex-col gap-1">
          {props.canAdmin && (
            <button
              type="button"
              class="sidebar-item w-full"
              onClick={props.syncEnabled ? () => sync.mutate() : props.onOpenHealth}
              disabled={sync.loading() || props.managementOpening !== null}
              title={props.syncEnabled ? "Synchronize mailbox now" : "Open mailbox health to resume synchronization"}
            >
              <i class={`ti ${sync.loading() ? "ti-loader-2 animate-spin" : "ti-refresh"}`} aria-hidden="true" />
              <span>{props.syncEnabled ? "Sync mailbox" : "Mailbox paused"}</span>
            </button>
          )}
          {automationsItem("desktop-footer")}
          {mailboxTools("sidebar-item w-full")}
          <button type="button" class="sidebar-item w-full" disabled={props.settingsOpening} onClick={props.onOpenSettings}>
            <i class={`ti ${props.settingsOpening ? "ti-loader-2 animate-spin" : "ti-settings"}`} aria-hidden="true" />
            <span>Settings</span>
          </button>
        </AppWorkspace.SidebarFooter>
      </AppWorkspace.SidebarDesktop>
    </AppWorkspace.Sidebar>
  );
}
