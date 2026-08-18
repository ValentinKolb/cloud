import { expect, test } from "bun:test";
import type { CustomAppPage, CustomAppReferencedRecordsBlock } from "./contracts";
import { referencedRecordsGqlSource } from "./referenced-records";

const page: CustomAppPage = {
  id: "detail",
  title: "Customer",
  navigation: { visible: false },
  parameters: { customer_id: { type: "record", tableId: "CUS001", required: true } },
  record: { tableId: "CUS001", id: { source: "PARAMS", path: "customer_id" } },
  rows: [],
};

const block: CustomAppReferencedRecordsBlock = {
  id: "orders",
  type: "referenced_records",
  sourceTableId: "ORD001",
  relationFieldId: "CUSREL",
  fieldIds: ["NUMBER", "STATUS"],
  display: { kind: "cards" },
  searchable: true,
  pageSize: 25,
};

test("derives one pinned reverse-relation GQL source from the record page binding", () => {
  expect(referencedRecordsGqlSource(page, block)).toBe(
    "from table {ORD001}\nselect {NUMBER}, {STATUS}\nwhere oneof({CUSREL}, @params.customer_id)",
  );
  expect(referencedRecordsGqlSource({ ...page, record: undefined }, block)).toBeNull();
});
