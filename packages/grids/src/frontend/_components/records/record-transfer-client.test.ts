import { afterEach, describe, expect, test } from "bun:test";
import type { ExportBody } from "../../../contracts";
import { requestRecordExport, uploadRecordFile } from "./record-transfer-client";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("record transfer client", () => {
  test("exports encode table ids and send a JSON body", async () => {
    let captured: [RequestInfo | URL, RequestInit | undefined] | undefined;
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      captured = [input, init];
      return Promise.resolve(new Response("csv", { status: 200 }));
    }) as typeof fetch;
    const body = { format: "csv", query: {}, fields: [], markdown: "raw", csv: { delimiter: "," } } as ExportBody;

    await requestRecordExport("table/id", body);

    expect(captured?.[0]).toBe("/api/grids/records/by-table/table%2Fid/export");
    expect(captured?.[1]?.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(String(captured?.[1]?.body))).toEqual(body);
  });

  test("uploads encode path ids and leave multipart headers to fetch", async () => {
    let captured: [RequestInfo | URL, RequestInit | undefined] | undefined;
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      captured = [input, init];
      return Promise.resolve(new Response(null, { status: 201 }));
    }) as typeof fetch;
    const file = new File(["content"], "asset.txt", { type: "text/plain" });

    await uploadRecordFile({ tableId: "table/id", recordId: "record/id", fieldId: "field/id", file });

    expect(captured?.[0]).toBe("/api/grids/records/table%2Fid/record%2Fid/files/field%2Fid");
    expect(captured?.[1]?.headers).toBeUndefined();
    expect(captured?.[1]?.body).toBeInstanceOf(FormData);
    const uploaded = (captured?.[1]?.body as FormData).get("file");
    expect(uploaded).toBeInstanceOf(File);
    expect((uploaded as File).name).toBe("asset.txt");
    expect(await (uploaded as File).text()).toBe("content");
  });
});
