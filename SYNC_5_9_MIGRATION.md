# @k2b/sync 5.9 maintenance upgrade

Cloud crosses the durable namespace boundary when it moves from `@k2b/sync`
5.8 to 5.9. This is a maintenance deployment: old and new producers or
workers must never run at the same time. The library cannot safely infer the
owner of an old colon-concatenated key, so do not bulk-rename legacy keys.

## Cloud durable-state inventory

Check every deployed instance, including app variants not present in the
standard Compose profile.

| Area | Durable primitives |
| --- | --- |
| Core | auth lifecycle jobs and scheduler; AI queue, topics, jobs, and scheduler; notification queue and topic; gateway telemetry topic |
| Assistant | notification recovery scheduler and delivery job |
| Contacts | contact event topic |
| Gateway Ops | offline-audit job and lifecycle scheduler |
| Grids | record, metadata, workflow, and runtime topics; record work queues; workflow scheduler |
| IPA Hosts | sync job and scheduler |
| Mail | command, maintenance, sync, hydration, draft import/export, and notification jobs; command, sync, workflow, and notification schedulers; collaboration topic; rule-backfill pump |
| Notebooks | snapshot and reindex jobs; snapshot queue; workspace, Yjs, and awareness topics; snapshot and reindex schedulers |
| Pulse | retention, rollup, and base-lifecycle jobs; Pulse scheduler |
| Spaces | space event topic |

Mutexes, rate limits, and ephemeral registry/presence state do not require the
durable migration, but they still require a coordinated restart so every
process loads the same package version.

## Read-only preflight

1. Verify the artifact resolves one version only:

   ```sh
   bun pm ls --all | rg '@k2b/sync@'
   ```

2. Record the running version in every Cloud container. A 5.8 container blocks
   the 5.9 start:

   ```sh
   docker compose -f compose.dev.yml --profile extra ps -q \
     | xargs -n1 docker inspect --format '{{.Name}}' \
     | while read -r container; do
         docker exec "${container#/}" bun -e \
           'console.log(process.env.APP_ID, require("@k2b/sync/package.json").version)'
       done
   ```

3. Export an exact, read-only Redis key inventory and a Redis backup before
   changing state. Keep the raw keys: ambiguous names must be decided by an
   operator, not parsed by a migration script.

   ```sh
   redis-cli -u "$REDIS_URL" --scan | sort > sync-5.9-keys.before.txt
   redis-cli -u "$REDIS_URL" --rdb sync-5.9-before.rdb
   ```

4. For every queue, verify ready, delayed, and active work is empty and inspect
   its DLQ. Consume or export retained topic entries and pending groups. Let job
   claims expire, pumps finish their active page, and pending scheduler-control
   requests settle. Preserve any pump cursor or run that must continue.

5. Record scheduler definitions, indexes, due state, and next-run times. These
   legacy scheduler keys are preserved through the deployment.

## Execution

1. Stop every 5.8 producer and worker. Verify no Cloud container remains before
   starting a 5.9 container.
2. Recheck the queue, topic, job, pump, and scheduler-control drain conditions.
3. Remove only legacy namespaces that were individually identified and proven
   drained. Wait out required queue idempotency TTLs first. Do not delete legacy
   scheduler definitions, indexes, or due state.
4. Start all Cloud images built from the same lockfile. Do not use a rolling
   deployment across this boundary.
5. Call each scheduler's normal list/get/create path and verify the new
   collision-free schedule records and next slots. Keep the compatible legacy
   scheduler keys.
6. Verify every container reports 5.9.0, all apps are present in the Gateway
   registry, representative queue/topic/job/pump flows complete, and logs contain
   no `namespace migration required` error.

## Rollback boundary

Before any 5.9 worker writes durable work, stop all containers and the old
images can be started together against the untouched legacy namespaces. After
5.9 has accepted work, a 5.8 rollback cannot see the new namespace safely;
stop all workers and restore the pre-upgrade Redis backup or explicitly migrate
that work first. Never run 5.8 and 5.9 concurrently during rollback.
