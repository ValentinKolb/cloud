import { err, fail, ok, type Result } from "@valentinkolb/stdlib";

type ScheduleLike = {
  kind: "schedule";
  cron: string;
  timezone?: string;
};

const isValidCronPart = (part: string, min: number, max: number): boolean => {
  if (!part || !/^[0-9*/,\-]+$/.test(part)) return false;
  const atoms = part.split(",");
  return atoms.every((atom) => {
    const [range, stepRaw] = atom.split("/");
    if (stepRaw !== undefined) {
      const step = Number(stepRaw);
      if (!Number.isInteger(step) || step < 1) return false;
      if (range !== "*" && !range?.includes("-")) return false;
    }
    if (range === "*") return true;
    if (!range) return false;
    const bounds = range.split("-");
    if (bounds.length > 2) return false;
    const nums = bounds.map((value) => Number(value));
    if (nums.some((value) => !Number.isInteger(value) || value < min || value > max)) return false;
    if (nums.length === 2 && nums[0]! > nums[1]!) return false;
    return true;
  });
};

export const validateSchedule = (trigger: ScheduleLike): Result<void> => {
  const parts = trigger.cron.trim().split(/\s+/);
  if (parts.length !== 5) return fail(err.badInput("schedule cron must have 5 fields"));
  const ranges = [
    { min: 0, max: 59, name: "minute" },
    { min: 0, max: 23, name: "hour" },
    { min: 1, max: 31, name: "day of month" },
    { min: 1, max: 12, name: "month" },
    { min: 0, max: 7, name: "day of week" },
  ];
  for (let i = 0; i < parts.length; i++) {
    if (!isValidCronPart(parts[i]!, ranges[i]!.min, ranges[i]!.max)) {
      return fail(err.badInput(`schedule cron has invalid ${ranges[i]!.name} field`));
    }
  }
  if (trigger.timezone) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: trigger.timezone }).format(new Date());
    } catch {
      return fail(err.badInput("schedule timezone must be a valid IANA timezone"));
    }
  }
  return ok();
};
