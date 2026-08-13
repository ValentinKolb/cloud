import { expect, test } from "bun:test";
import { projectCustomAppRecord } from "./record-projection";

test("projects record data without mutating the stored record", () => {
  const record = {
    id: "record-1",
    data: { visible: "shown", hidden: "secret" },
  };

  expect(projectCustomAppRecord(record, ["visible"])).toEqual({
    id: "record-1",
    data: { visible: "shown" },
  });
  expect(record.data).toEqual({ visible: "shown", hidden: "secret" });
});

test("keeps sibling Record block projections isolated", () => {
  const record = { id: "record-1", data: { profile: "Alice", billing: "Internal" } };

  expect(projectCustomAppRecord(record, ["profile"]).data).toEqual({ profile: "Alice" });
  expect(projectCustomAppRecord(record, ["billing"]).data).toEqual({ billing: "Internal" });
});
