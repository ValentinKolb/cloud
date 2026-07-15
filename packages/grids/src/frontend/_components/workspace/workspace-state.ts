import { logger } from "@valentinkolb/cloud/services";
import { gridsService } from "../../../service";
import { latestMetadataEventCursor } from "../../../service/metadata-events";
import { latestRecordEventCursor } from "../../../service/record-events";
import { loadWorkspaceRequest } from "./workspace-request-state";
import { loadWorkspaceRoute } from "./workspace-route-state";
import type { GridsWorkspaceState, LoadWorkspaceParams } from "./workspace-state-model";

export type { GridsWorkspaceState } from "./workspace-state-model";

const log = logger("grids:workspace-state");

const loadEventCursor = async (stream: "metadata" | "records", load: () => Promise<string | null>): Promise<string | null> => {
  try {
    return await load();
  } catch (error) {
    log.warn("Could not capture workspace event cursor", {
      stream,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
};

export const loadGridsWorkspaceState = async (params: LoadWorkspaceParams): Promise<GridsWorkspaceState> => {
  const base = await gridsService.base.getByIdOrShortId(params.baseShortId);
  if (!base) return { kind: "notFound", title: "Not found", message: "Base not found" };
  const [metadataCursor, recordCursor] = await Promise.all([
    loadEventCursor("metadata", () => latestMetadataEventCursor(base.id)),
    loadEventCursor("records", () => latestRecordEventCursor(base.id)),
  ]);
  const request = await loadWorkspaceRequest(params, base, { metadata: metadataCursor, records: recordCursor });
  if ("kind" in request) return request;
  return loadWorkspaceRoute(request);
};
