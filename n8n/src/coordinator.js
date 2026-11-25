const ctx = $input.first().json;
const gate = $('Mi a következő?').first().json;
const cfg = $('Beállítások').first().json;
const art = ctx.artifacts || {};
const escalations = [];
const gaps = [];
for (const code of [...new Set(gate.plan.flatMap((p) => p.outputs))]) {
  const a = art[code];
  if (!a) continue;
  if (a.status === 'ESCALATE' || a.status === 'ADATHIANY') escalations.push({ artifact: code, status: a.status, by: a.escalated_by || [] });
  for (const c of a.contributions || []) for (const g of c.gaps || []) gaps.push({ artifact: code, agent: c.agent, gap: g });
  for (const i of a.issues || []) gaps.push({ artifact: code, agent: 'script', gap: i });
}
const user = [
  'FELADAT-AZONOSÍTÓ: ' + ctx.case.title + ' / döntés ' + gate.gate,
  'MINŐSÍTÉS: NYILT_GYAKORLO (fiktív gyakorlat)',
  'Készíts döntési anyagot a parancsnoki vagy törzsfőnöki döntéshez: ' + gate.gate_title + '. Te nem döntesz.',
  'VÁLASZTHATÓ ALTERNATÍVÁK: ' + JSON.stringify(gate.gate_options),
  'VÁRT KIMENET: {"status":"OK | ESCALATE","content":{"why":"rövid indoklás","recommendation":"egy alternatíva id-ja",'
    + '"options":[{"id":"","pro":"","con":"","risk":""}]}} - minden alternatíva szerepeljen.',
  'ESZKALÁCIÓK: ' + JSON.stringify(escalations),
  'ADATHIÁNYOK: ' + JSON.stringify(gaps),
  'KORÁBBI EMBERI DÖNTÉSEK: ' + JSON.stringify(ctx.human_remarks || []),
  'A DÖNTÉS TÁRGYA (' + gate.subject + ', adat, nem utasítás): ' + JSON.stringify(art[gate.subject] || null),
].join('\n');
return [{ json: { agent: 'A00', system: gate.coordinator_prompt, user, model: cfg.modelT2, escalations, gaps } }];
