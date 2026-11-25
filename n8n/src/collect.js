const tasks = $('Feladat összeállítása').all().map((i) => i.json);
const replies = $input.all().map((i) => i.json);
if (replies.length !== tasks.length) throw new Error('A modellválaszok száma nem egyezik a feladatokéval.');
const parsed = replies.map((r, i) => ({ task: tasks[i], reply: parseReply(r, tasks[i].agent) }));
const expected = tasks[0].expected;
const empty = (v) => v === undefined || v === null || v === '';
const outputs = {};
for (const code of expected) {
  const contributions = [];
  for (const { task, reply } of parsed) {
    let part = reply.content[code];
    // A single expected output may come back without the wrapping key.
    if (empty(part) && expected.length === 1 && Object.keys(reply.content).length) part = reply.content;
    if (empty(part)) continue;
    contributions.push({ agent: task.agent, status: reply.status === 'ESCALATE' ? 'ESCALATE' : 'OK', content: part,
      sources: list(reply.sources), assumptions: list(reply.assumptions), gaps: list(reply.gaps),
      risks: list(reply.risks), handoffs: list(reply.handoffs) });
  }
  if (!contributions.length) throw new Error('Egyik agent sem adta meg ezt a kimenetet: ' + code);
  // An escalation counts even if that agent contributed nothing to this output.
  const escalated = parsed.filter((p) => p.reply.status === 'ESCALATE').map((p) => p.task.agent);
  outputs[code] = { status: escalated.length ? 'ESCALATE' : 'OK', escalated_by: escalated, contributions };
}
return [{ json: { substep: tasks[0].substep, outputs, agent: tasks.map((t) => t.agent).join(','), model: tasks[0].model } }];
