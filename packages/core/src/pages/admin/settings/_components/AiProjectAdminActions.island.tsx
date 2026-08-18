import { refreshCurrentPath } from "@k2b/ssr/nav";
import { query } from "@k2b/stdlib/solid";
import { Button, Dropdown, Placeholder, prompts } from "@k2b/ui";
import { PermissionEditor } from "@valentinkolb/cloud/access/ui";
import type { AiProjectAccess } from "@valentinkolb/cloud/ai";
import { coreClient } from "@valentinkolb/cloud/clients/core";
import { Show } from "solid-js";

type Props = {
  projectId: string;
  projectName: string;
};

const readError = async (response: Response, fallback: string): Promise<string> => {
  const body = (await response.json().catch(() => null)) as { message?: string } | null;
  return body?.message || fallback;
};

const PermissionDialogBody = (props: Props) => {
  const entries = query.create({
    source: () => props.projectId,
    load: async (projectId, { abortSignal }): Promise<AiProjectAccess[]> => {
      const response = await coreClient.admin.core["ai-projects"][":projectId"].access.$get(
        { param: { projectId } },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readError(response, "Failed to load Project permissions."));
      return (await response.json()).access;
    },
  });

  return (
    <div class="flex w-full max-w-full flex-col gap-2">
      <p class="text-xs text-dimmed">
        Manage direct Project access. At least one administrator must remain once the Project has been recovered.
      </p>
      <Show when={!entries.loading()} fallback={<Placeholder state="loading" title="Loading Project access" />}>
        <Show
          when={entries.data()}
          keyed
          fallback={
            <Placeholder
              state="error"
              title="Could not load Project access"
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
              initialEntries={currentEntries}
              canEdit
              allowPublic={false}
              allowServiceAccounts
              grantAccess={async (principal, permission) => {
                const response = await coreClient.admin.core["ai-projects"][":projectId"].access.$post({
                  param: { projectId: props.projectId },
                  json: { principal, permission },
                });
                if (!response.ok) throw new Error(await readError(response, "Failed to grant Project access."));
                return (await response.json()).access;
              }}
              updateAccess={async (accessId, permission) => {
                const response = await coreClient.admin.core["ai-projects"][":projectId"].access[":accessId"].$patch({
                  param: { projectId: props.projectId, accessId },
                  json: { permission },
                });
                if (!response.ok) throw new Error(await readError(response, "Failed to update Project access."));
              }}
              revokeAccess={async (accessId) => {
                const response = await coreClient.admin.core["ai-projects"][":projectId"].access[":accessId"].$delete({
                  param: { projectId: props.projectId, accessId },
                });
                if (!response.ok) throw new Error(await readError(response, "Failed to revoke Project access."));
              }}
            />
          )}
        </Show>
      </Show>
    </div>
  );
};

const openPermissionDialog = async (props: Props) => {
  await prompts.dialog<void>(() => <PermissionDialogBody {...props} />, {
    title: props.projectName,
    icon: "ti ti-shield",
  });
  refreshCurrentPath();
};

export default function AiProjectAdminActions(props: Props) {
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
      <Dropdown.Trigger iconOnly label={`Actions for ${props.projectName}`} size="xs" tooltip="Project actions">
        <i class="ti ti-settings text-sm" />
      </Dropdown.Trigger>
    </Dropdown.Root>
  );
}
