import type { AiConversation } from "@valentinkolb/cloud/ai";
import {
  AppWorkspace,
  dialogCore,
  IconInput,
  isSpotlightShortcut,
  openSpotlightSearch,
  PanelDialog,
  panelDialogOptions,
  prompts,
  SpotlightButton,
  SPOTLIGHT_SHORTCUT_TITLE,
  TextInput,
  toast,
  type SpotlightButtonVariant,
} from "@valentinkolb/cloud/ui";
import { navigateTo } from "@valentinkolb/ssr/nav";
import { mutation } from "@valentinkolb/stdlib/solid";
import { createSignal, For, onCleanup, onMount, Show, type Accessor } from "solid-js";
import { apiClient } from "../api/client";

type ConversationGroup = {
  title: string;
  items: AiConversation[];
};

type AssistantSidebarProps = {
  conversations: Accessor<AiConversation[]>;
  activeConversationId?: Accessor<string | null>;
  activeView?: "chat" | "all";
  onNewConversation?: () => void | Promise<void>;
  onOpenConversation?: (conversationId: string) => void | Promise<void>;
  onConversationUpdated?: (conversation: AiConversation) => void;
  onConversationDeleted?: (conversation: AiConversation) => void;
};

type EditConversationFormProps = {
  conversation: AiConversation;
  close: (result?: { action: "save"; conversation: AiConversation } | { action: "delete"; conversation: AiConversation }) => void;
};

const ASSISTANT_ICON_STYLE = "background-image: linear-gradient(135deg, var(--color-teal-500), var(--color-blue-500))";
const DEFAULT_CHAT_ICON = "ti ti-message";
const PER_SPOTLIGHT_PAGE = 20;

const readErrorMessage = async (response: Response, fallback: string): Promise<string> => {
  const body = (await response.json().catch(() => null)) as { message?: string; error?: { message?: string } } | null;
  return body?.message ?? body?.error?.message ?? fallback;
};

const conversationIcon = (conversation: AiConversation): string => conversation.icon?.trim() || DEFAULT_CHAT_ICON;

const startOfToday = (now = new Date()) => new Date(now.getFullYear(), now.getMonth(), now.getDate());

const startOfWeek = (now = new Date()) => {
  const today = startOfToday(now);
  const day = today.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  today.setDate(today.getDate() + mondayOffset);
  return today;
};

const startOfMonth = (now = new Date()) => new Date(now.getFullYear(), now.getMonth(), 1);

const groupRecentConversations = (conversations: AiConversation[]): ConversationGroup[] => {
  const now = new Date();
  const today = startOfToday(now);
  const week = startOfWeek(now);
  const month = startOfMonth(now);
  const groups: ConversationGroup[] = [
    { title: "Today", items: [] },
    { title: "This Week", items: [] },
    { title: "This Month", items: [] },
  ];

  for (const conversation of [...conversations].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))) {
    const updatedAt = new Date(conversation.updatedAt);
    if (updatedAt >= today) groups[0]!.items.push(conversation);
    else if (updatedAt >= week) groups[1]!.items.push(conversation);
    else if (updatedAt >= month) groups[2]!.items.push(conversation);
  }

  return groups.filter((group) => group.items.length > 0);
};

function AssistantSpotlightButton(props: { variant?: SpotlightButtonVariant; registerShortcut?: boolean }) {
  const openSearch = async () => {
    const selected = await openSpotlightSearch<AiConversation>({
      title: "Search chats",
      icon: "ti ti-sparkles",
      placeholder: "Search chats...",
      minQueryLength: 1,
      noResultsText: "No chats found.",
      resolve: async ({ query, abortSignal }) => {
        const trimmed = query.trim();
        if (!trimmed) return [];

        const response = await apiClient.conversations.$get(
          { query: { q: trimmed, limit: String(PER_SPOTLIGHT_PAGE) } },
          { init: { signal: abortSignal } },
        );
        if (!response.ok) return [];

        const conversations = (await response.json()) as AiConversation[];
        return conversations.map((conversation) => ({
          value: conversation,
          label: conversation.title,
          desc: conversation.description || new Date(conversation.updatedAt).toLocaleString(),
          icon: conversationIcon(conversation),
        }));
      },
    });

    if (selected?.value) navigateTo(`/app/assistant?conversation=${selected.value.id}`);
  };

  onMount(() => {
    if (!props.registerShortcut) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (!isSpotlightShortcut(event)) return;
      event.preventDefault();
      void openSearch();
    };
    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => window.removeEventListener("keydown", onKeyDown));
  });

  return (
    <SpotlightButton
      variant={props.variant}
      label="Search Chats"
      onClick={openSearch}
      title={`Search chats (${SPOTLIGHT_SHORTCUT_TITLE})`}
      ariaLabel="Search chats"
    />
  );
}

