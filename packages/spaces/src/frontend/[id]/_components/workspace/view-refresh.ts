import { mutation as mutations } from "@k2b/stdlib/solid";
import { prompts } from "@k2b/ui";
import { onCleanup, onMount } from "solid-js";
import { apiClient } from "@/api/client";
import { readResponseError } from "../../../lib/response";
import { SPACES_DATA_INVALIDATED_EVENT, type SpacesDataInvalidation } from "./workspace-events";
import type { SpacesViewSnapshot } from "./workspace-types";

const currentHref = () => `${window.location.pathname}${window.location.search}`;

export class SpacesViewUnavailableError extends Error {}

export const loadSpacesViewSnapshot = async (href: string, signal?: AbortSignal): Promise<SpacesViewSnapshot> => {
  const response = await apiClient.workspace.view.$get({ query: { href } }, { init: { signal } });
  if (response.status === 401 || response.status === 403 || response.status === 404) {
    throw new SpacesViewUnavailableError("Workspace access changed");
  }
  if (!response.ok) throw new Error(await readResponseError(response, "Could not refresh workspace view"));
  return response.json();
};

/** Coalesces local mutation and live invalidations into one active-view request. */
export const useSpacesViewRefresh = (apply: (snapshot: SpacesViewSnapshot) => void) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const refresh = mutations.create<SpacesViewSnapshot, void>({
    mutation: (_value, context) => loadSpacesViewSnapshot(currentHref(), context.abortSignal),
    onSuccess: apply,
    onError: (error) => {
      if (error instanceof SpacesViewUnavailableError) window.location.reload();
      else prompts.error(error.message);
    },
  });

  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      refresh.abort();
      void refresh.mutate(undefined);
    }, 120);
  };

  onMount(() => {
    const onInvalidated = (event: Event) => {
      const detail = (event as CustomEvent<SpacesDataInvalidation>).detail;
      if (detail?.domains.includes("view")) schedule();
    };
    window.addEventListener(SPACES_DATA_INVALIDATED_EVENT, onInvalidated);
    onCleanup(() => {
      window.removeEventListener(SPACES_DATA_INVALIDATED_EVENT, onInvalidated);
      if (timer) clearTimeout(timer);
      refresh.abort();
    });
  });

  return { loading: refresh.loading };
};
