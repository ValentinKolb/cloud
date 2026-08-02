export type LayoutBreadcrumb = {
  title: string;
  href?: string;
};

export type LayoutUpdate = {
  title?: string;
  breadcrumbs?: LayoutBreadcrumb[];
};

export const LAYOUT_UPDATE_EVENT = "cloud:layout:update";

export const layout = {
  update(update: LayoutUpdate) {
    if (typeof window === "undefined") return;

    const title = update.title ?? update.breadcrumbs?.at(-1)?.title;
    if (title) document.title = title;

    window.dispatchEvent(new CustomEvent<LayoutUpdate>(LAYOUT_UPDATE_EVENT, { detail: update }));
  },
};
