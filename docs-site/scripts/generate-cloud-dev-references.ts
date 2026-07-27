import { readdir, unlink } from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";
import { generatedAnchors, generatedReferenceHeader, obsoleteGeneratedReferences, portableWebsiteTarget } from "./generated-reference";
import { mapMarkdownProse, mapOutsideFences } from "./markdown";

export type ReferenceGroup = {
  output: string;
  title: string;
  sources: string[];
};

export const referenceGroups: ReferenceGroup[] = [
  {
    output: "architecture.md",
    title: "Cloud application model, lifecycle, and routing",
    sources: ["overview.md", "building-blocks.md", "build/index.md", "build/lifecycle.md", "build/routing.md"],
  },
  {
    output: "getting-started.md",
    title: "Build the first Cloud application",
    sources: ["build/getting-started.md"],
  },
  {
    output: "application.md",
    title: "Define a Cloud application",
    sources: ["build/define-app.md"],
  },
  {
    output: "middleware.md",
    title: "Cloud request middleware",
    sources: ["server/index.md", "server/middleware.md"],
  },
  {
    output: "http.md",
    title: "Cloud HTTP APIs",
    sources: ["server/http.md"],
  },
  {
    output: "services.md",
    title: "Cloud services, results, and pagination",
    sources: ["server/services-and-results.md", "server/pagination-and-filtering.md"],
  },
  {
    output: "data.md",
    title: "Cloud application data and Postgres queries",
    sources: ["data/index.md", "data/postgres-queries.md"],
  },
  {
    output: "migrations.md",
    title: "Cloud migrations, transactions, secrets, and state",
    sources: ["data/migrations-and-transactions.md", "data/secrets-and-persistent-state.md"],
  },
  {
    output: "auth.md",
    title: "Cloud request identity",
    sources: ["identity/index.md", "identity/authentication.md"],
  },
  {
    output: "route-access.md",
    title: "Cloud route policies and public access",
    sources: ["identity/route-policies.md", "identity/public-and-anonymous-access.md"],
  },
  {
    output: "authorization.md",
    title: "Cloud resource authorization",
    sources: ["identity/authorization.md"],
  },
  {
    output: "credentials.md",
    title: "Cloud resource API keys and OAuth",
    sources: ["identity/resource-api-keys.md", "identity/oauth.md"],
  },
  {
    output: "platform.md",
    title: "Cloud discovery, dashboard, and document services",
    sources: ["platform/index.md", "platform/search.md", "platform/dashboard-widgets.md", "platform/pdf-and-templates.md"],
  },
  {
    output: "settings.md",
    title: "Cloud settings reference",
    sources: ["platform/settings.md", "reference/settings-kinds-and-environment.md"],
  },
  {
    output: "observability.md",
    title: "Cloud logging, tracing, and audit events",
    sources: ["platform/logging.md", "platform/tracing.md", "platform/audit-events.md"],
  },
  {
    output: "notifications.md",
    title: "Cloud notifications reference",
    sources: ["platform/notifications.md"],
  },
  {
    output: "help.md",
    title: "Cloud in-product Help reference",
    sources: ["platform/help.md"],
  },
  {
    output: "cli.md",
    title: "Cloud application CLI reference",
    sources: ["platform/cli-modules.md"],
  },
  {
    output: "automation.md",
    title: "Cloud background work, jobs, and queues",
    sources: ["automation/index.md", "automation/lifecycle-background-work.md", "automation/jobs-and-queues.md"],
  },
  {
    output: "schedules.md",
    title: "Cloud schedulers, topics, and coordination",
    sources: ["automation/schedulers.md", "automation/topics-and-live-events.md", "automation/coordination-primitives.md"],
  },
  {
    output: "workflows.md",
    title: "Author and start durable Cloud workflows",
    sources: ["automation/workflow-overview.md", "automation/author-and-publish-workflows.md", "automation/emit-events-and-start-runs.md"],
  },
  {
    output: "workflow-runtime.md",
    title: "Cloud workflow effects, recovery, and testing",
    sources: ["automation/effects-retry-and-reconciliation.md", "automation/workflow-observability-and-testing.md"],
  },
  {
    output: "frontend.md",
    title: "Cloud frontend reference",
    sources: [
      "frontend/index.md",
      "frontend/ssr-pages-and-routing.md",
      "frontend/layout-and-navigation.md",
      "frontend/application-shells.md",
      "frontend/islands-and-hydration.md",
    ],
  },
  {
    output: "browser.md",
    title: "Cloud browser clients, navigation, and realtime UI",
    sources: ["frontend/browser-clients-and-mutations.md", "frontend/url-state-and-navigation.md", "frontend/realtime-ui.md"],
  },
  {
    output: "frontend-ui.md",
    title: "Cloud frontend interaction, styling, and testing",
    sources: [
      "frontend/forms-prompts-and-feedback.md",
      "frontend/styling-and-accessibility.md",
      "frontend/testing.md",
    ],
  },
  {
    output: "ai.md",
    title: "Cloud AI resources, models, files, and memory",
    sources: ["ai/index.md", "ai/resources-and-access.md", "ai/models-and-providers.md", "ai/files-skills-and-memory.md"],
  },
  {
    output: "ai-runtime.md",
    title: "Cloud AI runtime, tools, structured output, and chat UI",
    sources: [
      "ai/chat-runtime-and-streaming.md",
      "ai/tools-and-approvals.md",
      "ai/structured-and-background-ai.md",
      "ai/chat-interface.md",
    ],
  },
  {
    output: "development.md",
    title: "Cloud monorepo and standalone development",
    sources: ["operations/index.md", "operations/monorepo-development.md", "operations/standalone-development.md"],
  },
  {
    output: "deployment.md",
    title: "Build, deploy, and configure Cloud",
    sources: ["operations/build-and-deploy.md", "operations/runtime-configuration.md", "operations/freeipa.md"],
  },
  {
    output: "ops.md",
    title: "Cloud scaling, observability, and troubleshooting",
    sources: ["operations/scaling-and-shutdown.md", "operations/observability.md", "operations/troubleshooting.md"],
  },
  {
    output: "reference.md",
    title: "Cloud API reference",
    sources: ["reference/index.md", "reference/api-surface.md", "reference/deprecations-and-migrations.md"],
  },
  {
    output: "conventions.md",
    title: "Cloud route and status conventions",
    sources: ["reference/route-conventions.md", "reference/vocabulary-and-statuses.md"],
  },
];

