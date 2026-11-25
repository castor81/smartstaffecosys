// Minimal Supabase client for login and database functions, shared by the live page and the shared exercise.
// All rules are enforced by the database. The session lives in this browser tab only.
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

const SESSION = 'sse-session';
const keep = {
  get() { try { return JSON.parse(sessionStorage.getItem(SESSION)); } catch { return null; } },
  set(v) { try { v ? sessionStorage.setItem(SESSION, JSON.stringify(v)) : sessionStorage.removeItem(SESSION); } catch { /* memory only */ } },
};

export const configured = Boolean(SUPABASE_URL && SUPABASE_KEY);
let session = keep.get();
let expired = () => {};
export const onExpired = (fn) => { expired = fn; };
export const signedIn = () => Boolean(session);

async function post(path, body, token) {
  const headers = { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(SUPABASE_URL + path, { method: 'POST', headers, body: JSON.stringify(body) });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(data?.message || data?.error_description || data?.msg || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

async function token(grant, body) {
  const t = await post(`/auth/v1/token?grant_type=${grant}`, body);
  session = { access: t.access_token, refresh: t.refresh_token, until: Date.now() + (t.expires_in - 60) * 1000 };
  keep.set(session);
}
export const signIn = (email, password) => token('password', { email, password });

function drop() {
  session = null;
  keep.set(null);
}
export async function signOut() {
  const access = session?.access;
  drop();
  if (access) await post('/auth/v1/logout', {}, access).catch(() => {});
}
function lapse() {
  drop();
  expired('A munkamenet lejárt, lépj be újra.');
}

// One refresh at a time: a refresh token can be used only once.
let renewing = null;
export async function rpc(fn, args = {}) {
  if (!session) throw new Error('Nincs bejelentkezve.');
  if (Date.now() > session.until) {
    renewing ??= token('refresh_token', { refresh_token: session.refresh }).finally(() => { renewing = null; });
    try { await renewing; } catch (e) {
      if (e.status) lapse();
      throw e;
    }
  }
  try { return await post(`/rest/v1/rpc/${fn}`, args, session.access); } catch (e) {
    if (e.status === 401) lapse();
    throw e;
  }
}
