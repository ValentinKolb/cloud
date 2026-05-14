import { navigateTo } from "@valentinkolb/cloud/ui";

export const SOFT_NOTE_NAVIGATION_REQUEST_EVENT = "notebooks.note.softNavigationRequest";

type SoftNavigationRequestDetail = {
  href: string;
  handled?: Promise<boolean>;
};

export const requestSoftNoteNavigation = async (href: string): Promise<boolean> => {
  const detail: SoftNavigationRequestDetail = { href };
  window.dispatchEvent(new CustomEvent(SOFT_NOTE_NAVIGATION_REQUEST_EVENT, { detail }));
  return (await detail.handled) ?? false;
};

export const navigateToNotebookNote = async (href: string): Promise<void> => {
  if (await requestSoftNoteNavigation(href)) return;
  navigateTo(href);
};

export const handleSoftNoteNavigationRequests = (handler: (href: string) => Promise<boolean>): (() => void) => {
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<SoftNavigationRequestDetail>).detail;
    if (!detail?.href) return;
    detail.handled = handler(detail.href);
  };
  window.addEventListener(SOFT_NOTE_NAVIGATION_REQUEST_EVENT, listener);
  return () => window.removeEventListener(SOFT_NOTE_NAVIGATION_REQUEST_EVENT, listener);
};
