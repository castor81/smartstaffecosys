// Reads the JSON object a model returned, whatever envelope the model node puts around it.
function parseReply(raw, who) {
  const looksRight = (o) => o && typeof o === 'object' && !Array.isArray(o) && o.content && typeof o.content === 'object' && !Array.isArray(o.content);
  const fromText = (t) => {
    const a = t.indexOf('{');
    const b = t.lastIndexOf('}');
    if (a < 0 || b <= a) return null;
    try { const o = JSON.parse(t.slice(a, b + 1)); return looksRight(o) ? o : null; } catch (e) { return null; }
  };
  const find = (v, depth) => {
    if (depth > 6 || v === null || v === undefined) return null;
    if (typeof v === 'string') return fromText(v);
    if (typeof v !== 'object') return null;
    if (looksRight(v)) return v;
    for (const k of ['output', 'text', 'content', 'message', 'response', 'json', 'choices', 0, 1, 2, 3]) {
      if (v[k] !== undefined) { const r = find(v[k], depth + 1); if (r) return r; }
    }
    return null;
  };
  const found = find(raw, 0);
  if (!found) throw new Error('A(z) ' + who + ' agent válasza nem a várt JSON (hiányzik a content objektum).');
  return found;
}
const list = (v) => (Array.isArray(v) ? v : []);
