declare module "@valentinkolb/filegate/utils" {
  export type UploadState = {
    status: "pending" | "uploading" | "completed" | "error";
    percent: number;
    [key: string]: unknown;
  };

  type ChunkData = BodyInit;

  type PreparedUpload = {
    fileSize: number;
    checksum: string;
    chunkSize: number;
    subscribe(callback: (state: UploadState) => void): () => void;
    hash(config: { data: ChunkData }): Promise<string>;
    sendAll(config: {
      retries?: number;
      concurrency?: number;
      fn: (chunk: { index: number; data: ChunkData }) => Promise<void>;
    }): Promise<void>;
  };

  export const chunks: {
    prepare(config: { file: File; chunkSize: number }): Promise<PreparedUpload>;
  };

  export function formatBytes(config: { bytes: number }): string;
}
