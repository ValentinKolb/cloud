import type { AiConversation } from "@valentinkolb/cloud/ai";
import {
  AppWorkspace,
  Dropdown,
  isSpotlightShortcut,
  openAiSkillsManager,
  openSpotlightSearch,
  SPOTLIGHT_SHORTCUT_TITLE,
} from "@valentinkolb/cloud/ui";
import { type LinkNavigateEvent, navigate, navigateTo } from "@valentinkolb/ssr/nav";
import { type Accessor, For, onCleanup, onMount, Show } from "solid-js";
import { assistantApi } from "../api/client";
import { openAssistantAllChatsDialog } from "./AssistantAllChatsDialog";
import { conversationIcon, openAssistantConversationEditor } from "./AssistantConversationEditor";
import { openAssistantPrefsModal } from "./AssistantPrefsModals";
import { assistantConversationHref } from "./assistant-navigation";
import { ConversationStatusMeta } from "./conversation-status";
import { groupRecentConversations } from "./conversation-view";

type AssistantSidebarProps = {
  conversations: Accessor<AiConversation[]>;
  activeConversationId?: Accessor<string | null>;
  activeView?: "chat" | "all";
  creatingConversation?: Accessor<boolean>;
  onNewConversation?: () => void | Promise<void>;
  onOpenConversation?: (conversationId: string) => void | Promise<void>;
  canArchiveConversation?: (conversation: AiConversation) => boolean;
  onConversationUpdated?: (conversation: AiConversation) => void;
  onConversationArchived?: (conversation: AiConversation) => void;
};

const ASSISTANT_ICON_STYLE = "background-color: var(--app-accent)";
const PER_SPOTLIGHT_PAGE = 20;

function AssistantSpotlightButton(props: {
  registerShortcut?: boolean;
  openConversation?: (conversation: AiConversation) => void;
  variant?: "item" | "icon";
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

  return props.variant === "icon" ? (
    <AppWorkspace.SidebarIconAction icon="ti ti-search" onClick={openSearch} label={`Search chats (${SPOTLIGHT_SHORTCUT_TITLE})`} />
  ) : (
    <AppWorkspace.SidebarItem icon="ti ti-search" onClick={openSearch} title={`Search chats (${SPOTLIGHT_SHORTCUT_TITLE})`}>
      Search Chats
    </AppWorkspace.SidebarItem>
  );
}

function ConversationSidebarItem(props: {
  conversation: AiConversation;
  active: boolean;
  open?: (conversation: AiConversation) => void | Promise<void>;
  edit: (conversation: AiConversation) => void;
}) {
  const href = () => assistantConversationHref("/app/assistant", props.conversation.id);
  const running = () => props.conversation.runStatus === "queued" || props.conversation.runStatus === "running";
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
      active={props.active}
      title={props.conversation.title}
    >
      <AppWorkspace.SidebarItemIcon icon={running() ? "ti ti-loader-2 animate-spin" : conversationIcon(props.conversation)} />
      <AppWorkspace.SidebarItemLabel>{props.conversation.title}</AppWorkspace.SidebarItemLabel>
      <AppWorkspace.SidebarItemMeta>
        <ConversationStatusMeta conversation={props.conversation} hideStatus={running()} />
      </AppWorkspace.SidebarItemMeta>
      <AppWorkspace.SidebarItemAction
        icon="ti ti-settings"
        label={`Edit ${props.conversation.title}`}
        onSelect={() => props.edit(props.conversation)}
      />
    </AppWorkspace.SidebarItem>
  );
}

