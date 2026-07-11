import type { AiConversation } from "@valentinkolb/cloud/ai";
import {
  AppWorkspace,
  isSpotlightShortcut,
  openAiSkillsManager,
  openSpotlightSearch,
  SPOTLIGHT_SHORTCUT_TITLE,
  SpotlightButton,
  type SpotlightButtonVariant,
} from "@valentinkolb/cloud/ui";
import { type LinkNavigateEvent, navigate, navigateTo } from "@valentinkolb/ssr/nav";
import { type Accessor, For, onCleanup, onMount, Show } from "solid-js";
import { assistantApi } from "../api/client";
import { conversationIcon, openAssistantConversationEditor } from "./AssistantConversationEditor";
import { openAssistantPrefsModal } from "./AssistantPrefsModals";
import { assistantConversationHref } from "./assistant-navigation";

type ConversationGroup = {
  title: string;
  items: AiConversation[];
};

type AssistantSidebarProps = {
  conversations: Accessor<AiConversation[]>;
  activeConversationId?: Accessor<string | null>;
  activeView?: "chat" | "all";
  creatingConversation?: Accessor<boolean>;
  onNewConversation?: () => void | Promise<void>;
  onOpenConversation?: (conversationId: string) => void | Promise<void>;
  canDeleteConversation?: (conversation: AiConversation) => boolean;
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

function AssistantSpotlightButton(props: {
  variant?: SpotlightButtonVariant;
  registerShortcut?: boolean;
  openConversation?: (conversation: AiConversation) => void;
}) {
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

    if (!selected?.value) return;
    if (props.openConversation) props.openConversation(selected.value);
    else navigateTo(assistantConversationHref("/app/assistant", selected.value.id));
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
  open?: (conversation: AiConversation) => void | Promise<void>;
  edit: (conversation: AiConversation) => void;
}) {
  const href = () => assistantConversationHref("/app/assistant", props.conversation.id);
  const handleNavigate = (nav: LinkNavigateEvent) => {
    if (props.active || !props.open) return;
    void props.open(props.conversation);
    nav.push(undefined, { scroll: "manual" });
  };

  return (
    <AppWorkspace.SidebarItem
      href={href()}
      navigation={props.open ? "enhanced" : "document"}
      scroll="manual"
      onNavigate={props.open ? handleNavigate : undefined}
      icon={conversationIcon(props.conversation)}
      active={props.active}
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
  const creatingConversation = () => props.creatingConversation?.() ?? false;
  const groups = () => groupRecentConversations(props.conversations());
  const hasConversations = () => props.conversations().length > 0;

  const openConversationFromCommand = (conversation: AiConversation) => {
    if (conversation.id === activeConversationId()) return;
    const href = assistantConversationHref("/app/assistant", conversation.id);
    if (props.onOpenConversation) {
      void props.onOpenConversation(conversation.id);
      navigate(href, { scroll: "manual" });
      return;
    }
    navigateTo(href);
  };

  const openEditor = async (conversation: AiConversation) => {
    const canDelete = props.canDeleteConversation?.(conversation) ?? true;
    const result = await openAssistantConversationEditor(conversation, {
      deleteDisabled: !canDelete,
      deleteDisabledReason: canDelete ? undefined : "Stop the current response before deleting this chat.",
    });
    if (!result) return;
    if (result.action === "save") props.onConversationUpdated?.(result.conversation);
    else props.onConversationDeleted?.(result.conversation);
  };

  return (
    <AppWorkspace.Sidebar>
      <AppWorkspace.SidebarHeader title="Assistant" icon="ti ti-sparkles" iconStyle={ASSISTANT_ICON_STYLE} showDesktop={false} />

      <AppWorkspace.SidebarMobile>
        <AppWorkspace.SidebarMobileItems>
          <AppWorkspace.SidebarItem
            icon={creatingConversation() ? "ti ti-loader-2 animate-spin" : "ti ti-message-plus"}
            active={!activeConversationId()}
            disabled={creatingConversation()}
            onClick={() => void props.onNewConversation?.()}
          >
            {creatingConversation() ? "Creating Chat" : "New Chat"}
          </AppWorkspace.SidebarItem>
          <AssistantSpotlightButton variant="sidebar-mobile" openConversation={openConversationFromCommand} />
          <AppWorkspace.SidebarItem icon="ti ti-user-cog" onClick={() => void openAssistantPrefsModal()}>
            Personalize
          </AppWorkspace.SidebarItem>
          <AppWorkspace.SidebarItem icon="ti ti-wand" onClick={() => void openAiSkillsManager()}>
            Skills
          </AppWorkspace.SidebarItem>
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
                        open={props.onOpenConversation ? (item) => props.onOpenConversation?.(item.id) : undefined}
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
            <AppWorkspace.SidebarItem
              href="/app/assistant/chats"
              navigation="document"
              icon="ti ti-messages"
              active={activeView() === "all"}
            >
              All Chats
            </AppWorkspace.SidebarItem>
          </AppWorkspace.SidebarSection>
        </AppWorkspace.SidebarMobileBody>
      </AppWorkspace.SidebarMobile>

      <AppWorkspace.SidebarDesktop>
        <AppWorkspace.SidebarSection title="Actions">
          <AppWorkspace.SidebarIconGrid columns={2}>
            <AppWorkspace.SidebarIconAction
              icon={creatingConversation() ? "ti ti-loader-2 animate-spin" : "ti ti-message-plus"}
              label={creatingConversation() ? "Creating Chat" : "New Chat"}
              active={!activeConversationId() && activeView() === "chat"}
              disabled={creatingConversation()}
              tone="success"
              onClick={() => void props.onNewConversation?.()}
            />
            <AssistantSpotlightButton variant="icon" registerShortcut openConversation={openConversationFromCommand} />
            <AppWorkspace.SidebarIconAction icon="ti ti-user-cog" label="Personalize" onClick={() => void openAssistantPrefsModal()} />
            <AppWorkspace.SidebarIconAction icon="ti ti-wand" label="Skills" onClick={() => void openAiSkillsManager()} />
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
                        open={props.onOpenConversation ? (item) => props.onOpenConversation?.(item.id) : undefined}
                        edit={(item) => void openEditor(item)}
                      />
                    )}
                  </For>
                </AppWorkspace.SidebarSection>
              )}
            </For>
          </Show>
          <AppWorkspace.SidebarSection>
            <AppWorkspace.SidebarItem
              href="/app/assistant/chats"
              navigation="document"
              icon="ti ti-messages"
              active={activeView() === "all"}
            >
              All Chats
            </AppWorkspace.SidebarItem>
          </AppWorkspace.SidebarSection>
        </AppWorkspace.SidebarBody>
      </AppWorkspace.SidebarDesktop>
    </AppWorkspace.Sidebar>
  );
}
