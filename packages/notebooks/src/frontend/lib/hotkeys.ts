const OPEN_NOTEBOOK_SEARCH_EVENT = "notebooks.shortcuts.open-search";

export const requestNotebookSearch = () => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OPEN_NOTEBOOK_SEARCH_EVENT));
};

export const onNotebookSearchRequest = (handler: () => void): (() => void) => {
  if (typeof window === "undefined") return () => {};

  const listener = () => handler();
  window.addEventListener(OPEN_NOTEBOOK_SEARCH_EVENT, listener);
  return () => window.removeEventListener(OPEN_NOTEBOOK_SEARCH_EVENT, listener);
};

