import { randomUUID } from 'node:crypto';
import { OAuthProvider, User, UserTier } from './types';

/**
 * Persistence contract for users. WO-003 will land a Postgres-backed
 * implementation; for now, InMemoryUserStore is used in dev/tests.
 *
 * Repositories contain zero business logic — only CRUD per CLAUDE.md.
 * Email uniqueness enforcement IS persistence-level integrity, not
 * business logic — Postgres will use a UNIQUE constraint.
 *
 * Lookups:
 *   - findByEmail   → primary email lookup (case-insensitive)
 *   - findById      → admin / token-refresh path
 *   - findByOAuth   → OAuth sign-in path (provider + sub) [WO-009]
 *
 * Mutations:
 *   - create        → email/password signup
 *   - createOAuth   → OAuth signup (no password) [WO-009]
 *   - linkOAuth     → attach OAuth identity to an existing password user [WO-009]
 */
export interface UserStore {
  create(input: CreateUserInput): Promise<User>;
  createOAuth(input: CreateOAuthUserInput): Promise<User>;
  findByEmail(email: string): Promise<User | null>;
  findById(id: string): Promise<User | null>;
  findByOAuth(provider: OAuthProvider, oauth_id: string): Promise<User | null>;
  linkOAuth(user_id: string, provider: OAuthProvider, oauth_id: string): Promise<User>;
}

export interface CreateUserInput {
  email: string;
  display_name: string;
  password_hash: string;
  tier?: UserTier;
}

export interface CreateOAuthUserInput {
  email: string;
  display_name: string;
  provider: OAuthProvider;
  oauth_id: string;
  tier?: UserTier;
}

export class EmailAlreadyExistsError extends Error {
  constructor(email: string) {
    super(`User with email "${email}" already exists`);
    this.name = 'EmailAlreadyExistsError';
  }
}

export class UserNotFoundError extends Error {
  constructor(id: string) {
    super(`User ${id} not found`);
    this.name = 'UserNotFoundError';
  }
}

export class InMemoryUserStore implements UserStore {
  private readonly byId = new Map<string, User>();
  private readonly byEmail = new Map<string, User>();
  /** Composite key: `${provider}:${oauth_id}` */
  private readonly byOAuth = new Map<string, User>();

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

  async createOAuth(input: CreateOAuthUserInput): Promise<User> {
    const normalized_email = input.email.toLowerCase();
    if (this.byEmail.has(normalized_email)) {
      throw new EmailAlreadyExistsError(input.email);
    }
    const user: User = {
      id: randomUUID(),
      email: normalized_email,
      display_name: input.display_name,
      password_hash: null,
      oauth_provider: input.provider,
      oauth_id: input.oauth_id,
      tier: input.tier ?? 'free',
      created_at: new Date(),
    };
    this.byId.set(user.id, user);
    this.byEmail.set(user.email, user);
    this.byOAuth.set(oauthKey(input.provider, input.oauth_id), user);
    return user;
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.byEmail.get(email.toLowerCase()) ?? null;
  }

  async findById(id: string): Promise<User | null> {
    return this.byId.get(id) ?? null;
  }

  async findByOAuth(provider: OAuthProvider, oauth_id: string): Promise<User | null> {
    return this.byOAuth.get(oauthKey(provider, oauth_id)) ?? null;
  }

  async linkOAuth(user_id: string, provider: OAuthProvider, oauth_id: string): Promise<User> {
    const user = this.byId.get(user_id);
    if (!user) throw new UserNotFoundError(user_id);
    user.oauth_provider = provider;
    user.oauth_id = oauth_id;
    this.byOAuth.set(oauthKey(provider, oauth_id), user);
    return user;
  }
}

function oauthKey(provider: OAuthProvider, oauth_id: string): string {
  return `${provider}:${oauth_id}`;
}
