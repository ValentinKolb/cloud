import type { AiConversation } from "@valentinkolb/cloud/ai";
import {
  AppWorkspace,
  isSpotlightShortcut,
  openSpotlightSearch,
  SpotlightButton,
  SPOTLIGHT_SHORTCUT_TITLE,
  type SpotlightButtonVariant,
} from "@valentinkolb/cloud/ui";
import { navigateTo } from "@valentinkolb/ssr/nav";
import { createSignal, For, onCleanup, onMount, Show, type Accessor } from "solid-js";
import { assistantApi } from "../api/client";
import { conversationIcon, openAssistantConversationEditor } from "./AssistantConversationEditor";

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

const ASSISTANT_ICON_STYLE = "background-image: linear-gradient(135deg, var(--color-teal-500), var(--color-blue-500))";
const PER_SPOTLIGHT_PAGE = 20;

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

        const conversations = await assistantApi.listConversations({ q: trimmed, limit: PER_SPOTLIGHT_PAGE, signal: abortSignal });
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

function ConversationSidebarItem(props: {
  conversation: AiConversation;
  active: boolean;
  open: (conversation: AiConversation) => void;
  edit: (conversation: AiConversation) => void;
}) {
  return (
    <AppWorkspace.SidebarItem
      icon={conversationIcon(props.conversation)}
      active={props.active}
      onClick={() => props.open(props.conversation)}
      title={props.conversation.title}
      actionIcon="ti ti-settings"
      actionLabel={`Edit ${props.conversation.title}`}
      onActionClick={() => props.edit(props.conversation)}
    >
      {props.conversation.title}
    </AppWorkspace.SidebarItem>
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
    const result = await openAssistantConversationEditor(conversation);
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
                      <ConversationSidebarItem
                        conversation={conversation}
                        active={conversation.id === activeConversationId()}
                        open={openConversation}
                        edit={(item) => void openEditor(item)}
                      />
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
                      <ConversationSidebarItem
                        conversation={conversation}
                        active={conversation.id === activeConversationId()}
                        open={openConversation}
                        edit={(item) => void openEditor(item)}
                      />
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
