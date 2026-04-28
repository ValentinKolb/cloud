import { z } from "zod";

/**
 * Schemas for account profile / password / request inputs. Live in core
 * contracts so both the core `/api/me` router and the accounts admin app can
 * consume the same shapes without cross-app imports.
 */

const SSH_PUBLIC_KEY_PATTERN = /^(ssh-(rsa|ed25519|dss)|ecdsa-sha2-nistp(256|384|521))\s+[A-Za-z0-9+/=]+(?:\s+.+)?$/;

/**
 * IPA-only self-service fields. Exposed so an admin schema can compose the
 * same inner shape without extending the refined self-service schema.
 */
export const IpaProfileFieldsSchema = z.object({
  phone: z.string().optional(),
  address: z
    .object({
      street: z.string().optional(),
      postalCode: z.string().optional(),
      city: z.string().optional(),
      state: z.string().optional(),
    })
    .optional(),
  sshPublicKeys: z.array(z.string().regex(SSH_PUBLIC_KEY_PATTERN, "Invalid SSH public key format")).optional(),
});

export const UpdateProfileSchema = z
  .object({
    givenname: z.string().min(1).optional(),
    sn: z.string().min(1).optional(),
    displayName: z.string().min(1).optional(),
    ipa: IpaProfileFieldsSchema.optional(),
  })
  .refine(
    (data) => data.givenname !== undefined || data.sn !== undefined || data.displayName !== undefined || data.ipa !== undefined,
    { message: "At least one profile field must be provided" },
  );

export const ChangePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8),
    confirmPassword: z.string().min(1),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export const ChangeExpiredPasswordSchema = z
  .object({
    username: z.string().min(1),
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8),
    confirmPassword: z.string().min(1),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export const CreateAccountRequestSchema = z.object({
  phone: z.string().optional().describe("Optional phone number for the request"),
  comment: z.string().optional().describe("Why do you need a FreeIPA account?"),
  acceptedAgb: z.literal(true).describe("Must accept terms of service"),
});