const docsRoot = resolve(import.meta.dir, "../docs/en");
const referencesRoot = resolve(import.meta.dir, "../../skills/cloud-dev/references");
const intentionallyExcluded = new Map<string, string>();
export const GENERATED_REFERENCE_CONTENTS_THRESHOLD = 300;

const normalizeNewlines = (value: string) => value.replaceAll("\r\n", "\n");

const stripFrontmatter = (source: string, file: string): string => {
  const normalized = normalizeNewlines(source);
  if (!normalized.startsWith("---\n")) {
    throw new Error(`${file}: missing frontmatter`);
  }

  const end = normalized.indexOf("\n---\n", 4);
  if (end === -1) {
    throw new Error(`${file}: unterminated frontmatter`);
  }

  return normalized.slice(end + 5).trim();
};

const routeForSource = (source: string): string => {
  const withoutExtension = source.replace(/\.md$/, "");
  const withoutIndex = withoutExtension.replace(/(^|\/)index$/, "$1");
  const suffix = withoutIndex.replace(/\/$/, "");
  return suffix ? `/docs/en/${suffix}` : "/docs/en";
};

const slug = (value: string): string =>
  value
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .toLowerCase()
    .replace(/&[a-z0-9#]+;/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/[\s-]+/g, "-");

const pageAnchorForRoute = (route: string): string => {
  const suffix = route.replace(/^\/docs\/en\/?/, "");
  return suffix ? `page-${slug(suffix.replaceAll("/", " "))}` : "page-introduction";
};

const sourceToGroup = new Map<string, ReferenceGroup>();
const outputOwners = new Set<string>();
const routeToSource = new Map<string, { group: ReferenceGroup; pageAnchor: string; source: string }>();

for (const group of referenceGroups) {
  if (outputOwners.has(group.output)) {
    throw new Error(`${group.output}: generated by more than one group`);
  }
  outputOwners.add(group.output);

  for (const source of group.sources) {
    if (sourceToGroup.has(source)) {
      throw new Error(`${source}: included more than once`);
    }
    sourceToGroup.set(source, group);

    const route = routeForSource(source);
    if (routeToSource.has(route)) {
      throw new Error(`${route}: generated by more than one source`);
    }
    routeToSource.set(route, {
      group,
      pageAnchor: pageAnchorForRoute(route),
      source,
    });
  }
}

const listMarkdownFiles = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listMarkdownFiles(path)));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(relative(docsRoot, path).replaceAll(sep, "/"));
    }
  }

  return files.sort();
};

