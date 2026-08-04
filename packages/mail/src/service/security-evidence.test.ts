import { describe, expect, test } from "bun:test";
import type { MailProtectedIdentity, MailSecurityPolicy } from "../security-contracts";
import { assessMailSecurityEvidence, type MailSecurityEvidenceInput } from "./security-evidence";

const timestamp = "2026-08-03T10:00:00.000Z";

const policy = (
  disposition: MailSecurityPolicy["disposition"],
  target: MailSecurityPolicy["target"],
  value: string,
): MailSecurityPolicy => ({
  id: crypto.randomUUID(),
  disposition,
  target,
  value,
  note: null,
  enabled: true,
  createdAt: timestamp,
  updatedAt: timestamp,
});

const identity = (name: string, allowedDomains: string[]): MailProtectedIdentity => ({
  id: crypto.randomUUID(),
  name,
  allowedDomains,
  note: null,
  enabled: true,
  createdAt: timestamp,
  updatedAt: timestamp,
});

const assess = (overrides: Partial<MailSecurityEvidenceInput> = {}) =>
  assessMailSecurityEvidence({
    from: [{ name: "Example", address: "sender@example.com" }],
    replyTo: [],
    selectedHeaders: {},
    sanitizedHtml: null,
    policies: [],
    protectedIdentities: [],
    trustedAuthservIds: [],
    evaluatedAt: timestamp,
    ...overrides,
  });

describe("Mail security evidence", () => {
  test("keeps individual weak signals quiet", () => {
    expect(assess({ replyTo: [{ name: null, address: "reply@elsewhere.example" }] }).verdict).toBe("clear");
    expect(assess({ sanitizedHtml: '<a href="https://example.net/pay">https://example.com/pay</a>' }).verdict).toBe("clear");
  });

  test("warns when independent weak signals corroborate each other", () => {
    const assessment = assess({
      replyTo: [{ name: null, address: "reply@elsewhere.example" }],
      sanitizedHtml: '<a href="https://payments.example.net/pay">https://example.com/pay</a>',
    });

    expect(assessment.verdict).toBe("suspicious");
    expect(assessment.findings.map((finding) => finding.code)).toEqual(["reply_to_mismatch", "misleading_link"]);
  });

  test("trust entries suppress weak heuristics only after trusted authentication passes", () => {
    const evidence = {
      replyTo: [{ name: null, address: "reply@elsewhere.example" }],
      sanitizedHtml: '<a href="https://payments.example.net/pay">https://example.com/pay</a>',
      policies: [policy("trust", "sender_domain", "example.com")],
    } satisfies Partial<MailSecurityEvidenceInput>;

    expect(assess(evidence).verdict).toBe("suspicious");
    expect(
      assess({
        ...evidence,
        trustedAuthservIds: ["mx.example.org"],
        selectedHeaders: { "authentication-results": "mx.example.org; dmarc=pass header.from=example.com" },
      }).verdict,
    ).toBe("clear");
  });

  test("does not trust authentication that passed for an unrelated domain", () => {
    const assessment = assess({
      replyTo: [{ name: null, address: "reply@elsewhere.example" }],
      sanitizedHtml: '<a href="https://payments.example.net/pay">https://example.com/pay</a>',
      policies: [policy("trust", "sender_domain", "example.com")],
      trustedAuthservIds: ["mx.example.org"],
      selectedHeaders: { "authentication-results": "mx.example.org; spf=pass smtp.mailfrom=attacker.example" },
    });

    expect(assessment.verdict).toBe("suspicious");
  });

  test("accepts aligned DKIM and SPF results but ignores unrelated failures", () => {
    const evidence = {
      replyTo: [{ name: null, address: "reply@elsewhere.example" }],
      sanitizedHtml: '<a href="https://payments.example.net/pay">https://example.com/pay</a>',
      policies: [policy("trust", "sender_domain", "example.com")],
      trustedAuthservIds: ["mx.example.org"],
    } satisfies Partial<MailSecurityEvidenceInput>;

    expect(
      assess({
        ...evidence,
        selectedHeaders: {
          "authentication-results": "mx.example.org; spf=fail smtp.mailfrom=attacker.example; dkim=pass header.d=mail.example.com",
        },
      }).verdict,
    ).toBe("clear");
    expect(
      assess({
        ...evidence,
        selectedHeaders: { "authentication-results": "mx.example.org; spf=pass smtp.mailfrom=sender@example.com" },
      }).verdict,
    ).toBe("clear");
  });

  test("warns on trusted authentication failures without adding speculative signals", () => {
    const assessment = assess({
      trustedAuthservIds: ["mx.example.org"],
      selectedHeaders: { "authentication-results": "mx.example.org; dmarc=fail header.from=example.com" },
    });

    expect(assessment.verdict).toBe("suspicious");
    expect(assessment.findings.map((finding) => finding.code)).toEqual(["authentication_failed"]);
  });

  test("explicit deny rules always contain the message", () => {
    const assessment = assess({
      policies: [policy("trust", "sender_domain", "example.com"), policy("deny", "sender_address", "sender@example.com")],
      trustedAuthservIds: ["mx.example.org"],
      selectedHeaders: { "authentication-results": "mx.example.org; dmarc=pass header.from=example.com" },
    });

    expect(assessment).toMatchObject({ risk: "danger", verdict: "quarantined", linksDisabled: true });
    expect(assessment.findings.map((finding) => finding.code)).toEqual(["admin_deny_policy"]);
  });

  test("protected names corroborate another suspicious signal", () => {
    const assessment = assess({
      from: [{ name: "Example Billing", address: "billing@lookalike.example" }],
      sanitizedHtml: '<a href="https://payments.example.net/pay">https://example.com/pay</a>',
      protectedIdentities: [identity("Example Billing", ["example.com"])],
    });

    expect(assessment.verdict).toBe("suspicious");
    expect(assessment.findings.map((finding) => finding.code)).toEqual(["misleading_link", "protected_identity_mismatch"]);
  });

  test("protected names warn on their own because an administrator configured them explicitly", () => {
    const assessment = assess({
      from: [{ name: "Example Billing", address: "billing@lookalike.example" }],
      protectedIdentities: [identity("Example Billing", ["example.com"])],
    });

    expect(assessment.verdict).toBe("suspicious");
    expect(assessment.findings.map((finding) => finding.code)).toEqual(["protected_identity_mismatch"]);
  });
});
