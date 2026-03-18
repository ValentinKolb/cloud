import { api } from "@valentinkolb/cloud-lib/browser";
import type { ApiType } from "./admin-account-lifecycle";

export const apiClient = api.create<ApiType>({ baseUrl: "/api/admin/account-lifecycle" });
