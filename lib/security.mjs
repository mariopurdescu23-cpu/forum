import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(scryptCallback);
export const randomToken = () => randomBytes(32).toString('hex');
export const digest = value => createHash('sha256').update(value).digest('hex');
export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `${salt}:${hash.toString('hex')}`;
}
export async function checkPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const actual = await scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return timingSafeEqual(actual, Buffer.from(hash, 'hex'));
}
export class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
export const fail = (status, message) => { throw new HttpError(status, message); };
export function text(value, label, min = 1, max = 10000) {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) fail(400, `${label}: folosește între ${min} și ${max} de caractere.`);
  return value.trim();
}
export function choice(value, allowed, label = 'Valoare') { if (!allowed.includes(value)) fail(400, `${label} invalidă.`); return value; }
export function url(value, optional = true) {
  if (!value && optional) return '';
  try { const u = new URL(value); if (u.protocol === 'https:' && !u.username && !u.password && value.length <= 2000) return u.href; } catch {}
  fail(400, 'Folosește un link HTTPS valid.');
}
export function password(value) { if (typeof value !== 'string' || value.length < 12 || value.length > 128) fail(400, 'Parola trebuie să aibă între 12 și 128 de caractere.'); return value; }
export const roles = ['PLAYER', 'HELPER', 'MODERATOR', 'ADMIN', 'OWNER'];
export const rank = user => roles.indexOf(user?.role);
