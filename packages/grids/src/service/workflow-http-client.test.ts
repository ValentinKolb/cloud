import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import type { ClientRequest, IncomingMessage, RequestOptions } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import type { AddressInfo } from "node:net";
import { PassThrough } from "node:stream";
import { connect as tlsConnect } from "node:tls";
import { isUnsafeWorkflowHttpAddress, requestWorkflowHttp } from "./workflow-http-client";

const publicAddress = "93.184.216.34";

const TLS_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC1dDK1s9tDBQ3V
o2UHbY+Wz2ko7BYJLJ8ksxe0FpQzCJzpBArpqsM7Hngmmlcwya6OGA8Qk3ugimSo
lU8MVjBJPn3rA0rqRL8mBnbpeh9xRzYkYP3XrEsd5wGwekht2Lkur/4YDAJGvbeA
tdXAh8moUXyp0BFWIb7Qer7nOhaWeiHWML8+sXlcCiCkS/m/HuuQpJlNApMnKXWD
7xMR4f4npu6VuM99twZ/CLIhY8ali/hij0EFZuNoFdUwamIO4XYVd2b76HyM5H1p
yAOqBtHPlKq9EnaTtYOra4qUAB4g+P54WTduaRrL+CyPTihL++eUM9ZI1PvWmBqi
UehIfnHLAgMBAAECggEAI5iadBPG8TRWHPFzWcwv7XVd21XJEt6qj6AEh+MgCozn
fzy4SVOi/f+BsYz4is0dzalBl05fY8SSb5Hu0mw8B7pXKFnage+fkf2VqUK4VVgT
cnqGgZ8+kyyko7Kxb78iwNpsndoJPkhsbbb+KklZEYh+zK9RH1T6YlqaBbFbCgSx
+7Kw9eF7YccI5mC9dDgu9rg8JWS+N+6DXqchL9noAyaI6/cWsTz8//wZu1eX4yuM
27Slowiv27JGowrVL9eBJ19bRia8Mns8edrTlrketwxJvlJuXssED2zjt12Q5wz4
O7QMI8nGEkUIKMBJanOcumYdChlTDoI/lweTA6aeTQKBgQDXmtfVzpSeeRx5wkVW
A0z4yGNYmwf+PMzwUNuzP0K2fpF0KPR1tjhC9OFtxThTjDSTlkEviKQC+R/zFKho
Wb5+vp9hN6Bj+d39XM3OIokVytQhCrjlTuLWfoQ1QqlumIK/CObgcQBCEMwEMEmu
2i5rhxMDUO2OOEDlvVOp5GE+PwKBgQDXc1tJx/72M1/5RV/mIaNPgUEbJf0tkXMB
SdheM0YRArUVD/JOATTx5UTpbrs137ylcAg6z7LcC457pPPmhM5cFkTHj6dbyIfR
+iygr25BBzD3Pa5t1K4kAxRKv9C4vXXkyDMDMWv0qDG276uInOHICSEIznWtXEk/
C0z+xwFBdQKBgQCHezexlNRzGKu6H0eumvhdRJ6Y6SKGsfId+NF1u4TSZIpGMg4b
gdusx3B4p/uTFIFdVIe1tOlLLPzUpOCGYg6AWoyQbIIPEM5cDVsN80mtNf1Cnhg9
j+qe2nV9elw5sQBHxvI9iwScfy2UXDuQ8m1FCGX8KXh9a//r3aKbGXW5xQKBgQCC
tamciYlVNLX1NPGJXL8HbRNitRl0m9l53qM2A0Vu7IWP0azfRjwoxT+Zn2RUuvho
Jh/YDkok1Z4LxXdzUv8fPyNbLvwJ4w8DhROuKMBrE0HRvcolN/KuRm/5KYYnjkoI
Eq1gMoucUq5WnfEjYIpaIa+4+AjMtEB7zw9XQsSwQQKBgGrP8JvWKtBXxPlBRA13
U94oyjfbjDStJ5a+xRwhiHBmvAOKOVuIspodWk8gmmoNLDJf2esMtl5l1IyLlh9V
a7DqTODg9XL55Z9YQD64BZ0Ejpgt5pDMLd7hj0krYqHCxJOW//ePN6q8UVlv1Liq
5QKkh3mYFVdNZoCT7ePXd6+V
-----END PRIVATE KEY-----`;

const TLS_CERT = `-----BEGIN CERTIFICATE-----
MIIDNDCCAhygAwIBAgIUMYMwDDChCoV5b8QgDPdSvGzOlp8wDQYJKoZIhvcNAQEL
BQAwGzEZMBcGA1UEAwwQYXBpLmV4YW1wbGUudGVzdDAeFw0yNjA3MTExNDUzNTJa
Fw0zNjA3MDgxNDUzNTJaMBsxGTAXBgNVBAMMEGFwaS5leGFtcGxlLnRlc3QwggEi
MA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQC1dDK1s9tDBQ3Vo2UHbY+Wz2ko
7BYJLJ8ksxe0FpQzCJzpBArpqsM7Hngmmlcwya6OGA8Qk3ugimSolU8MVjBJPn3r
A0rqRL8mBnbpeh9xRzYkYP3XrEsd5wGwekht2Lkur/4YDAJGvbeAtdXAh8moUXyp
0BFWIb7Qer7nOhaWeiHWML8+sXlcCiCkS/m/HuuQpJlNApMnKXWD7xMR4f4npu6V
uM99twZ/CLIhY8ali/hij0EFZuNoFdUwamIO4XYVd2b76HyM5H1pyAOqBtHPlKq9
EnaTtYOra4qUAB4g+P54WTduaRrL+CyPTihL++eUM9ZI1PvWmBqiUehIfnHLAgMB
AAGjcDBuMB0GA1UdDgQWBBRMsROHqQrsKeVpOAAKYonnTvG3ZTAfBgNVHSMEGDAW
gBRMsROHqQrsKeVpOAAKYonnTvG3ZTAPBgNVHRMBAf8EBTADAQH/MBsGA1UdEQQU
MBKCEGFwaS5leGFtcGxlLnRlc3QwDQYJKoZIhvcNAQELBQADggEBAA1edNWUG5VX
zCax/zFuA69DTqFvMOv43XZTEQOjKeQ1TCQDfseZrFL6eNJiXRVk7pU1sAt9m0V7
ywlkoBPQKTfxz14+zUuQaYSwN9XSYBEOJTAg73JzsxgRjYv4/Et+HzBpqKnT1igf
D33Dv/fomH8KxOEhNdpX5ku6C0JKE9xrSBh88AOxoBu2sXFqekABXkqddnsyg+c2
bRYXZ9jjAOG7/V4+0Ie3v5KRtTJbDQYbRaJ/GgQGSOe16wiuiEKfGZ111RzXGXfr
EdhmHL/nG6Qn77uRnSyX6TIL7VDm7G3EiETBoS2R9QSQRe6+PEPisNsI6glbnLEA
vqYVP4QjFv4=
-----END CERTIFICATE-----`;

const settings =
  (options: { allowPrivate?: boolean; allowedHosts?: string[] } = {}) =>
  async (key: string): Promise<unknown> => {
    if (key === "grids.http_request_allow_private_networks") return options.allowPrivate ?? false;
    if (key === "grids.http_request_allowed_hosts") return options.allowedHosts ?? [];
    return null;
  };

const responseRequest =
  (
    body: string | Buffer | Buffer[],
    inspect?: (options: RequestOptions) => void,
  ): ((options: RequestOptions, callback: (response: IncomingMessage) => void) => ClientRequest) =>
  (options, callback) => {
    inspect?.(options);
    const request = new EventEmitter() as ClientRequest;
    request.destroy = (() => request) as ClientRequest["destroy"];
    request.end = (() => {
      queueMicrotask(() => {
        const stream = new PassThrough();
        const response = stream as unknown as IncomingMessage;
        response.statusCode = 200;
        response.headers = {};
        callback(response);
        for (const chunk of Array.isArray(body) ? body : [body]) stream.write(chunk);
        stream.end();
      });
      return request;
    }) as ClientRequest["end"];
    return request;
  };

describe("workflow HTTP client", () => {
  test("pins the validated DNS address for the socket lookup", async () => {
    let pinnedAddress: string | null = null;
    let pinnedServername: string | undefined;
    let dnsLookups = 0;
    const result = await requestWorkflowHttp(
      { url: "https://api.example.com/hooks", method: "POST", body: '{"ok":true}' },
      {
        getSetting: settings(),
        lookup: async () => {
          dnsLookups += 1;
          return [{ address: publicAddress, family: 4 }];
        },
        request: responseRequest("ok", (options) => {
          pinnedServername = (options as RequestOptions & { servername?: string }).servername;
          const pinnedLookup = options.lookup as unknown as (
            hostname: string,
            options: unknown,
            callback: (error: Error | null, address: string, family: number) => void,
          ) => void;
          pinnedLookup("api.example.com", {}, (_error, address) => {
            pinnedAddress = address;
          });
        }),
      },
    );

    expect(result.ok).toBe(true);
    expect(dnsLookups).toBe(1);
    expect(String(pinnedAddress)).toBe(publicAddress);
    expect(pinnedServername).toBe("api.example.com");
  });

  test("rejects private and reserved DNS results before opening a socket", async () => {
    let requested = false;
    const result = await requestWorkflowHttp(
      { url: "http://service.example.test", method: "GET" },
      {
        getSetting: settings(),
        lookup: async () => [{ address: "127.0.0.1", family: 4 }],
        request: responseRequest("hidden", () => {
          requested = true;
        }),
      },
    );

    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error.message).toBe("HTTP request target is not allowed");
    expect(requested).toBe(false);
  });

  test("allows an explicitly configured private-network integration", async () => {
    const result = await requestWorkflowHttp(
      { url: "http://inventory.internal/api", method: "GET" },
      {
        getSetting: settings({ allowPrivate: true, allowedHosts: ["inventory.internal"] }),
        lookup: async () => [{ address: "10.20.30.40", family: 4 }],
        request: responseRequest("ok"),
      },
    );

    expect(result.ok).toBe(true);
  });

  test("requires a host allowlist even when private-network requests are enabled", async () => {
    const result = await requestWorkflowHttp(
      { url: "http://inventory.internal/api", method: "GET" },
      {
        getSetting: settings({ allowPrivate: true }),
        lookup: async () => [{ address: "10.20.30.40", family: 4 }],
        request: responseRequest("hidden"),
      },
    );

    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error.message).toBe("HTTP request target is not allowed");
  });

  test("uses the pinned transport against a real private HTTP service when explicitly enabled", async () => {
    const server = Bun.serve({
      port: 0,
      fetch: () => new Response("connected"),
    });
    try {
      const result = await requestWorkflowHttp(
        { url: `http://127.0.0.1:${server.port}/health`, method: "GET" },
        { getSetting: settings({ allowPrivate: true, allowedHosts: ["127.0.0.1"] }) },
      );

      expect(result.ok).toBe(true);
      expect(result.ok && result.data.body).toBe("connected");
    } finally {
      server.stop(true);
    }
  });

  test("enforces exact and wildcard host allowlists", async () => {
    const denied = await requestWorkflowHttp(
      { url: "https://evil.example.net", method: "GET" },
      { getSetting: settings({ allowedHosts: ["api.example.com", "*.hooks.example.com"] }) },
    );
    const allowed = await requestWorkflowHttp(
      { url: "https://tenant.hooks.example.com", method: "GET" },
      {
        getSetting: settings({ allowedHosts: ["api.example.com", "*.hooks.example.com"] }),
        lookup: async () => [{ address: publicAddress, family: 4 }],
        request: responseRequest("ok"),
      },
    );

    expect(denied.ok).toBe(false);
    expect(denied.ok ? "" : denied.error.message).toContain("host allowlist");
    expect(allowed.ok).toBe(true);
  });

  test("rejects mixed public and private DNS answers", async () => {
    const result = await requestWorkflowHttp(
      { url: "https://api.example.com", method: "GET" },
      {
        getSetting: settings(),
        lookup: async () => [
          { address: publicAddress, family: 4 },
          { address: "127.0.0.1", family: 4 },
        ],
        request: responseRequest("hidden"),
      },
    );

    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error.message).toBe("HTTP request target is not allowed");
  });

  test("rejects oversized request bodies before opening a socket", async () => {
    let requested = false;
    const result = await requestWorkflowHttp(
      { url: "https://api.example.com", method: "POST", body: "x".repeat(64 * 1024 + 1) },
      {
        getSetting: settings(),
        lookup: async () => [{ address: publicAddress, family: 4 }],
        request: responseRequest("hidden", () => {
          requested = true;
        }),
      },
    );

    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error.message).toBe("httpRequest body is too large");
    expect(requested).toBe(false);
  });

  test("rejects unsafe, malformed, and conflicting request headers", async () => {
    const unsafeHeaders: Record<string, string>[] = [
      { " Content-Length ": "5" },
      { "TRANSFER-ENCODING": "chunked" },
      { Host: "internal.example" },
      { "x-value": "safe\r\nHost: internal.example" },
      { "bad header": "value" },
    ];
    for (const headers of unsafeHeaders) {
      const result = await requestWorkflowHttp({ url: "https://api.example.com", method: "GET", headers });
      expect(result.ok).toBe(false);
      expect(result.ok ? "" : result.error.message).toMatch(/header .* (?:invalid|not allowed)/);
    }
  });

  test("keeps TLS verification bound to the original hostname", async () => {
    const server = createHttpsServer({ key: TLS_KEY, cert: TLS_CERT }, (_request, response) => response.end("secure"));
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const port = (server.address() as AddressInfo).port;
    try {
      const matching = await requestWorkflowHttp(
        { url: `https://api.example.test:${port}/health`, method: "GET" },
        {
          getSetting: settings({ allowPrivate: true, allowedHosts: ["api.example.test"] }),
          lookup: async () => [{ address: "127.0.0.1", family: 4 }],
          tlsCa: TLS_CERT,
        },
      );
      const rejectsMismatchingHostname = await new Promise<boolean>((resolve) => {
        const socket = tlsConnect({ host: "127.0.0.1", port, servername: "other.example.test", ca: TLS_CERT }, () => {
          socket.destroy();
          resolve(false);
        });
        socket.once("error", () => resolve(true));
      });

      expect(matching.ok).toBe(true);
      expect(matching.ok && matching.data.body).toBe("secure");
      expect(rejectsMismatchingHostname).toBe(true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test("stops buffering as soon as the streamed response exceeds 64 KiB", async () => {
    const result = await requestWorkflowHttp(
      { url: "https://api.example.com/large", method: "GET" },
      {
        getSetting: settings(),
        lookup: async () => [{ address: publicAddress, family: 4 }],
        request: responseRequest([Buffer.alloc(40 * 1024), Buffer.alloc(40 * 1024)]),
      },
    );

    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error.message).toBe("httpRequest response is too large");
  });

  test("applies the request timeout while DNS is still resolving", async () => {
    const result = await requestWorkflowHttp(
      { url: "https://api.example.com/slow", method: "GET", timeoutMs: 5 },
      {
        getSetting: settings(),
        lookup: () => new Promise(() => undefined),
      },
    );

    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error.message).toBe("httpRequest timed out");
  });

  test("applies the timeout after response headers arrive", async () => {
    const requestFactory = ((_options: RequestOptions, callback: (response: IncomingMessage) => void) => {
      const request = new EventEmitter() as ClientRequest;
      request.destroy = ((error?: Error) => {
        if (error) queueMicrotask(() => request.emit("error", error));
        return request;
      }) as ClientRequest["destroy"];
      request.end = (() => {
        queueMicrotask(() => {
          const response = new PassThrough() as unknown as IncomingMessage;
          response.statusCode = 200;
          response.headers = {};
          callback(response);
          response.emit("data", Buffer.from("partial"));
        });
        return request;
      }) as ClientRequest["end"];
      return request;
    }) as (options: RequestOptions, callback: (response: IncomingMessage) => void) => ClientRequest;

    const result = await requestWorkflowHttp(
      { url: "https://api.example.com/slow", method: "GET", timeoutMs: 5 },
      {
        getSetting: settings(),
        lookup: async () => [{ address: publicAddress, family: 4 }],
        request: requestFactory,
      },
    );

    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error.message).toBe("httpRequest timed out");
  });

  test("classifies IPv4, IPv6, and mapped private ranges conservatively", () => {
    expect(isUnsafeWorkflowHttpAddress("10.0.0.1")).toBe(true);
    expect(isUnsafeWorkflowHttpAddress("100.64.0.1")).toBe(true);
    expect(isUnsafeWorkflowHttpAddress("203.0.113.1")).toBe(true);
    expect(isUnsafeWorkflowHttpAddress("::1")).toBe(true);
    expect(isUnsafeWorkflowHttpAddress("0:0:0:0:0:ffff:127.0.0.1")).toBe(true);
    expect(isUnsafeWorkflowHttpAddress("fc00::1")).toBe(true);
    expect(isUnsafeWorkflowHttpAddress(publicAddress)).toBe(false);
    expect(isUnsafeWorkflowHttpAddress("2606:4700:4700::1111")).toBe(false);
  });
});
