import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';

const scrypt = (pw: string, salt: Buffer, len: number, opts: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) =>
    scryptCb(pw, salt, len, opts, (err, key) => (err ? reject(err) : resolve(key))),
  );

// scrypt with N=2^15, r=8, p=1 (OWASP-recommended minimum); parameters are stored with each hash.
const N = 32768, R = 8, P = 1, KEYLEN = 64;
const MAXMEM = 128 * N * R * 2;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize('NFKC'), salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, keyB64] = parts;
  const expected = Buffer.from(keyB64, 'base64');
  const key = await scrypt(password.normalize('NFKC'), Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(n), r: Number(r), p: Number(p), maxmem: 128 * Number(n) * Number(r) * 2,
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** A hash of a random secret, used to equalise timing when the account does not exist. */
let dummy: Promise<string> | null = null;
export function dummyHash(): Promise<string> {
  dummy ??= hashPassword(randomBytes(16).toString('hex'));
  return dummy;
}

export function passwordPolicyError(pw: string, email?: string): string | null {
  if (pw.length < 10) return 'Password must be at least 10 characters long.';
  if (pw.length > 128) return 'Password must be at most 128 characters long.';
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(pw)).length;
  if (classes < 3) return 'Password must contain at least three of: lowercase, uppercase, digit, symbol.';
  if (email && pw.toLowerCase().includes(email.split('@')[0].toLowerCase()))
    return 'Password must not contain your user name.';
  return null;
}
