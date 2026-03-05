export const STREAM_CURSOR_PATTERN = /^\d+-\d+$/;

export const NOTEBOOKS_YJS_WS_TYPE = {
  replayRequest: "notes.yjs.replay.request",
  replayReady: "notes.yjs.replay.ready",
  syncPublish: "notes.yjs.sync.publish",
  awarenessPublish: "notes.yjs.awareness.publish",
  syncPush: "notes.yjs.sync.push",
  awarenessPush: "notes.yjs.awareness.push",
  error: "notes.yjs.error",
} as const;

export type NotebooksYjsWsType = (typeof NOTEBOOKS_YJS_WS_TYPE)[keyof typeof NOTEBOOKS_YJS_WS_TYPE];

export const NOTEBOOKS_YJS_ERROR_CODE = {
  loginRequired: "LOGIN_REQUIRED",
  sessionExpired: "SESSION_EXPIRED",
  accessDenied: "ACCESS_DENIED",
  accessRevoked: "ACCESS_REVOKED",
  noteNotFound: "NOTE_NOT_FOUND",
  noteLocked: "NOTE_LOCKED",
  invalidJson: "INVALID_JSON",
  invalidMessage: "INVALID_MESSAGE",
  invalidPayload: "INVALID_PAYLOAD",
  backpressure: "BACKPRESSURE",
  internalError: "INTERNAL_ERROR",
} as const;

export type NotebooksYjsErrorCode = (typeof NOTEBOOKS_YJS_ERROR_CODE)[keyof typeof NOTEBOOKS_YJS_ERROR_CODE];

export type NotebooksYjsErrorPayload = {
  code: NotebooksYjsErrorCode;
  message: string;
  noteId?: string;
};

export const NOTEBOOKS_YJS_TERMINAL_ERROR_CODES = [
  NOTEBOOKS_YJS_ERROR_CODE.loginRequired,
  NOTEBOOKS_YJS_ERROR_CODE.sessionExpired,
  NOTEBOOKS_YJS_ERROR_CODE.accessDenied,
  NOTEBOOKS_YJS_ERROR_CODE.accessRevoked,
  NOTEBOOKS_YJS_ERROR_CODE.noteNotFound,
  NOTEBOOKS_YJS_ERROR_CODE.noteLocked,
  NOTEBOOKS_YJS_ERROR_CODE.backpressure,
  NOTEBOOKS_YJS_ERROR_CODE.internalError,
] as const;

export const notebooksYjs = {
  wsType: NOTEBOOKS_YJS_WS_TYPE,
  streamCursorPattern: STREAM_CURSOR_PATTERN,
  errorCode: NOTEBOOKS_YJS_ERROR_CODE,
  terminalErrorCodes: NOTEBOOKS_YJS_TERMINAL_ERROR_CODES,
} as const;
