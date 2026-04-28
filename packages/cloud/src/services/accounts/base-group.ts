import type { BaseGroup, UserProvider } from "../../contracts/shared";

type DbRow = Record<string, unknown>;

export const buildBaseGroup = (row: DbRow): BaseGroup => ({
  id: row.id as string,
  provider: row.provider as UserProvider,
  name: row.name as string,
  description: (row.description as string | null | undefined) ?? null,
  gidnumber: (row.gid_number as number | null | undefined) ?? null,
});
