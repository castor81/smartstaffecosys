// Shared demo state of the command post and the process view (one browser). Storage is a convenience only.
export const KEY = 'sse-demo-v0.4';

export const store = {
  load() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } },
  save(patch) { try { localStorage.setItem(KEY, JSON.stringify({ ...this.load(), ...patch })); } catch { /* ignore */ } },
  clear() { try { localStorage.removeItem(KEY); } catch { /* ignore */ } },
};