const rewriteTarget = (target: string, source: string, output: string): string => {
  const portableTarget = portableWebsiteTarget(target);
  if (portableTarget !== target) return portableTarget;

  if (target.startsWith("#")) {
    const current = routeToSource.get(routeForSource(source));
    if (!current) throw new Error(`${source}: missing route metadata`);
    return `#${current.pageAnchor}-${target.slice(1)}`;
  }

  if (!target.startsWith("/docs/en")) return target;

  const [rawRoute, fragment] = target.split("#", 2);
  const route =
    rawRoute
      .replace(/\.markdown$/, "")
      .replace(/\.md$/, "")
      .replace(/\/$/, "") || "/docs/en";
  const destination = routeToSource.get(route);

  if (!destination) {
    throw new Error(`${source}: documentation link is not in manifest: ${target}`);
  }

  const anchor = fragment ? `${destination.pageAnchor}-${fragment}` : destination.pageAnchor;
  return destination.group.output === output ? `#${anchor}` : `./${destination.group.output}#${anchor}`;
};

const rewriteLinks = (markdown: string, source: string, output: string): string =>
  mapMarkdownProse(markdown, (text) =>
    text.replace(
      /\]\(([^)\s]+)(\s+"[^"]*")?\)/g,
      (_match, target: string, title: string | undefined) => `](${rewriteTarget(target, source, output)}${title ?? ""})`,
    ),
  );

export type RenderedReferencePage = {
  anchor: string;
  markdown: string;
  title: string;
};

const addScopedAnchors = (markdown: string, source: string): RenderedReferencePage => {
  const pageAnchor = pageAnchorForRoute(routeForSource(source));
  let firstHeading = true;
  let title = "";
  const output = mapOutsideFences(markdown, (line) => {
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (!heading) return line;

    const [, marks, text] = heading;
    const anchor = firstHeading ? pageAnchor : `${pageAnchor}-${slug(text)}`;
    const shiftedLevel = Math.min(6, marks.length + 1);
    if (firstHeading) title = text;
    firstHeading = false;
    return `<a id="${anchor}"></a>\n${"#".repeat(shiftedLevel)} ${text}`;
  });

  if (firstHeading) {
    throw new Error(`${source}: missing heading`);
  }

  return { anchor: pageAnchor, markdown: output, title };
};

export const renderReference = (title: string, pages: RenderedReferencePage[]): string => {
  const preamble = [
    generatedReferenceHeader,
    `# ${title}`,
    "",
    "The Cloud developer documentation is the canonical source for this file.",
    "",
  ];
  const body = pages.flatMap((page, index) => [...(index === 0 ? [] : ["", "---", ""]), page.markdown]);
  const withoutContents = [...preamble, ...body, ""].join("\n");

  if (withoutContents.split("\n").length <= GENERATED_REFERENCE_CONTENTS_THRESHOLD) {
    return withoutContents;
  }

  return [...preamble, "## Contents", "", ...pages.map((page) => `- [${page.title}](#${page.anchor})`), "", ...body, ""].join("\n");
};

