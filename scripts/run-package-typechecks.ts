const workspacePackages = [
  "@valentinkolb/cloud-contracts",
  "@valentinkolb/cloud-lib",
  "@valentinkolb/cloud-core",
  "@valentinkolb/cloud-apps",
  "@valentinkolb/cloud-standalone",
] as const;

for (const pkg of workspacePackages) {
  const proc = Bun.spawn(["bun", "run", "--filter", pkg, "typecheck"], {
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });

  const exitCode = await proc.exited;
  if (exitCode !== 0) process.exit(exitCode);
}

