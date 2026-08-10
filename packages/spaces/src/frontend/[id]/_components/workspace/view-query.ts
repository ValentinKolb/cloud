import { apiClient } from "@/api/client";
import { readResponseError } from "../../../lib/response";
import type { SpacesViewSnapshot } from "./workspace-types";

export class SpacesViewUnavailableError extends Error {}

export const loadSpacesViewSnapshot = async (href: string, signal: AbortSignal): Promise<SpacesViewSnapshot> => {
  const response = await apiClient.workspace.view.$get({ query: { href } }, { init: { signal } });
  if (response.status === 401 || response.status === 403 || response.status === 404) {
    throw new SpacesViewUnavailableError("Workspace access changed");
  }
  if (!response.ok) throw new Error(await readResponseError(response, "Could not refresh workspace view"));
  return response.json();
};
