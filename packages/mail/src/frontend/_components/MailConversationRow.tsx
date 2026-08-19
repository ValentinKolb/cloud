import { type DateContext, dates } from "@k2b/stdlib";
import { Dropdown, Tooltip } from "@k2b/ui";
import { For, Show } from "solid-js";
import { getMailAction, type MailActionId, spamActionForFolder } from "./mail-actions";
import { MAX_MAIL_CONVERSATION_SELECTION } from "./mail-conversation-selection";
import { buildMailAttachmentDownloadHref, buildMailSelectionHref, isMailListItemActive, type MailListItem } from "./mail-navigation";

const statusLabel = (item: MailListItem): string | null => {
  if (item.workStatus === "needs_action") return "Needs action";
  if (item.workStatus === "waiting") return "Waiting for reply";
  if (item.workStatus === "done") return "Done";
  if (item.assigneeUserId) return "Assigned";
  return null;
};

const statusIcon = (item: MailListItem): string | null => {
  if (item.workStatus === "needs_action") return "ti ti-message-reply";
  if (item.workStatus === "waiting") return "ti ti-hourglass";
  if (item.workStatus === "done") return "ti ti-checkbox";
  if (item.assigneeUserId) return "ti ti-user-check";
  return null;
};

const correspondentLabels = (item: MailListItem): string[] =>
  item.participantLabels.length > 0 ? item.participantLabels : [item.participantSummary || "Unknown sender"];

type MailConversationRowState = {
  selectedConversationId: string | null;
  selectedMessageId: string | null;
  selectedConversationIds: ReadonlySet<string>;
  selectionMode: boolean;
  canWrite: boolean;
  junkFolderIds: string[];
  dateConfig: DateContext;
};

type MailConversationRowActions = {
  navigate: (href: string, item: MailListItem, activation: "keyboard" | "pointer") => void | Promise<void>;
  toggleSelection: (item: MailListItem, range: boolean) => void;
  itemAction: (item: MailListItem, actionId: MailActionId) => void | Promise<void>;
  manageTags: (item: MailListItem) => void | Promise<void>;
  merge: (item: MailListItem) => void | Promise<void>;
};

