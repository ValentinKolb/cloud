import { beforeAll, describe, expect, test } from "bun:test";
import { sql } from "bun";
import { migrate } from "../migrate";
import { submitForm } from "./form-submission";
import type { Form } from "./forms";

const postgresTest = process.env.GRIDS_QUERY_DSL_DB_TEST === "1" ? test : test.skip;
const uuid = () => Bun.randomUUIDv7();
const shortId = (prefix: string) => `${prefix}${Math.random().toString(36).slice(2, 6)}`.slice(0, 5);

type Fixture = {
  baseId: string;
  sourceTableId: string;
  targetTableId: string;
  relationFieldId: string;
  sourceNameFieldId: string;
  targetNameFieldId: string;
};

const fixture = (): Fixture => ({
  baseId: uuid(),
  sourceTableId: uuid(),
  targetTableId: uuid(),
  relationFieldId: uuid(),
  sourceNameFieldId: uuid(),
  targetNameFieldId: uuid(),
});

const insertFixture = async (item: Fixture) => {
  await sql`
    INSERT INTO grids.bases (id, short_id, name)
    VALUES (${item.baseId}::uuid, ${shortId("B")}, 'Form submission integration')
  `;
  await sql`
    INSERT INTO grids.tables (id, short_id, base_id, name, position)
    VALUES
      (${item.sourceTableId}::uuid, ${shortId("S")}, ${item.baseId}::uuid, 'Orders', 0),
      (${item.targetTableId}::uuid, ${shortId("T")}, ${item.baseId}::uuid, 'Contacts', 1)
  `;
  await sql`
    INSERT INTO grids.fields (id, short_id, table_id, name, type, config, required, position)
    VALUES
      (${item.sourceNameFieldId}::uuid, ${shortId("N")}, ${item.sourceTableId}::uuid, 'Reference', 'text', '{}'::jsonb, TRUE, 0),
      (
        ${item.relationFieldId}::uuid,
        ${shortId("R")},
        ${item.sourceTableId}::uuid,
        'Contact',
        'relation',
        ${{ targetTableId: item.targetTableId, cardinality: "multiple" }}::jsonb,
        FALSE,
        1
      ),
      (${item.targetNameFieldId}::uuid, ${shortId("C")}, ${item.targetTableId}::uuid, 'Name', 'text', '{}'::jsonb, TRUE, 0)
  `;
};

