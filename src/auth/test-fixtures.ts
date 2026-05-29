import { AppContext } from '../app';
import { AuthSuccessResponse } from './types';

/**
 * Test helper (AC #11): creates an authenticated user against the supplied
 * AppContext's stores and returns the AuthSuccessResponse + refresh token
 * for use in other test suites.
 *
 * Designed for unit/integration tests only — invokes the AuthService
 * directly to avoid the cost of going through the Express stack and rate
 * limiter for every fixture user.
 */
export interface CreateTestUserInput {
  email?: string;
  password?: string;
  displayName?: string;
}

export interface CreatedTestUser {
  response: AuthSuccessResponse;
  refresh_token: string;
  refresh_expires_at: number;
  /** Convenience: pre-formatted Authorization header value. */
  authorization_header: string;
}

let counter = 0;
function uniqueEmail(): string {
  counter += 1;
  return `test-user-${counter}-${process.hrtime.bigint().toString(36)}@example.test`;
}

export async function createTestUser(
  ctx: AppContext,
  input: CreateTestUserInput = {},
): Promise<CreatedTestUser> {
  const email = input.email ?? uniqueEmail();
  const password = input.password ?? 'Password1A';
  const displayName = input.displayName ?? 'Test User';

  const result = await ctx.authService.register({ email, password, displayName });
  return {
    response: result.response,
    refresh_token: result.refresh_token,
    refresh_expires_at: result.refresh_expires_at,
    authorization_header: `Bearer ${result.response.access_token}`,
  };
}
