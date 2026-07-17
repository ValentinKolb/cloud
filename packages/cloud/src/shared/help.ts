export type HelpDocumentManifest = {
  id: string;
  title: string;
  icon?: string;
  description?: string;
  order: number;
  /** App-owned endpoint used for debounced full-text search. */
  searchUrl: string;
  url: string;
};

export type HelpSearchPayload = {
  ids: string[];
};

export type HelpDocumentPayload = {
  id: string;
  title: string;
  markdown: string;
  html: string;
};
