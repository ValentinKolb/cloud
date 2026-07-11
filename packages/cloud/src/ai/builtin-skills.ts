/**
 * Builtin skills shipped with the cloud — seeded ONCE into the registry as
 * ordinary workspace skills (prepopulated content: admins manage, users
 * toggle, deletion sticks). Their bash commands stay in code and run
 * in-process, so nothing here may evaluate model-provided input as code:
 * calc uses a hand-written expression parser, not eval/Function.
 */
import { sql } from "bun";
import { type Command, defineCommand } from "just-bash";
import { aiSkillStore } from "./skills-store";

export type BuiltinAiSkill = {
  slug: string;
  /** Paths relative to the skill folder, e.g. "/SKILL.md" — the description lives in its frontmatter. */
  files: Record<string, string>;
  commands?: Command[];
};

// ── calc: safe math expression evaluator ───────────────────────────────────

type Token = { kind: "number"; value: number } | { kind: "ident"; name: string } | { kind: "op"; op: string };

const tokenizeMath = (input: string): Token[] => {
  const tokens: Token[] = [];
  let index = 0;
  while (index < input.length) {
    const char = input[index]!;
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (/[0-9.]/.test(char)) {
      const match = /^\d*\.?\d+(?:[eE][+-]?\d+)?/.exec(input.slice(index));
      if (!match) throw new Error(`Invalid number at position ${index + 1}`);
      tokens.push({ kind: "number", value: Number(match[0]) });
      index += match[0].length;
      continue;
    }
    if (/[a-zA-Z_]/.test(char)) {
      const match = /^[a-zA-Z_][a-zA-Z0-9_]*/.exec(input.slice(index))!;
      tokens.push({ kind: "ident", name: match[0].toLowerCase() });
      index += match[0].length;
      continue;
    }
    if ("+-*/%^(),".includes(char)) {
      tokens.push({ kind: "op", op: char });
      index += 1;
      continue;
    }
    throw new Error(`Unexpected character "${char}"`);
  }
  return tokens;
};

const MATH_CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E };

const MATH_FUNCTIONS: Record<string, (...args: number[]) => number> = {
  sqrt: Math.sqrt,
  abs: Math.abs,
  floor: Math.floor,
  ceil: Math.ceil,
  round: (value, digits = 0) => {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
  },
  min: Math.min,
  max: Math.max,
  pow: (base, exponent) => base ** exponent,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  log: Math.log10,
  ln: Math.log,
  exp: Math.exp,
};

/** Recursive-descent parser: expr > term > power > unary > primary. */
const evaluateMath = (input: string): number => {
  const tokens = tokenizeMath(input);
  let position = 0;

  const peek = () => tokens[position];
  const nextOp = (...ops: string[]): string | null => {
    const token = peek();
    if (token?.kind === "op" && ops.includes(token.op)) {
      position += 1;
      return token.op;
    }
    return null;
  };

  const parsePrimary = (): number => {
    const token = peek();
    if (!token) throw new Error("Unexpected end of expression");
    if (token.kind === "number") {
      position += 1;
      return token.value;
    }
    if (token.kind === "ident") {
      position += 1;
      if (nextOp("(")) {
        const args: number[] = [parseExpr()];
        while (nextOp(",")) args.push(parseExpr());
        if (!nextOp(")")) throw new Error(`Missing ")" after ${token.name}(...)`);
        const fn = MATH_FUNCTIONS[token.name];
        if (!fn) throw new Error(`Unknown function "${token.name}"`);
        return fn(...args);
      }
      const constant = MATH_CONSTANTS[token.name];
      if (constant === undefined) throw new Error(`Unknown constant "${token.name}"`);
      return constant;
    }
    if (token.op === "(") {
      position += 1;
      const value = parseExpr();
      if (!nextOp(")")) throw new Error('Missing ")"');
      return value;
    }
    throw new Error(`Unexpected "${token.op}"`);
  };

  const parseUnary = (): number => {
    if (nextOp("-")) return -parseUnary();
    if (nextOp("+")) return parseUnary();
    return parsePrimary();
  };

  const parsePower = (): number => {
    const base = parseUnary();
    if (nextOp("^")) return base ** parsePower(); // right-associative
    return base;
  };

  const parseTerm = (): number => {
    let value = parsePower();
    for (let op = nextOp("*", "/", "%"); op; op = nextOp("*", "/", "%")) {
      const rhs = parsePower();
      value = op === "*" ? value * rhs : op === "/" ? value / rhs : value % rhs;
    }
    return value;
  };

  const parseExpr = (): number => {
    let value = parseTerm();
    for (let op = nextOp("+", "-"); op; op = nextOp("+", "-")) {
      const rhs = parseTerm();
      value = op === "+" ? value + rhs : value - rhs;
    }
    return value;
  };

  const result = parseExpr();
  if (position < tokens.length) throw new Error("Unexpected trailing input");
  return result;
};

const formatMathResult = (value: number): string => {
  if (!Number.isFinite(value)) return String(value);
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toPrecision(12)));
};

// ── calc: date arithmetic ───────────────────────────────────────────────────

const DATE_PATTERN = /^(.+?)\s*([+-])\s*(\d+)\s+(days?|weeks?|months?|years?)$/i;

