import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  CLOUD_RESOURCE_CLIPBOARD_MIME_TYPE,
  CLOUD_RESOURCE_CLIPBOARD_WEB_FORMAT,
  serializeCloudResourceClipboard,
} from "../contracts/resource-clipboard";
import { readCloudResourceClipboard, writeCloudResourceClipboard } from "./resource-clipboard";

class TestClipboardItem {
  static supported = true;
  static supports = (_type: string) => TestClipboardItem.supported;

  readonly types: string[];
  readonly #items: Record<string, Blob>;

  constructor(items: Record<string, Blob>) {
    this.#items = items;
    this.types = Object.keys(items);
  }

  async getType(type: string): Promise<Blob> {
    const blob = this.#items[type];
    if (!blob) throw new TypeError(`Unknown clipboard type: ${type}`);
    return blob;
  }
}

const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const originalClipboardItem = Object.getOwnPropertyDescriptor(globalThis, "ClipboardItem");

let writtenItems: ClipboardItem[][];
let writtenText: string[];

beforeEach(() => {
  writtenItems = [];
  writtenText = [];
  TestClipboardItem.supported = true;

  Object.defineProperty(globalThis, "ClipboardItem", { configurable: true, value: TestClipboardItem });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      clipboard: {
        read: async () => [],
        write: async (items: ClipboardItem[]) => writtenItems.push(items),
        writeText: async (text: string) => writtenText.push(text),
      },
    },
  });
});

afterEach(() => {
  if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
  else Reflect.deleteProperty(globalThis, "navigator");
  if (originalClipboardItem) Object.defineProperty(globalThis, "ClipboardItem", originalClipboardItem);
  else Reflect.deleteProperty(globalThis, "ClipboardItem");
});

describe("Cloud resource clipboard browser adapter", () => {
  it("writes the resource format and a plain-text fallback together", async () => {
    const ref = { type: "grids.record", id: "A8vcaK" };
    await writeCloudResourceClipboard({
      cloudUrl: "https://cloud.example",
      ref,
      fallbackText: "https://cloud.example/app/grids?record=A8vcaK",
    });

    expect(writtenItems).toHaveLength(1);
    const item = writtenItems[0]?.[0];
    expect(item?.types).toEqual([CLOUD_RESOURCE_CLIPBOARD_WEB_FORMAT, "text/plain"]);
    expect((await item?.getType(CLOUD_RESOURCE_CLIPBOARD_WEB_FORMAT))?.type).toBe(CLOUD_RESOURCE_CLIPBOARD_MIME_TYPE);
    expect(await (await item?.getType(CLOUD_RESOURCE_CLIPBOARD_WEB_FORMAT))?.text()).toBe(
      serializeCloudResourceClipboard({ cloudUrl: "https://cloud.example", ref }),
    );
    expect(await (await item?.getType("text/plain"))?.text()).toBe("https://cloud.example/app/grids?record=A8vcaK");
    expect(writtenText).toEqual([]);
  });

  it("falls back to plain text when web custom formats are unsupported", async () => {
    TestClipboardItem.supported = false;

    await writeCloudResourceClipboard({
      cloudUrl: "https://cloud.example",
      ref: { type: "grids.record", id: "A8vcaK" },
      fallbackText: "https://cloud.example/app/grids?record=A8vcaK",
    });

    expect(writtenItems).toEqual([]);
    expect(writtenText).toEqual(["https://cloud.example/app/grids?record=A8vcaK"]);
  });

  it("reads only the exact structured format", async () => {
    const ref = { type: "grids.record", id: "A8vcaK" };
    const item = new TestClipboardItem({
      [CLOUD_RESOURCE_CLIPBOARD_WEB_FORMAT]: new Blob([serializeCloudResourceClipboard({ cloudUrl: "https://cloud.example", ref })], {
        type: CLOUD_RESOURCE_CLIPBOARD_MIME_TYPE,
      }),
      "text/plain": new Blob(["Camera"], { type: "text/plain" }),
    });

    expect(await readCloudResourceClipboard("https://cloud.example", [item])).toEqual(ref);
    expect(
      await readCloudResourceClipboard("https://cloud.example", [
        new TestClipboardItem({
          "text/plain": new Blob([serializeCloudResourceClipboard({ cloudUrl: "https://cloud.example", ref })]),
        }),
      ]),
    ).toBeNull();
  });

  it("rejects invalid structured clipboard data", async () => {
    const item = new TestClipboardItem({
      [CLOUD_RESOURCE_CLIPBOARD_WEB_FORMAT]: new Blob(['{"version":2}'], {
        type: CLOUD_RESOURCE_CLIPBOARD_MIME_TYPE,
      }),
    });

    expect(await readCloudResourceClipboard("https://cloud.example", [item])).toBeNull();
  });

  it("rejects references copied from another configured Cloud URL", async () => {
    const item = new TestClipboardItem({
      [CLOUD_RESOURCE_CLIPBOARD_WEB_FORMAT]: new Blob(
        [
          serializeCloudResourceClipboard({
            cloudUrl: "https://other.cloud.example",
            ref: { type: "grids.record", id: "A8vcaK" },
          }),
        ],
        { type: CLOUD_RESOURCE_CLIPBOARD_MIME_TYPE },
      ),
    });

    expect(await readCloudResourceClipboard("https://cloud.example", [item])).toBeNull();
  });

  it("falls back to plain text when ClipboardItem.supports is unavailable", async () => {
    Object.defineProperty(TestClipboardItem, "supports", { configurable: true, writable: true, value: undefined });

    await writeCloudResourceClipboard({
      cloudUrl: "https://cloud.example",
      ref: { type: "grids.record", id: "A8vcaK" },
      fallbackText: "https://cloud.example/app/grids?record=A8vcaK",
    });

    expect(writtenItems).toEqual([]);
    expect(writtenText).toEqual(["https://cloud.example/app/grids?record=A8vcaK"]);

    Object.defineProperty(TestClipboardItem, "supports", {
      configurable: true,
      writable: true,
      value: (_type: string) => TestClipboardItem.supported,
    });
  });
});
