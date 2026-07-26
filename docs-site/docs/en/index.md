---
title: Cloud
navTitle: Home
section: Start
order: 10
description: An open-source, on-premises application platform. Cloud provides shared identity, UI, data, automation, and operations while every application stays independent.
tags: [cloud, platform, open-source, on-premises]
updated: 2026-07-26
---

# Cloud

<div class="cloud-home">
  <section class="cloud-hero">
    <div class="cloud-shell cloud-hero-grid">
      <div class="cloud-hero-copy">
        <h1>The open-source<br />application platform<br />that runs on<br />your infrastructure.</h1>
        <p class="cloud-lead">Cloud gives every application identity, permissions, product UI, data, automation, and operations. Use the building blocks you need, run everything on premises, and keep each service independent.</p>
        <div class="cloud-actions">
          <a class="cloud-btn cloud-btn-primary" href="/en/overview">Read the developer overview</a>
          <a class="cloud-btn" href="https://github.com/ValentinKolb/cloud">Browse the source</a>
        </div>
        <p class="cloud-stack"><span>AGPL-3.0-or-later</span><span>Bun</span><span>Hono</span><span>SolidJS</span><span>Postgres</span><span>Valkey</span></p>
      </div>
      <div class="cloud-artifact cloud-code cloud-hero-code">
        <div class="cloud-code-head"><span class="cloud-artifact-title">src/config.ts</span><span class="cloud-artifact-note">one application contract</span></div>
        <pre><code><i>import</i> { defineApp } <i>from</i> <u>"@valentinkolb/cloud"</u>;
