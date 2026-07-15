import { z } from 'zod';

/**
 * Password policy: min 12 chars with upper, lower, digit, and special
 * character. Applied on registration, password change, and password reset —
 * existing accounts keep working until they next set a password.
 */
export const passwordSchema = z
  .string()
  .min(12, 'Password must be at least 12 characters')
  .max(128, 'Password must be at most 128 characters')
  .regex(/[a-z]/, 'Password must contain a lowercase letter')
  .regex(/[A-Z]/, 'Password must contain an uppercase letter')
  .regex(/[0-9]/, 'Password must contain a number')
  .regex(/[^A-Za-z0-9]/, 'Password must contain a special character');

const emailSchema = z.string().trim().toLowerCase().email('Invalid email address').max(254);

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(100),
  // Optional — derived from the email local part when omitted (the current
  // registration UI has no username field).
  username: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9_.-]{3,32}$/, 'Username must be 3-32 characters (letters, numbers, _ . -)')
    .optional(),
  company: z.string().trim().max(100).optional(),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required').max(128),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required').max(128),
  newPassword: passwordSchema,
});

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export const resetPasswordSchema = z.object({
  token: z.string().regex(/^[a-f0-9]{64}$/, 'Invalid reset token'),
  password: passwordSchema,
});

export const uuidSchema = z.string().uuid('Invalid id');

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
