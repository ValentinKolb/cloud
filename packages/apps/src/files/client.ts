import { api } from "@valentinkolb/cloud/lib/browser";
import type { ApiType } from "./api";

export const apiClient = api.create<ApiType>({ baseUrl: "/api/app/files" });
