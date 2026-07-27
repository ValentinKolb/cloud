---
title: Observability
navTitle: Observability
section: Operations
order: 1160
description: Use logs, traces, metrics, and health data to operate Cloud applications.
tags: [observability, health, logs]
updated: 2026-07-27
---

# Observability

Start with gateway health. Then narrow the problem to an application, route,
background source, or dependency.

## Check the deployment

```bash
cld admin instance health
cld admin gateway apps
```

Gateway health shows registered applications, route count, and healthy,
degraded, or offline instances.

Use `cld admin instance diagnose` for a bounded snapshot of health, logs,
telemetry, jobs, Postgres, Valkey, and metrics.

See [CLI modules](/docs/en/platform/cli-modules) for authentication and output
formats.

## Read logs

Use structured fields to filter by:

- application source;
- level;
- request ID;
- trace ID;
- route;
- actor or resource identifier when safe.

Do not log secrets, session tokens, authorization headers, prompts, or model
output.

See [Logging](/docs/en/platform/logging) for application APIs.

## Trace a request or operation

Request middleware publishes route templates to gateway telemetry.
`middleware.logger()` records 5xx, 429, 401, and 403 responses. Notifications
and structured AI create trace spans. Add explicit spans around other
application work when you need end-to-end tracing.

Use one trace to answer:

- where time was spent;
- which dependency failed;
- whether a retry ran;
- whether the operation finished or was abandoned.

See [Tracing](/docs/en/platform/tracing) for span APIs.

## Inspect routes and background work

Route telemetry uses the route template, not the concrete URL. This keeps one
series for `/api/inventory/items/:id`.

Sort by error rate to find unhealthy routes. Sort by requests to find the
highest traffic.

For background work, inspect the latest run and then its history. A stuck run is
an abandoned span, not proof that a worker is still active.

Use the dedicated pages for:

- [jobs and queues](/docs/en/automation/jobs-and-queues);
- [workflow observability](/docs/en/automation/workflow-observability-and-testing);
- [notifications](/docs/en/platform/notifications).

## Operate AI workloads

Monitor:

- queued, running, failed, and attention-needed turns;
- provider latency and errors;
- token usage;
- tool duration, approval, timeout, and failure;
- worker lease recovery;
- conversation file size;
- structured-task repair and failure counts.

Cloud tracing records model and tool metadata. It does not record prompt or
output content by default.

Set provider, tool, output, file, and worker limits before production. Test
provider failure, stream reconnect, abort, approval denial, and worker restart.

See [AI user interface](/docs/en/ai/ui-and-operations) for browser state and
shared chat components.

## Alert on user impact

Useful alerts include:

- gateway cannot reach a required application;
- a required application disappears from the registry;
- the orchestrator reports too few healthy replicas;
- route error rate or latency exceeds its threshold;
- background work is failed or stuck;
- Postgres or Valkey is unavailable;
- delivery queues grow without progress.

Alert on sustained conditions. A single failed request is not deployment
health.
