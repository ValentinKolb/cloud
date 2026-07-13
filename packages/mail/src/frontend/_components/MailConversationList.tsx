import { SearchBar } from "@valentinkolb/cloud/ssr/islands";
import { AppWorkspace, Placeholder } from "@valentinkolb/cloud/ui";
import { type DateContext, dates } from "@valentinkolb/stdlib";
import { Show } from "solid-js";
import type { Mailbox } from "../../contracts";
import { buildMailListHref, buildMailSelectionHref, type MailListItem } from "../[mailboxId]/mailbox-page-data";

export default function MailConversationList(props: {
  mailbox: Mailbox;
  mailboxId: string;
  requestUrl: string;
  query: string;
  title: string;
  items: MailListItem[];
  error: string | null;
  selectedConversationId: string | null;
  selectedMessageId: string | null;
  dateConfig: DateContext;
}) {
  const requestUrl = new URL(props.requestUrl);
  const listHref = buildMailListHref(requestUrl);

  return (
    <AppWorkspace.Main>
      <header class="flex shrink-0 flex-col gap-3 px-3 py-3 sm:px-4">
        <div class="min-w-0">
          <h1 class="truncate text-base font-semibold text-primary">{props.title}</h1>
          <p class="mt-0.5 text-xs text-dimmed">
            {props.items.length} conversation{props.items.length === 1 ? "" : "s"}
          </p>
        </div>
        <SearchBar
          value={props.query}
          param="q"
          placeholder={`Search ${props.mailbox.name}...`}
          ariaLabel={`Search ${props.mailbox.name}`}
        />
        {props.mailbox.health !== "active" && (
          <div class="info-block-warning flex items-center gap-2 text-xs" role="status">
            <i class="ti ti-alert-triangle" aria-hidden="true" />
            <span>{props.mailbox.healthReason || `Mailbox is ${props.mailbox.health.replaceAll("_", " ")}.`}</span>
          </div>
        )}
      </header>

      <div class="min-h-0 flex-1 overflow-y-auto" data-scroll-preserve={`mail-list-${props.mailboxId}`}>
        {props.error ? (
          <Placeholder
            state="error"
            variant="panel"
            title="Could not load conversations"
            description={props.error}
            action={
              <a href={listHref} class="btn-secondary btn-sm">
                Retry
              </a>
            }
          />
        ) : props.items.length === 0 ? (
          <Placeholder
            icon={props.query ? "ti ti-search" : "ti ti-mail-off"}
            variant="panel"
            title={props.query ? "No matching messages" : "No conversations here"}
            description={props.query ? "Try a different search term." : "New synchronized mail will appear in this view."}
            action={
              props.query ? (
                <a href={buildMailListHref(requestUrl, true)} class="btn-secondary btn-sm">
                  Clear search
                </a>
              ) : undefined
            }
          />
        ) : (
          <div class="divide-y divide-subtle border-y border-subtle">
            {props.items.map((item) => {
              const selected = item.conversationId
                ? item.conversationId === props.selectedConversationId
                : item.id === props.selectedMessageId;
              return (
                <a
                  href={buildMailSelectionHref(requestUrl, item)}
                  aria-current={selected ? "page" : undefined}
                  class={`group flex min-w-0 gap-3 px-3 py-3 no-underline transition-colors hover:bg-subtle focus-ui ${
                    selected ? "bg-subtle" : ""
                  }`}
                >
                  <span
                    class={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${item.unread ? "bg-blue-500" : "bg-transparent"}`}
                    aria-hidden="true"
                  />
                  <span class="min-w-0 flex-1">
                    <Show when={item.unread}>
                      <span class="sr-only">Unread. </span>
                    </Show>
                    <span class="flex items-baseline justify-between gap-3">
                      <span class={`truncate text-sm text-primary ${item.unread ? "font-semibold" : ""}`}>
                        {item.participantSummary || "Unknown sender"}
                      </span>
                      <time
                        class="shrink-0 text-2xs tabular-nums text-dimmed"
                        dateTime={item.latestMessageAt}
                        title={dates.formatDateTime(item.latestMessageAt, props.dateConfig)}
                      >
                        {dates.formatDateTimeRelative(item.latestMessageAt, props.dateConfig)}
                      </time>
                    </span>
                    <span class={`block truncate text-xs text-primary ${item.unread ? "font-semibold" : "font-medium"}`}>
                      {item.subject || "(no subject)"}
                    </span>
                    <span class="block truncate text-xs text-dimmed">{item.preview || "Body is still synchronizing"}</span>
                    <span class="mt-1.5 flex flex-wrap items-center gap-2 text-2xs text-dimmed">
                      <Show when={item.messageCount > 1}>
                        <span class="inline-flex items-center gap-1" title={`${item.messageCount} messages`}>
                          <i class="ti ti-messages" aria-hidden="true" /> {item.messageCount}
                        </span>
                      </Show>
                      <Show when={item.hasAttachments}>
                        <span class="inline-flex items-center gap-1" title="Has attachments">
                          <i class="ti ti-paperclip" aria-hidden="true" /> Attachment
                        </span>
                      </Show>
                      <Show when={item.assigneeUserId}>
                        <span class="inline-flex items-center gap-1" title="Assigned">
                          <i class="ti ti-user-check" aria-hidden="true" /> Assigned
                        </span>
                      </Show>
                      <Show when={item.responseNeeded}>
                        <span class="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300" title="Response needed">
                          <i class="ti ti-message-exclamation" aria-hidden="true" /> Response needed
                        </span>
                      </Show>
                      <Show when={item.snoozedUntil}>
                        <span
                          class="inline-flex items-center gap-1"
                          title={`Snoozed until ${dates.formatDateTime(item.snoozedUntil!, props.dateConfig)}`}
                        >
                          <i class="ti ti-clock" aria-hidden="true" /> Snoozed
                        </span>
                      </Show>
                      <Show when={item.workStatus === "waiting"}>
                        <span class="inline-flex items-center gap-1">
                          <i class="ti ti-clock-pause" aria-hidden="true" /> Waiting
                        </span>
                      </Show>
                      <Show when={item.workStatus === "done"}>
                        <span class="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-300">
                          <i class="ti ti-circle-check" aria-hidden="true" /> Done
                        </span>
                      </Show>
                    </span>
                  </span>
                </a>
              );
            })}
          </div>
        )}
      </div>
    </AppWorkspace.Main>
  );
}
