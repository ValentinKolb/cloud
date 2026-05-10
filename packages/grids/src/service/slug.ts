import { crypto } from "@valentinkolb/stdlib";
import { isUniqueViolation } from "@valentinkolb/cloud/services";

/**
 * 5-char readable slug regex. Used to validate persisted slugs at the
 * Zod-contract layer; mirrors the DB CHECK constraint applied by the
 * migration so the two layers can never disagree.
 */
export const SLUG_REGEX = /^[A-Za-z0-9]{5}$/;

/**
 * Insert-with-random-slug helper. Each grids resource (base/table/field/
 * form/view/dashboard) carries a 5-char readable slug alongside its UUID.
 *
 * Unlike a check-then-insert pattern, this helper trusts the DB partial
 * unique index as the only authoritative collision check — two
 * concurrent creates can race the JS-side check otherwise. We retry the
 * insert when the SPECIFIC slug-index name comes back as a 23505 unique
 * violation; any other unique constraint (a real PK collision, an FK,
 * etc.) bubbles up as a real error.
 *
 * Collision math: 62^5 = 916M; even 1000 alive resources per scope gives
 * ~0.054% birthday-paradox collision rate per try, so 10 attempts is
 * massive overkill — the loop exists strictly for paranoia.
 *
 * Why pass the index name explicitly: bun.sql / postgres surface the
 * constraint that fired. If we retried on every 23505 we would mask a
 * different unique-constraint bug (e.g. a duplicate name with a unique
 * index) as a slug failure. Naming the slug index keeps that signal
 * sharp.
 *
 * @param insert  Function that runs the INSERT for a candidate slug and
 *                returns the inserted row. MUST throw on any failure
 *                (do not return null/undefined for "row missing").
 * @param uniqueIndexName  The name of the partial unique index that
 *                guards slug uniqueness for this resource (e.g.
 *                `idx_grids_bases_slug`).
 */
export const insertWithSlug = async <T>(
  insert: (slug: string) => Promise<T>,
  uniqueIndexName: string,
): Promise<T> => {
  for (let attempt = 0; attempt < 10; attempt++) {
    const slug = crypto.common.readableId(5);
    try {
      return await insert(slug);
    } catch (e: unknown) {
      if (isUniqueViolation(e, uniqueIndexName)) continue;
      throw e;
    }
  }
  throw new Error(
    `slug generation: 10 collisions in a row on ${uniqueIndexName} — scope is saturated or RNG is broken`,
  );
};
