const gate = $('Mi a következő?').first().json;
const task = $('Döntési kérés összeállítása').first().json;
const reply = parseReply($input.first().json, 'A00');
const ids = gate.gate_options.map((o) => o.id);
const given = list(reply.content.options);
const options = {};
const incomplete = [];
for (const id of ids) {
  const o = given.find((x) => x && x.id === id) || {};
  if (!o.pro || !o.con || !o.risk) incomplete.push(id);
  options[id] = { pro: o.pro || 'ADATHIANY', con: o.con || 'ADATHIANY', risk: o.risk || 'ADATHIANY' };
}
// An unknown recommendation is dropped, never replaced by a guess.
const recommendation = ids.includes(reply.content.recommendation) ? reply.content.recommendation : null;
return [{ json: { recommendation, material: { why: reply.content.why || 'ADATHIANY', options,
  escalations: task.escalations, gaps: task.gaps, incomplete,
  coordinator_status: reply.status === 'ESCALATE' ? 'ESCALATE' : 'OK',
  generated_by: { agent: 'A00', model: task.model } } } }];
