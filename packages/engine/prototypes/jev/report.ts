import type { ReportRecord } from './run.ts';

export async function buildReport(
  directory: string,
  summary: unknown,
  records: ReportRecord[],
) {
  const built = await Bun.build({
    entrypoints: [`${import.meta.dir}/viewer.ts`],
    target: 'browser',
    conditions: ['@maelstrom-co/source'],
    format: 'iife',
    minify: false,
  });
  if (!built.success) throw new Error('Could not build the report viewer.');
  const script = await built.outputs[0].text();
  const catalogs: ReportRecord['input']['request']['vessels'][] = [];
  const catalogKeys: string[] = [];
  const compactRecords = records.map((record) => {
    const key = JSON.stringify(record.input.request.vessels);
    let catalogIndex = catalogKeys.indexOf(key);
    if (catalogIndex < 0) {
      catalogIndex = catalogs.length;
      catalogs.push(record.input.request.vessels);
      catalogKeys.push(key);
    }
    return {
      ...record,
      catalogIndex,
      input: {
        ...record.input,
        request: { ...record.input.request, vessels: undefined },
      },
    };
  });
  const data = JSON.stringify({
    summary,
    catalogs,
    records: compactRecords,
  }).replaceAll('<', '\\u003c');
  await Bun.write(
    `${directory}/report.html`,
    `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Jev × Maelstrom — feasibility experiment</title>
<style>
:root{font-family:system-ui,sans-serif;color:#21312c;background:#f4f6f3}*{box-sizing:border-box}body{max-width:1320px;margin:auto;padding:32px}h1{font-size:32px;margin:8px 0}h2{font-size:20px}p{line-height:1.55}.eyebrow{font-size:12px;font-weight:750;letter-spacing:.1em;color:#356e57}.notice{background:#e6eee6;border-left:4px solid #356e57;padding:16px 20px;margin:20px 0}.metrics{display:flex;gap:20px;flex-wrap:wrap}.metric{background:white;padding:16px;border:1px solid #d6ded5;border-radius:8px;min-width:170px}.metric strong{display:block;font-size:24px}.workspace{display:grid;grid-template-columns:280px 1fr;gap:24px;margin-top:24px}nav{display:flex;flex-direction:column;gap:6px}button,select{font:inherit;padding:9px 12px;border:1px solid #b7c8b9;border-radius:6px;color:inherit;background:white;cursor:pointer}button:hover,button[aria-pressed=true]{background:#dcebdd}button:focus-visible,select:focus-visible{outline:3px solid #356e57;outline-offset:2px}nav button{text-align:left;font-size:13px}button:disabled{opacity:.5;cursor:default}.toolbar{display:flex;gap:8px;flex-wrap:wrap;margin:16px 0}.board{height:340px;position:relative;background:#d9e1d8;border-radius:8px;overflow:hidden}.tile{position:absolute;padding:6px}.tile>div{height:100%;border:1px solid #b6cab6;background:#fff;border-radius:6px;padding:14px;overflow:auto}.tile strong{display:block}.tile small{color:#55675b}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;line-height:1.5;background:#fff;padding:16px;border:1px solid #d6ded5;border-radius:6px}details{margin-top:12px}summary{cursor:pointer;font-weight:600}.pass{color:#21613b}.fail{color:#a03522}.subtle{color:#536459;font-size:13px}#status{min-height:28px}.empty{padding:30px}.guide{border-top:1px solid #c6d3c7;padding-top:16px;margin-top:20px}@media(max-width:760px){body{padding:16px}.workspace{grid-template-columns:1fr}nav{max-height:210px;overflow:auto}.board{height:300px}}
</style></head><body>
<header><div class="eyebrow">THROWAWAY PROTOTYPE · STRUCTURED OUTPUT ONLY</div><h1>Can Jev plan a Maelstrom board?</h1>
<p>This experiment asks whether bounded model judgments can become a valid layout and ordered execution plan, without a user message.</p></header>
<div id="notice" class="notice"></div><div id="metrics" class="metrics"></div>
<div class="workspace"><aside><label for="group">Explore cases</label><select id="group"><option value="all">All cases</option><option value="capability">Supported behaviors</option><option value="boundary">Integration limits</option><option value="compiler">Compiler fault injections</option></select><nav id="cases" aria-label="Experiment cases"></nav></aside>
<main><h2 id="title"></h2><p id="why"></p><blockquote id="intent"></blockquote>
<div class="toolbar"><button id="before" type="button">1. Inspect starting board</button><button id="apply" type="button">2. Apply recorded plan</button><button id="reset" type="button">Reset</button></div>
<p id="status" aria-live="polite"></p><div id="board" class="board" aria-label="Chart layout preview"></div>
<p class="subtle">The preview uses Chart-relative dimensions. Tiles show instance identity and simulated variant, not rendered Vessel components. Action success is assumed for this preview.</p>
<div class="guide"><h2>Free play: deterministic arrangements</h2><p class="subtle">These controls change only the preview. They do not call Jev or count as evaluation results.</p><div class="toolbar"><button id="row" type="button">Equal columns</button><button id="column" type="button">Equal rows</button><button id="focus" type="button">Emphasize first tile</button><button id="hide" type="button">Hide last tile</button></div></div>
<details open><summary>Layout and execution plan</summary><pre id="output"></pre></details>
<details><summary>Judgments and request measurements</summary><pre id="judgments"></pre></details>
<details><summary>Expected behavior and evaluation failures</summary><pre id="expected"></pre></details>
<details><summary>Complete starting state</summary><pre id="input"></pre></details>
</main></div>
<details><summary>Full experiment summary and demo parameter audit</summary><pre id="summary"></pre></details>
<script id="data" type="application/json">${data}</script><script>${script.replaceAll('</script', '<\\/script')}</script>
</body></html>`,
  );
}
