import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import type { ClientRequest, IncomingMessage } from "node:http";
import type { RequestOptions } from "node:https";
import type { RequestDetails } from "web-push";
import { buildPinnedWebPushRequests, sendPinnedWebPush } from "./web-push-transport";

const subscription = {
  endpoint: "https://push.example.test/subscriptions/one?token=two",
  expirationTime: null,
  keys: { p256dh: "p".repeat(65), auth: "a".repeat(24) },
};

const requestDetails = (): RequestDetails => ({
  method: "POST",
  endpoint: subscription.endpoint,
  headers: { TTL: "60", Authorization: "vapid" },
  body: Buffer.from("encrypted"),
});

describe("pinned Web Push transport", () => {
  test("connects to the validated IP while preserving host routing and TLS SNI", async () => {
    const prepared = await buildPinnedWebPushRequests(
      subscription,
      "payload",
      { TTL: 60 },
      {
        resolve: async () => [{ address: "1.1.1.1", family: 4 }],
        generateRequestDetails: requestDetails,
      },
    );

    expect(prepared.attempts[0]).toEqual(
      expect.objectContaining({
        hostname: "1.1.1.1",
        servername: "push.example.test",
        port: 443,
        path: "/subscriptions/one?token=two",
        method: "POST",
        rejectUnauthorized: true,
        headers: expect.objectContaining({ host: "push.example.test", Authorization: "vapid" }),
      }),
    );
    expect(prepared.endpoint).toBe(subscription.endpoint);
    expect(prepared.body).toEqual(Buffer.from("encrypted"));
  });

  test("keeps both address families in the bounded attempt list", async () => {
    const prepared = await buildPinnedWebPushRequests(
      subscription,
      "payload",
      { TTL: 60 },
      {
        resolve: async () => [
          { address: "2606:4700:4700::1", family: 6 },
          { address: "2606:4700:4700::2", family: 6 },
          { address: "2606:4700:4700::3", family: 6 },
          { address: "2606:4700:4700::4", family: 6 },
          { address: "1.1.1.1", family: 4 },
        ],
        generateRequestDetails: requestDetails,
      },
    );

    expect(prepared.attempts.map((attempt) => attempt.hostname)).toEqual([
      "2606:4700:4700::1",
      "1.1.1.1",
      "2606:4700:4700::2",
      "2606:4700:4700::3",
    ]);
  });

  test("tries another validated address after a connection failure", async () => {
    const attemptedHosts: string[] = [];
    const request = (options: RequestOptions, callback: (response: IncomingMessage) => void): ClientRequest => {
      attemptedHosts.push(String(options.hostname));
      const outgoing = new EventEmitter() as ClientRequest;
      outgoing.write = () => true;
      outgoing.end = () => {
        if (attemptedHosts.length === 1) {
          queueMicrotask(() => outgoing.emit("error", new Error("connect failed")));
          return outgoing;
        }
        const response = new EventEmitter() as IncomingMessage;
        response.statusCode = 201;
        response.destroy = () => response;
        queueMicrotask(() => {
          callback(response);
          response.emit("end");
        });
        return outgoing;
      };
      outgoing.destroy = (error) => {
        if (error) queueMicrotask(() => outgoing.emit("error", error));
        return outgoing;
      };
      return outgoing;
    };

    await sendPinnedWebPush(
      subscription,
      "payload",
      { TTL: 60 },
      {
        resolve: async () => [
          { address: "1.1.1.1", family: 4 },
          { address: "8.8.8.8", family: 4 },
        ],
        generateRequestDetails: requestDetails,
        request,
      },
    );

    expect(attemptedHosts).toEqual(["1.1.1.1", "8.8.8.8"]);
  });
});