export const renderGroup = async (group: ReferenceGroup): Promise<string> => {
  const pages: RenderedReferencePage[] = [];

  for (const source of group.sources) {
    const path = join(docsRoot, source);
    const markdown = stripFrontmatter(await Bun.file(path).text(), source);
    const linked = rewriteLinks(markdown, source, group.output);
    pages.push(addScopedAnchors(linked, source));
  }

  return renderReference(group.title, pages);
};

export const run = async (): Promise<void> => {
  const checkOnly = process.argv.includes("--check");
  const allDocs = await listMarkdownFiles(docsRoot);
  const selectedDocs = [...sourceToGroup.keys()].sort();
  const missingFromManifest = allDocs.filter((file) => !sourceToGroup.has(file) && !intentionallyExcluded.has(file));
  const missingFromDisk = selectedDocs.filter((file) => !allDocs.includes(file));
  const unknownExclusions = [...intentionallyExcluded.keys()].filter((file) => !allDocs.includes(file));

  if (missingFromManifest.length || missingFromDisk.length || unknownExclusions.length) {
    throw new Error(
      [
        missingFromManifest.length ? `Not in manifest: ${missingFromManifest.join(", ")}` : "",
        missingFromDisk.length ? `Missing from docs: ${missingFromDisk.join(", ")}` : "",
        unknownExclusions.length ? `Excluded files missing from docs: ${unknownExclusions.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  const stale: string[] = [];
  const expectedByOutput = new Map<string, string>();

  for (const group of referenceGroups) {
    expectedByOutput.set(group.output, await renderGroup(group));
  }

  const anchorsByOutput = new Map<string, Set<string>>();
  for (const [output, markdown] of expectedByOutput) {
    anchorsByOutput.set(output, generatedAnchors(markdown, output));
  }

  for (const [output, markdown] of expectedByOutput) {
    for (const match of markdown.matchAll(/\]\((?:(?:\.\/)?([^/#)\s]+\.md))?#([^)\s"]+)/g)) {
      const targetOutput = match[1] ? basename(match[1]) : output;
      const anchor = match[2];
      if (!expectedByOutput.has(targetOutput)) {
        throw new Error(`${output}: generated link targets unknown file ${targetOutput}`);
      }
      if (!anchorsByOutput.get(targetOutput)?.has(anchor)) {
        throw new Error(`${output}: generated link targets missing anchor ${targetOutput}#${anchor}`);
      }
    }
  }

  const existingReferences = await Promise.all(
    (await readdir(referencesRoot, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map(async (entry) => ({
        name: entry.name,
        source: await Bun.file(join(referencesRoot, entry.name)).text(),
      })),
  );
  for (const name of obsoleteGeneratedReferences(existingReferences, new Set(expectedByOutput.keys()))) {
    const outputPath = join(referencesRoot, name);
    if (checkOnly) {
      stale.push(`${name} (obsolete)`);
    } else {
      await unlink(outputPath);
      console.log(`Removed obsolete generated reference ${relative(resolve(import.meta.dir, "../.."), outputPath)}`);
    }
  }

  for (const group of referenceGroups) {
    const outputPath = join(referencesRoot, group.output);
    const expected = expectedByOutput.get(group.output);
    if (!expected) throw new Error(`${group.output}: missing generated content`);

    if (checkOnly) {
      const current = await Bun.file(outputPath)
        .text()
        .catch(() => "");
      if (normalizeNewlines(current) !== expected) stale.push(group.output);
    } else {
      await Bun.write(outputPath, expected);
      console.log(`Generated ${relative(resolve(import.meta.dir, "../.."), outputPath)}`);
    }
  }

  if (stale.length) {
    throw new Error(`Generated Cloud developer references are stale: ${stale.join(", ")}\n` + "Run: bun run generate:skill-references");
  }

  if (checkOnly) {
    const pageCount = selectedDocs.length + intentionallyExcluded.size;
    console.log(
      `Cloud developer references are current (${referenceGroups.length} files, ${pageCount} documentation pages: ${selectedDocs.length} generated sources and ${intentionallyExcluded.size} intentional exclusion).`,
    );
  }
};

if (import.meta.main) {
  await run();
}
