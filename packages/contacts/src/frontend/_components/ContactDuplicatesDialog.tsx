import { mutation as mutations, query } from "@k2b/stdlib/solid";
import { Button, dialogCore, PanelDialog, Placeholder, panelDialogOptions, prompts, toast } from "@k2b/ui";
import { createSignal, For, onCleanup, Show } from "solid-js";
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
  const [changed, setChanged] = createSignal(false);
  const [reconcileError, setReconcileError] = createSignal<string | null>(null);
  const [reconciling, setReconciling] = createSignal(false);
  const [confirming, setConfirming] = createSignal(false);
  let disposed = false;

  const matches = query.create<string, ContactDuplicateMatch[]>({
    source: () => props.bookId,
    load: async (bookId, { abortSignal }) => {
      const response = await apiClient.books[":bookId"].contacts.duplicates.$get({ param: { bookId } }, { init: { signal: abortSignal } });
      if (!response.ok) throw new Error(await readErrorMessage(response, "Could not inspect duplicates"));
      return await response.json();
    },
  });
  const reconcile = async () => {
    if (disposed) return;
    setReconciling(true);
    setReconcileError(null);
    try {
      await matches.invalidate();
      if (!disposed) setReconciling(false);
    } catch {
      if (disposed) return;
      setReconciling(false);
      setReconcileError("The contacts were merged, but duplicate matches could not be reloaded.");
    }
  };

  const mergeMutation = mutations.create<
    Contact,
    { bookId: string; keepId: string; removeId: string; keepUpdatedAt: string; removeUpdatedAt: string }
  >({
    mutation: async (selection, { abortSignal }) => {
      const response = await apiClient.books[":bookId"].contacts.duplicates.merge.$post(
        {
          param: { bookId: selection.bookId },
          json: {
            keepId: selection.keepId,
            removeId: selection.removeId,
            keepUpdatedAt: selection.keepUpdatedAt,
            removeUpdatedAt: selection.removeUpdatedAt,
          },
        },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readErrorMessage(response, "Could not merge contacts"));
      return await response.json();
    },
    onSuccess: () => {
      setChanged(true);
      toast.success("Contacts merged");
      void reconcile();
    },
    onError: (error) => void prompts.error(error.message),
  });
  onCleanup(() => {
    disposed = true;
    mergeMutation.abort();
  });
  const coverageBlocked = () => reconciling() || reconcileError() !== null;

  const keep = async (contact: Contact, duplicate: Contact) => {
    if (disposed || confirming() || mergeMutation.loading() || coverageBlocked()) return;
    setConfirming(true);
    try {
      const confirmed = await prompts.confirm(
        `Keep “${resolveContactName(contact)}” and merge “${resolveContactName(duplicate)}” into it? Missing fields, unique contact methods, notes, tags, and favorites are preserved. When both records contain a different value, the kept record wins.`,
        { title: "Merge contacts", icon: "ti ti-users-minus", confirmText: "Merge" },
      );
      if (!confirmed || disposed) return;
      void mergeMutation.mutate({
        bookId: props.bookId,
        keepId: contact.id,
        removeId: duplicate.id,
        keepUpdatedAt: contact.updatedAt,
        removeUpdatedAt: duplicate.updatedAt,
      });
    } finally {
      if (!disposed) setConfirming(false);
    }
  };
  const close = () => {
    if (!coverageBlocked()) props.close(changed());
  };

  return (
    <PanelDialog>
      <PanelDialog.Header
        title="Review duplicates"
        subtitle="Exact matches inside this contact book. Nothing is changed until you choose which record to keep."
        icon="ti ti-users-group"
        close={close}
      />
      <PanelDialog.Body>
        <Show when={!matches.loading()} fallback={<Placeholder icon="ti ti-loader-2" title="Checking contacts..." variant="panel" />}>
          <Show
            when={!matches.error() || matches.data() !== undefined}
            fallback={
              <div class="flex min-h-56 flex-col items-center justify-center gap-3 text-center">
                <Placeholder
                  icon="ti ti-alert-circle"
                  title="Could not check duplicates"
                  description="Try again. No contacts were changed."
                  variant="panel"
                />
                <Button variant="secondary" size="sm" onClick={() => void matches.refresh()}>
                  <i class="ti ti-refresh" /> Retry
                </Button>
              </div>
            }
          >
            <Show
              when={(matches.data() ?? []).length > 0}
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
                <For each={matches.data() ?? []}>
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
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  class="mt-3 w-full"
                                  disabled={mergeMutation.loading() || confirming() || coverageBlocked()}
                                  onClick={() => void keep(contact, other())}
                                >
                                  Keep this record
                                </Button>
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
        <Show when={reconciling()}>
          <p class="text-xs text-dimmed" role="status">
            Reloading duplicate matches…
          </p>
        </Show>
        <Show when={reconcileError()}>
          <div class="flex items-center justify-between gap-2 text-xs text-amber-700 dark:text-amber-300" role="status">
            <span>{reconcileError()}</span>
            <Button type="button" variant="secondary" size="xs" onClick={() => void reconcile()} disabled={reconciling()}>
              Retry reload
            </Button>
          </div>
        </Show>
      </PanelDialog.Body>
      <PanelDialog.Footer>
        <span class="text-xs text-dimmed">
          {(matches.data() ?? []).length} match{(matches.data() ?? []).length === 1 ? "" : "es"}
        </span>
        <Button variant="secondary" size="sm" onClick={close} disabled={coverageBlocked()}>
          Done
        </Button>
      </PanelDialog.Footer>
    </PanelDialog>
  );
}

export const openContactDuplicatesDialog = (bookId: string) =>
  dialogCore.open<boolean>((close) => <DuplicateReviewDialog bookId={bookId} close={close} />, {
    ...panelDialogOptions,
    cancelBehavior: "ignore",
  });