function EditConversationForm(props: EditConversationFormProps) {
  const [title, setTitle] = createSignal(props.conversation.title);
  const [icon, setIcon] = createSignal(conversationIcon(props.conversation));
  const [description, setDescription] = createSignal(props.conversation.description);

  const save = mutation.create<AiConversation, void>({
    mutation: async () => {
      const response = await apiClient.conversations[":conversationId"].$patch({
        param: { conversationId: props.conversation.id },
        json: {
          title: title().trim(),
          icon: icon().trim() || DEFAULT_CHAT_ICON,
          description: description().trim(),
        },
      });
      if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to save chat"));
      return (await response.json()) as AiConversation;
    },
    onSuccess: (conversation) => {
      toast.success("Chat saved");
      props.close({ action: "save", conversation });
    },
    onError: (error) => prompts.error(error.message),
  });

  const remove = mutation.create<boolean, void>({
    mutation: async () => {
      const confirmed = await prompts.confirm(`Delete "${props.conversation.title}"?`, {
        title: "Delete chat",
        icon: "ti ti-trash",
        variant: "danger",
        confirmText: "Delete",
        cancelText: "Cancel",
      });
      if (!confirmed) return false;

      const response = await apiClient.conversations[":conversationId"].$delete({
        param: { conversationId: props.conversation.id },
      });
      if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to delete chat"));
      return true;
    },
    onSuccess: (deleted) => {
      if (!deleted) return;
      toast.success("Chat deleted");
      props.close({ action: "delete", conversation: props.conversation });
    },
    onError: (error) => prompts.error(error.message),
  });

  return (
    <PanelDialog>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save.mutate(undefined);
        }}
      >
        <PanelDialog.Header title="Edit chat" icon="ti ti-settings" close={() => props.close()} />
        <PanelDialog.Body>
          <IconInput label="Icon" value={icon} onChange={setIcon} required clearable={false} />
          <TextInput label="Name" value={title} onInput={setTitle} required maxLength={120} />
          <TextInput
            label="Description"
            value={description}
            onInput={setDescription}
            multiline
            lines={3}
            maxLength={500}
            placeholder="Optional context for this chat..."
          />
        </PanelDialog.Body>
        <PanelDialog.Footer>
          <button type="button" class="btn-danger btn-sm" disabled={remove.loading() || save.loading()} onClick={() => remove.mutate(undefined)}>
            <i class={remove.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-trash"} />
            Delete
          </button>
          <div class="flex items-center gap-2">
            <button type="button" class="btn-secondary btn-sm" disabled={save.loading() || remove.loading()} onClick={() => props.close()}>
              Cancel
            </button>
            <button type="submit" class="btn-primary btn-sm" disabled={save.loading() || remove.loading() || !title().trim()}>
              <i class={save.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-device-floppy"} />
              Save
            </button>
          </div>
        </PanelDialog.Footer>
      </form>
    </PanelDialog>
  );
}

