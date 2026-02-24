import { z } from "zod";

export const UpdateProfileSchema = z.object({
  givenname: z.string().min(1),
  sn: z.string().min(1),
  displayName: z.string().min(1),
  phone: z.string().optional(),
  street: z.string().optional(),
  postalCode: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
});

export const UpdateSshKeysSchema = z.object({
  keys: z.array(z.string()),
});

export const ChangePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(1),
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
    newPassword: z.string().min(1),
    confirmPassword: z.string().min(1),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });
