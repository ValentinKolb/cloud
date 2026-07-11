export type ScrollViewport = {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
};

export type ScrollSnapshot = {
  scrollHeight: number;
  scrollTop: number;
};

export type ScrollRestoreToken = {
  conversationKey: string;
  revision: number;
};

export const distanceFromBottom = (viewport: ScrollViewport): number =>
  Math.max(0, viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight);

export const isNearBottom = (viewport: ScrollViewport, thresholdPx: number): boolean => distanceFromBottom(viewport) < thresholdPx;

export const scrollToBottom = (viewport: ScrollViewport): void => {
  viewport.scrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
};

export const keepBottomAligned = (viewport: ScrollViewport, input: { following: boolean; preservingHistoryPosition: boolean }): boolean => {
  if (!input.following || input.preservingHistoryPosition) return false;
  scrollToBottom(viewport);
  return true;
};

export const captureScrollSnapshot = (viewport: ScrollViewport): ScrollSnapshot => ({
  scrollHeight: viewport.scrollHeight,
  scrollTop: viewport.scrollTop,
});

export const restoreAfterPrepend = (viewport: ScrollViewport, snapshot: ScrollSnapshot): void => {
  viewport.scrollTop = Math.max(0, snapshot.scrollTop + viewport.scrollHeight - snapshot.scrollHeight);
};

export const isScrollRestoreCurrent = (token: ScrollRestoreToken, currentConversationKey: string, currentRevision: number): boolean =>
  token.conversationKey === currentConversationKey && token.revision === currentRevision;
