import { describe, expect, test } from "bun:test";
import { acquireScannerStream } from "./workflow-scanner-camera";

describe("workflow scanner camera", () => {
  test("stops a stream that resolves after the scanner was disposed", async () => {
    let resolveStream: ((stream: MediaStream) => void) | undefined;
    let disposed = false;
    let stopped = 0;
    const stream = {
      getTracks: () => [{ stop: () => stopped++ }],
    } as unknown as MediaStream;
    const pending = acquireScannerStream(
      () =>
        new Promise<MediaStream>((resolve) => {
          resolveStream = resolve;
        }),
      () => disposed,
    );

    disposed = true;
    resolveStream?.(stream);

    expect(await pending).toBeNull();
    expect(stopped).toBe(1);
  });

  test("returns an acquired stream while the scanner is mounted", async () => {
    const stream = { getTracks: () => [] } as unknown as MediaStream;

    expect(
      await acquireScannerStream(
        async () => stream,
        () => false,
      ),
    ).toBe(stream);
  });
});
