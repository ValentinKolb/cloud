import { domainToASCII } from "node:url";
import type { MailProtectedIdentity, MailSecurityAssessment, MailSecurityPolicy } from "../security-contracts";

export type MailSecurityEvidenceInput = {
  from: Array<{ name: string | null; address: string }>;
  replyTo: Array<{ name: string | null; address: string }>;
  selectedHeaders: Record<string, unknown>;
  sanitizedHtml: string | null;
  policies: MailSecurityPolicy[];
  protectedIdentities: MailProtectedIdentity[];
  trustedAuthservIds: string[];
  evaluatedAt?: string;
};

const normalizeDomain = (value: string): string | null => {
  const normalized = domainToASCII(
    value
      .trim()
      .toLowerCase()
      .replace(/^\.+|\.+$/gu, ""),
  );
  if (!normalized || normalized.length > 253 || !/^[a-z0-9.-]+$/u.test(normalized) || normalized.includes("..")) return null;
  return normalized;
};

const addressDomain = (address: string): string | null => {
  const separator = address.lastIndexOf("@");
  return separator > 0 ? normalizeDomain(address.slice(separator + 1)) : null;
};

const normalizeAddress = (value: string): string | null => {
  const address = value.trim().toLowerCase();
  return address.length <= 320 && !/[\s\u0000-\u001f\u007f]/u.test(address) && addressDomain(address) ? address : null;
};

const sameOrSubdomain = (value: string, expected: string): boolean => value === expected || value.endsWith(`.${expected}`);

const linkEvidence = (html: string | null): { domains: Set<string>; misleading: boolean } => {
  const domains = new Set<string>();
  let misleading = false;
  if (!html) return { domains, misleading };
  for (const match of html.matchAll(/<a\b[^>]*href=(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/giu)) {
    const href = match[1] ?? match[2] ?? "";
    try {
      const url = new URL(href);
      if (url.protocol !== "http:" && url.protocol !== "https:") continue;
      const domain = normalizeDomain(url.hostname);
      if (!domain) continue;
      domains.add(domain);
      const visible = (match[3] ?? "").replace(/<[^>]+>/gu, " ").trim();
      const visibleHost = visible.match(/(?:https?:\/\/)?([a-z0-9.-]+\.[a-z]{2,})/iu)?.[1];
      const normalizedVisibleHost = visibleHost ? normalizeDomain(visibleHost) : null;
      if (normalizedVisibleHost && !sameOrSubdomain(domain, normalizedVisibleHost) && !sameOrSubdomain(normalizedVisibleHost, domain)) {
        misleading = true;
      }
    } catch {
      // Relative and invalid links carry no domain evidence.
    }
  }
  return { domains, misleading };
};

const trustedAuthentication = (headers: Record<string, unknown>, trustedAuthservIds: string[]): { trusted: boolean; failed: boolean } => {
  const raw = typeof headers["authentication-results"] === "string" ? headers["authentication-results"] : "";
  const authservId = raw.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (!authservId || !trustedAuthservIds.some((value) => value.trim().toLowerCase() === authservId)) {
    return { trusted: false, failed: false };
  }
  return {
    trusted: /\b(dmarc|dkim|spf)=pass\b/iu.test(raw),
    failed: /\b(dmarc|dkim|spf)=(?:fail|softfail|permerror|temperror)\b/iu.test(raw),
  };
};

const normalizedIdentityName = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

export const assessMailSecurityEvidence = (input: MailSecurityEvidenceInput): MailSecurityAssessment => {
  const senderAddress = normalizeAddress(input.from[0]?.address ?? "");
  const senderDomain = senderAddress ? addressDomain(senderAddress) : null;
  const replyDomain = addressDomain(input.replyTo[0]?.address ?? "");
  const links = linkEvidence(input.sanitizedHtml);
  const activePolicies = input.policies.filter((policy) => policy.enabled);
  const deny = activePolicies.find((policy) => {
    if (policy.disposition !== "deny") return false;
    if (policy.target === "sender_address") return senderAddress === policy.value;
    if (policy.target === "sender_domain") return Boolean(senderDomain && sameOrSubdomain(senderDomain, policy.value));
    return [...links.domains].some((domain) => sameOrSubdomain(domain, policy.value));
  });
  const authentication = trustedAuthentication(input.selectedHeaders, input.trustedAuthservIds);
  const trustedSender = activePolicies.some((policy) => {
    if (policy.disposition !== "trust") return false;
    if (policy.target === "sender_address") return senderAddress === policy.value;
    return policy.target === "sender_domain" && Boolean(senderDomain && sameOrSubdomain(senderDomain, policy.value));
  });

  if (deny) {
    return {
      risk: "danger",
      verdict: "quarantined",
      findings: [
        {
          code: "admin_deny_policy",
          title: "Blocked by your organization",
          explanation: `An administrator blocked this ${deny.target.replaceAll("_", " ")}.`,
        },
      ],
      linksDisabled: true,
      evaluatedAt: input.evaluatedAt ?? new Date().toISOString(),
    };
  }

  const findings: MailSecurityAssessment["findings"] = [];
  let weakSignals = 0;
  if (authentication.failed) {
    findings.push({
      code: "authentication_failed",
      title: "Sender verification failed",
      explanation: "The receiving mail system reported a failed sender-authentication check.",
    });
  }
  if (senderDomain && replyDomain && senderDomain !== replyDomain) {
    weakSignals += 1;
    findings.push({
      code: "reply_to_mismatch",
      title: "Replies go to another domain",
      explanation: "Replying would send mail to a different domain than the visible sender.",
    });
  }
  if (links.misleading) {
    weakSignals += 1;
    findings.push({
      code: "misleading_link",
      title: "A link points somewhere unexpected",
      explanation: "Visible link text and the actual destination use different domains.",
    });
  }
  const senderName = normalizedIdentityName(input.from[0]?.name ?? "");
  const impersonated = input.protectedIdentities.find(
    (identity) =>
      identity.enabled &&
      senderName === normalizedIdentityName(identity.name) &&
      Boolean(senderDomain && !identity.allowedDomains.some((domain) => sameOrSubdomain(senderDomain, domain))),
  );
  if (impersonated) {
    weakSignals += 1;
    findings.push({
      code: "protected_identity_mismatch",
      title: "The sender name may be impersonated",
      explanation: `${impersonated.name} normally sends from another domain.`,
    });
  }

  const trustedAuthenticatedSender = trustedSender && authentication.trusted;
  const suspicious = authentication.failed || Boolean(impersonated) || (!trustedAuthenticatedSender && weakSignals >= 2);
  return {
    risk: suspicious ? "warning" : "none",
    verdict: suspicious ? "suspicious" : "clear",
    findings: suspicious ? findings : [],
    linksDisabled: false,
    evaluatedAt: input.evaluatedAt ?? new Date().toISOString(),
  };
};
