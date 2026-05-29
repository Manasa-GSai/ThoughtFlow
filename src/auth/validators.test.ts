import { registerSchema, loginSchema } from './validators';

describe('registerSchema', () => {
  const validInput = { email: 'a@b.com', password: 'Password1A', displayName: 'A' };

  it('accepts a valid input', () => {
    expect(() => registerSchema.parse(validInput)).not.toThrow();
  });

  it('rejects invalid email', () => {
    expect(() => registerSchema.parse({ ...validInput, email: 'not-an-email' })).toThrow();
  });

  it('rejects password shorter than 8 chars', () => {
    expect(() => registerSchema.parse({ ...validInput, password: 'Pass1A' })).toThrow();
  });

  it('rejects password without an uppercase letter', () => {
    expect(() => registerSchema.parse({ ...validInput, password: 'password1' })).toThrow();
  });

  it('rejects password without a lowercase letter', () => {
    expect(() => registerSchema.parse({ ...validInput, password: 'PASSWORD1' })).toThrow();
  });

  it('rejects password without a number', () => {
    expect(() => registerSchema.parse({ ...validInput, password: 'Passwordxx' })).toThrow();
  });

  it('rejects empty displayName', () => {
    expect(() => registerSchema.parse({ ...validInput, displayName: '   ' })).toThrow();
  });

  it('trims displayName whitespace', () => {
    const parsed = registerSchema.parse({ ...validInput, displayName: '  Alice  ' });
    expect(parsed.displayName).toBe('Alice');
  });
});

describe('loginSchema', () => {
  it('accepts a valid input', () => {
    expect(() => loginSchema.parse({ email: 'a@b.com', password: 'anything' })).not.toThrow();
  });

  it('rejects invalid email', () => {
    expect(() => loginSchema.parse({ email: 'bad', password: 'x' })).toThrow();
  });

  it('rejects empty password', () => {
    expect(() => loginSchema.parse({ email: 'a@b.com', password: '' })).toThrow();
  });
});