export default function MailConversationRow(props: {
  item: MailListItem;
  requestUrl: URL;
  state: MailConversationRowState;
  actions: MailConversationRowActions;
}) {
  const selected = () => isMailListItemActive(props.item, props.state.selectedConversationId, props.state.selectedMessageId);
  const stateLabel = () => statusLabel(props.item);
  const stateIcon = () => statusIcon(props.item);
  const correspondents = () => correspondentLabels(props.item);
  const primaryCorrespondent = () => correspondents()[0] ?? "Unknown sender";
  const additionalCorrespondents = () => Math.max(0, correspondents().length - 1);
  const tagLabel = () => props.item.localTags.map((tag) => tag.name).join(", ");
  const bulkSelected = () => Boolean(props.item.conversationId && props.state.selectedConversationIds.has(props.item.conversationId));
  const attachmentDownloadHref = () => buildMailAttachmentDownloadHref(props.requestUrl, props.item);
  let activation: "keyboard" | "pointer" = "keyboard";
  let selectRange = false;

  return (
    <div
      class="mail-list-entry group relative"
      classList={{
        "mail-list-entry-active": selected(),
        "mail-list-entry-unread": props.item.unread,
        "mail-list-entry-selected": bulkSelected(),
        "mail-list-entry-selection-mode": props.state.selectionMode,
      }}
      role="listitem"
      data-conversation-id={props.item.conversationId ?? undefined}
      data-message-id={props.item.selectionKind === "message" ? props.item.id : undefined}
    >
      <Show when={props.state.canWrite && props.state.selectionMode && props.item.conversationId}>
        <input
          type="checkbox"
          class="mail-list-checkbox h-4 w-4"
          checked={bulkSelected()}
          disabled={!bulkSelected() && props.state.selectedConversationIds.size >= MAX_MAIL_CONVERSATION_SELECTION}
          aria-label={`${bulkSelected() ? "Deselect" : "Select"} ${props.item.subject || "conversation"}`}
          onClick={(event) => {
            event.stopPropagation();
            selectRange = event.shiftKey;
          }}
          onChange={() => {
            props.actions.toggleSelection(props.item, selectRange);
            selectRange = false;
          }}
        />
      </Show>
      <a
        href={buildMailSelectionHref(props.requestUrl, props.item)}
        aria-current={selected() ? "page" : undefined}
        class="mail-list-row focus-ui"
        title={`${correspondents().join(", ")}: ${props.item.subject || "(no subject)"}`}
        draggable={props.state.canWrite && Boolean(props.item.conversationId && props.item.sourceFolderId)}
        onClick={(event) => {
          activation = event.detail === 0 ? "keyboard" : "pointer";
          if (event.defaultPrevented || event.button !== 0 || event.altKey) return;
          if (!props.state.canWrite && (event.shiftKey || event.metaKey || event.ctrlKey)) return;
          const select = Boolean(
            props.item.conversationId &&
              props.state.canWrite &&
              (props.state.selectionMode || event.shiftKey || event.metaKey || event.ctrlKey),
          );
          event.preventDefault();
          if (select) props.actions.toggleSelection(props.item, event.shiftKey);
          else void props.actions.navigate(event.currentTarget.href, props.item, activation);
        }}
        onDragStart={(event) => {
          const transfer = event.dataTransfer;
          if (!props.item.conversationId || !props.item.sourceFolderId || !transfer) return event.preventDefault();
          transfer.effectAllowed = "move";
          transfer.setData(
            "application/x-cloud-mail-conversation",
            JSON.stringify({
              conversationId: props.item.conversationId,
              sourceFolderId: props.item.sourceFolderId,
            }),
          );
        }}
      >
        <span class="sr-only">
          {props.item.unread ? `Unread ${props.item.selectionKind === "message" ? "message" : "conversation"}. ` : ""}
          {!props.item.unread ? `Read ${props.item.selectionKind === "message" ? "message" : "conversation"}. ` : ""}
          {props.item.flagged ? `Flagged ${props.item.selectionKind === "message" ? "message" : "conversation"}. ` : ""}
        </span>
        <span class="mail-list-copy">
          <span
            class="mail-list-primary-text flex min-w-0 items-center gap-1 text-sm"
            classList={{
              "font-semibold": props.item.unread,
              "font-medium": !props.item.unread,
            }}
          >
            <Show when={props.item.unread}>
              <span class="mail-list-unread-dot" aria-hidden="true" />
            </Show>
            <span class="min-w-0 truncate">{primaryCorrespondent()}</span>
            <Show when={additionalCorrespondents() > 0}>
              <Tooltip.Anchor content={correspondents().join(", ")}>
                <span
                  class="shrink-0 text-xs font-normal text-dimmed"
                  role="img"
                  aria-label={`${additionalCorrespondents()} additional correspondent${additionalCorrespondents() === 1 ? "" : "s"}: ${correspondents()
                    .slice(1)
                    .join(", ")}`}
                >
                  +{additionalCorrespondents()}
                </span>
              </Tooltip.Anchor>
            </Show>
          </span>
          <span
            class="mail-list-primary-text min-w-0 truncate text-xs"
            classList={{
              "font-semibold": props.item.unread,
              "font-medium": !props.item.unread,
            }}
          >
            <Show when={props.item.primaryReference}>
              <span class="mr-1 font-mono text-[0.6875rem] text-dimmed">{props.item.primaryReference}</span>
            </Show>
            {props.item.subject || "(no subject)"}
          </span>
          <Show when={props.item.attachmentMatch} fallback={<span class="mail-list-preview">{props.item.preview || "\u00a0"}</span>}>
            {(match) => (
              <span
                class="mail-list-preview flex min-w-0 items-center gap-1"
                title={`Matched in attachment ${match().filename ?? "Untitled attachment"}`}
              >
                <i class="ti ti-paperclip shrink-0" aria-hidden="true" />
                <span class="min-w-0 truncate">
                  Matched in {match().filename?.trim() || "attachment"}: {match().snippet}
                </span>
              </span>
            )}
          </Show>
        </span>
        <span class="mail-list-meta">
          <time
            class="shrink-0 tabular-nums transition-opacity group-focus-within:opacity-0 group-hover:opacity-0 [@media(hover:none)]:opacity-0"
            dateTime={props.item.latestMessageAt}
            title={dates.formatDateTime(props.item.latestMessageAt, props.state.dateConfig)}
          >
            {dates.formatDateTimeRelative(props.item.latestMessageAt, props.state.dateConfig)}
          </time>
          <span class="mail-list-meta-icons">
            <Show when={props.item.localTags.length > 0}>
              <Tooltip.Anchor content={`Tags: ${tagLabel()}`}>
                <span class="mail-list-tag-markers" role="img" aria-label={`Tags: ${tagLabel()}`}>
                  <For each={props.item.localTags.slice(0, 2)}>
                    {(tag) => <span class="mail-list-tag-dot" style={{ "background-color": tag.color }} aria-hidden="true" />}
                  </For>
                  <Show when={props.item.localTags.length > 2}>
                    <span class="mail-list-tag-overflow" aria-hidden="true">
                      +{props.item.localTags.length - 2}
                    </span>
                  </Show>
                </span>
              </Tooltip.Anchor>
            </Show>
            <Show when={props.item.flagged}>
              <Tooltip.Anchor content="Flagged">
                <span class="inline-flex text-orange-600 dark:text-orange-400" role="img" aria-label="Flagged conversation">
                  <i class={getMailAction("flag").icon} aria-hidden="true" />
                </span>
              </Tooltip.Anchor>
            </Show>
            <Show when={stateLabel() && stateIcon()}>
              <Tooltip.Anchor content={stateLabel() ?? ""}>
                <span class="inline-flex" role="img" aria-label={`Status: ${stateLabel()}`}>
                  <i class={stateIcon() ?? ""} aria-hidden="true" />
                </span>
              </Tooltip.Anchor>
            </Show>
            <Show when={props.item.hasAttachments}>
              <Tooltip.Anchor content="Has attachments">
                <span class="inline-flex" role="img" aria-label="Has attachments">
                  <i class="ti ti-paperclip" aria-hidden="true" />
                </span>
              </Tooltip.Anchor>
            </Show>
          </span>
        </span>
      </a>
      <Show when={attachmentDownloadHref()}>
        {(href) => (
          <a
            class="focus-ui absolute bottom-1.5 right-3 z-10 inline-flex h-7 w-7 items-center justify-center rounded-md text-dimmed opacity-0 transition-opacity hover:text-current group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
            href={href()}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Download matched attachment ${props.item.attachmentMatch?.filename?.trim() || "attachment"}`}
            title="Download matched attachment"
            onClick={(event) => event.stopPropagation()}
          >
            <i class="ti ti-download" aria-hidden="true" />
            <span class="sr-only">Download matched attachment {props.item.attachmentMatch?.filename?.trim() || "attachment"}</span>
          </a>
        )}
      </Show>
      <Show when={props.state.canWrite && !props.state.selectionMode && props.item.conversationId}>
        <div class="absolute right-3 top-2 z-10 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
          <Dropdown.Root
            position="bottom-left"
            width="13rem"
            items={[
              {
                label: getMailAction(props.item.unread ? "mark_read" : "mark_unread").label,
                icon: getMailAction(props.item.unread ? "mark_read" : "mark_unread").icon,
                action: () => props.actions.itemAction(props.item, props.item.unread ? "mark_read" : "mark_unread"),
              },
              {
                label: getMailAction(props.item.flagged ? "unflag" : "flag").label,
                icon: getMailAction(props.item.flagged ? "unflag" : "flag").icon,
                action: () => props.actions.itemAction(props.item, props.item.flagged ? "unflag" : "flag"),
              },
              {
                label: "Manage tags",
                icon: "ti ti-tags",
                action: () => props.actions.manageTags(props.item),
              },
              ...(["archive", "move", spamActionForFolder(props.item.sourceFolderId, props.state.junkFolderIds), "trash"] as const).map(
                (actionId) => ({
                  label: getMailAction(actionId).label,
                  icon: getMailAction(actionId).icon,
                  action: () => props.actions.itemAction(props.item, actionId),
                }),
              ),
              {
                label: "Merge with another conversation",
                icon: "ti ti-git-merge",
                action: () => props.actions.merge(props.item),
              },
            ]}
          >
            <Dropdown.Trigger
              iconOnly
              size="sm"
              type="button"
              variant="ghost"
              label={`Actions for ${props.item.subject || "conversation"}`}
            >
              <i class="ti ti-dots" aria-hidden="true" />
            </Dropdown.Trigger>
          </Dropdown.Root>
        </div>
      </Show>
    </div>
  );
}
