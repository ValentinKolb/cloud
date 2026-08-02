import { CheckboxCard, prompts, Button } from "@k2b/ui";
import { createSignal, For } from "solid-js";
import {
  MAIL_CONVERSATION_TOOLBAR_SECTIONS,
  MAX_MAIL_CONVERSATION_TOOLBAR_ACTIONS,
  type MailConversationToolbarActionId,
  normalizeMailConversationToolbarActions,
} from "./mail-conversation-toolbar";

export const openMailConversationToolbarDialog = (
  current: readonly MailConversationToolbarActionId[],
): Promise<MailConversationToolbarActionId[] | undefined> =>
  prompts.dialog<MailConversationToolbarActionId[]>(
    (close) => {
      const [selected, setSelected] = createSignal(normalizeMailConversationToolbarActions(current));
      const toggle = (actionId: MailConversationToolbarActionId, enabled: boolean) => {
        setSelected((existing) =>
          enabled
            ? normalizeMailConversationToolbarActions([...existing, actionId])
            : existing.filter((candidate) => candidate !== actionId),
        );
      };

      return (
        <div class="flex min-h-0 flex-col gap-4">
          <div>
            <p class="text-sm text-secondary">
              Choose up to {MAX_MAIL_CONVERSATION_TOOLBAR_ACTIONS} direct actions. Every action remains available in the overflow menu.
            </p>
            <p class="mt-1 text-xs text-dimmed">
              Actions appear in the order shown here. Unavailable actions stay hidden for the current conversation.
            </p>
          </div>
          <div class="flex min-h-0 flex-col gap-4 overflow-y-auto">
            <For each={MAIL_CONVERSATION_TOOLBAR_SECTIONS}>
              {(section) => (
                <section class="flex flex-col gap-2">
                  <p class="section-label">{section.label}</p>
                  <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <For each={section.options}>
                      {(option) => {
                        const checked = () => selected().includes(option.id);
                        return (
                          <CheckboxCard
                            label={option.label}
                            description={option.description}
                            icon={option.icon}
                            value={checked}
                            disabled={!checked() && selected().length >= MAX_MAIL_CONVERSATION_TOOLBAR_ACTIONS}
                            onValueChange={(enabled) => toggle(option.id, enabled)}
                          />
                        );
                      }}
                    </For>
                  </div>
                </section>
              )}
            </For>
          </div>
          <div class="flex items-center justify-between gap-2">
            <span class="text-xs tabular-nums text-dimmed">
              {selected().length} of {MAX_MAIL_CONVERSATION_TOOLBAR_ACTIONS} selected
            </span>
            <div class="flex items-center gap-2">
              <Button variant="secondary" size="sm" type="button" onClick={() => close(undefined)}>
                Cancel
              </Button>
              <Button size="sm" type="button" onClick={() => close(selected())}>
                Save toolbar
              </Button>
            </div>
          </div>
        </div>
      );
    },
    { title: "Customize toolbar", icon: "ti ti-adjustments-horizontal", size: "large" },
  );
