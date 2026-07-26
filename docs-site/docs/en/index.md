---
title: Cloud
navTitle: Home
section: Start
order: 10
description: A self-hosted application platform for internal software. Identity, product UI, data services, background work, and operations are shared; every application stays its own deployable service.
tags: [cloud, platform, self-hosted]
updated: 2026-07-26
---

# Cloud

<div class="cloud-home">
  <section class="cloud-hero">
    <div class="cloud-shell cloud-hero-grid">
      <div class="cloud-hero-copy">
        <h1>A self-hosted platform your applications register into.</h1>
        <p class="cloud-lead">Cloud brings identity, permissions, product UI, data services, background work, and operations. An application registers at startup and keeps running as its own deployable HTTP service — no plugin runtime, and no application code inside the gateway.</p>
        <div class="cloud-actions">
          <a class="cloud-btn cloud-btn-primary" href="/en/overview">Read the developer overview</a>
          <a class="cloud-btn" href="https://github.com/ValentinKolb/cloud">Browse the source</a>
        </div>
        <p class="cloud-stack"><span>AGPL-3.0-or-later</span><span>Bun</span><span>Hono</span><span>SolidJS</span><span>Postgres</span><span>Valkey</span></p>
      </div>
      <figure class="cloud-artifact cloud-routes">
        <figcaption><span class="cloud-artifact-title">gateway route table</span><span class="cloud-dot" aria-hidden="true"></span><span class="cloud-artifact-note">rebuilt from the registry</span></figcaption>
        <table>
          <thead><tr><th scope="col">prefix</th><th scope="col">upstream</th><th scope="col" class="cloud-num">inst</th></tr></thead>
          <tbody>
            <tr><td>/app/mail</td><td>app-mail:3000</td><td class="cloud-num">1</td></tr>
            <tr><td>/app/notebooks</td><td>app-notebooks:3000</td><td class="cloud-num">3</td></tr>
            <tr><td>/app/grids</td><td>app-grids:3000</td><td class="cloud-num">1</td></tr>
            <tr><td>/admin/gateway</td><td>app-gateway-ops:3000</td><td class="cloud-num">1</td></tr>
            <tr class="cloud-row-yours"><td>/app/inventory</td><td>app-inventory:3000</td><td class="cloud-num">2</td><td class="cloud-row-tag">your app</td></tr>
          </tbody>
        </table>
        <p class="cloud-artifact-foot">Every row is a separate container, started and scaled on its own. The applications that ship with Cloud are rows in the same table as yours.</p>
      </figure>
    </div>
  </section>
  <section class="cloud-dayone">
    <div class="cloud-shell">
      <div class="cloud-head">
        <h2>What is already running on day one.</h2>
        <p>Cloud is not a starter repository. The platform ships with working applications that cover the recurring needs of an organisation, and they use exactly the systems your own application uses.</p>
      </div>
      <div class="cloud-dayone-grid">
        <div class="cloud-apps">
          <div class="cloud-apps-group">
            <h3>Work</h3>
            <ul>
              <li><b>Mail</b><code>mail</code><span>Search, organise, and collaborate on email.</span></li>
              <li><b>Notebooks</b><code>notebooks</code><span>Collaborative notes with realtime sync.</span></li>
              <li><b>Spaces</b><code>spaces</code><span>Boards, tasks, and events, published as iCal.</span></li>
              <li><b>Grids</b><code>grids</code><span>Flexible tables: bases, fields, records, views, forms.</span></li>
              <li><b>Files</b><code>files</code><span>Browse, upload, and move files across accessible bases.</span></li>
              <li><b>Contacts</b><code>contacts</code><span>Contact books with structured addresses and directory projection.</span></li>
              <li><b>Assistant</b><code>assistant</code><span>AI chat for writing, rewriting, and summarising.</span></li>
            </ul>
          </div>
          <div class="cloud-apps-group">
            <h3>Identity and access</h3>
            <ul>
              <li><b>Core</b><code>core</code><span>Auth, sessions, search, admin, and platform services.</span></li>
              <li><b>Accounts</b><code>accounts</code><span>Users, groups, and account requests.</span></li>
              <li><b>OAuth</b><code>oauth</code><span>OAuth2 and OIDC clients, redirects, scopes, secrets.</span></li>
              <li><b>Proxy Auth</b><code>proxy-auth</code><span>Forward-auth for services behind the reverse proxy.</span></li>
            </ul>
          </div>
          <div class="cloud-apps-group">
            <h3>Operations</h3>
            <ul>
              <li><b>Gateway</b><code>gateway-ops</code><span>Registry, routes, logs, telemetry, webhooks, notifications.</span></li>
              <li><b>Pulse</b><code>pulse</code><span>Metrics, events, states, and realtime dashboards.</span></li>
              <li><b>API Docs</b><code>api-docs</code><span>Every running app's OpenAPI spec, aggregated.</span></li>
              <li><b>Dashboard</b><code>dashboard</code><span>User home built from widgets contributed by every app.</span></li>
            </ul>
          </div>
        </div>
        <aside class="cloud-inherits">
          <h3>What every one of them inherits</h3>
          <p>These are runtime services and maintained contracts. An application adopts them individually; nothing is generated into your repository.</p>
          <dl>
            <div>
              <dt>Identity</dt>
              <dd>Authentication flows, browser sessions, actors, principals, roles, resource permissions, service accounts, API credentials, OAuth, passkeys.</dd>
            </div>
            <div>
              <dt>Interface</dt>
              <dd>SolidJS server rendering, islands, application shells, navigation, settings, universal search, admin surfaces, and the shared UI kit.</dd>
            </div>
            <div>
              <dt>State</dt>
              <dd>Postgres with optional app-owned schemas and migrations, Valkey for sessions, registry, cache, and distributed coordination.</dd>
            </div>
            <div>
              <dt>Work</dt>
              <dd>Jobs, durable queues, schedulers, topics, rate limits, mutexes, and durable workflows with retry, crash recovery, and effect journals.</dd>
            </div>
            <div>
              <dt>Evidence</dt>
              <dd>Structured logging, tracing, request telemetry, health, metrics, typed notifications, email, and Web Push.</dd>
            </div>
          </dl>
        </aside>
      </div>
    </div>
  </section>
  <section class="cloud-request">
    <div class="cloud-shell">
      <div class="cloud-head">
        <h2>One request, end to end.</h2>
        <p>Nothing about an application is compiled into the gateway. A request is authenticated by the platform, matched against prefixes published by running instances, and proxied to one of them.</p>
      </div>
      <ol class="cloud-path">
        <li class="cloud-step">
          <h3>Request arrives</h3>
          <div class="cloud-artifact cloud-mono-card">
            <p class="cloud-req-line"><b>GET</b><code>/app/grids/api/records/42</code></p>
            <dl><div><dt>cookie</dt><dd>cloud_session</dd></div><div><dt>upgrade</dt><dd>—</dd></div></dl>
          </div>
        </li>
        <li class="cloud-step">
          <h3>Identity resolves</h3>
          <div class="cloud-artifact cloud-mono-card">
            <dl><div><dt>actor</dt><dd>user:42</dd></div><div><dt>accessSubject</dt><dd>user:42</dd></div></dl>
            <p class="cloud-grant"><span class="cloud-dot" aria-hidden="true"></span><code>grids.base:7</code><b>write</b></p>
          </div>
          <p class="cloud-step-note">A browser session and a user-bound API key resolve to the same access subject. Resource-bound service accounts stay distinct principals.</p>
        </li>
        <li class="cloud-step">
          <h3>Longest prefix wins</h3>
          <div class="cloud-artifact cloud-mono-card">
            <p class="cloud-match"><code>/app/grids</code><b>→</b><code>app-grids:3000</code></p>
            <dl><div><dt>instance</dt><dd>02 of 03</dd></div><div><dt>status</dt><dd>200</dd></div></dl>
          </div>
          <p class="cloud-step-note">Several instances of one application register under the same id. The gateway spreads traffic across whichever are currently alive.</p>
        </li>
      </ol>
      <dl class="cloud-facts">
        <div><dt>routing</dt><dd>longest prefix</dd></div>
        <div><dt>heartbeat</dt><dd>every 60 s</dd></div>
        <div><dt>entry expiry</dt><dd>after 180 s</dd></div>
        <div><dt>transport</dt><dd>HTTP and WebSocket</dd></div>
      </dl>
    </div>
  </section>
  <section class="cloud-boundary">
    <div class="cloud-shell cloud-boundary-grid">
      <div class="cloud-boundary-copy">
        <h2>The Cloud packages are optional. The runtime contract is not.</h2>
        <p>The TypeScript packages are the shortest path to full integration, but the gateway never loads application code and there is no plugin sandbox to live inside. A service that implements the registry entry and the HTTP contract is a first-class application, whatever it is written in.</p>
        <p>Shared semantics stay shared for the applications that opt into them. Everything else is yours, including the decision to fork: the complete platform is self-hosted under the AGPL.</p>
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
        <h2>Registration is a declaration, not a framework.</h2>
        <p><code>defineApp()</code> states what the platform must know to discover and present a service. The application keeps its own Hono router, middleware, pages, lifecycle hooks, and optional Postgres schema; Cloud injects nothing implicitly.</p>
        <p>At startup <code>app.start()</code> writes the entry below into the registry and refreshes it every 60 seconds. When an instance stops answering, its entry expires after 180 seconds and the gateway drops it from the trie.</p>
        <a class="cloud-link" href="/en/overview#the-app-contract">Read the complete app contract</a>
      </div>
      <div class="cloud-contract-stack">
        <div class="cloud-artifact cloud-code">
          <div class="cloud-code-head"><span class="cloud-artifact-title">src/config.ts</span><span class="cloud-artifact-note">@valentinkolb/cloud</span></div>
          <pre><code><i>import</i> { defineApp } <i>from</i> <u>"@valentinkolb/cloud"</u>;
