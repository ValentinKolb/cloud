import { navigateTo } from "@valentinkolb/cloud/ui";

export const SOFT_NOTE_NAVIGATION_REQUEST_EVENT = "notebooks.note.softNavigationRequest";

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

export const navigateToNotebookNote = async (href: string): Promise<void> => {
  if (await requestSoftNoteNavigation(href)) return;
  navigateTo(href);
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