export default function AssistantSidebar(props: AssistantSidebarProps) {
  const activeConversationId = () => props.activeConversationId?.() ?? null;
  const activeView = () => props.activeView ?? "chat";
  const groups = () => groupRecentConversations(props.conversations());
  const hasConversations = () => props.conversations().length > 0;

  const openConversation = (conversation: AiConversation) => {
    if (props.onOpenConversation) {
      void props.onOpenConversation(conversation.id);
      return;
    }
    navigateTo(`/app/assistant?conversation=${conversation.id}`);
  };

  const openEditor = async (conversation: AiConversation) => {
    const result = await dialogCore.open<
      { action: "save"; conversation: AiConversation } | { action: "delete"; conversation: AiConversation } | undefined
    >((close) => <EditConversationForm conversation={conversation} close={close} />, panelDialogOptions);

    if (!result) return;
    if (result.action === "save") props.onConversationUpdated?.(result.conversation);
    else props.onConversationDeleted?.(result.conversation);
  };

  return (
    <AppWorkspace.Sidebar>
      <AppWorkspace.SidebarHeader title="Assistant" icon="ti ti-sparkles" iconStyle={ASSISTANT_ICON_STYLE} />

      <AppWorkspace.SidebarMobile>
        <AppWorkspace.SidebarMobileItems>
          <AppWorkspace.SidebarItem icon="ti ti-message-plus" active={!activeConversationId()} onClick={() => void props.onNewConversation?.()}>
            New Chat
          </AppWorkspace.SidebarItem>
          <AssistantSpotlightButton variant="sidebar-mobile" />
        </AppWorkspace.SidebarMobileItems>
        <AppWorkspace.SidebarMobileBody scrollPreserveKey="assistant-sidebar-mobile">
          <AppWorkspace.SidebarSection>
            <For each={groups()}>
              {(group) => (
                <>
                  <p class="sidebar-section-title px-2 pt-2">{group.title}</p>
                  <For each={group.items}>
                    {(conversation) => (
                      <AppWorkspace.SidebarItem
                        icon={conversationIcon(conversation)}
                        active={conversation.id === activeConversationId()}
                        onClick={() => openConversation(conversation)}
                        title={conversation.title}
                        actionIcon="ti ti-settings"
                        actionLabel={`Edit ${conversation.title}`}
                        onActionClick={() => void openEditor(conversation)}
                      >
                        {conversation.title}
                      </AppWorkspace.SidebarItem>
                    )}
                  </For>
                </>
              )}
            </For>
            <Show when={!hasConversations()}>
              <p class="px-2 py-1 text-xs text-dimmed">No chats yet</p>
            </Show>
            <AppWorkspace.SidebarItem href="/app/assistant/chats" navigation="document" icon="ti ti-messages" active={activeView() === "all"}>
              All Chats
            </AppWorkspace.SidebarItem>
          </AppWorkspace.SidebarSection>
        </AppWorkspace.SidebarMobileBody>
      </AppWorkspace.SidebarMobile>

      <AppWorkspace.SidebarDesktop>
        <AppWorkspace.SidebarSection title="Actions">
          <AppWorkspace.SidebarIconGrid columns={2}>
            <AppWorkspace.SidebarIconAction
              icon="ti ti-message-plus"
              label="New Chat"
              active={!activeConversationId() && activeView() === "chat"}
              tone="success"
              onClick={() => void props.onNewConversation?.()}
            />
            <AssistantSpotlightButton variant="icon" registerShortcut />
          </AppWorkspace.SidebarIconGrid>
        </AppWorkspace.SidebarSection>

        <AppWorkspace.SidebarBody scrollPreserveKey="assistant-sidebar">
          <Show when={groups().length > 0} fallback={<p class="px-2 py-1 text-xs text-dimmed">No recent chats</p>}>
            <For each={groups()}>
              {(group) => (
                <AppWorkspace.SidebarSection title={group.title}>
                  <For each={group.items}>
                    {(conversation) => (
                      <AppWorkspace.SidebarItem
                        icon={conversationIcon(conversation)}
                        active={conversation.id === activeConversationId()}
                        onClick={() => openConversation(conversation)}
                        title={conversation.title}
                        actionIcon="ti ti-settings"
                        actionLabel={`Edit ${conversation.title}`}
                        onActionClick={() => void openEditor(conversation)}
                      >
                        {conversation.title}
                      </AppWorkspace.SidebarItem>
                    )}
                  </For>
                </AppWorkspace.SidebarSection>
              )}
            </For>
          </Show>
          <AppWorkspace.SidebarSection>
            <AppWorkspace.SidebarItem href="/app/assistant/chats" navigation="document" icon="ti ti-messages" active={activeView() === "all"}>
              All Chats
            </AppWorkspace.SidebarItem>
          </AppWorkspace.SidebarSection>
        </AppWorkspace.SidebarBody>
      </AppWorkspace.SidebarDesktop>
    </AppWorkspace.Sidebar>
  );
}
