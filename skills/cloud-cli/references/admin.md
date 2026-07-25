# Administration CLI

## What Administration is

Administration is the operational view of a Cloud instance: gateway state, registered apps, routes, observability, storage diagnostics, notifications, announcements, webhooks, and metrics.

Use `cld admin` when operating a Cloud instance as an administrator. Commands inspect the selected remote Cloud instance and use the permissions of the signed-in administrator.

## Start with health and diagnostics

```bash
cld admin status --json
cld admin apps list --json
cld admin routes list --range 24h --json
cld admin diagnose --since 6h --include health,logs,telemetry,jobs,postgres,redis,metrics --json
```

Route hit and error counts are scoped to `--range` (1h, 6h, 24h, 7d, 30d). They used to be cumulative since the gateway router last restarted, which made a long-lived router look healthy while it was failing every request.

Use `diagnose` for a bounded troubleshooting bundle. Narrow its time window and included sections before requesting more data. Its `telemetry.failingRoutes` and `jobs` sections name the endpoints and background jobs that are actually failing, which is usually the fastest way into a problem.

## Logs and storage diagnostics

```bash
cld admin logs errors --since 24h --search "timeout" --json
cld admin logs list --source gateway --level warn --since 6h --json
cld admin postgres summary --json
cld admin redis summary --json
```

`redis summary` reports memory against `maxmemory`, evicted keys with the active eviction policy, cache hit rate and connected clients alongside the keyspace counts. A rising eviction count or a falling hit rate is the signal that Redis is under pressure; key counts alone will not show it.

Use `cld admin logs show <id> --json` for the full details of a selected log entry, and `cld admin logs explain <id> --json` to get that entry together with nearby context. The `postgres` and `redis` command groups also provide tables, schemas, extensions, and sampled prefix views; read their command help before narrowing a diagnostic.

## Request telemetry

Start with `telemetry routes`, not with individual events. Routes are real route templates such as `/api/mail/mailboxes/:id`, so a failing endpoint is identifiable; an aggregate request count is usually dominated by one busy route and says very little.

```bash
cld admin telemetry routes --sort errorRate --range 24h --json
cld admin telemetry routes --sort requests --range 7d --json
cld admin telemetry overview --range 24h --app mail --json
cld admin telemetry explain "/api/mail/mailboxes/:id" --json
```

Ranges are `1h`, `6h`, `24h`, `7d`, and `30d`. Sort by `errorRate` to find what is broken and by `requests` to find what is popular; `errors`, `slow`, and `duration` are also available. `errorRate` ignores routes below 20 requests so a single failure cannot top the list. Narrow to failing routes with `--errors`, to slow ones with `--slow`.

`telemetry overview` counts server errors (5xx), client errors (4xx), and rate limits (429) separately — a rate-limited caller and a broken endpoint need different responses. `telemetry explain <route>` bundles one route's error breakdown, recent requests, and related error logs. `telemetry timeseries` places when a change started.

The older `telemetry summary`, `telemetry events`, and `telemetry apps` remain for raw event access.

## Background jobs

```bash
cld admin jobs list --json
cld admin jobs list --health stuck --json
cld admin jobs list --health failed --window 7d --json
cld admin jobs runs --source gateway:telemetry:cleanup --json
cld admin jobs show <traceId>:<spanId> --json
```

Run statistics are scoped to `--window` (10m, 1h, 12h, 24h, 7d, 30d) and exclude schedule-definition spans, which are registration records rather than runs.

Three states are deliberately distinct:

- **running** — open and started recently, genuinely in flight.
- **stuck** — open past the abandonment threshold. Nothing is working on these; a process died mid-run and left the span open. Stuck is counted across all retained spans rather than within the window, because an abandonment is old by definition and a windowed count would hide it.
- **anomalous** — finished, but took longer than that threshold. These come from sweeps closing orphaned spans long after the fact and are excluded from the duration percentiles so those describe real runs.

`--health failed` means the most recent run of a source failed, i.e. it is unhealthy right now — it does not list every source that has ever failed. `--health stuck` lists sources with abandoned spans. Use `jobs runs --source <id>` for run history and `jobs show` for a single run with its recorded events, which is the closest thing a background job has to a log. These commands are read-only; trigger a schedule from the admin UI.

## Notifications and announcements

```bash
cld admin notifications list --status error --json
cld admin notifications summary --json
cld admin announcements list --json
cld admin announcements create --title "Maintenance" --body-file ./maintenance.md --tone warning
```

Notification batches are drafts until explicitly finalized. Create them with a Markdown body and an audience-selection JSON file, inspect the resulting draft, then finalize only after the intended recipients are confirmed:

```bash
cld admin notification-batches create --subject "Maintenance" --body-file ./maintenance.md --selection-file ./audience.json
cld admin notification-batches get <batch-id> --json
cld admin notification-batches finalize <batch-id> --yes
```

Use the exact command help to prepare the audience-selection JSON and to retry failed recipients. Deleting a draft cannot be undone.

## Webhooks and metrics

```bash
cld admin webhooks list --json
cld admin webhooks create --name "Ops alert" --url https://example.org/webhook --min-status error
cld admin metrics status --json
cld admin metrics catalogue --category postgres --json
cld admin metrics read
```

Webhook changes affect health notifications. Test a webhook with `cld admin webhooks test --help` before relying on it. Metrics tokens are secrets: creating one prints the token once, and revocation requires `--yes`.

## Complete command catalogue

Run `cld admin <command> --help` for flags, filters, pagination, and confirmation requirements.

| Area | Commands |
| --- | --- |
| Instance | `status`, `diagnose` |
| App registry | `apps list`, `apps get`, `apps remove` |
| Routes | `routes list` (windowed via `--range`) |
| Logs | `logs list`, `logs summary`, `logs stats`, `logs errors`, `logs problems`, `logs show`, `logs explain`, `logs tail`, `logs sources`, `logs cleanup` |
| Telemetry | `telemetry routes`, `telemetry overview`, `telemetry timeseries`, `telemetry explain`, `telemetry summary`, `telemetry events`, `telemetry apps` |
| Background jobs | `jobs list`, `jobs stats`, `jobs runs`, `jobs show` |
| Postgres diagnostics | `postgres summary`, `postgres tables`, `postgres schemas`, `postgres extensions` |
| Redis diagnostics | `redis summary`, `redis prefixes` |
| Notifications | `notifications list`, `notifications summary`, `notifications get`, `notifications resend`, `notifications pending-system`, `notifications send-pending-system` |
| Notification batches | `notification-batches list`, `notification-batches preview`, `notification-batches create`, `notification-batches get`, `notification-batches finalize`, `notification-batches recipients`, `notification-batches retry-failed`, `notification-batches retry-recipient`, `notification-batches delete-draft` |
| Announcements | `announcements list`, `announcements create`, `announcements update`, `announcements delete` |
| Webhooks | `webhooks list`, `webhooks get`, `webhooks apply`, `webhooks create`, `webhooks update`, `webhooks test`, `webhooks delete` |
| Metrics | `metrics status`, `metrics read`, `metrics catalogue`, `metrics tokens list`, `metrics tokens create`, `metrics tokens revoke` |
