# Administration CLI

## What Administration is

Administration is the operational view of a Cloud instance: gateway state, registered apps, routes, observability, storage diagnostics, notifications, announcements, webhooks, and metrics.

Use `cld admin` when operating a Cloud instance as an administrator. Commands inspect the selected remote Cloud instance and use the permissions of the signed-in administrator.

## Start with health and diagnostics

```bash
cld admin status --json
cld admin apps list --json
cld admin routes list --json
cld admin diagnose --since 6h --include health,logs,telemetry,postgres,redis,metrics --json
```

Use `diagnose` for a bounded troubleshooting bundle. Narrow its time window and included sections before requesting more data.

## Logs, telemetry, and storage diagnostics

```bash
cld admin logs errors --since 24h --search "timeout" --json
cld admin logs list --source gateway --level warn --since 6h --json
cld admin telemetry summary --hours 24 --json
cld admin postgres summary --json
cld admin redis summary --json
```

Use `cld admin logs show <id> --json` for the full details of a selected log entry. The `postgres` and `redis` command groups also provide tables, schemas, extensions, and sampled prefix views; read their command help before narrowing a diagnostic.

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
| Routes | `routes list` |
| Logs | `logs list`, `logs summary`, `logs stats`, `logs errors`, `logs problems`, `logs show`, `logs explain`, `logs tail`, `logs sources`, `logs cleanup` |
| Telemetry | `telemetry summary`, `telemetry events`, `telemetry apps` |
| Postgres diagnostics | `postgres summary`, `postgres tables`, `postgres schemas`, `postgres extensions` |
| Redis diagnostics | `redis summary`, `redis prefixes` |
| Notifications | `notifications list`, `notifications summary`, `notifications get`, `notifications resend`, `notifications pending-system`, `notifications send-pending-system` |
| Notification batches | `notification-batches list`, `notification-batches preview`, `notification-batches create`, `notification-batches get`, `notification-batches finalize`, `notification-batches recipients`, `notification-batches retry-failed`, `notification-batches retry-recipient`, `notification-batches delete-draft` |
| Announcements | `announcements list`, `announcements create`, `announcements update`, `announcements delete` |
| Webhooks | `webhooks list`, `webhooks get`, `webhooks apply`, `webhooks create`, `webhooks update`, `webhooks test`, `webhooks delete` |
| Metrics | `metrics status`, `metrics read`, `metrics catalogue`, `metrics tokens list`, `metrics tokens create`, `metrics tokens revoke` |
