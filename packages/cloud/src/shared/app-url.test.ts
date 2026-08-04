import { describe, expect, test } from "bun:test";
import { cloudMcpResourceUri, publicCloudOrigin } from "./app-url";

describe("publicCloudOrigin", () => {
  test("uses HTTP for bare local development URLs", () => {
    expect(publicCloudOrigin("localhost:3000")).toBe("http://localhost:3000");
    expect(publicCloudOrigin("127.0.0.1:3000/")).toBe("http://127.0.0.1:3000");
    expect(cloudMcpResourceUri("localhost:3000")).toBe("http://localhost:3000/api/mcp/v1");
  });

  test("defaults public hosts to HTTPS and preserves explicit schemes", () => {
    expect(publicCloudOrigin("cloud.example/app")).toBe("https://cloud.example");
    expect(publicCloudOrigin("https://cloud.example/app/")).toBe("https://cloud.example");
    expect(publicCloudOrigin("http://localhost:4000/app")).toBe("http://localhost:4000");
  });
});
