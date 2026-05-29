import bcrypt from 'bcryptjs';

/**
 * Bcrypt wrapper centralizing the cost factor. CLAUDE.md mandates strategy/
 * factory pattern for external integrations — depend on interface, not vendor.
 *
 * Cost factor 12 is the security baseline from the architecture
 * "Security Architecture" specification — strong enough to slow brute-force
 * attacks while keeping per-login cost under ~200ms on modern hardware.
 */
export interface PasswordHasher {
  hash(plaintext: string): Promise<string>;
  verify(plaintext: string, hash: string): Promise<boolean>;
}

const DEFAULT_COST = 12;

export class BcryptPasswordHasher implements PasswordHasher {
  constructor(private readonly cost: number = DEFAULT_COST) {}

  async hash(plaintext: string): Promise<string> {
    return bcrypt.hash(plaintext, this.cost);
  }

  async verify(plaintext: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plaintext, hash);
  }
}
