# Cloud developer documentation plan

## Objective

Finish the developer documentation as the canonical source for:

1. developers who build Cloud applications;
2. Fibel HTML, search, and raw Markdown routes;
3. generated `cloud-dev` reference files.

The documentation explains the supported application contract. It does not
mirror the repository structure or document every exported symbol as a
recommended API.

The UI component showcase remains a separate follow-up. The developer
documentation may explain how to choose and use shared UI, but this plan does
not expand `/ui`.

## Source hierarchy

Every product claim must be grounded before it is written.

Use sources in this order:

1. public types and package exports;
2. implementation and tests of the public contract;
3. shared primitives and their package documentation;
4. working built-in applications as examples;
5. existing documentation and `cloud-dev` references.

An existing application is not authoritative when it conflicts with a shared
primitive or public contract.

Do not invent missing behavior. Record an unresolved product question in Dex
and continue with an independent work unit.

## Canonical page contract

Each page answers one primary reader need.

Before writing, record in the active Dex task:

- reader and situation;
- question the page answers;
- source files that define the contract;
- content owned by this page;
- adjacent pages that own related content.

A complete task guide contains:

- the outcome and prerequisites;
- one runnable path;
- the success signal;
- common failures with a concrete diagnosis;
- links to option or concept references.

A complete reference contains:

- when and why the API is used;
- supported imports;
- types and options;
- required fields and defaults;
- constraints and side effects;
- permissions and security boundaries;
- results and errors;
- persistence and operational behavior when relevant;
- one minimal, verified example.

An overview explains the mental model and routes readers to tasks. It does not
repeat complete option tables or examples from reference pages.

## Writing rules

- Use clear, direct English.
- Say one thing at a time.
- Lead with the answer, action, or reason.
- Explain the platform concept before implementation detail.
- Use headings that name a task or concept. Do not put code in headings.
- Use one term for each concept.
- Keep examples small and consistent. Use the `inventory` application unless a
  real platform application is required to show the contract.
- Explain why a declaration or restriction exists when that affects correct
  use.
- Link to the canonical owner instead of summarizing it again.
- Do not add manual tables of contents.
- Do not add marketing copy, internal planning history, or filler.
- Avoid “simply”, “seamless”, “powerful”, “super easy”, and “in order to”.
- Do not expose maintainer-only, compatibility, deprecated, or experimental
  APIs as normal application APIs.

## Work loop

Every work unit follows the same loop:

1. Inspect the current pages and identify duplicates, gaps, and misplaced
   content.
2. Inspect public exports, implementation, tests, and at least one real caller.
3. Decide the smallest canonical page set before drafting.
4. Write the overview last, after the detailed ownership boundaries are clear.
5. Add or update compile fixtures for runnable TypeScript examples.
6. Add only useful cross-links to canonical pages.
7. Run the documentation harness.
8. Verify Fibel HTML and raw Markdown routes.
9. Verify navigation, search, and `llms.txt` after the section is complete.
10. Complete the Dex work unit with source and verification evidence.

Do not mark a page complete because it contains prose. Mark it complete only
when the page contract and verification gates pass.

## Execution order

### 0. Planning and harness

- Persist this plan.
- Add structural, link, wording, typecheck, and Fibel build checks.
- Make the checks runnable through `bun run verify:docs`.

### 1. Audit the completed foundation

Review Start, Build an app, Server, Identity and access, and Data together.

- Merge pages whose primary need is not distinct.
- Remove repeated actor, route, storage, and application-boundary explanations.
- Keep only examples that add a new contract.
- Repair all cross-links after consolidation.

### 2. Platform services

First close the core service contract:

- Platform services overview;
- Settings;
- Logging;
- Notifications.

Then document the remaining supported services:

- Tracing;
- Audit events;
- Universal search;
- Dashboard widgets;
- In-product Help;
- PDF and templates;
- CLI modules.

Notifications is the depth reference, not the length target.

