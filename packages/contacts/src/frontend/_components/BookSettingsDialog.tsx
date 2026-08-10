import { navigateTo } from "@k2b/ssr/nav";
import { mutation } from "@k2b/stdlib/solid";
import { Button, IconButton, Placeholder, prompts } from "@k2b/ui";
import type { ResourceApiKey } from "@valentinkolb/cloud/access/ui";
import type { AccessEntry } from "@valentinkolb/cloud/contracts";
import { onCleanup, onMount, Show } from "solid-js";
import { apiClient } from "@/api/client";
import type { ContactBook, ContactTag } from "../../service";
import { readErrorMessage } from "./api";
import BookSettingsForm from "./BookSettingsForm";

const settingsDialogFrameClass = "dialog-fixed-frame flex min-h-0 flex-col overflow-hidden";

type BookSettingsContext = {
  book: ContactBook;
  accessEntries: AccessEntry[];
  apiKeys: ResourceApiKey[];
  tags: ContactTag[];
};

type BookSettingsDialogOutcome = { deleted?: boolean };

export type BookSettingsDialogResult = {
  deleted: boolean;
  workspaceChanged: boolean;
};

function BookSettingsDialog(props: {
  bookId: string;
  initialTab?: string;
  close: (outcome?: BookSettingsDialogOutcome) => void;
  onWorkspaceChange: () => void;
}) {
  const load = mutation.create<BookSettingsContext, void>({
    mutation: async (_input, context) => {
      const response = await apiClient.books[":bookId"]["settings-context"].$get(
        { param: { bookId: props.bookId } },
        { init: { signal: context.abortSignal } },
      );
      if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to load contact book settings"));
      return response.json();
    },
  });

  const reload = () => {
    load.abort();
    void load.mutate(undefined);
  };

  onMount(reload);
  onCleanup(() => load.abort());

  return (
    <Show
      when={load.data()}
      fallback={
        <div class={`paper relative ${settingsDialogFrameClass} rounded-[var(--ui-radius-frame)] [box-shadow:var(--ui-shadow-float)]`}>
          <IconButton type="button" class="absolute right-4 top-4 z-10" label="Close settings" onClick={() => props.close()}>
            <i class="ti ti-x" aria-hidden="true" />
          </IconButton>
          <Show
            when={load.error()}
            fallback={<Placeholder state="loading" variant="panel" title="Loading contact book settings" class="flex-1 justify-center" />}
          >
            {(error) => (
              <Placeholder
                state="error"
                variant="panel"
                title="Could not load contact book settings"
                description={error().message}
                class="flex-1"
                action={
                  <Button variant="secondary" size="sm" type="button" disabled={load.loading()} onClick={reload}>
                    <i class={load.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-refresh"} aria-hidden="true" />
                    Retry
                  </Button>
                }
              />
            )}
          </Show>
        </div>
      }
    >
      {(context) => (
        <div class={settingsDialogFrameClass}>
          <BookSettingsForm
            bookId={context().book.id}
            initialName={context().book.name}
            initialDescription={context().book.description}
            accessEntries={context().accessEntries}
            apiKeys={context().apiKeys}
            initialTags={context().tags}
            initialTab={props.initialTab}
            onWorkspaceChange={props.onWorkspaceChange}
            onClose={() => props.close()}
            onDeleted={() => props.close({ deleted: true })}
          />
        </div>
      )}
    </Show>
  );
}

export const openBookSettingsDialog = async (params: { bookId: string; initialTab?: string }): Promise<BookSettingsDialogResult> => {
  let workspaceChanged = false;
  const outcome = await prompts.dialog<BookSettingsDialogOutcome>(
    (close) => (
      <BookSettingsDialog
        {...params}
        close={close}
        onWorkspaceChange={() => {
          workspaceChanged = true;
        }}
      />
    ),
    { surface: "bare", header: false, size: "large", cancelBehavior: "ignore" },
  );
  const deleted = outcome?.deleted === true;
  if (deleted) navigateTo("/app/contacts");
  return { deleted, workspaceChanged };
};
