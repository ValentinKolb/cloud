import { IconButton } from "@k2b/ui";
import { EntitySearch, type EntitySearchPrincipal } from "@valentinkolb/cloud/account/ui";
import { createSignal, For, onMount, Show } from "solid-js";
import type { PrincipalReference } from "../../../field-types/principal";

type PrincipalOption = PrincipalReference & { label: string; description?: string };

const keyOf = (value: PrincipalReference) => `${value.type}:${value.id}`;

const optionOf = (principal: EntitySearchPrincipal): PrincipalOption | null => {
  if (principal.type === "user") {
    return {
      type: "user",
      id: principal.userId,
      label: principal.displayName || principal.uid,
      description: principal.mail ?? principal.uid,
    };
  }
  if (principal.type === "group") {
    return { type: "group", id: principal.groupId, label: principal.name, description: principal.description ?? undefined };
  }
  return null;
};

const referenceArray = (value: unknown): PrincipalReference[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const type = (item as { type?: unknown }).type;
    const id = (item as { id?: unknown }).id;
    return (type === "user" || type === "group") && typeof id === "string" ? [{ type, id }] : [];
  });
};

export default function PrincipalInput(props: {
  value: unknown;
  multi: boolean;
  disabled?: boolean;
  onChange: (value: PrincipalReference[] | null) => void;
}) {
  const initial = referenceArray(props.value);
  const [options, setOptions] = createSignal<PrincipalOption[]>(
    initial.map((value) => ({ ...value, label: value.type === "user" ? "User" : "Group", description: "Private identity" })),
  );

  onMount(async () => {
    const users = initial.filter((value) => value.type === "user").map((value) => value.id);
    const groups = initial.filter((value) => value.type === "group").map((value) => value.id);
    if (users.length + groups.length === 0) return;
    const url = new URL("/api/accounts/entities", window.location.origin);
    url.searchParams.set("kinds", "user,group");
    url.searchParams.set("per_page", String(users.length + groups.length));
    if (users.length) url.searchParams.set("user_ids", users.join(","));
    if (groups.length) url.searchParams.set("group_ids", groups.join(","));
    const response = await fetch(url, { credentials: "same-origin" });
    if (!response.ok) return;
    const body = (await response.json()) as {
      items?: Array<{
        kind: "user" | "group";
        user?: { id: string; uid: string; displayName: string; mail: string | null };
        group?: { id: string; name: string; description: string | null };
      }>;
    };
    const labels = new Map<string, PrincipalOption>();
    for (const item of body.items ?? []) {
      if (item.kind === "user" && item.user) {
        labels.set(`user:${item.user.id}`, {
          type: "user",
          id: item.user.id,
          label: item.user.displayName || item.user.uid,
          description: item.user.mail ?? item.user.uid,
        });
      }
      if (item.kind === "group" && item.group) {
        labels.set(`group:${item.group.id}`, {
          type: "group",
          id: item.group.id,
          label: item.group.name,
          description: item.group.description ?? undefined,
        });
      }
    }
    setOptions((current) => current.map((option) => labels.get(keyOf(option)) ?? option));
  });

  const values = () => options().map(({ type, id }) => ({ type, id }));
  const commit = (next: PrincipalOption[]) => {
    setOptions(next);
    props.onChange(next.length ? next.map(({ type, id }) => ({ type, id })) : null);
  };
  const add = (principal: EntitySearchPrincipal) => {
    const option = optionOf(principal);
    if (!option) return;
    const next = props.multi ? [...options().filter((item) => keyOf(item) !== keyOf(option)), option] : [option];
    commit(next);
  };
  const remove = (value: PrincipalReference) => commit(options().filter((item) => keyOf(item) !== keyOf(value)));

  return (
    <div class="flex flex-col gap-2">
      <Show when={options().length > 0}>
        <div class="flex flex-col gap-1">
          <For each={options()}>
            {(option) => (
              <div class="flex min-w-0 items-center gap-2 rounded-md bg-[var(--ui-surface-subtle)] px-2.5 py-2">
                <i class={`ti ${option.type === "user" ? "ti-user" : "ti-users-group"} shrink-0 text-dimmed`} />
                <div class="min-w-0 flex-1">
                  <div class="truncate text-sm font-medium">{option.label}</div>
                  <Show when={option.description}>
                    <div class="truncate text-xs text-dimmed">{option.description}</div>
                  </Show>
                </div>
                <IconButton type="button" label={`Remove ${option.label}`} disabled={props.disabled} onClick={() => remove(option)}>
                  <i class="ti ti-x" aria-hidden="true" />
                </IconButton>
              </div>
            )}
          </For>
        </div>
      </Show>
      <Show when={props.multi || values().length === 0}>
        <EntitySearch
          includeUsers
          includeGroups
          excludeUserIds={values()
            .filter((value) => value.type === "user")
            .map((value) => value.id)}
          excludeGroupIds={values()
            .filter((value) => value.type === "group")
            .map((value) => value.id)}
          placeholder={props.multi ? "Search users and groups..." : "Select a user or group..."}
          resultsHeightClass="max-h-48"
          disabled={props.disabled}
          onSelect={add}
        />
      </Show>
    </div>
  );
}
