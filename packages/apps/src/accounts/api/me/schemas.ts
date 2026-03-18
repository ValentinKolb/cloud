import { z } from "zod";

const SSH_PUBLIC_KEY_PATTERN = /^(ssh-(rsa|ed25519|dss)|ecdsa-sha2-nistp(256|384|521))\s+[A-Za-z0-9+/=]+(?:\s+.+)?$/;

export const UpdateProfileSchema = z.object({
  givenname: z.string().min(1).optional(),
  sn: z.string().min(1).optional(),
  displayName: z.string().min(1).optional(),
  ipa: z.object({
    phone: z.string().optional(),
    address: z.object({
      street: z.string().optional(),
      postalCode: z.string().optional(),
      city: z.string().optional(),
      state: z.string().optional(),
    }).optional(),
    sshPublicKeys: z.array(z.string().regex(SSH_PUBLIC_KEY_PATTERN, "Invalid SSH public key format")).optional(),
  }).optional(),
}).refine((data) => data.givenname !== undefined || data.sn !== undefined || data.displayName !== undefined || data.ipa !== undefined, {
  message: "At least one profile field must be provided",
});

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
