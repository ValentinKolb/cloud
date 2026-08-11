export const assertCursorProgress = (cursor: string | undefined, nextCursor: string | null | undefined, pageName: string) => {
  if (cursor !== undefined && nextCursor === cursor) throw new Error(`The server returned the same ${pageName} page twice`);
};