<i>export const</i> app = defineApp({
  id: <u>"inventory"</u>,
  name: <u>"Inventory"</u>,
  icon: <u>"ti ti-package"</u>,
  description:
    <u>"Stock across teams and locations."</u>,
  basePath: <u>"/app/inventory"</u>,
  baseUrl: <u>"http://app-inventory:3000"</u>,
  routes: [<u>"/api/inventory"</u>, <u>"/app/inventory"</u>],
});
<i>export const</i> { ssr, plugin } = app;</code></pre>
      </div>
    </div>
  </section>
  <section class="cloud-dayone">
    <div class="cloud-shell">
      <div class="cloud-head">
        <h2>A working platform from day one.</h2>
        <p>Cloud is more than a starter repository. It includes useful applications and the shared systems behind them. Your own applications can use the same platform building blocks.</p>
      </div>
      <div class="cloud-dayone-grid">
        <div class="cloud-apps">
          <div class="cloud-apps-group">
            <h3>Work</h3>
            <ul>
              <li><b>Mail</b><span>Search, organise, and collaborate on email.</span></li>
              <li><b>Notebooks</b><span>Collaborative notes with realtime sync.</span></li>
              <li><b>Spaces</b><span>Boards, tasks, and events, published as iCal.</span></li>
              <li><b>Grids</b><span>Flexible tables with fields, records, views, and forms.</span></li>
              <li><b>Files</b><span>Browse, upload, and organise shared files.</span></li>
              <li><b>Contacts</b><span>Shared contact books and directories.</span></li>
              <li><b>Assistant</b><span>AI chat for writing, rewriting, and summarising.</span></li>
            </ul>
          </div>
          <div class="cloud-apps-group">
            <h3>Identity and access</h3>
            <ul>
              <li><b>Core</b><span>Sign-in, sessions, search, administration, and platform services.</span></li>
              <li><b>Accounts</b><span>Users, groups, and account requests.</span></li>
              <li><b>OAuth</b><span>Connect external applications through open standards.</span></li>
              <li><b>Proxy Auth</b><span>Protect services that run behind the platform.</span></li>
            </ul>
          </div>
          <div class="cloud-apps-group">
            <h3>Operations</h3>
            <ul>
              <li><b>Gateway</b><span>Connect applications, routes, logs, webhooks, and notifications.</span></li>
              <li><b>Pulse</b><span>Metrics, events, states, and realtime dashboards.</span></li>
              <li><b>API Docs</b><span>One place for the APIs published by running applications.</span></li>
              <li><b>Dashboard</b><span>A shared home assembled from application widgets.</span></li>
            </ul>
          </div>
        </div>
        <aside class="cloud-inherits">
          <h3>Platform building blocks</h3>
          <p>Use them together or adopt only what an application needs. Cloud does not generate or take ownership of your code.</p>
          <dl>
            <div>
              <dt>Identity</dt>
              <dd>Sign-in, sessions, accounts, roles, service identities, and resource permissions.</dd>
            </div>
            <div>
              <dt>Interface</dt>
              <dd>Application shells, navigation, settings, search, administration, and a shared UI kit.</dd>
            </div>
            <div>
              <dt>State</dt>
              <dd>Postgres foundations, caching, and app-owned schemas when an application needs durable data.</dd>
            </div>
            <div>
              <dt>Background</dt>
              <dd>Background jobs, queues, schedules, and durable workflows with retries and recovery.</dd>
            </div>
            <div>
              <dt>Evidence</dt>
              <dd>Logging, tracing, health, metrics, notifications, email, and Web Push.</dd>
            </div>
          </dl>
        </aside>
      </div>
    </div>
  </section>
  <section class="cloud-request">
    <div class="cloud-shell">
      <div class="cloud-head">
        <h2>How an application fits in.</h2>
        <p>Applications join the platform through a small contract. Cloud provides the shared context around them without turning independent services into plugins.</p>
      </div>
      <ol class="cloud-path">
        <li class="cloud-step">
          <h3>Declare the application</h3>
          <div class="cloud-artifact cloud-mono-card">
            <dl><div><dt>name</dt><dd>Inventory</dd></div><div><dt>path</dt><dd>/app/inventory</dd></div><div><dt>status</dt><dd>connected</dd></div></dl>
          </div>
          <p class="cloud-step-note">The application tells Cloud where it lives and which platform features it contributes.</p>
        </li>
        <li class="cloud-step">
          <h3>Use shared capabilities</h3>
          <div class="cloud-artifact cloud-mono-card">
            <dl><div><dt>identity</dt><dd>ready</dd></div><div><dt>interface</dt><dd>ready</dd></div><div><dt>automation</dt><dd>opt in</dd></div></dl>
          </div>
          <p class="cloud-step-note">Adopt authentication, UI, data, jobs, notifications, and operations together or one capability at a time.</p>
        </li>
        <li class="cloud-step">
          <h3>Operate independently</h3>
          <div class="cloud-artifact cloud-mono-card">
            <dl><div><dt>deployment</dt><dd>independent</dd></div><div><dt>instances</dt><dd>scale as needed</dd></div><div><dt>health</dt><dd>observed</dd></div></dl>
          </div>
          <p class="cloud-step-note">Release, scale, replace, or rewrite the service without rebuilding the rest of the platform.</p>
        </li>
      </ol>
    </div>
  </section>
  <section class="cloud-boundary">
    <div class="cloud-shell cloud-boundary-grid">
      <div class="cloud-boundary-copy">
        <h2>Use the platform. Keep your choices.</h2>
        <p>The TypeScript packages are the shortest path to full integration, but they are not a cage. Any service that speaks the platform's HTTP contract can become a first-class application, whatever it is written in.</p>
        <p>Choose the shared capabilities that make sense and own everything else. Cloud is open source, runs on premises, and can be extended or forked without permission.</p>
      </div>
      <dl class="cloud-choices">
        <div><dt>Language</dt><dd><b>Bun and Hono</b><span>or any service that speaks HTTP</span></dd></div>
        <div><dt>Interface</dt><dd><b>SolidJS SSR and the Cloud UI kit</b><span>or a frontend you build yourself</span></dd></div>
        <div><dt>State</dt><dd><b>An app-owned Postgres schema</b><span>or additional stores the service owns</span></dd></div>
        <div><dt>Integration</dt><dd><b><code>defineApp()</code></b><span>or the registry and routing contract directly</span></dd></div>
        <div><dt>Deployment</dt><dd><b>One container per application</b><span>started, replaced, and scaled on its own</span></dd></div>
        <div><dt>Platform</dt><dd><b>Track upstream releases</b><span>or fork and operate the whole source</span></dd></div>
      </dl>
    </div>
  </section>
  <section class="cloud-contract">
    <div class="cloud-shell cloud-contract-grid">
      <div class="cloud-contract-copy">
        <h2>Bring your own router.</h2>
        <p><code>app.start()</code> connects the application's request handler to the registry, assets, lifecycle, and graceful shutdown. The request pipeline remains explicit.</p>
        <p>Prefer another stack? Implement the open HTTP contract directly. Cloud coordinates applications; it never owns their domain logic.</p>
        <a class="cloud-link" href="/en/overview#the-app-contract">Read the complete app contract</a>
      </div>
      <div class="cloud-contract-stack">
        <div class="cloud-artifact cloud-code">
          <div class="cloud-code-head"><span class="cloud-artifact-title">src/index.ts</span><span class="cloud-artifact-note">your request pipeline</span></div>
          <pre><code><i>import</i> { middleware, <i>type</i> AuthContext } <i>from</i> <u>"@valentinkolb/cloud/server"</u>;
<i>import</i> { Hono } <i>from</i> <u>"hono"</u>;
<i>import</i> { app } <i>from</i> <u>"./config"</u>;
<i>import</i> api <i>from</i> <u>"./api"</u>;
<i>import</i> pages <i>from</i> <u>"./frontend"</u>;
<i>const</i> router = <i>new</i> Hono&lt;AuthContext&gt;()
  .use(<u>"*"</u>, middleware.runtime())
  .use(<u>"*"</u>, middleware.settings())
  .route(<u>"/api/inventory"</u>, api)
  .route(<u>"/app/inventory"</u>, pages);
<i>export default await</i> app.start({
  fetch: router.fetch,
});</code></pre>
        </div>
      </div>
    </div>
  </section>
  <section class="cloud-cta">
    <div class="cloud-shell cloud-cta-grid">
      <h2>See how an application joins Cloud.</h2>
      <p>Read the application model, the complete <code>defineApp()</code> contract, and the technical details behind the platform.</p>
      <a class="cloud-btn cloud-btn-primary" href="/en/overview">Open the overview</a>
    </div>
  </section>
</div>
