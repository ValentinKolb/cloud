export const HELP_PAGE_PARAM = "help";

export const layoutHelpPageHref = (href: string, topicId: string | null) => {
  const url = new URL(href);
  url.searchParams.set(HELP_PAGE_PARAM, topicId ?? "");
  return `${url.pathname}${url.search}${url.hash}`;
};
