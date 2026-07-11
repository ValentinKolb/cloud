import { describe, expect, test } from "bun:test";
import { Bash, InMemoryFs, MountableFs } from "just-bash";
import { __builtinSkillsTest, BUILTIN_AI_SKILLS, builtinAiSkillCommands } from "./builtin-skills";
import { parseAiSkillDescription } from "./skills-store";

const { evaluateMath, evaluateDate } = __builtinSkillsTest;

describe("calc math evaluator", () => {
  test("arithmetic with precedence and parentheses", () => {
    expect(evaluateMath("2 + 3 * 4")).toBe(14);
    expect(evaluateMath("(2 + 3) * 4")).toBe(20);
    expect(evaluateMath("2 ^ 10")).toBe(1024);
    expect(evaluateMath("2 ^ 3 ^ 2")).toBe(512); // right-associative
    expect(evaluateMath("-3 + 5")).toBe(2);
    expect(evaluateMath("10 % 3")).toBe(1);
  });

  test("functions and constants", () => {
    expect(evaluateMath("sqrt(144)")).toBe(12);
    expect(evaluateMath("round(19.99 * 1.19, 2)")).toBe(23.79);
    expect(evaluateMath("min(3, 1, 2)")).toBe(1);
    expect(evaluateMath("round(pi, 4)")).toBe(3.1416);
  });

  test("rejects anything that is not an expression — no code execution", () => {
    expect(() => evaluateMath("process.exit(1)")).toThrow();
    expect(() => evaluateMath("require('fs')")).toThrow();
    expect(() => evaluateMath("x = 5")).toThrow();
    expect(() => evaluateMath("2 +")).toThrow();
  });
});

describe("calc date evaluator", () => {
  test("date offsets", () => {
    expect(evaluateDate("2026-07-11 + 90 days")).toBe("2026-10-09");
    expect(evaluateDate("2026-06-01 - 2 weeks")).toBe("2026-05-18");
    expect(evaluateDate("2026-03-01 + 3 months")).toBe("2026-06-01");
    expect(evaluateDate("2026-01-15 + 1 year")).toBe("2027-01-15");
  });

  test("rejects invalid input", () => {
    expect(() => evaluateDate("banana + 3 days")).toThrow(/Invalid date/);
  });
});

describe("skill description from frontmatter", () => {
  test("parses plain, quoted, and missing descriptions", () => {
    expect(parseAiSkillDescription("---\nname: x\ndescription: Does things.\n---\n# X\n")).toBe("Does things.");
    expect(parseAiSkillDescription('---\ndescription: "Quoted, with: colons"\n---\n')).toBe("Quoted, with: colons");
    expect(parseAiSkillDescription("# No frontmatter\n")).toBe("");
    expect(parseAiSkillDescription("---\nname: x\n---\n")).toBe("");
  });

  test("every builtin SKILL.md carries a description", () => {
    for (const skill of BUILTIN_AI_SKILLS) {
      expect(parseAiSkillDescription(skill.files["/SKILL.md"] ?? "")).not.toBe("");
    }
  });
});

describe("calc as a bash command", () => {
  test("calc runs inside bash", async () => {
    const fs = new MountableFs();
    fs.mount("/files", new InMemoryFs());
    const bash = new Bash({ fs, cwd: "/files", customCommands: builtinAiSkillCommands(new Set(["calc"])) });

    const math = await bash.exec('calc math "2 + 3 * 4"');
    expect(math.exitCode).toBe(0);
    expect(math.stdout.trim()).toBe("14");

    const date = await bash.exec('calc date "2026-07-11 + 90 days"');
    expect(date.stdout.trim()).toBe("2026-10-09");

    const failed = await bash.exec('calc math "nope("');
    expect(failed.exitCode).toBe(1);
    expect(failed.stderr).toContain("calc:");
  });

  test("the command list follows the skill's activation", async () => {
    expect(builtinAiSkillCommands(new Set(["calc"])).map((command) => command.name)).toContain("calc");
    expect(builtinAiSkillCommands(new Set())).toHaveLength(0);
    // No filter = all builtin commands (e.g. for docs/introspection).
    expect(builtinAiSkillCommands().map((command) => command.name)).toContain("calc");
  });
});
