import { solidPage } from "@k2b/fibel/solid";
import { fibelHtml } from "../ssr";
import overviewMarkdown from "./context/overview.md" with { type: "text" };
import { DocsOverviewPage } from "./DocsOverviewPage";

export const docsPages = [
  solidPage({
    html: fibelHtml,
    collection: "docs",
    path: "/",
    title: "Cloud developer documentation",
    navTitle: "Introduction",
    description: "Build an application and find the Cloud platform APIs it needs.",
    section: "Start",
    order: 10,
    layout: "full",
    content: overviewMarkdown,
    tags: ["cloud", "platform", "applications"],
    updated: "2026-07-27",
    component: ({ page }) => <DocsOverviewPage locale={page.locale.code} />,
  }),
];