export default function AssistantSidebar(props: AssistantSidebarProps) {
  const activeConversationId = () => props.activeConversationId?.() ?? null;
  const activeView = () => props.activeView ?? "chat";
  const creatingConversation = () => props.creatingConversation?.() ?? false;
  const groups = () => groupRecentConversations(props.conversations());

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
    const canArchive = props.canArchiveConversation?.(conversation) ?? true;
    const result = await openAssistantConversationEditor(conversation, {
      archiveDisabled: !canArchive,
      archiveDisabledReason: canArchive ? undefined : "Stop the current response before archiving this chat.",
    });
    if (!result) return;
    if (result.action === "save") props.onConversationUpdated?.(result.conversation);
    else props.onConversationArchived?.(result.conversation);
  };
  const openAllChats = () => void openAssistantAllChatsDialog(openConversationFromCommand);
  const collapsedChatMenu = () => [
    {
      sectionLabel: "Chats",
      items: [
        ...props
          .conversations()
          .slice(0, 6)
          .map((conversation) => ({
            icon: conversationIcon(conversation),
            label: conversation.title,
            action: () => openConversationFromCommand(conversation),
          })),
        { icon: "ti ti-messages", label: "All chats", action: openAllChats },
      ],
    },
  ];

  return (
    <AppWorkspace.Sidebar collapsible>
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
          <AssistantSpotlightButton openConversation={openConversationFromCommand} />
          <AppWorkspace.SidebarItem icon="ti ti-messages" active={activeView() === "all"} onClick={openAllChats}>
            All Chats
          </AppWorkspace.SidebarItem>
          <AppWorkspace.SidebarItem icon="ti ti-user-cog" onClick={() => void openAssistantPrefsModal()}>
            Personalize
          </AppWorkspace.SidebarItem>
          <AppWorkspace.SidebarItem icon="ti ti-wand" onClick={() => void openAiSkillsManager()}>
            Skills
          </AppWorkspace.SidebarItem>
        </AppWorkspace.SidebarMobileItems>
        <AppWorkspace.SidebarMobileBody scrollPreserveKey="assistant-sidebar-mobile">
          <Show when={groups().length > 0} fallback={<p class="px-2 py-1 text-xs text-dimmed">No chats yet</p>}>
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
        </AppWorkspace.SidebarMobileBody>
      </AppWorkspace.SidebarMobile>

      <AppWorkspace.SidebarDesktop>
        <AppWorkspace.SidebarIconGrid columns={2}>
          <AppWorkspace.SidebarIconAction
            icon={creatingConversation() ? "ti ti-loader-2 animate-spin" : "ti ti-message-plus"}
            label={creatingConversation() ? "Creating chat" : "New chat"}
            active={!activeConversationId() && activeView() === "chat"}
            disabled={creatingConversation()}
            onClick={() => void props.onNewConversation?.()}
          />
          <AssistantSpotlightButton variant="icon" registerShortcut openConversation={openConversationFromCommand} />
        </AppWorkspace.SidebarIconGrid>

        <AppWorkspace.SidebarSection sidebarMode="expanded">
          <AppWorkspace.SidebarItem icon="ti ti-messages" active={activeView() === "all"} onClick={openAllChats}>
            All Chats
          </AppWorkspace.SidebarItem>
        </AppWorkspace.SidebarSection>

        <AppWorkspace.SidebarSection sidebarMode="collapsed">
          <Dropdown
            trigger={<AppWorkspace.SidebarIconAction icon="ti ti-messages" label="Recent and all chats" active={activeView() === "all"} />}
            elements={collapsedChatMenu()}
            position="right-start"
            width="w-64"
            triggerClass="flex w-full"
            openOnHover
          />
        </AppWorkspace.SidebarSection>

        <AppWorkspace.SidebarBody scrollPreserveKey="assistant-sidebar" sidebarMode="expanded">
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
        </AppWorkspace.SidebarBody>
        <AppWorkspace.SidebarFooter sidebarMode="expanded">
          <AppWorkspace.SidebarItem icon="ti ti-user-cog" onClick={() => void openAssistantPrefsModal()}>
            Personalize
          </AppWorkspace.SidebarItem>
          <AppWorkspace.SidebarItem icon="ti ti-wand" onClick={() => void openAiSkillsManager()}>
            Skills
          </AppWorkspace.SidebarItem>
        </AppWorkspace.SidebarFooter>
        <AppWorkspace.SidebarFooter sidebarMode="collapsed">
          <AppWorkspace.SidebarIconGrid>
            <AppWorkspace.SidebarIconAction icon="ti ti-user-cog" label="Personalize" onClick={() => void openAssistantPrefsModal()} />
            <AppWorkspace.SidebarIconAction icon="ti ti-wand" label="Skills" onClick={() => void openAiSkillsManager()} />
          </AppWorkspace.SidebarIconGrid>
        </AppWorkspace.SidebarFooter>
      </AppWorkspace.SidebarDesktop>
    </AppWorkspace.Sidebar>
  );
}
