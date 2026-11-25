#!/usr/bin/env python3
"""Builds the n8n Workflow SDK code of the runner from n8n/src. One runner serves every workflow
segment defined in the database (v0.3: WF-01 and WF-02)."""
import json, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
VERSION, DATE = "0.3", "2026-11-25"
HQ = "5e000000-0000-0000-0000-0000000000b1"  # fictitious brigade from db/demo_setup.sql
MODELS = {"modelT1": "gpt-6.2-astra", "modelT2": "gpt-6.2-sol", "modelT3": "gpt-6-luna"}


def js(s):
    return json.dumps(s, ensure_ascii=False)


def src(*names):
    return "\n".join((ROOT / "n8n" / "src" / n).read_text(encoding="utf-8") for n in names)


def code_node(var, name, source, sample):
    return f"""const {var} = node({{
  type: 'n8n-nodes-base.code', version: 2,
  config: {{ name: {js(name)}, parameters: {{ mode: 'runOnceForAllItems', language: 'javaScript', jsCode: {js(source)} }} }},
  output: [{sample}]
}});
"""


def rpc(var, name, fn, body, sample, extra=""):
    url = "={{ $('Beállítások').first().json.supabaseUrl }}/rest/v1/rpc/" + fn
    return f"""const {var} = node({{
  type: 'n8n-nodes-base.httpRequest', version: 4.5,
  config: {{ name: {js(name)},{extra} parameters: {{ method: 'POST', url: expr({js(url[1:])}),
      authentication: 'predefinedCredentialType', nodeCredentialType: 'supabaseApi',
      sendBody: true, contentType: 'json', specifyBody: 'json',
      jsonBody: expr({js('{{ JSON.stringify(' + body + ') }}')}), options: {{ timeout: 60000 }} }},
    credentials: {{ supabaseApi: newCredential('SSE Supabase') }} }},
  output: [{sample}]
}});
"""


def llm(var, name, task_node):
    return f"""const {var} = node({{
  type: '@n8n/n8n-nodes-langchain.openAi', version: 2.3,
  config: {{ name: {js(name)}, parameters: {{ resource: 'text', operation: 'response',
      modelId: {{ __rl: true, mode: 'id', value: expr({js("{{ $('" + task_node + "').item.json.model }}")}) }},
      responses: {{ values: [
        {{ type: 'text', role: 'system', content: expr({js("{{ $('" + task_node + "').item.json.system }}")}) }},
        {{ type: 'text', role: 'user', content: expr({js("{{ $('" + task_node + "').item.json.user }}")}) }} ] }},
      builtInTools: {{}},
      options: {{ store: false, textFormat: {{ textOptions: {{ type: 'json_object' }} }} }} }},
    credentials: {{ openAiApi: newCredential('OpenAi account') }} }},
  output: [{{ output: [{{ content: [{{ type: 'output_text', text: {{ status: 'OK', content: {{}} }} }}] }}] }}]
}});
"""


