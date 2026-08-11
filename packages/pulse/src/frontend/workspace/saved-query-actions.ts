import type { PulseSavedQuery } from "../../contracts";
import { jsonFetch } from "../http";

export const createPulseSavedQuery = (
  baseId: string,
  input: {
    description: string | null;
    name: string;
    query: string;
  },
  signal?: AbortSignal,
): Promise<PulseSavedQuery> =>
  jsonFetch<PulseSavedQuery>(`/api/pulse/bases/${baseId}/saved-queries`, {
    method: "POST",
    body: JSON.stringify(input),
    signal,
  });

export const deletePulseSavedQuery = (query: PulseSavedQuery, signal?: AbortSignal): Promise<void> =>
  jsonFetch<void>(`/api/pulse/bases/${query.baseId}/saved-queries/${query.id}`, { method: "DELETE", signal });
