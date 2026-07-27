export const mergeMailRemoteImageUrls = (
  current: ReadonlyMap<string, string>,
  loaded: ReadonlyArray<readonly [string, string]>,
): Map<string, string> => new Map([...current, ...loaded]);
