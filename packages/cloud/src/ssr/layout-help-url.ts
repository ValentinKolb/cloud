/** Build a canonical, reload-safe URL on an app-owned Help route. */
export const layoutHelpTopicHref = (pageBase: string, topicId: string | null) => {
  const base = pageBase.endsWith("/") ? pageBase.slice(0, -1) : pageBase;
  return topicId ? `${base}/${encodeURIComponent(topicId)}` : base;
};
