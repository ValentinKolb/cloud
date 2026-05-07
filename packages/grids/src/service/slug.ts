import { crypto } from "@valentinkolb/stdlib";

/**
 * Generate a unique 5-character slug in a given scope.
 *
 * Each grids resource (base / table / field / form / view) carries a
 * short readable slug alongside its UUID. The slug is what URLs and
 * formula references show; the UUID stays as the database PK and
 * relational FK. Slugs are immutable once set and unique within their
 * parent scope (bases globally, tables per base, fields/forms/views
 * per table).
 *
 * Generation is purely random via `crypto.common.readableId(5)` — we
 * deliberately don't slugify from the resource's name. A meaningful
 * default would invite the user to expect rename-then-slug-changes,
 * which is exactly the surprise we want to avoid. Random slugs are
 * stable forever, with no implied semantics.
 *
 * Collision probability for 5-char base62 slugs in any realistic scope
 * is microscopic (62^5 = 916M; even 1000 fields per table puts the
 * birthday-paradox collision rate at < 0.001%). The 10-attempt budget
 * below is paranoia rather than necessity.
 *
 * @param check - Async predicate returning true when a candidate slug
 *                is already taken in the relevant scope. Service
 *                modules wire their own SQL EXISTS query.
 */
export const generateUniqueSlug = async (
  check: (slug: string) => Promise<boolean>,
): Promise<string> => {
  for (let attempt = 0; attempt < 10; attempt++) {
    const candidate = crypto.common.readableId(5);
    if (!(await check(candidate))) return candidate;
  }
  throw new Error(
    "Failed to generate a unique slug after 10 attempts — bizarre bad luck or scope is saturated",
  );
};