<i>export const</i> app = defineApp({
  id: <u>"inventory"</u>,
  name: <u>"Inventory"</u>,
  basePath: <u>"/app/inventory"</u>,
  baseUrl: <u>"http://app-inventory:3000"</u>,
  routes: [<u>"/api/inventory"</u>, <u>"/app/inventory"</u>],
  nav: { href: <u>"/app/inventory"</u>, section: <u>"primary"</u> },
});
<i>export const</i> { ssr, plugin } = app;</code></pre>
        </div>
        <figure class="cloud-artifact cloud-entry">
          <figcaption><span class="cloud-artifact-title">registry entry</span><span class="cloud-dot" aria-hidden="true"></span><span class="cloud-artifact-note">live in Valkey</span></figcaption>
          <dl>
            <div><dt>id</dt><dd>inventory</dd></div>
            <div><dt>baseUrl</dt><dd>http://app-inventory:3000</dd></div>
            <div><dt>routes</dt><dd>/api/inventory /app/inventory</dd></div>
            <div><dt>instance</dt><dd>02 of 02</dd></div>
            <div><dt>ttl</dt><dd>180 s</dd></div>
          </dl>
        </figure>
      </div>
    </div>
  </section>
  <section class="cloud-cta">
    <div class="cloud-shell cloud-cta-grid">
      <h2>See how an application joins Cloud.</h2>
      <p>Follow a request through the gateway, read the full <code>defineApp()</code> contract, and see which platform services application code can reach.</p>
      <a class="cloud-btn cloud-btn-primary" href="/en/overview">Open the overview</a>
    </div>
  </section>
</div>
