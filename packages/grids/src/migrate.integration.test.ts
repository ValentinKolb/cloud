import { describe, expect, test } from "bun:test";
import { SQL, sql } from "bun";
import { migrate as migrateCoreWorkflows } from "../../core/src/migrate/core/workflows";
import { migrate } from "./migrate";
import { insertTestWorkflow, insertTestWorkflowRun } from "./service/workflow-test-fixture";
import { GRIDS_WORKFLOW_SCHEMA_VERSION } from "./workflows/migrate";

const postgresTest = process.env.GRIDS_DB_TEST === "1" ? test : test.skip;

const uuid = () => Bun.randomUUIDv7();
const shortId = (prefix: string) => `${prefix}${Math.random().toString(36).slice(2, 6)}`.slice(0, 5);

const withIsolatedDatabase = async (run: (database: SQL) => Promise<void>) => {
  const sourceUrl = process.env.DATABASE_URL;
  if (!sourceUrl) throw new Error("DATABASE_URL is required for migration integration tests");
  const databaseName = `grids_migrate_${Bun.randomUUIDv7().replaceAll("-", "")}`;
  const databaseUrl = new URL(sourceUrl);
  databaseUrl.pathname = `/${databaseName}`;

  await sql.unsafe(`CREATE DATABASE "${databaseName}"`);
  const database = new SQL(databaseUrl);
  try {
    await database`CREATE SCHEMA auth`.simple();
    await database`CREATE TABLE auth.users (id UUID PRIMARY KEY)`.simple();
    await database`CREATE TABLE auth.access (id UUID PRIMARY KEY)`.simple();
    await database`CREATE TABLE auth.service_accounts (id UUID PRIMARY KEY)`.simple();
    await run(database);
  } finally {
    await database.close({ timeout: 5 });
    await sql.unsafe(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
  }
};

describe("grids schema migration", () => {
  postgresTest(
    "says which container has not run yet when the kernel schema is missing",
    async () => {
      await withIsolatedDatabase(async (database) => {
        // Nothing declares an ordering between the app containers, so on an
        // empty database Grids can migrate before app-core. Postgres would
        // refuse the health view naming a table nobody would think to look for.
        await expect(migrate(database)).rejects.toThrow(/app-core has not migrated yet/);
      });
    },
    30_000,
  );

  postgresTest(
    "serializes concurrent setup and remains idempotent",
    async () => {
      await withIsolatedDatabase(async (database) => {
        await migrateCoreWorkflows(database);
        await Promise.all([migrate(database), migrate(database)]);
        await migrateCoreWorkflows(database);
        await migrate(database);

        const [row] = await database<Array<{ tableCount: number }>>`
          SELECT count(*)::int AS "tableCount"
          FROM information_schema.tables
          WHERE table_schema = 'grids'
            AND table_type = 'BASE TABLE'
        `;
        // workflow_profile and workflow_run_profile arrived; grids.workflows,
        // workflow_revisions, workflow_runs and workflow_step_runs moved into
        // the kernel, taking workflow_effect_intents with them. Custom Apps add
        // custom_apps and custom_app_access to the current Grids schema.
        expect(row?.tableCount).toBe(30);
        const [cast] = await database<Array<{ value: number | string }>>`SELECT grids.try_numeric('12.5') AS value`;
        expect(String(cast?.value)).toBe("12.5");

        const indexes = await database<Array<{ indexName: string }>>`
          SELECT indexname AS "indexName"
          FROM pg_indexes
          WHERE schemaname = 'grids'
            AND indexname IN (
              'idx_grids_tables_live_name',
              'idx_grids_fields_live_name',
              'idx_grids_views_live_name'
            )
          ORDER BY indexname
        `;
        expect(indexes.map((index) => index.indexName)).toEqual([
          "idx_grids_fields_live_name",
          "idx_grids_tables_live_name",
          "idx_grids_views_live_name",
        ]);
        const obsoleteTables = await database<Array<{ tableName: string }>>`
          SELECT table_name AS "tableName"
          FROM information_schema.tables
          WHERE table_schema = 'grids'
            AND table_name IN ('table_access', 'view_access', 'form_access', 'document_template_access', 'workflow_access')
          ORDER BY table_name
        `;
        expect(obsoleteTables).toEqual([]);
        const [recordScope] = await database<Array<{ exists: boolean }>>`
          SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'grids' AND table_name = 'base_access' AND column_name = 'record_scope'
          ) AS exists
        `;
        expect(recordScope?.exists).toBe(false);

        const accessIdIndexes = await database<Array<{ indexName: string }>>`
          SELECT indexname AS "indexName"
          FROM pg_indexes
          WHERE schemaname = 'grids'
            AND indexname IN (
              'idx_grids_base_access_access',
              'idx_grids_custom_app_access_access'
            )
          ORDER BY indexname
        `;
        expect(accessIdIndexes.map((index) => index.indexName)).toEqual([
          "idx_grids_base_access_access",
          "idx_grids_custom_app_access_access",
        ]);
        const [health] = await database<Array<{ status: string; outboxPending: number }>>`
          SELECT status, outbox_pending::int AS "outboxPending"
          FROM grids.operational_health
        `;
        expect(health).toEqual({ status: "ok", outboxPending: 0 });
      });
    },
    30_000,
  );

  postgresTest(
    "drops obsolete access metadata without changing domain rows or base and Custom App grants",
    async () => {
      await withIsolatedDatabase(async (database) => {
        await migrateCoreWorkflows(database);
        await migrate(database);
        expect(GRIDS_WORKFLOW_SCHEMA_VERSION).toBe(8);

        const userId = uuid();
        const serviceAccountId = uuid();
        const baseId = uuid();
        const tableId = uuid();
        const fieldId = uuid();
        const recordId = uuid();
        const viewId = uuid();
        const formId = uuid();
        const documentTemplateId = uuid();
        const snapshotId = uuid();
        const documentRunId = uuid();
        const customAppId = uuid();
        const workflowId = uuid();
        const workflowLauncherId = uuid();
        const workflowRunId = uuid();
        const baseAccessId = uuid();
        const appAccessId = uuid();
        const obsoleteAccessId = uuid();
        const draftDefinition = {
          schemaVersion: 1,
          name: "Legacy draft kept byte-for-byte as JSON",
          pages: [{ id: "draft", title: "Draft", blocks: [] }],
        };
        const publishedDefinition = {
          schemaVersion: 1,
          name: "Legacy published kept byte-for-byte as JSON",
          pages: [{ id: "published", title: "Published", blocks: [] }],
        };
        const draftCapabilities = { schemaVersion: 1, tableIds: [tableId], marker: "draft" };
        const publishedCapabilities = { schemaVersion: 1, tableIds: [tableId], marker: "published" };

        await database`INSERT INTO auth.users (id) VALUES (${userId}::uuid)`;
        await database`INSERT INTO auth.service_accounts (id) VALUES (${serviceAccountId}::uuid)`;
        await database`
          INSERT INTO auth.access (id) VALUES
            (${baseAccessId}::uuid), (${appAccessId}::uuid), (${obsoleteAccessId}::uuid)
        `;
        await database`
          INSERT INTO grids.bases (id, short_id, name, description, document_profile, created_by)
          VALUES (
            ${baseId}::uuid,
            ${shortId("B")},
            'Preserved',
            'Must survive the permission hard cut',
            '{"locale":"de-DE"}'::jsonb,
            ${userId}::uuid
          )
        `;
        await database`
          INSERT INTO grids.tables (id, short_id, base_id, name, description, columns, display_config, audit_policy, position)
          VALUES (
            ${tableId}::uuid,
            ${shortId("T")},
            ${baseId}::uuid,
            'Preserved table',
            'Stable table data',
            '["primary"]'::jsonb,
            '{"mode":"cards"}'::jsonb,
            '{"recordChanges":true}'::jsonb,
            7
          )
        `;
        await database`
          INSERT INTO grids.fields (
            id, short_id, table_id, name, description, type, config, position, required, default_value, indexed, presentable
          ) VALUES (
            ${fieldId}::uuid,
            ${shortId("F")},
            ${tableId}::uuid,
            'Preserved field',
            'Stable field data',
            'text',
            '{"maxLength":120}'::jsonb,
            3,
            TRUE,
            '"fallback"'::jsonb,
            TRUE,
            TRUE
          )
        `;
        await database`
          INSERT INTO grids.records (id, table_id, data, created_by, updated_by)
          VALUES (
            ${recordId}::uuid,
            ${tableId}::uuid,
            ${{ [fieldId]: "preserved value" }}::jsonb,
            ${userId}::uuid,
            ${userId}::uuid
          )
        `;
        await database`
          INSERT INTO grids.views (id, short_id, table_id, name, description, source, ui, owner_user_id, position)
          VALUES (
            ${viewId}::uuid,
            ${shortId("V")},
            ${tableId}::uuid,
            'Preserved view',
            'Stable view data',
            'from table "Preserved table"',
            '{"density":"compact"}'::jsonb,
            ${userId}::uuid,
            4
          )
        `;
        await database`
          INSERT INTO grids.forms (id, short_id, table_id, name, config, public_token, owner_user_id, position)
          VALUES (
            ${formId}::uuid,
            ${shortId("O")},
            ${tableId}::uuid,
            'Preserved form',
            ${{ fields: [{ fieldId, required: true }] }}::jsonb,
            'preserved-public-token',
            ${userId}::uuid,
            5
          )
        `;
        await database`
          INSERT INTO grids.document_templates (
            id, short_id, table_id, name, description, source, html, header_html, footer_html, page_css,
            number_template, filename_template, enabled, position, created_by, updated_by
          ) VALUES (
            ${documentTemplateId}::uuid,
            ${shortId("D")},
            ${tableId}::uuid,
            'Preserved document template',
            'Stable template data',
            'from table "Preserved table"',
            '<main>{{ record.name }}</main>',
            '<header>Kept</header>',
            '<footer>Kept</footer>',
            '@page { size: A4; }',
            'DOC-{{ run.shortId }}',
            '{{ document.number }}.pdf',
            TRUE,
            6,
            ${userId}::uuid,
            ${userId}::uuid
          )
        `;
        await database`
          INSERT INTO grids.custom_apps (
            id, short_id, base_id, name, icon, draft_definition, draft_capabilities,
            published_definition, published_capabilities, published_at
          ) VALUES (
            ${customAppId}::uuid,
            ${shortId("C")},
            ${baseId}::uuid,
            'Preserved Custom App',
            'app-window',
            ${draftDefinition}::jsonb,
            ${draftCapabilities}::jsonb,
            ${publishedDefinition}::jsonb,
            ${publishedCapabilities}::jsonb,
            '2026-08-10T10:00:00Z'::timestamptz
          )
        `;
        await insertTestWorkflow({
          db: database,
          id: workflowId,
          baseId,
          name: "Preserved workflow",
          shortId: shortId("W"),
          source: "steps: [] # preserved",
          enabled: true,
          position: 8,
          ownerUserId: userId,
        });
        await database`
          INSERT INTO grids.workflow_launchers (
            id, short_id, base_id, workflow_id, name, kind, config, enabled, validated_revision, diagnostics
          ) VALUES (
            ${workflowLauncherId}::uuid,
            ${shortId("L")},
            ${baseId}::uuid,
            ${workflowId}::uuid,
            'Preserved launcher',
            'customApp',
            '{"button":"Run"}'::jsonb,
            TRUE,
            1,
            '[{"level":"info","message":"kept"}]'::jsonb
          )
        `;
        await insertTestWorkflowRun({
          db: database,
          id: workflowRunId,
          workflowId,
          baseId,
          state: "succeeded",
          launcherId: workflowLauncherId,
          actorUserId: userId,
          serviceAccountId,
          authorization: { kind: "preserved" },
          idempotencyKey: "preserved-run",
          occurredAt: new Date("2026-08-10T10:01:00Z"),
          createdAt: new Date("2026-08-10T10:01:00Z"),
          startedAt: new Date("2026-08-10T10:01:01Z"),
          finishedAt: new Date("2026-08-10T10:01:02Z"),
        });
        await database`
          INSERT INTO grids.record_snapshots (id, base_id, table_id, record_id, root, graph, created_by)
          VALUES (
            ${snapshotId}::uuid,
            ${baseId}::uuid,
            ${tableId}::uuid,
            ${recordId}::uuid,
            ${{ recordId, data: { [fieldId]: "preserved value" } }}::jsonb,
            ${{ records: [recordId] }}::jsonb,
            ${userId}::uuid
          )
        `;
        await database`
          INSERT INTO grids.document_runs (
            id, short_id, template_id, workflow_run_id, snapshot_id, base_id, table_id, record_id,
            document_number, filename, tags, template_snapshot, render_data, generated_by
          ) VALUES (
            ${documentRunId}::uuid,
            ${shortId("R")},
            ${documentTemplateId}::uuid,
            ${workflowRunId}::uuid,
            ${snapshotId}::uuid,
            ${baseId}::uuid,
            ${tableId}::uuid,
            ${recordId}::uuid,
            'PRESERVED-DOC-1',
            'preserved.pdf',
            ARRAY['preserved', 'migration'],
            '{"html":"<main>kept</main>"}'::jsonb,
            '{"record":{"name":"kept"}}'::jsonb,
            ${userId}::uuid
          )
        `;
        await database`INSERT INTO grids.base_access (base_id, access_id) VALUES (${baseId}::uuid, ${baseAccessId}::uuid)`;
        await database`
          INSERT INTO grids.custom_app_access (custom_app_id, access_id)
          VALUES (${customAppId}::uuid, ${appAccessId}::uuid)
        `;
        await database`
          ALTER TABLE grids.base_access ADD COLUMN record_scope JSONB NOT NULL DEFAULT '{"kind":"all"}'::jsonb;
          CREATE TABLE grids.table_access (table_id UUID, access_id UUID, record_scope JSONB);
          CREATE TABLE grids.view_access (view_id UUID, access_id UUID, record_scope JSONB);
          CREATE TABLE grids.form_access (form_id UUID, access_id UUID);
          CREATE TABLE grids.document_template_access (template_id UUID, access_id UUID);
          CREATE TABLE grids.workflow_access (workflow_id UUID, access_id UUID);
        `.simple();
        await database`
          INSERT INTO grids.table_access
          VALUES (${tableId}::uuid, ${obsoleteAccessId}::uuid, '{"kind":"all"}'::jsonb)
        `;
        await database`
          INSERT INTO grids.view_access
          VALUES (${viewId}::uuid, ${obsoleteAccessId}::uuid, '{"kind":"all"}'::jsonb)
        `;
        await database`INSERT INTO grids.form_access VALUES (${formId}::uuid, ${obsoleteAccessId}::uuid)`;
        await database`
          INSERT INTO grids.document_template_access VALUES (${documentTemplateId}::uuid, ${obsoleteAccessId}::uuid)
        `;
        await database`INSERT INTO grids.workflow_access VALUES (${workflowId}::uuid, ${obsoleteAccessId}::uuid)`;

        type SnapshotRow = { entity: string; entityId: string; value: Record<string, unknown> };
        const readPreservedRows = () => database<Array<SnapshotRow>>`
          SELECT entity, entity_id AS "entityId", value
          FROM (
            SELECT 'auth.access' AS entity, id::text AS entity_id, jsonb_build_object('id', id::text) AS value
            FROM auth.access WHERE id IN (${baseAccessId}::uuid, ${appAccessId}::uuid, ${obsoleteAccessId}::uuid)
            UNION ALL
            SELECT 'auth.service_accounts', id::text, jsonb_build_object('id', id::text)
            FROM auth.service_accounts WHERE id = ${serviceAccountId}::uuid
            UNION ALL
            SELECT 'auth.users', id::text, jsonb_build_object('id', id::text)
            FROM auth.users WHERE id = ${userId}::uuid
            UNION ALL
            SELECT 'grids.base_access', base_id::text || ':' || access_id::text,
              jsonb_build_object('baseId', base_id::text, 'accessId', access_id::text)
            FROM grids.base_access WHERE base_id = ${baseId}::uuid
            UNION ALL
            SELECT 'grids.bases', id::text,
              jsonb_build_object(
                'shortId', short_id, 'name', name, 'description', description,
                'documentProfile', document_profile, 'createdBy', created_by::text, 'deletedAt', deleted_at
              )
            FROM grids.bases WHERE id = ${baseId}::uuid
            UNION ALL
            SELECT 'grids.custom_app_access', custom_app_id::text || ':' || access_id::text,
              jsonb_build_object('customAppId', custom_app_id::text, 'accessId', access_id::text)
            FROM grids.custom_app_access WHERE custom_app_id = ${customAppId}::uuid
            UNION ALL
            SELECT 'grids.custom_apps', id::text,
              jsonb_build_object(
                'shortId', short_id, 'baseId', base_id::text, 'name', name, 'icon', icon,
                'draftDefinition', draft_definition, 'draftCapabilities', draft_capabilities,
                'publishedDefinition', published_definition, 'publishedCapabilities', published_capabilities,
                'publishedAt', published_at, 'deletedAt', deleted_at
              )
            FROM grids.custom_apps WHERE id = ${customAppId}::uuid
            UNION ALL
            SELECT 'grids.document_runs', id::text,
              jsonb_build_object(
                'shortId', short_id, 'templateId', template_id::text, 'workflowRunId', workflow_run_id::text,
                'snapshotId', snapshot_id::text, 'baseId', base_id::text, 'tableId', table_id::text,
                'recordId', record_id::text, 'documentNumber', document_number, 'filename', filename,
                'tags', tags, 'templateSnapshot', template_snapshot, 'renderData', render_data,
                'generatedBy', generated_by::text
              )
            FROM grids.document_runs WHERE id = ${documentRunId}::uuid
            UNION ALL
            SELECT 'grids.document_templates', id::text,
              jsonb_build_object(
                'shortId', short_id, 'tableId', table_id::text, 'name', name, 'description', description,
                'source', source, 'html', html, 'headerHtml', header_html, 'footerHtml', footer_html,
                'pageCss', page_css, 'numberTemplate', number_template, 'filenameTemplate', filename_template,
                'enabled', enabled, 'position', position, 'createdBy', created_by::text, 'updatedBy', updated_by::text,
                'deletedAt', deleted_at
              )
            FROM grids.document_templates WHERE id = ${documentTemplateId}::uuid
            UNION ALL
            SELECT 'grids.fields', id::text,
              jsonb_build_object(
                'shortId', short_id, 'tableId', table_id::text, 'name', name, 'description', description,
                'type', type, 'config', config, 'position', position, 'required', required,
                'defaultValue', default_value, 'indexed', indexed, 'unique', unique_constraint,
                'presentable', presentable, 'hideInTable', hide_in_table, 'deletedAt', deleted_at
              )
            FROM grids.fields WHERE id = ${fieldId}::uuid
            UNION ALL
            SELECT 'grids.forms', id::text,
              jsonb_build_object(
                'shortId', short_id, 'tableId', table_id::text, 'name', name, 'config', config,
                'publicToken', public_token, 'isActive', is_active, 'ownerUserId', owner_user_id::text,
                'position', position, 'deletedAt', deleted_at
              )
            FROM grids.forms WHERE id = ${formId}::uuid
            UNION ALL
            SELECT 'grids.record_snapshots', id::text,
              jsonb_build_object(
                'baseId', base_id::text, 'tableId', table_id::text, 'recordId', record_id::text,
                'root', root, 'graph', graph, 'createdBy', created_by::text
              )
            FROM grids.record_snapshots WHERE id = ${snapshotId}::uuid
            UNION ALL
            SELECT 'grids.records', id::text,
              jsonb_build_object(
                'tableId', table_id::text, 'data', data, 'version', version, 'deletedAt', deleted_at,
                'createdBy', created_by::text, 'updatedBy', updated_by::text
              )
            FROM grids.records WHERE id = ${recordId}::uuid
            UNION ALL
            SELECT 'grids.tables', id::text,
              jsonb_build_object(
                'shortId', short_id, 'baseId', base_id::text, 'kind', kind, 'name', name,
                'description', description, 'columns', columns, 'displayConfig', display_config,
                'auditPolicy', audit_policy, 'position', position, 'disableDirectInsert', disable_direct_insert,
                'deletedAt', deleted_at
              )
            FROM grids.tables WHERE id = ${tableId}::uuid
            UNION ALL
            SELECT 'grids.views', id::text,
              jsonb_build_object(
                'shortId', short_id, 'tableId', table_id::text, 'baseId', base_id::text,
                'name', name, 'description', description, 'source', source, 'ui', ui,
                'ownerUserId', owner_user_id::text, 'position', position, 'deletedAt', deleted_at
              )
            FROM grids.views WHERE id = ${viewId}::uuid
            UNION ALL
            SELECT 'grids.workflow_launchers', id::text,
              jsonb_build_object(
                'shortId', short_id, 'baseId', base_id::text, 'workflowId', workflow_id::text,
                'name', name, 'kind', kind, 'config', config, 'enabled', enabled,
                'validatedRevision', validated_revision, 'diagnostics', diagnostics, 'deletedAt', deleted_at
              )
            FROM grids.workflow_launchers WHERE id = ${workflowLauncherId}::uuid
            UNION ALL
            SELECT 'grids.workflow_profile', id::text,
              jsonb_build_object(
                'baseId', base_id::text, 'shortId', short_id, 'position', position,
                'ownerUserId', owner_user_id::text, 'enabled', enabled,
                'recordEventActiveSince', record_event_active_since, 'deletedAt', deleted_at
              )
            FROM grids.workflow_profile WHERE id = ${workflowId}::uuid
            UNION ALL
            SELECT 'grids.workflow_run_profile', run_id::text,
              jsonb_build_object(
                'baseId', base_id::text, 'workflowId', workflow_id::text, 'launcherId', launcher_id::text,
                'launcherKind', launcher_kind, 'channel', channel, 'actorUserId', actor_user_id::text,
                'serviceAccountId', service_account_id::text, 'requestFingerprint', request_fingerprint
              )
            FROM grids.workflow_run_profile WHERE run_id = ${workflowRunId}::uuid
            UNION ALL
            SELECT 'workflows.run', id::text,
              jsonb_build_object(
                'appId', app_id, 'scopeId', scope_id, 'workflowId', workflow_id::text,
                'workflowVersionId', workflow_version_id::text, 'mode', mode, 'state', state,
                'inputs', inputs, 'context', context, 'authorizationSnapshot', authorization_snapshot,
                'idempotencyKey', idempotency_key, 'occurredAt', occurred_at,
                'startedAt', started_at, 'finishedAt', finished_at
              )
            FROM workflows.run WHERE id = ${workflowRunId}::uuid
            UNION ALL
            SELECT 'workflows.workflow', id::text,
              jsonb_build_object(
                'appId', app_id, 'scopeId', scope_id, 'key', key, 'name', name,
                'description', description, 'activeVersionId', active_version_id::text,
                'createdByKind', created_by_kind, 'createdById', created_by_id::text
              )
            FROM workflows.workflow WHERE id = ${workflowId}::uuid
          ) AS preserved
          ORDER BY entity, entity_id
        `;
        const readWorkflowMigrationVersions = () => database<Array<{ version: number }>>`
          SELECT version FROM grids.workflow_migrations ORDER BY version
        `;

        const before = await readPreservedRows();
        const workflowMigrationVersions = await readWorkflowMigrationVersions();
        expect(before).toHaveLength(22);

        await migrateCoreWorkflows(database);
        await migrate(database);
        expect(await readPreservedRows()).toEqual(before);
        expect(await readWorkflowMigrationVersions()).toEqual(workflowMigrationVersions);

        await migrateCoreWorkflows(database);
        await migrate(database);
        expect(await readPreservedRows()).toEqual(before);
        expect(await readWorkflowMigrationVersions()).toEqual(workflowMigrationVersions);

        const obsoleteTables = await database<Array<{ tableName: string }>>`
          SELECT table_name AS "tableName"
          FROM information_schema.tables
          WHERE table_schema = 'grids'
            AND table_name IN (
              'table_access', 'view_access', 'form_access', 'document_template_access', 'workflow_access'
            )
          ORDER BY table_name
        `;
        expect(obsoleteTables).toEqual([]);
        const [recordScope] = await database<Array<{ exists: boolean }>>`
          SELECT EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'grids' AND table_name = 'base_access' AND column_name = 'record_scope'
          ) AS exists
        `;
        expect(recordScope?.exists).toBe(false);
      });
    },
    30_000,
  );

  /*
   * The workflow revision trigger is gone. Revisions are published versions in
   * the kernel now, not a side effect of any UPDATE — which is why renaming a
   * workflow no longer produces one.
   */

  postgresTest(
    "backfills legacy email preview data once without replacing later edits",
    async () => {
      await withIsolatedDatabase(async (database) => {
        await migrateCoreWorkflows(database);
        await migrate(database);
        const baseId = uuid();
        const templateId = uuid();
        await database`
          INSERT INTO grids.bases (id, short_id, name)
          VALUES (${baseId}::uuid, ${shortId("B")}, 'Email preview data migration')
        `;
        await database`
          INSERT INTO grids.email_templates (id, short_id, base_id, name, subject, html)
          VALUES (
            ${templateId}::uuid,
            ${shortId("E")},
            ${baseId}::uuid,
            'Loan agreement ready',
            'Agreement ready',
            '<p>{{ data.requesterName }}</p><a href="{{ data.agreement.url }}">Download</a>'
          )
        `;
        await database`ALTER TABLE grids.email_templates ALTER COLUMN sample_data DROP NOT NULL`.simple();
        await database`UPDATE grids.email_templates SET sample_data = NULL WHERE id = ${templateId}::uuid`;

        await migrateCoreWorkflows(database);
        await migrate(database);
        const [backfilled] = await database<Array<{ sampleData: Record<string, unknown> }>>`
          SELECT sample_data AS "sampleData"
          FROM grids.email_templates
          WHERE id = ${templateId}::uuid
        `;
        expect(backfilled?.sampleData).toEqual({
          requesterName: "Alex Morgan",
          loanNumber: "LOAN-2026-0001",
          dueDate: "31 July 2026",
          agreement: { url: "https://cloud.example.org/share/grids/documents/example" },
        });

        await database`UPDATE grids.email_templates SET sample_data = '{}'::jsonb WHERE id = ${templateId}::uuid`;
        await migrateCoreWorkflows(database);
        await migrate(database);
        const [preserved] = await database<Array<{ sampleData: Record<string, unknown> }>>`
          SELECT sample_data AS "sampleData"
          FROM grids.email_templates
          WHERE id = ${templateId}::uuid
        `;
        expect(preserved?.sampleData).toEqual({});
      });
    },
    30_000,
  );

  postgresTest(
    "enforces combined table revision, source, mapping, and read-only invariants",
    async () => {
      await withIsolatedDatabase(async (database) => {
        await migrateCoreWorkflows(database);
        await migrate(database);
        const baseId = uuid();
        const storedTableId = uuid();
        const combinedTableId = uuid();
        const storedFieldId = uuid();
        const combinedFieldId = uuid();
        const revisionId = uuid();
        await database`
          INSERT INTO grids.bases (id, short_id, name)
          VALUES (${baseId}::uuid, ${shortId("B")}, 'Combined schema invariants')
        `;
        await database`
          INSERT INTO grids.tables (id, short_id, base_id, kind, name, disable_direct_insert)
          VALUES
            (${storedTableId}::uuid, ${shortId("T")}, ${baseId}::uuid, 'stored', 'Stored', FALSE),
            (${combinedTableId}::uuid, ${shortId("C")}, ${baseId}::uuid, 'federated', 'Combined', TRUE)
        `;
        await database`
          INSERT INTO grids.fields (id, short_id, table_id, name, type)
          VALUES
            (${storedFieldId}::uuid, ${shortId("F")}, ${storedTableId}::uuid, 'Stored field', 'text'),
            (${combinedFieldId}::uuid, ${shortId("F")}, ${combinedTableId}::uuid, 'Canonical field', 'text')
        `;
        await database`
          INSERT INTO grids.federated_table_revisions (id, table_id, revision, status)
          VALUES (${revisionId}::uuid, ${combinedTableId}::uuid, 1, 'draft')
        `;
        await database`
          INSERT INTO grids.federated_table_sources (revision_id, source_table_id)
          VALUES (${revisionId}::uuid, ${storedTableId}::uuid)
        `;
        await database`
          INSERT INTO grids.federated_field_mappings (revision_id, target_field_id, source_table_id, source_field_id)
          VALUES (${revisionId}::uuid, ${combinedFieldId}::uuid, ${storedTableId}::uuid, ${storedFieldId}::uuid)
        `;

        await expect(
          (async () => {
            await database`
            INSERT INTO grids.federated_table_revisions (table_id, revision)
            VALUES (${storedTableId}::uuid, 1)
            `;
          })(),
        ).rejects.toThrow("revision target must be a combined table");
        await expect(
          (async () => {
            await database`
            INSERT INTO grids.federated_table_sources (revision_id, source_table_id)
            VALUES (${revisionId}::uuid, ${combinedTableId}::uuid)
            `;
          })(),
        ).rejects.toThrow("source must be a distinct stored table");
        await expect(
          (async () => {
            await database`
            INSERT INTO grids.federated_field_mappings (revision_id, target_field_id, source_table_id, source_field_id)
            VALUES (${revisionId}::uuid, ${storedFieldId}::uuid, ${storedTableId}::uuid, ${storedFieldId}::uuid)
            `;
          })(),
        ).rejects.toThrow("mapping fields must belong to their declared tables");
        await expect(
          (async () => {
            await database`
            UPDATE grids.tables
            SET disable_direct_insert = FALSE
            WHERE id = ${combinedTableId}::uuid
            `;
          })(),
        ).rejects.toThrow("tables_federated_read_only_chk");
      });
    },
    30_000,
  );

  postgresTest(
    "preserves document runs while resetting alpha workflow runs",
    async () => {
      await withIsolatedDatabase(async (database) => {
        await migrateCoreWorkflows(database);
        await migrate(database);

        const baseId = uuid();
        const workflowId = uuid();
        const workflowRunId = uuid();
        const snapshotId = uuid();
        const documentRunId = uuid();
        await database`
          INSERT INTO grids.bases (id, short_id, name)
          VALUES (${baseId}::uuid, ${shortId("B")}, 'Workflow reset artifacts')
        `;
        await insertTestWorkflow({ db: database, id: workflowId, baseId, name: "Old workflow", shortId: shortId("W") });
        await database`
          INSERT INTO grids.record_snapshots (id, base_id, table_id, record_id, root, graph)
          VALUES (${snapshotId}::uuid, ${baseId}::uuid, ${uuid()}::uuid, ${uuid()}::uuid, '{}'::jsonb, '{}'::jsonb)
        `;
        await database`
          INSERT INTO grids.document_runs (
            id, short_id, workflow_run_id, snapshot_id, base_id, table_id, record_id, document_number, filename,
            template_snapshot, render_data
          ) VALUES (
            ${documentRunId}::uuid, ${shortId("D")}, ${workflowRunId}::uuid, ${snapshotId}::uuid, ${baseId}::uuid,
            ${uuid()}::uuid, ${uuid()}::uuid, 'DOC-1', 'DOC-1.pdf', '{}'::jsonb, '{}'::jsonb
          )
        `;

        await database`DELETE FROM grids.workflow_migrations WHERE version = ${GRIDS_WORKFLOW_SCHEMA_VERSION}`;
        await migrateCoreWorkflows(database);
        await migrate(database);

        const [document] = await database<Array<{ workflowRunId: string | null }>>`
          SELECT workflow_run_id::text AS "workflowRunId"
          FROM grids.document_runs
          WHERE id = ${documentRunId}::uuid
        `;
        const [surviving] = await database<Array<{ count: number }>>`
          SELECT count(*)::int AS count FROM grids.document_runs WHERE id = ${documentRunId}::uuid
        `;
        // The document is real user data and survives; only its link to a run
        // that no longer exists is cleared.
        expect(document).toEqual({ workflowRunId: null });
        expect(surviving).toEqual({ count: 1 });
      });
    },
    30_000,
  );

  postgresTest(
    "derives a view base id and enforces base-wide live names",
    async () => {
      await withIsolatedDatabase(async (database) => {
        await migrateCoreWorkflows(database);
        await migrate(database);
        const baseId = uuid();
        const firstTableId = uuid();
        const secondTableId = uuid();

        await database`
          INSERT INTO grids.bases (id, short_id, name)
          VALUES (${baseId}::uuid, ${shortId("B")}, 'View names')
        `;
        await database`
          INSERT INTO grids.tables (id, short_id, base_id, name)
          VALUES
            (${firstTableId}::uuid, ${shortId("T")}, ${baseId}::uuid, 'First'),
            (${secondTableId}::uuid, ${shortId("T")}, ${baseId}::uuid, 'Second')
        `;
        const [view] = await database<Array<{ baseId: string }>>`
          INSERT INTO grids.views (short_id, table_id, name, source)
          VALUES (${shortId("V")}, ${firstTableId}::uuid, 'Open items', 'from table First')
          RETURNING base_id::text AS "baseId"
        `;
        expect(view?.baseId).toBe(baseId);

        let conflict: unknown;
        try {
          await database`
            INSERT INTO grids.views (short_id, table_id, name, source)
            VALUES (${shortId("V")}, ${secondTableId}::uuid, ' open ITEMS ', 'from table Second')
          `;
        } catch (error) {
          conflict = error;
        }
        const pgError = conflict as { errno?: string; constraint?: string };
        expect(pgError.errno).toBe("23505");
        expect(pgError.constraint).toBe("idx_grids_views_live_name");
      });
    },
    30_000,
  );

  postgresTest(
    "fails clearly when legacy data already contains ambiguous names",
    async () => {
      await withIsolatedDatabase(async (database) => {
        await migrateCoreWorkflows(database);
        await migrate(database);
        const baseId = uuid();
        await database`DROP INDEX grids.idx_grids_tables_live_name`.simple();
        await database`
          INSERT INTO grids.bases (id, short_id, name)
          VALUES (${baseId}::uuid, ${shortId("B")}, 'Legacy duplicates')
        `;
        await database`
          INSERT INTO grids.tables (short_id, base_id, name)
          VALUES
            ('TD001', ${baseId}::uuid, 'Orders'),
            ('TD002', ${baseId}::uuid, ' orders ')
        `;

        let migrationError: unknown;
        try {
          await migrateCoreWorkflows(database);
          await migrate(database);
        } catch (error) {
          migrationError = error;
        }
        expect((migrationError as Error).message).toContain(
          `cannot enforce unique table names: grid ${baseId} contains multiple live tables named "orders"`,
        );
      });
    },
    30_000,
  );

  postgresTest(
    "removes intentional alpha-only schema surfaces",
    async () => {
      await migrate();
      await sql`ALTER TABLE grids.views ADD COLUMN IF NOT EXISTS query JSONB`.simple();
      await sql`ALTER TABLE grids.views ADD COLUMN IF NOT EXISTS display_config JSONB`.simple();
      await sql`CREATE TABLE IF NOT EXISTS grids.gql_queries (id UUID PRIMARY KEY)`.simple();
      await sql`ALTER TABLE grids.email_templates ADD COLUMN IF NOT EXISTS text TEXT`.simple();

      await migrate();

      const legacyColumns = await sql`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'grids'
        AND (
          (table_name = 'views' AND column_name IN ('query', 'display_config'))
          OR (table_name = 'email_templates' AND column_name = 'text')
        )
    `;
      const [legacyTable] = await sql<Array<{ tableName: string | null }>>`
      SELECT to_regclass('grids.gql_queries')::text AS "tableName"
    `;
      expect(legacyColumns).toHaveLength(0);
      expect(legacyTable?.tableName).toBeNull();
    },
    30_000,
  );

  postgresTest(
    "normalizes legacy number scale config to decimalPlaces",
    async () => {
      await migrate();

      const baseId = uuid();
      const tableId = uuid();
      const fieldId = uuid();

      try {
        await sql`
        INSERT INTO grids.bases (id, short_id, name)
        VALUES (${baseId}::uuid, ${shortId("B")}, 'Migration integration')
      `;
        await sql`
        INSERT INTO grids.tables (id, short_id, base_id, name, position)
        VALUES (${tableId}::uuid, ${shortId("T")}, ${baseId}::uuid, 'Numbers', 0)
      `;
        await sql`
        INSERT INTO grids.fields (id, short_id, table_id, name, type, config, position)
        VALUES (${fieldId}::uuid, 'NUM01', ${tableId}::uuid, 'Amount', 'number', '{"scale":2}'::jsonb, 0)
      `;

        await migrate();

        const [row] = await sql<Array<{ config: { decimalPlaces?: number; scale?: number } }>>`
        SELECT config
        FROM grids.fields
        WHERE id = ${fieldId}::uuid
      `;

        expect(row?.config).toEqual({ decimalPlaces: 2 });
      } finally {
        await sql`DELETE FROM grids.bases WHERE id = ${baseId}::uuid`;
      }
    },
    30_000,
  );
});
