import { describe, expect, test } from "bun:test";
import { Bash, InMemoryFs, MountableFs } from "just-bash";
import { type SkillFsFile, SkillsFs } from "./bash-fs";

const enc = new TextEncoder();

const skillFile = (path: string, content: string): SkillFsFile => ({
  path,
  size: enc.encode(content).byteLength,
  read: async () => enc.encode(content),
});

const buildFs = () => {
  const skills = new SkillsFs([
    skillFile("/README.md", "# Skills\n"),
    skillFile("/qr/SKILL.md", "---\nname: qr\ndescription: Generate QR codes\n---\n\n# QR skill\n"),
    skillFile("/qr/references/format.md", "QR format notes\n"),
  ]);
  const fs = new MountableFs();
  fs.mount("/skills", skills);
  fs.mount("/files", new InMemoryFs());
  fs.mount("/input", new InMemoryFs());
  return fs;
};

describe("SkillsFs", () => {
  test("lists directories and files from flat paths", async () => {
    const fs = buildFs();
    expect((await fs.readdir("/skills")).sort()).toEqual(["README.md", "qr"]);
    expect((await fs.readdir("/skills/qr")).sort()).toEqual(["SKILL.md", "references"]);
    expect(await fs.readdir("/skills/qr/references")).toEqual(["format.md"]);
  });

  test("stat distinguishes files and implicit directories", async () => {
    const fs = buildFs();
    expect((await fs.stat("/skills/qr")).isDirectory).toBe(true);
    expect((await fs.stat("/skills/qr/SKILL.md")).isFile).toBe(true);
    await expect(fs.stat("/skills/missing")).rejects.toThrow();
  });

  test("rejects writes anywhere under the mount", async () => {
    const fs = buildFs();
    await expect(fs.writeFile("/skills/qr/hack.txt", "nope")).rejects.toThrow(/read-only/);
    await expect(fs.rm("/skills/README.md")).rejects.toThrow(/read-only/);
    await expect(fs.mv("/skills/README.md", "/skills/renamed.md")).rejects.toThrow(/read-only/);
  });
});

describe("bash over the mounted VFS", () => {
  const run = async (bash: Bash, command: string, stdin?: string) => bash.exec(command, { stdin });

  test("standard pipeline over skill and workspace files", async () => {
    const bash = new Bash({ fs: buildFs(), cwd: "/files", env: { HOME: "/files" } });

    const ls = await run(bash, "ls /skills");
    expect(ls.exitCode).toBe(0);
    expect(ls.stdout).toContain("qr");

    const grep = await run(bash, "grep -r 'QR' /skills --include='*.md' | wc -l");
    expect(grep.exitCode).toBe(0);
    expect(Number(grep.stdout.trim())).toBeGreaterThan(0);

    const pipeline = await run(bash, "printf 'x,y\\n1,2\\n3,4\\n' > data.csv && awk -F, '{print $2}' data.csv | tail -1");
    expect(pipeline.exitCode).toBe(0);
    expect(pipeline.stdout.trim()).toBe("4");

    const glob = await run(bash, "ls *.csv");
    expect(glob.stdout).toContain("data.csv");

    const stdinPass = await run(bash, "cat", "stdin-works");
    expect(stdinPass.stdout).toBe("stdin-works");
  });

  test("read-only mounts surface as command errors, not crashes", async () => {
    const bash = new Bash({ fs: buildFs(), cwd: "/files" });
    const rm = await run(bash, "rm /skills/README.md; echo exit=$?");
    expect(rm.stdout).toContain("exit=1");
    expect(rm.stderr).toContain("read-only");
    // A redirection onto a read-only mount throws out of exec — the bash tool
    // catches this and reports a failed command (see bash-tool.ts).
    await expect(bash.exec("echo nope > /skills/hack.txt")).rejects.toThrow(/read-only/);
  });

  test("directory workflows work on the writable mount", async () => {
    const bash = new Bash({ fs: buildFs(), cwd: "/files" });
    const result = await run(bash, "mkdir -p sub/dir && echo z > sub/dir/z.txt && find . -type f | sort && rm -r sub && ls");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("./sub/dir/z.txt");
    expect(result.stdout).not.toContain("sub\n");
  });
});
