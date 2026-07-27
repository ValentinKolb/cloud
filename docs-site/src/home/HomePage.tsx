import { For } from "solid-js";
import type { ThemeMode } from "@k2b/fibel";
import { highlight } from "@k2b/stdlib";
import HomeHeader from "./HomeHeader.island";
import HomeShortcuts from "./HomeShortcuts.client";

const applications = [
  ["Mail", "Search, organise, and collaborate on email."],
  ["Notebooks", "Collaborative notes with realtime sync."],
  ["Spaces", "Boards, tasks, and events, published as iCal."],
  ["Grids", "Flexible tables with fields, records, views, and forms."],
  ["Files", "Browse, upload, and organise shared files."],
  ["Contacts", "Shared contact books and directories."],
  ["Assistant", "AI chat for writing, rewriting, and summarising."],
];

const buildingBlocks = [
  ["Identity", "Sign-in, sessions, accounts, roles, service identities, and resource permissions."],
  ["Interface", "Application shells, navigation, settings, search, administration, and a shared UI kit."],
  ["State", "Postgres foundations, caching, and app-owned schemas for durable data."],
  ["Background", "Background jobs, queues, schedules, and durable workflows with retries and recovery."],
  ["Evidence", "Logging, tracing, health, metrics, notifications, email, and Web Push."],
];

const steps = [
  ["Declare the application", ["name", "Inventory"], ["path", "/app/inventory"], ["status", "connected"]],
  ["Use shared capabilities", ["identity", "ready"], ["interface", "ready"], ["automation", "opt in"]],
  ["Operate independently", ["deployment", "independent"], ["instances", "scale as needed"], ["health", "observed"]],
] as const;

const choices = [
  ["Language", "Bun and Hono", "or any service that speaks HTTP"],
  ["Interface", "SolidJS SSR and the Cloud UI kit", "or a frontend you build yourself"],
  ["State", "An app-owned Postgres schema", "or additional stores the service owns"],
  ["Integration", "defineApp()", "or the registry and routing contract directly"],
  ["Deployment", "One container per application", "started, replaced, and scaled on its own"],
  ["Platform", "Track upstream releases", "or fork and operate the whole source"],
];

const defineAppCode = `import { defineApp } from "@valentinkolb/cloud";

export const app = defineApp({
  id: "inventory",
  name: "Inventory",
  basePath: "/app/inventory",
  routes: ["/api/inventory", "/app/inventory"],
});

export const { ssr, plugin } = app;`;

const defineAppCodeHtml = highlight.presets.code(defineAppCode);

type HomePageProps = {
  theme: ThemeMode;
  themeCookieName: string;
};

export default function HomePage(props: HomePageProps) {
  return (
    <>
      <HomeHeader initialTheme={props.theme} themeCookieName={props.themeCookieName} />
      <main class="cloud-home">
        <section class="cloud-hero">
          <div class="cloud-shell cloud-hero-grid">
            <div class="cloud-hero-copy">
              <h1>
                The open-source
                <br />
                application platform
                <br />
                that runs on
                <br />
                your infrastructure.
              </h1>
              <p class="cloud-lead">
                Cloud gives every application identity, permissions, product UI, data, automation, and operations. Use the building blocks
                you need and keep each service independent.
              </p>
              <div class="cloud-actions">
                <a class="cloud-btn cloud-btn-primary" href="/docs/en/overview">
                  Read the developer overview
                </a>
                <a class="cloud-btn" href="https://github.com/ValentinKolb/cloud">
                  Browse the source
                </a>
              </div>
              <p class="cloud-stack">
                <span>AGPL-3.0-or-later</span>
                <span>Bun</span>
                <span>Hono</span>
                <span>SolidJS</span>
                <span>Postgres</span>
                <span>Valkey</span>
              </p>
            </div>
            <div class="cloud-artifact cloud-code cloud-hero-code">
              <div class="cloud-code-head">
                <span class="cloud-artifact-title">src/config.ts</span>
                <span class="cloud-artifact-note">one application contract</span>
              </div>
              <pre>
                <code innerHTML={defineAppCodeHtml} />
              </pre>
            </div>
          </div>
        </section>

        <section class="cloud-dayone">
          <div class="cloud-shell">
            <div class="cloud-head">
              <h2>A working platform from day one.</h2>
              <p>
                Cloud includes useful applications and the shared systems behind them. Your own applications use the same platform building
                blocks.
              </p>
            </div>
            <div class="cloud-dayone-grid">
              <div class="cloud-apps">
                <div class="cloud-apps-group">
                  <h3>Applications included</h3>
                  <ul>
                    <For each={applications}>
                      {([name, description]) => (
                        <li>
                          <b>{name}</b>
                          <span>{description}</span>
                        </li>
                      )}
                    </For>
                  </ul>
                </div>
              </div>
              <aside class="cloud-inherits">
                <h3>Platform building blocks</h3>
                <p>Use them together or adopt only what an application needs. Cloud never takes ownership of your code.</p>
                <dl>
                  <For each={buildingBlocks}>
                    {([name, description]) => (
                      <div>
                        <dt>{name}</dt>
                        <dd>{description}</dd>
                      </div>
                    )}
                  </For>
                </dl>
              </aside>
            </div>
          </div>
        </section>

        <section class="cloud-request">
          <div class="cloud-shell">
            <div class="cloud-head">
              <h2>How an application fits in.</h2>
              <p>A small contract connects an independent service to the shared platform around it.</p>
            </div>
            <ol class="cloud-path">
              <For each={steps}>
                {(step) => (
                  <li class="cloud-step">
                    <h3>{step[0]}</h3>
                    <div class="cloud-artifact cloud-mono-card">
                      <dl>
                        <For each={step.slice(1)}>
                          {(entry) => (
                            <div>
                              <dt>{entry[0]}</dt>
                              <dd>{entry[1]}</dd>
                            </div>
                          )}
                        </For>
                      </dl>
                    </div>
                  </li>
                )}
              </For>
            </ol>
          </div>
        </section>

        <section class="cloud-boundary">
          <div class="cloud-shell cloud-boundary-grid">
            <div class="cloud-boundary-copy">
              <h2>Use the platform. Keep your choices.</h2>
              <p>
                The TypeScript packages are the shortest path to full integration, not a cage. Any service that speaks the platform's HTTP
                contract can become a first-class application.
              </p>
              <p>Cloud is open source, runs on your infrastructure, and can be extended or forked without permission.</p>
            </div>
            <dl class="cloud-choices">
              <For each={choices}>
                {([label, preferred, alternative]) => (
                  <div>
                    <dt>{label}</dt>
                    <dd>
                      <b>{preferred}</b>
                      <span>{alternative}</span>
                    </dd>
                  </div>
                )}
              </For>
            </dl>
          </div>
        </section>

        <section class="cloud-cta">
          <div class="cloud-shell cloud-cta-grid">
            <h2>Build on the platform.</h2>
            <p>Read the application model or inspect the real components applications share.</p>
            <div class="cloud-actions">
              <a class="cloud-btn cloud-btn-primary" href="/docs/en/overview">
                Open the docs
              </a>
              <a class="cloud-btn" href="/ui">
                Explore the UI
              </a>
            </div>
          </div>
        </section>
      </main>
      <HomeShortcuts />
    </>
  );
}
