export const GRIDS_STREAM_CURSOR_PATTERN = /^\d+-\d+$/;

export const gridsWorkspace = {
  wsType: {
    recordsSubscribe: "grids.records.subscribe",
    recordsReady: "grids.records.ready",
    recordsEvent: "grids.records.event",
    recordsError: "grids.records.error",
    recordsRevoked: "grids.records.revoked",
    metadataSubscribe: "grids.metadata.subscribe",
    metadataReady: "grids.metadata.ready",
    metadataEvent: "grids.metadata.event",
    metadataError: "grids.metadata.error",
    metadataRevoked: "grids.metadata.revoked",
  },
  streamCursorPattern: GRIDS_STREAM_CURSOR_PATTERN,
} as const;

export type GridsWorkspaceWsType = (typeof gridsWorkspace.wsType)[keyof typeof gridsWorkspace.wsType];
