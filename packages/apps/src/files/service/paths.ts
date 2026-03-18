import { sql } from "bun";
import { getSync } from "@valentinkolb/cloud/core/services";
import type { FileBase, MutationResult } from "@/files/contracts";
import path from "node:path";

type DbRow = Record<string, unknown>;

/**
 * Resolve a FileBase to the absolute path on the file server
 */
export const resolveBase = (base: FileBase): string => {
  if (base.type === "home") {
    return path.join(getSync<string>("files.base_homes"), base.uid);
  }
  return path.join(getSync<string>("files.base_groups"), base.name);
};

/**
 * Validate and resolve a relative path within a base directory.
 * Returns the full path on the file server or an error if path traversal is detected.
 */
export const resolvePath = (base: FileBase, relativePath: string): MutationResult<{ fullPath: string; relativePath: string }> => {
  const basePath = resolveBase(base);

  // Normalize the path and remove leading slashes
  const normalized = path.normalize(relativePath).replace(/^\/+/, "");
  const fullPath = path.join(basePath, normalized);

  // Prevent path traversal attacks
  if (!fullPath.startsWith(basePath)) {
    return {
      ok: false,
      error: "Invalid path: traversal not allowed",
      status: 400,
    };
  }

  return {
    ok: true,
    data: {
      fullPath,
      relativePath: normalized || "/",
    },
  };
};

/**
 * Parse route parameters into a FileBase with numeric IDs for ownership.
 * Fetches uidNumber/gidNumber from the database.
 */
export const parseBase = async (baseType: string, baseId: string): Promise<MutationResult<FileBase>> => {
  if (baseType === "home") {
    // Fetch user's uidNumber
    const rows: DbRow[] = await sql`
      SELECT d.uid_number
      FROM auth.users u
      LEFT JOIN auth.user_ipa_data d ON d.user_id = u.id
      WHERE u.uid = ${baseId}
    `;

    if (rows.length === 0) {
      return { ok: false, error: "User not found", status: 404 };
    }

    const uidNumber = rows[0]!.uid_number as number | null;
    // For home dirs, use user's uidNumber as both uid and gid
    // This matches the nfsctl pattern: chown user:user (user's personal group)

    return {
      ok: true,
      data: {
        type: "home",
        uid: baseId,
        uidNumber: uidNumber ?? undefined,
        gidNumber: uidNumber ?? undefined, // Same as UID for home directories
      },
    };
  }

  if (baseType === "group") {
    // Fetch group's gidNumber
    const rows: DbRow[] = await sql`
      SELECT gid_number FROM auth.groups WHERE cn = ${baseId}
    `;

    if (rows.length === 0) {
      return { ok: false, error: "Group not found", status: 404 };
    }

    const gidNumber = rows[0]!.gid_number as number | null;

    return {
      ok: true,
      data: {
        type: "group",
        name: baseId,
        gidNumber: gidNumber ?? undefined,
      },
    };
  }

  return {
    ok: false,
    error: "Invalid base type: must be 'home' or 'group'",
    status: 400,
  };
};
