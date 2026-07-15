import { navigateTo } from "@valentinkolb/ssr/nav";

export const SOFT_NOTE_NAVIGATION_REQUEST_EVENT = "notebooks.note.softNavigationRequest";
const SELECT_INITIAL_TITLE_KEY = "notebooks.selectInitialTitle";

type SoftNavigationRequestDetail = {
  href: string;
  push: boolean;
  handled?: Promise<boolean>;
};

export const requestSoftNoteNavigation = async (href: string, options: { push?: boolean } = {}): Promise<boolean> => {
  const detail: SoftNavigationRequestDetail = { href, push: options.push ?? true };
  window.dispatchEvent(new CustomEvent(SOFT_NOTE_NAVIGATION_REQUEST_EVENT, { detail }));
  return (await detail.handled) ?? false;
};

export const navigateToNotebookNote = async (href: string, options: { selectInitialTitle?: string } = {}): Promise<void> => {
  if (options.selectInitialTitle) sessionStorage.setItem(SELECT_INITIAL_TITLE_KEY, options.selectInitialTitle);
  if (await requestSoftNoteNavigation(href)) return;
  navigateTo(href);
};

export const consumeInitialTitleSelection = (noteShortId: string): boolean => {
  if (sessionStorage.getItem(SELECT_INITIAL_TITLE_KEY) !== noteShortId) return false;
  sessionStorage.removeItem(SELECT_INITIAL_TITLE_KEY);
  return true;
};

export const handleSoftNoteNavigationRequests = (handler: (href: string, options: { push: boolean }) => Promise<boolean>): (() => void) => {
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<SoftNavigationRequestDetail>).detail;
    if (!detail?.href) return;
    detail.handled = handler(detail.href, { push: detail.push });
  };
  window.addEventListener(SOFT_NOTE_NAVIGATION_REQUEST_EVENT, listener);
  return () => window.removeEventListener(SOFT_NOTE_NAVIGATION_REQUEST_EVENT, listener);
};
