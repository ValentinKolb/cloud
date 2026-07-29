import { basename } from "node:path";

export const isBarrelTarget = (target: string): boolean => /^index\.tsx?$/.test(basename(target));

export const barrelTargetError = (target: string, allowBarrelTarget?: true): string | undefined => {
  const barrel = isBarrelTarget(target);
  if (barrel && allowBarrelTarget !== true) {
    return `target must be a concrete module, not a group barrel: ${target}`;
  }
  if (!barrel && allowBarrelTarget === true) {
    return `allowBarrelTarget is only valid for an intentional index module: ${target}`;
  }
  return undefined;
};
