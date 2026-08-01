import { type CapabilityKind, capabilityApiPath } from "./routes";

export const quotePosix = (value: string): string => `'${value.replaceAll("'", `'"'"'`)}'`;

export function buildCapabilityCurl(input: {
  kind: CapabilityKind;
  appId: string;
  capabilityId: string;
  body: Record<string, unknown>;
  idempotencyKey?: string;
}): string {
  const path = capabilityApiPath(input);
  const lines = [
    "curl --fail-with-body --silent --show-error \\",
    "  --request POST \\",
    `  --url \"$CLD_SERVER${path}\" \\`,
    '  --header "Authorization: Bearer $CLD_TOKEN" \\',
    `  --header ${quotePosix("Content-Type: application/json")} \\`,
  ];
  if (input.idempotencyKey) lines.push(`  --header ${quotePosix(`Idempotency-Key: ${input.idempotencyKey}`)} \\`);
  lines.push(`  --data-raw ${quotePosix(JSON.stringify({ input: input.body }))}`);
  return lines.join("\n");
}
