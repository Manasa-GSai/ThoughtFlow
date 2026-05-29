import { randomUUID } from 'node:crypto';
import { User, UserTier } from './types';

/**
 * Persistence contract for users. WO-003 will land a Postgres-backed
 * implementation; for now, InMemoryUserStore is used in dev/tests.
 *
 * Repositories contain zero business logic — only CRUD per CLAUDE.md.
 * Email uniqueness enforcement IS persistence-level integrity, not
 * business logic — Postgres will use a UNIQUE constraint.
 */
export interface UserStore {
  create(input: CreateUserInput): Promise<User>;
  findByEmail(email: string): Promise<User | null>;
  findById(id: string): Promise<User | null>;
}

export interface CreateUserInput {
  email: string;
  display_name: string;
  password_hash: string;
  tier?: UserTier;
}

export class EmailAlreadyExistsError extends Error {
  constructor(email: string) {
    super(`User with email "${email}" already exists`);
    this.name = 'EmailAlreadyExistsError';
  }
}

export class InMemoryUserStore implements UserStore {
  private readonly byId = new Map<string, User>();
  private readonly byEmail = new Map<string, User>();

  async create(input: CreateUserInput): Promise<User> {
    const normalized_email = input.email.toLowerCase();
    if (this.byEmail.has(normalized_email)) {
      throw new EmailAlreadyExistsError(input.email);
    }
    const user: User = {
      id: randomUUID(),
      email: normalized_email,
      display_name: input.display_name,
      password_hash: input.password_hash,
      tier: input.tier ?? 'free',
      created_at: new Date(),
    };
    this.byId.set(user.id, user);
    this.byEmail.set(user.email, user);
    return user;
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.byEmail.get(email.toLowerCase()) ?? null;
  }

  async findById(id: string): Promise<User | null> {
    return this.byId.get(id) ?? null;
  }
}