const parseBaseDate = (input: string): Date => {
  const trimmed = input.trim().toLowerCase();
  if (trimmed === "now" || trimmed === "today") return new Date();
  const date = new Date(input.trim());
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid date: "${input.trim()}"`);
  return date;
};

const evaluateDate = (expression: string): string => {
  const trimmed = expression.trim();
  const match = DATE_PATTERN.exec(trimmed);
  if (!match) {
    // Bare date/now: normalize to ISO for chaining.
    return parseBaseDate(trimmed).toISOString().split("T")[0]!;
  }
  const base = parseBaseDate(match[1]!);
  const amount = Number.parseInt(match[3]!, 10) * (match[2] === "+" ? 1 : -1);
  const unit = match[4]!.toLowerCase().replace(/s$/, "");
  const result = new Date(base);
  if (unit === "day") result.setDate(result.getDate() + amount);
  else if (unit === "week") result.setDate(result.getDate() + amount * 7);
  else if (unit === "month") result.setMonth(result.getMonth() + amount);
  else result.setFullYear(result.getFullYear() + amount);
  return result.toISOString().split("T")[0]!;
};

const ok = (stdout: string) => ({ stdout, stderr: "", exitCode: 0 });
const fail = (stderr: string) => ({ stdout: "", stderr: `calc: ${stderr}\n`, exitCode: 1 });

const CALC_USAGE = `Usage:
  calc math "2 + 3 * 4"
  calc date "2026-01-15 + 90 days"
`;

const calcCommand = defineCommand("calc", async (args) => {
  const [mode, expression] = [args[0], args.slice(1).join(" ").trim()];
  if (mode === "math") {
    if (!expression) return fail('usage: calc math "2 + 3 * 4"');
    try {
      return ok(`${formatMathResult(evaluateMath(expression))}\n`);
    } catch (error) {
      return fail(error instanceof Error ? error.message : "evaluation failed");
    }
  }
  if (mode === "date") {
    if (!expression) return fail('usage: calc date "2026-01-15 + 90 days"');
    try {
      return ok(`${evaluateDate(expression)}\n`);
    } catch (error) {
      return fail(error instanceof Error ? error.message : "date calculation failed");
    }
  }
  return mode === "--help" || mode === "-h" || mode === "help" ? ok(CALC_USAGE) : fail(`unknown mode "${mode ?? ""}"\n${CALC_USAGE}`);
});

const CALC_SKILL_MD = `---
name: calc
description: Exact math and date arithmetic. Use for any numeric calculation or date offset ("in 90 days") instead of computing in your head.
---

# Calc

Use the \`calc\` command for precise calculations — never do arithmetic mentally when a tool call is available.

## Math

\`\`\`bash
calc math "2 + 3 * 4"
calc math "round(19.99 * 1.19, 2)"
calc math "sqrt(144) + 2^10"
calc math "17500 * 0.07 / 12"
\`\`\`

Supported: \`+ - * / % ^\`, parentheses, \`sqrt abs round(x, digits) floor ceil min max pow sin cos tan log ln exp\`, constants \`pi\` and \`e\`.

## Dates

\`\`\`bash
calc date "2026-07-11 + 90 days"
calc date "now - 2 weeks"
calc date "2026-03-01 + 3 months"
\`\`\`

Units: days, weeks, months, years. Output is an ISO date (YYYY-MM-DD).

## Bigger jobs

For multi-step number crunching over data, write JavaScript instead:

\`\`\`bash
js-exec -c 'const rates = [0.02, 0.025, 0.03]; console.log(rates.map(r => (1000 * (1+r)**10).toFixed(2)).join("\\n"))'
\`\`\`

## Presenting results

For a single number the user will reference (price, percentage, date), consider the \`card\` tool (call it directly, not via bash). For inline answers plain text is fine.
`;

// ── Registry ────────────────────────────────────────────────────────────────

export const BUILTIN_AI_SKILLS: BuiltinAiSkill[] = [
  {
    slug: "calc",
    files: { "/SKILL.md": CALC_SKILL_MD },
    commands: [calcCommand],
  },
];

/**
 * Bash commands contributed by builtin skills, limited to the skills active
 * for this user — disabling the calc skill also removes the calc command.
 */
export const builtinAiSkillCommands = (activeSlugs?: ReadonlySet<string>): Command[] =>
  BUILTIN_AI_SKILLS.filter((skill) => !activeSlugs || activeSlugs.has(skill.slug)).flatMap((skill) => skill.commands ?? []);

/**
 * Seed builtin skills as ordinary workspace skills — once. The durable audit
 * log remembers the seeding (skill_events has no FK and survives deletion),
 * so an admin deleting a builtin skill sticks: it never comes back on its own.
 */
export const seedBuiltinAiSkills = async (): Promise<void> => {
  for (const builtin of BUILTIN_AI_SKILLS) {
    const seeded = await sql<{ id: string }[]>`
      SELECT id FROM ai.skill_events
      WHERE skill_slug = ${builtin.slug} AND event = 'created' AND meta->>'seeded' = 'true'
      LIMIT 1
    `;
    if (seeded.length > 0) continue;
    if (await aiSkillStore.getBySlug(builtin.slug)) continue;

    const skill = await aiSkillStore.create({ slug: builtin.slug, ownerUserId: null, actorUserId: null });
    for (const [path, content] of Object.entries(builtin.files)) {
      await aiSkillStore.writeFile({ skillId: skill.id, path, bytes: new TextEncoder().encode(content), actorUserId: null });
    }
    await sql`
      UPDATE ai.skill_events SET meta = COALESCE(meta, '{}'::jsonb) || '{"seeded": true}'::jsonb
      WHERE skill_id = ${skill.id} AND event = 'created'
    `;
  }
};

export const __builtinSkillsTest = { evaluateMath, evaluateDate, formatMathResult };
