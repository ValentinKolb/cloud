const countParams = (params: URLSearchParams): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const [key, value] of params) {
    const token = `${key}\u0000${value}`;
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return counts;
};

/** A deep link already points at the visible view when all its params are present. */
export const notificationTargetMatchesLocation = (targetHref: string, currentHref: string): boolean => {
  try {
    const current = new URL(currentHref);
    const target = new URL(targetHref, current.origin);
    if (target.origin !== current.origin || target.pathname !== current.pathname) return false;
    if (target.hash && target.hash !== current.hash) return false;

    const targetParams = countParams(target.searchParams);
    const currentParams = countParams(current.searchParams);
    for (const [token, count] of targetParams) {
      if ((currentParams.get(token) ?? 0) < count) return false;
    }
    return true;
  } catch {
    return false;
  }
};
