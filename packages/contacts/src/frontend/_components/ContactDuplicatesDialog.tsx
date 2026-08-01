import { mutation as mutations } from "@k2b/stdlib/solid";
import { dialogCore, PanelDialog, Placeholder, panelDialogOptions, prompts, toast } from "@k2b/ui";
import { createSignal, For, onMount, Show } from "solid-js";
import { apiClient } from "@/api/client";
import type { Contact, ContactDuplicateMatch } from "../../service";
import { resolveContactName } from "../../shared";
import { readErrorMessage } from "./api";

const contactSummary = (contact: Contact) =>
  [contact.companyName, contact.emails[0]?.email, contact.phones[0]?.phone].filter(Boolean).join(" · ") || "No additional contact details";

const reasonLabel: Record<ContactDuplicateMatch["reasons"][number], string> = {
  email: "same email",
  phone: "same phone",
  name: "same name",
};

function DuplicateReviewDialog(props: { bookId: string; close: (changed: boolean) => void }) {
  const [matches, setMatches] = createSignal<ContactDuplicateMatch[]>([]);
  const [changed, setChanged] = createSignal(false);

  const loadMutation = mutations.create<ContactDuplicateMatch[], void>({
    mutation: async () => {
      const response = await apiClient.books[":bookId"].contacts.duplicates.$get({ param: { bookId: props.bookId } });
      if (!response.ok) throw new Error(await readErrorMessage(response, "Could not inspect duplicates"));
      return await response.json();
    },
    onSuccess: setMatches,
    onError: (error) => void prompts.error(error.message),
  });

  const mergeMutation = mutations.create<Contact, { keepId: string; removeId: string; keepUpdatedAt: string; removeUpdatedAt: string }>({
    mutation: async (selection) => {
      const response = await apiClient.books[":bookId"].contacts.duplicates.merge.$post({
        param: { bookId: props.bookId },
        json: selection,
      });
      if (!response.ok) throw new Error(await readErrorMessage(response, "Could not merge contacts"));
      return await response.json();
    },
    onSuccess: () => {
      setChanged(true);
      toast.success("Contacts merged");
      void loadMutation.mutate();
    },
    onError: (error) => void prompts.error(error.message),
  });

  onMount(() => void loadMutation.mutate());

  const keep = async (contact: Contact, duplicate: Contact) => {
    const confirmed = await prompts.confirm(
      `Keep “${resolveContactName(contact)}” and merge “${resolveContactName(duplicate)}” into it? Missing fields, unique contact methods, notes, tags, and favorites are preserved. When both records contain a different value, the kept record wins.`,
      { title: "Merge contacts", icon: "ti ti-users-minus", confirmText: "Merge" },
    );
    if (confirmed) {
      void mergeMutation.mutate({
        keepId: contact.id,
        removeId: duplicate.id,
        keepUpdatedAt: contact.updatedAt,
        removeUpdatedAt: duplicate.updatedAt,
      });
    }
  };

  return (
    <PanelDialog>
      <PanelDialog.Header
        title="Review duplicates"
        subtitle="Exact matches inside this contact book. Nothing is changed until you choose which record to keep."
        icon="ti ti-users-group"
        close={() => props.close(changed())}
      />
      <PanelDialog.Body>
        <Show when={!loadMutation.loading()} fallback={<Placeholder icon="ti ti-loader-2" title="Checking contacts..." variant="panel" />}>
          <Show
            when={!loadMutation.error()}
            fallback={
              <div class="flex min-h-56 flex-col items-center justify-center gap-3 text-center">
                <Placeholder
                  icon="ti ti-alert-circle"
                  title="Could not check duplicates"
                  description="Try again. No contacts were changed."
                  variant="panel"
                />
                <button type="button" class="btn-secondary btn-sm" onClick={() => void loadMutation.mutate()}>
                  <i class="ti ti-refresh" /> Retry
                </button>
              </div>
            }
          >
            <Show
              when={matches().length > 0}
              fallback={
                <Placeholder
                  icon="ti ti-user-check"
                  title="No duplicates found"
                  description="No exact name, email, or phone matches need review."
                  variant="panel"
                />
              }
            >
              <div class="flex flex-col gap-2">
                <For each={matches()}>
                  {(match) => (
                    <section class="paper p-3">
                      <p class="mb-2 text-xs text-dimmed">{match.reasons.map((reason) => reasonLabel[reason]).join(" · ")}</p>
                      <div class="grid grid-cols-1 gap-2 md:grid-cols-2">
                        <For each={[match.first, match.second]}>
                          {(contact, index) => {
                            const other = () => (index() === 0 ? match.second : match.first);
                            return (
                              <div class="min-w-0 p-1">
                                <p class="truncate text-sm font-medium text-primary">{resolveContactName(contact)}</p>
                                <p class="mt-0.5 truncate text-xs text-dimmed">{contactSummary(contact)}</p>
                                <button
                                  type="button"
                                  class="btn-secondary btn-sm mt-3 w-full"
                                  disabled={mergeMutation.loading()}
                                  onClick={() => void keep(contact, other())}
                                >
                                  Keep this record
                                </button>
                              </div>
                            );
                          }}
                        </For>
                      </div>
                    </section>
                  )}
                </For>
              </div>
            </Show>
          </Show>
        </Show>
      </PanelDialog.Body>
      <PanelDialog.Footer>
        <span class="text-xs text-dimmed">
          {matches().length} match{matches().length === 1 ? "" : "es"}
        </span>
        <button type="button" class="btn-secondary btn-sm" onClick={() => props.close(changed())}>
          Done
        </button>
      </PanelDialog.Footer>
    </PanelDialog>
  );
}

export const openContactDuplicatesDialog = (bookId: string) =>
  dialogCore.open<boolean>((close) => <DuplicateReviewDialog bookId={bookId} close={close} />, panelDialogOptions);
