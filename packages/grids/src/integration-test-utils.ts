import { test } from "bun:test";

export const postgresTest = process.env.GRIDS_QUERY_DSL_DB_TEST === "1" ? test : test.skip;
export const testUuid = () => Bun.randomUUIDv7();
export const testShortId = (prefix: string) => `${prefix}${Math.random().toString(36).slice(2, 6)}`.slice(0, 5);
