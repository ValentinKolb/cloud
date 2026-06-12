import { describe, expect, test } from "bun:test";
import {
  FqdnParamSchema,
  HostgroupMemberSchema,
  HostgroupSearchQuerySchema,
  normalizeMacAddress,
  SyncCronUpdateSchema,
  UpdateHostSchema,
} from "./contracts";

describe("IPA Hosts contracts", () => {
  test("normalizes MAC addresses", () => {
    expect(normalizeMacAddress("aa-bb-cc-dd-ee-ff")).toBe("AA:BB:CC:DD:EE:FF");
  });

  test("deduplicates valid MAC addresses", () => {
    const result = UpdateHostSchema.parse({
      macAddress: ["aa-bb-cc-dd-ee-ff", "AA:BB:CC:DD:EE:FF"],
    });
    expect(result.macAddress).toEqual(["AA:BB:CC:DD:EE:FF"]);
  });

  test("rejects malformed host FQDN params", () => {
    expect(FqdnParamSchema.safeParse({ fqdn: "host.example.org" }).success).toBe(true);
    expect(FqdnParamSchema.safeParse({ fqdn: "not a host" }).success).toBe(false);
  });

  test("trims bounded hostgroup names and search input", () => {
    expect(HostgroupMemberSchema.parse({ hostgroup: " ops " }).hostgroup).toBe("ops");
    expect(HostgroupSearchQuerySchema.parse({ q: " db " }).q).toBe("db");
  });

  test("rejects empty sync cron after trimming", () => {
    expect(SyncCronUpdateSchema.safeParse({ cron: "   " }).success).toBe(false);
  });
});