### 3. Automation

Document process and distributed primitives first:

- Automation overview;
- Lifecycle work;
- Jobs and queues;
- Schedulers;
- Topics and live events;
- Coordination primitives.

Then document durable workflows:

- Workflow model;
- Actions and events;
- Authoring and publication;
- Starting runs;
- Workers and execution;
- Effects, retry, and reconciliation;
- Waiting, fan-out, and budgets;
- Observability and testing.

Keep `@valentinkolb/sync` primitives separate from the Cloud workflow kernel.

### 4. Frontend

Document rendering and composition first:

- Frontend overview;
- SSR pages and routing;
- Application shells;
- Layout and navigation;
- Islands and hydration;
- URL state and enhanced navigation.

Then document interactions and quality:

- Typed browser clients and mutations;
- Forms, prompts, and feedback;
- Realtime UI;
- Styling and accessibility;
- Frontend testing;
- Component catalog guide.

The catalog guide routes to `/ui`; it does not duplicate component reference
content.

### 5. AI

Keep AI pages focused on Cloud-specific contracts:

- AI overview;
- Resources and access;
- Models and providers;
- Chat runtime and streaming;
- Tools and approvals;
- Files, skills, and memory;
- Structured and background work;
- UI and operations.

Do not restate generic provider SDK documentation.

### 6. Operations

- Operations overview;
- Monorepo development;
- Standalone development;
- Build and deploy;
- Runtime configuration;
- Scaling and shutdown;
- Observability;
- FreeIPA;
- Troubleshooting.

Separate application-author steps from platform-operator steps on every page.

### 7. Reference and coverage

- API surface;
- Route conventions;
- Settings and environment reference;
- Shared vocabulary and statuses;
- Deprecations and migrations.

The API surface owns the support classification. Check every package export
against it so a new public path cannot appear without documentation.

### 8. Whole-site review

- Remove all remaining stubs.
- Remove duplicated explanations and examples.
- Balance depth across related pages.
- Verify every internal link and heading anchor.
- Verify every example fixture.
- Verify HTML, raw Markdown, navigation, search, `llms.txt`, and
  `llms-full.txt`.
- Run a final browser pass in light and dark mode.

### 9. Generate skill references

Only after the developer documentation is complete:

- concatenate explicit canonical page lists;
- strip Fibel frontmatter;
- rewrite documentation links to local reference links;
- preserve headings, code, and warnings;
- fail when generated output is stale.

`skills/cloud-dev/SKILL.md` remains hand-written. Generated references do not
rewrite public documentation.

## Final hardening

Before release:

- keep one canonical owner for each platform fact;
- reject malformed frontmatter, duplicate headings, broken links, and
  undocumented package exports;
- typecheck the site and every example without hiding unrelated diagnostics;
- prove that generated references are current and contain no orphaned output;
- run the Fibel build and the skill validator;
- build the deployment container;
- verify representative HTML, raw Markdown, search, and LLM routes in a real
  browser.

## Automated harness

Run the fast checks while writing:

```bash
cd docs-site
bun run check:docs
bun run typecheck:examples
```

Run the scoped content gate before completing a work unit:

```bash
cd docs-site
bun run check:docs -- docs/en/<section>
bun run typecheck:examples
bun run typecheck:harness
bun run build
```

Run the global gate after all sections are complete:

```bash
cd docs-site
bun run verify:docs
```

The global gate remains red while scaffold pages are empty. The automated
harness checks objective rules. Source accuracy, coverage, redundancy, and
“one thing at a time” remain mandatory review gates because a script cannot
judge them reliably.

## Stop conditions

Continue without asking when a source-backed answer exists.

Stop only when:

- two public contracts contradict each other;
- a security or authorization behavior is ambiguous;
- documenting the current behavior would endorse a known bug;
- completing the page requires an API or product decision.

Record the exact conflict in Dex. Continue with the next independent work unit
when possible.
