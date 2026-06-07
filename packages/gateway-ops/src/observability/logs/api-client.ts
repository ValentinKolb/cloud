import { api } from "@valentinkolb/cloud/browser";
import type { ApiType } from "./api";

export const apiClient = api.create<ApiType>({ baseUrl: "/api/logging" });
