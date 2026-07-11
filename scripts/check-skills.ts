import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

type Violation = {
  file: string;
  message: string;
};

const workspaceRoot = join(import.meta.dir, "..");
const skillsRoot = join(workspaceRoot, "skills");

const expectedSkills = ["cloud", "cloud-app", "cloud-cli", "cloud-desktop-app", "cloud-ops"] as const;

const isDirectory = (path: string): boolean => existsSync(path) && statSync(path).isDirectory();

const parseFrontmatter = (source: string): Record<string, string> | null => {
  const match = source.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return null;

  const fields: Record<string, string> = {};
  const lines = match[1].split("\n");
  let currentKey: string | null = null;
  let currentValue = "";

  for (const rawLine of lines) {
    // Indented line → continuation of previous block scalar value
    if (currentKey && /^\s{2,}/.test(rawLine)) {
      currentValue += ` ${rawLine.trim()}`;
      continue;
    }

    // Flush previous key
    if (currentKey) {
      fields[currentKey] = currentValue.trim();
      currentKey = null;
      currentValue = "";
    }

    const line = rawLine.trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();

    // Block scalar indicator (> or |)
    if (value === ">" || value === "|") {
      currentKey = key;
      currentValue = "";
    } else {
      fields[key] = value;
    }
  }

  // Flush last key
  if (currentKey) {
    fields[currentKey] = currentValue.trim();
  }

  return fields;
};

const violations: Violation[] = [];

if (!isDirectory(skillsRoot)) {
  console.error("Missing skills directory at cloud/skills.");
  process.exit(1);
}

const actualSkills = readdirSync(skillsRoot)
  .filter((entry) => entry !== "old_skills" && isDirectory(join(skillsRoot, entry)))
  .sort();

for (const expected of expectedSkills) {
  if (!actualSkills.includes(expected)) {
    violations.push({
      file: join(skillsRoot, expected),
      message: "Expected skill folder is missing.",
    });
  }
}

for (const actual of actualSkills) {
  if (!expectedSkills.includes(actual as (typeof expectedSkills)[number])) {
    violations.push({
      file: join(skillsRoot, actual),
      message: "Unexpected skill folder found (skill set is strict).",
    });
  }
}

for (const skill of expectedSkills) {
  const skillDir = join(skillsRoot, skill);
  if (!isDirectory(skillDir)) continue;

  const skillMd = join(skillDir, "SKILL.md");
  if (!existsSync(skillMd)) {
    violations.push({ file: skillMd, message: "Missing SKILL.md." });
    continue;
  }

  const skillSource = readFileSync(skillMd, "utf8");
  const fields = parseFrontmatter(skillSource);
  if (!fields) {
    violations.push({
      file: skillMd,
      message: "SKILL.md must start with YAML frontmatter delimited by ---.",
    });
  } else {
    const keys = Object.keys(fields).sort();
    if (keys.join(",") !== "description,name") {
      violations.push({
        file: skillMd,
        message: "Frontmatter must contain only 'name' and 'description'.",
      });
    }

    if (fields.name !== skill) {
      violations.push({
        file: skillMd,
        message: `Frontmatter name must equal folder name ('${skill}').`,
      });
    }

    if (!fields.description || fields.description.length < 20) {
      violations.push({
        file: skillMd,
        message: "Frontmatter description is missing or too short.",
      });
    }
  }

  const body = skillSource.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
  if (body.length === 0) {
    violations.push({
      file: skillMd,
      message: "SKILL.md body must not be empty.",
    });
  }

  const referencesDir = join(skillDir, "references");
  if (!isDirectory(referencesDir)) {
    violations.push({
      file: referencesDir,
      message: "Missing references directory.",
    });
  } else {
    const hasReferenceFile = readdirSync(referencesDir).some((entry) => statSync(join(referencesDir, entry)).isFile());
    if (!hasReferenceFile) {
      violations.push({
        file: referencesDir,
        message: "references directory must contain at least one file.",
      });
    }
  }
}

if (violations.length > 0) {
  console.error("Skills check failed:\n");
  for (const violation of violations) {
    console.error(`- ${relative(workspaceRoot, violation.file)} ${violation.message}`);
  }
  process.exit(1);
}

console.log("Skills check passed.");