def build():
    case = "$('Ügy megnyitása').first().json.case"
    assignments = {"supabaseUrl": "https://PROJEKT.supabase.co", "hqId": HQ, "caseTitle": "GYAKORLAT-01",
                   **MODELS}
    rows = ",\n        ".join(f"{{ id: {js(k)}, name: {js(k)}, value: {js(v)}, type: 'string' }}"
                             for k, v in assignments.items())
    rows += ",\n        { id: 'dueMinutes', name: 'dueMinutes', value: 60, type: 'number' }"
    note = (f"## SSE futtató (WF-01, WF-02) · v{VERSION} · {DATE}\n"
            "Futtatás előtt: 1) a Beállításokban a Supabase projekt címe; 2) az **SSE Supabase** hitelesítő "
            "(service role / secret kulcs) minden HTTP node-on; 3) az adatbázisban a séma, a seed, az API és a demo setup (ez hozza létre a fiktív ügyet).\n"
            "Csak NYÍLT, FIKTÍV gyakorló adat kerülhet bele. A workflow nem dönt: döntéskérést nyit és leáll.\n"
            "A döntés után ugyanezt kell újra futtatni: mindig a következő szakasz indul.")
    out = ["import { workflow, node, trigger, sticky, newCredential, ifElse, splitInBatches, nextBatch, expr } "
           "from '@n8n/workflow-sdk';\n",
           """const start = trigger({ type: 'n8n-nodes-base.manualTrigger', version: 1, config: { name: 'Indítás' }, output: [{}] });
""",
           f"""const settings = node({{
  type: 'n8n-nodes-base.set', version: 3.4,
  config: {{ name: 'Beállítások', parameters: {{ mode: 'manual', includeOtherFields: false, assignments: {{ assignments: [
        {rows} ] }} }} }},
  output: [{js(assignments | {"dueMinutes": 60})}]
}});
"""]
    out.append(rpc("openCase", "Ügy megnyitása", "sse_engine_start",
                   "{ p_hq: $('Beállítások').first().json.hqId, p_title: $('Beállítások').first().json.caseTitle, "
                   "p_inputs: {} }", "{ case: '00000000-0000-0000-0000-000000000001', created: true }"))
    out.append(rpc("askNext", "Mi a következő?", "sse_engine_next",
                   f"{{ p_case: {case}, p_workflow: null }}", "{ action: 'run', segment: 'W1A', plan: [] }"))
    out.append("""const canRun = ifElse({ version: 2.2, config: { name: 'Futtatható?', parameters: { conditions: {
  options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
  conditions: [{ leftValue: expr('{{ $json.action }}'), operator: { type: 'string', operation: 'equals' }, rightValue: 'run' }],
  combinator: 'and' } } } });
const idle = node({
  type: 'n8n-nodes-base.set', version: 3.4,
  config: { name: 'Nincs teendő', parameters: { mode: 'manual', includeOtherFields: true, assignments: { assignments: [
    { id: 'message', name: 'message', type: 'string', value: expr('{{ $json.action === "wait" ? "Emberi döntésre vár: " + $json.gate : $json.action === "done" ? "A WF-01 és WF-02 elkészült. A további lépések még nincsenek automatizálva." : "Nem futtatható: " + $json.why }}') } ] } } },
  output: [{ message: 'Emberi döntésre vár: D0' }]
});
""")
    out.append(code_node("plan", "Részlépések", "return $input.first().json.plan.map((p) => ({ json: p }));",
                         "{ substep: 'S1.1', run: 'script', inputs: [], outputs: [], agents: [] }"))
    out.append("""const loop = splitInBatches({ version: 3, config: { name: 'Részlépésenként', parameters: { batchSize: 1 } } });
const current = node({
  type: 'n8n-nodes-base.set', version: 3.4,
  config: { name: 'Aktuális részlépés', parameters: { mode: 'manual', includeOtherFields: true, assignments: { assignments: [] } } },
  output: [{ substep: 'S1.1', run: 'script', inputs: [], outputs: [], agents: [] }]
});
""")
    out.append(rpc("context", "Kontextus", "sse_engine_context", f"{{ p_case: {case} }}",
                   "{ case: { title: 'GYAKORLAT-01' }, artifacts: {}, human_remarks: [] }"))
    out.append(code_node("task", "Feladat összeállítása", src("task.js"),
                         "{ kind: 'llm', substep: 'S1.3', agent: 'A01', model: 'gpt-6.2-sol', system: '', user: '' }"))
    out.append("""const needsModel = ifElse({ version: 2.2, config: { name: 'Modell kell?', parameters: { conditions: {
  options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
  conditions: [{ leftValue: expr('{{ $json.kind }}'), operator: { type: 'string', operation: 'equals' }, rightValue: 'llm' }],
  combinator: 'and' } } } });
""")
    out.append(rpc("logCall", "Hívás naplózása", "sse_engine_model_call",
                   f"{{ p_case: {case}, p_agent: $json.agent, p_model: $json.model }}", "{ call: 1 }"))
    out.append(llm("agentModel", "Agent", "Feladat összeállítása"))
    out.append(code_node("collect", "Eredmény összegyűjtése", src("parse.js", "collect.js"),
                         "{ substep: 'S1.3', outputs: {}, agent: 'A01', model: 'gpt-6.2-sol' }"))
    out.append(rpc("save", "Mentés", "sse_engine_put",
                   f"{{ p_case: {case}, p_substep: $json.substep, p_outputs: $json.outputs, p_agent: $json.agent, p_model: $json.model }}",
                   "{ written: 1 }"))
    out.append(rpc("decisionContext", "Döntési kontextus", "sse_engine_context", f"{{ p_case: {case} }}",
                   "{ case: { title: 'GYAKORLAT-01' }, artifacts: {}, human_remarks: [] }", " executeOnce: true,"))
    out.append(code_node("coordinatorTask", "Döntési kérés összeállítása", src("coordinator.js"),
                         "{ agent: 'A00', model: 'gpt-6.2-sol', system: '', user: '', escalations: [], gaps: [] }"))
    out.append(rpc("logCoordinator", "Koordinátor naplózása", "sse_engine_model_call",
                   f"{{ p_case: {case}, p_agent: $json.agent, p_model: $json.model }}", "{ call: 2 }"))
    out.append(llm("coordinatorModel", "Törzskoordinátor", "Döntési kérés összeállítása"))
    out.append(code_node("material", "Döntési anyag", src("parse.js", "material.js"),
                         "{ recommendation: 'full', material: {} }"))
    out.append(rpc("request", "Döntéskérés", "sse_engine_request",
                   f"{{ p_case: {case}, p_gate: $('Mi a következő?').first().json.gate, "
                   "p_substep: $('Mi a következő?').first().json.gate_substep, p_recommendation: $json.recommendation, "
                   "p_material: $json.material, p_subject_code: $('Mi a következő?').first().json.subject, "
                   "p_due_minutes: $('Beállítások').first().json.dueMinutes }",
                   "{ request: '00000000-0000-0000-0000-000000000002' }"))
    out.append(f"const note = sticky({js(note)}, [start, settings], {{ color: 4 }});\n")
    out.append(f"""export default workflow('sse-runner', {js(f'SSE futtató · WF-01, WF-02 · v{VERSION} {DATE}')})
  .add(start).to(settings).to(openCase).to(askNext)
  .to(canRun
    .onTrue(plan.to(loop
      .onEachBatch(current.to(context.to(task.to(needsModel
        .onTrue(logCall.to(agentModel.to(collect.to(save.to(nextBatch(loop))))))
        .onFalse(save)))))
      .onDone(decisionContext.to(coordinatorTask.to(logCoordinator.to(coordinatorModel.to(material.to(request))))))))
    .onFalse(idle))
  .add(note);
""")
    path = ROOT / "n8n" / f"sse_runner_v{VERSION}_{DATE}.ts"
    path.write_text("".join(out), encoding="utf-8")
    print(path, path.stat().st_size)


if __name__ == "__main__":
    build()
