import { z } from 'zod';

/**
 * Password rules per AC #2:
 *   - min 8 chars
 *   - at least one uppercase
 *   - at least one lowercase
 *   - at least one number
 *
 * Composed as a single Zod refinement so the error response can pinpoint
 * the specific rule that failed — see RegistrationError details serialization.
 */
const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .refine((p) => /[a-z]/.test(p), 'Password must contain at least one lowercase letter')
  .refine((p) => /[A-Z]/.test(p), 'Password must contain at least one uppercase letter')
  .refine((p) => /[0-9]/.test(p), 'Password must contain at least one number');

export const registerSchema = z.object({
  email: z.string().email('Invalid email address').max(254),
  password: passwordSchema,
  displayName: z.string().trim().min(1, 'Display name is required').max(80),
});

export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
