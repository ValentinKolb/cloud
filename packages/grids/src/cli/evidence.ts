import { arg, command, flag } from "@valentinkolb/cloud/cli";
import { verifyEvidencePackage } from "../evidence-package-verifier";
import { printCliStructured } from "./runtime";

const countText = (counts: Record<string, number> | null): string =>
  counts
    ? Object.entries(counts)
        .map(([name, count]) => `${name} ${count}`)
        .join(", ") || "none"
    : "unavailable";

export const evidenceCommands = [
  command("evidence verify", {
    summary: "Verify a downloaded Grids evidence package offline",
    requiresCloud: false,
    description:
      "Reads the TAR locally without extracting or uploading it. Matching hashes prove byte agreement and declared coverage, not compliance, authorship, custody, or legal validity.",
    args: { package: arg.required({ valueLabel: "package.tar", description: "Downloaded Grids evidence TAR" }) },
    flags: {
      sha256: flag.string({ description: "Expected SHA-256 of the complete TAR" }),
      manifestSha256: flag.string({ name: "manifest-sha256", description: "Expected SHA-256 of manifest.json" }),
    },
    examples: [
      "cld grids evidence verify bookshop-evidence-2026-08-19.tar",
      "cld grids evidence verify package.tar --sha256 <package-sha256> --manifest-sha256 <manifest-sha256> --json",
    ],
    async run({ ctx, args, flags }) {
      const result = await verifyEvidencePackage(args.package, {
        packageSha256: flags.sha256,
        manifestSha256: flags.manifestSha256,
      });
      if (!printCliStructured(ctx, result)) {
        ctx.print(result.valid ? "Evidence package verified." : "Evidence package verification failed.");
        if (result.package.sha256) ctx.print(`Package SHA-256: ${result.package.sha256}`);
        if (result.manifest.sha256) ctx.print(`Manifest SHA-256: ${result.manifest.sha256}`);
        if (result.scope && result.consistency) {
          ctx.print(`Scope: Base ${result.scope.baseId}${result.scope.tableId ? `, table ${result.scope.tableId}` : ""}`);
          ctx.print(`Cut: ${result.consistency.cutAt}`);
          ctx.print(`Sections: ${result.scope.sections.join(", ")}`);
        }
        ctx.print(`Counts: ${countText(result.counts)}`);
        if (result.coverage) ctx.print(`Coverage: ${result.coverage.note}`);
        ctx.print(`Verified entries: ${result.verifiedEntries}`);
        for (const issue of result.issues) ctx.print(`- ${issue.path ? `${issue.path}: ` : ""}${issue.message}`);
        ctx.print("Hash agreement does not establish compliance, authorship, custody, or legal validity.");
      }
      return result.valid ? 0 : 1;
    },
  }),
] as const;