const formFor = (item: Fixture): Form => ({
  id: uuid(),
  shortId: shortId("F"),
  tableId: item.sourceTableId,
  name: "Order",
  config: {
    fields: [
      { kind: "user_input", fieldId: item.sourceNameFieldId, required: true },
      {
        kind: "user_input",
        fieldId: item.relationFieldId,
        inlineCreate: {
          enabled: true,
          fields: [{ fieldId: item.targetNameFieldId, required: true }],
        },
      },
    ],
  },
  publicToken: null,
  isActive: true,
  ownerUserId: null,
  position: 0,
  isDefault: false,
  deletedAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

const cleanup = async (item: Fixture) => {
  await sql`DELETE FROM grids.audit_log WHERE base_id = ${item.baseId}::uuid`;
  await sql`DELETE FROM grids.record_event_outbox WHERE base_id = ${item.baseId}::uuid`;
  await sql`DELETE FROM grids.bases WHERE id = ${item.baseId}::uuid`;
};

beforeAll(async () => {
  if (process.env.GRIDS_QUERY_DSL_DB_TEST === "1") await migrate();
});

describe("form submission integration", () => {
  postgresTest("creates inline records, relation links, and durable events atomically", async () => {
    const item = fixture();
    try {
      await insertFixture(item);
      const result = await submitForm({
        form: formFor(item),
        actorId: null,
        dateConfig: { timeZone: "UTC" },
        submission: {
          data: { [item.sourceNameFieldId]: "ORDER-1", [item.relationFieldId]: ["tmp_contact"] },
          inlineCreates: {
            [item.relationFieldId]: [{ tempId: "tmp_contact", data: { [item.targetNameFieldId]: "Ada" } }],
          },
        },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);

      const [link] = await sql<Array<{ from_record_id: string; to_record_id: string }>>`
        SELECT from_record_id::text, to_record_id::text
        FROM grids.record_links
        WHERE from_field_id = ${item.relationFieldId}::uuid
      `;
      expect(link?.from_record_id).toBe(result.data.recordId);
      expect(link?.to_record_id).toBeString();

      const [{ records, events } = { records: 0, events: 0 }] = await sql<Array<{ records: number; events: number }>>`
        SELECT
          (SELECT count(*)::int FROM grids.records r JOIN grids.tables t ON t.id = r.table_id WHERE t.base_id = ${item.baseId}::uuid) AS records,
          (SELECT count(*)::int FROM grids.record_event_outbox WHERE base_id = ${item.baseId}::uuid) AS events
      `;
      expect({ records, events }).toEqual({ records: 2, events: 2 });
    } finally {
      await cleanup(item);
    }
  });

  postgresTest("rolls back earlier inline records when a later draft is invalid", async () => {
    const item = fixture();
    try {
      await insertFixture(item);
      const result = await submitForm({
        form: formFor(item),
        actorId: null,
        dateConfig: { timeZone: "UTC" },
        submission: {
          data: { [item.sourceNameFieldId]: "ORDER-2", [item.relationFieldId]: ["tmp_valid", "tmp_invalid"] },
          inlineCreates: {
            [item.relationFieldId]: [
              { tempId: "tmp_valid", data: { [item.targetNameFieldId]: "Ada" } },
              { tempId: "tmp_invalid", data: {} },
            ],
          },
        },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.message).toBe('Field "Name" is required');

      const [{ records, links, events } = { records: 0, links: 0, events: 0 }] = await sql<
        Array<{ records: number; links: number; events: number }>
      >`
        SELECT
          (SELECT count(*)::int FROM grids.records r JOIN grids.tables t ON t.id = r.table_id WHERE t.base_id = ${item.baseId}::uuid) AS records,
          (SELECT count(*)::int FROM grids.record_links rl JOIN grids.records r ON r.id = rl.from_record_id JOIN grids.tables t ON t.id = r.table_id WHERE t.base_id = ${item.baseId}::uuid) AS links,
          (SELECT count(*)::int FROM grids.record_event_outbox WHERE base_id = ${item.baseId}::uuid) AS events
      `;
      expect({ records, links, events }).toEqual({ records: 0, links: 0, events: 0 });
    } finally {
      await cleanup(item);
    }
  });

  postgresTest("rejects duplicate inline draft ids before creating records or events", async () => {
    const item = fixture();
    try {
      await insertFixture(item);
      const result = await submitForm({
        form: formFor(item),
        actorId: null,
        dateConfig: { timeZone: "UTC" },
        submission: {
          data: { [item.sourceNameFieldId]: "ORDER-3", [item.relationFieldId]: ["tmp_contact"] },
          inlineCreates: {
            [item.relationFieldId]: [
              { tempId: "tmp_contact", data: { [item.targetNameFieldId]: "Ada" } },
              { tempId: "tmp_contact", data: { [item.targetNameFieldId]: "Grace" } },
            ],
          },
        },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.message).toBe('Field "Contact" contains a duplicate inline draft id');

      const [{ records, events } = { records: 0, events: 0 }] = await sql<Array<{ records: number; events: number }>>`
        SELECT
          (SELECT count(*)::int FROM grids.records r JOIN grids.tables t ON t.id = r.table_id WHERE t.base_id = ${item.baseId}::uuid) AS records,
          (SELECT count(*)::int FROM grids.record_event_outbox WHERE base_id = ${item.baseId}::uuid) AS events
      `;
      expect({ records, events }).toEqual({ records: 0, events: 0 });
    } finally {
      await cleanup(item);
    }
  });
});
