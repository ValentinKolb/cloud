import { prompts } from "@valentinkolb/cloud/ui";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { onCleanup, onMount } from "solid-js";
import { apiClient } from "@/api/client";
import { readResponseError } from "../../../lib/response";
import { SPACES_DATA_INVALIDATED_EVENT, type SpacesDataInvalidation } from "./workspace-events";
import type { SpacesViewSnapshot } from "./workspace-types";

const currentHref = () => `${window.location.pathname}${window.location.search}`;

/** Coalesces local mutation and SSE invalidations into one active-view request. */
export const useSpacesViewRefresh = (apply: (snapshot: SpacesViewSnapshot) => void) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const refresh = mutations.create<SpacesViewSnapshot, void>({
    mutation: async (_value, context) => {
      const response = await apiClient.workspace.view.$get({ query: { href: currentHref() } }, { init: { signal: context.abortSignal } });
      if (response.status === 401 || response.status === 403 || response.status === 404) {
        window.location.reload();
        throw new DOMException("Workspace access changed", "AbortError");
      }
      if (!response.ok) throw new Error(await readResponseError(response, "Could not refresh workspace view"));
      return response.json();
    },
    onSuccess: apply,
    onError: (error) => {
      if (error.name !== "AbortError") prompts.error(error.message);
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
