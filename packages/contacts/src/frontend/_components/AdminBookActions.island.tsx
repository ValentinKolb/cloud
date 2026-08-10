import { refreshCurrentPath } from "@k2b/ssr/nav";
import { query } from "@k2b/stdlib/solid";
import { Button, Dropdown, Placeholder, prompts } from "@k2b/ui";
import { type GrantableLevel, PermissionEditor } from "@valentinkolb/cloud/access/ui";
import type { AccessEntry, Principal } from "@valentinkolb/cloud/contracts";
import { createSignal, onCleanup, Show } from "solid-js";
import { apiClient } from "@/api/client";
import { readErrorMessage } from "./api";
import { createQueuedReconciliation } from "./book-settings-reconcile";

type AdminBookActionsProps = {
  bookId: string;
  bookName: string;
};

const PermissionDialogBody = (props: AdminBookActionsProps) => {
  const entries = query.create<string, AccessEntry[]>({
    source: () => props.bookId,
    load: async (bookId, { abortSignal }) => {
      const response = await apiClient.admin.books[":bookId"].access.$get({ param: { bookId } }, { init: { signal: abortSignal } });
      if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to load contact book permissions."));
      return response.json();
    },
  });
  const [reconcileError, setReconcileError] = createSignal<string | null>(null);
  const [reconciling, setReconciling] = createSignal(false);
  let disposed = false;
  const coverage = createQueuedReconciliation(entries.invalidate, (state) => {
    setReconciling(state.reconciling);
    setReconcileError(state.error);
  });
  const reconcile = () => coverage.run("The change was saved, but contact book access could not be reloaded.");
  const coverageBlocked = () => reconciling() || reconcileError() !== null;
  const requestControllers = new Set<AbortController>();
  const runRequest = async <T,>(request: (signal: AbortSignal) => Promise<T>): Promise<T> => {
    if (disposed) throw new DOMException("Contact book permissions were closed", "AbortError");
    if (coverageBlocked() || requestControllers.size > 0) throw new Error("Another permission change is still in progress");
    const controller = new AbortController();
    requestControllers.add(controller);
    try {
      const result = await request(controller.signal);
      if (disposed) throw new DOMException("Contact book permissions were closed", "AbortError");
      return result;
    } finally {
      requestControllers.delete(controller);
    }
  };
  const grant = async (input: { bookId: string; principal: Principal; permission: GrantableLevel }): Promise<AccessEntry> => {
    const created = await runRequest(async (abortSignal) => {
      const response = await apiClient.admin.books[":bookId"].access.$post(
        { param: { bookId: input.bookId }, json: { principal: input.principal, permission: input.permission } },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to grant access."));
      return response.json();
    });
    reconcile();
    return created;
  };
  const update = async (input: { bookId: string; accessId: string; permission: GrantableLevel }): Promise<void> => {
    await runRequest(async (abortSignal) => {
      const response = await apiClient.admin.books[":bookId"].access[":accessId"].$patch(
        { param: { bookId: input.bookId, accessId: input.accessId }, json: { permission: input.permission } },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to update access."));
    });
    reconcile();
  };
  const revoke = async (input: { bookId: string; accessId: string }): Promise<void> => {
    await runRequest(async (abortSignal) => {
      const response = await apiClient.admin.books[":bookId"].access[":accessId"].$delete(
        { param: { bookId: input.bookId, accessId: input.accessId } },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to revoke access."));
    });
    reconcile();
  };
  onCleanup(() => {
    disposed = true;
    for (const controller of requestControllers) controller.abort();
    requestControllers.clear();
    coverage.dispose();
  });

  return (
    <div class="flex w-full max-w-full flex-col gap-2">
      <p class="text-xs text-dimmed">Manage who can access this contact book.</p>
      <Show when={!entries.loading()} fallback={<Placeholder state="loading" variant="compact" title="Loading contact book access" />}>
        <Show
          when={entries.data()}
          keyed
          fallback={
            <Placeholder
              state="error"
              variant="compact"
              title="Could not load contact book access"
              description={entries.error()?.message}
              action={
                <Button type="button" variant="secondary" size="sm" onClick={() => void entries.refresh()}>
                  Retry
                </Button>
              }
            />
          }
        >
          {(currentEntries) => (
            <PermissionEditor
              initialEntries={currentEntries.filter((entry) => entry.principal.type !== "service_account")}
              canEdit={!coverageBlocked()}
              grantAccess={async (principal, permission) => {
                return grant({ bookId: props.bookId, principal, permission });
              }}
              updateAccess={async (accessId, permission) => {
                await update({ bookId: props.bookId, accessId, permission });
              }}
              revokeAccess={async (accessId) => {
                await revoke({ bookId: props.bookId, accessId });
              }}
            />
          )}
        </Show>
      </Show>
      <Show when={reconcileError()}>
        <div class="flex items-center justify-between gap-2 text-xs text-amber-700 dark:text-amber-300" role="status">
          <span>{reconcileError()}</span>
          <Button type="button" variant="secondary" size="sm" onClick={() => void coverage.retry()} disabled={reconciling()}>
            Retry reload
          </Button>
        </div>
      </Show>
    </div>
  );
};

const openPermissionDialog = async (props: AdminBookActionsProps) => {
  await prompts.dialog<void>(() => <PermissionDialogBody {...props} />, { title: props.bookName, icon: "ti ti-shield" });
  refreshCurrentPath();
};

const AdminBookActions = (props: AdminBookActionsProps) => {
  return (
    <Dropdown.Root
      position="bottom-left"
      width="13rem"
      items={[
        {
          items: [
            {
              icon: "ti ti-shield",
              label: "Permissions",
              action: () => void openPermissionDialog(props),
            },
          ],
        },
      ]}
    >
      <Dropdown.Trigger iconOnly label={`Manage permissions for ${props.bookName}`} size="xs" tooltip="Manage permissions">
        <i class="ti ti-settings text-sm" />
      </Dropdown.Trigger>
    </Dropdown.Root>
  );
};

export default AdminBookActions;
