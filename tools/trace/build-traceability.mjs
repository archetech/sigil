#!/usr/bin/env node
// Sigil traceability matrix generator (zero-dependency).
//
// Scans the repo for the tags defined in docs/traceability.md and writes TRACEABILITY.md:
//   - Requirements  : `**R1 …**` / `**AC-1**` declarations in Requirements/*.md (a feature requirement's
//                     block also names the foundational `R*` it realizes, on its Traces line)
//   - Design points : `[D-AAC-3 → AC-3, R6]` tags in docs/*.md
//   - Code          : `@implements AC-3, …` doc-comments in source files
//   - Tests         : `@verifies AC-3, …` doc-comments in test files
// It rolls coverage up: a foundational `R*` counts as covered at a layer if it has direct coverage OR any
// feature requirement that realizes it does. Run:  node tools/trace/build-traceability.mjs
//
// @implements process:traceability  (this generator realizes the traceability discipline itself)

import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');
const CODE_EXT = new Set(['.ts', '.js', '.mjs', '.cjs', '.tsx', '.py', '.rs', '.go']);
const SKIP_DIR = new Set(['.git', 'node_modules', 'dist', 'build']);
const CONVENTION_DOC = 'docs/traceability.md'; // holds illustrative tags — not a real design note

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIR.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const files = walk(ROOT);
const rel = (p) => relative(ROOT, p);
const isTest = (p) => /(^|\/)tests?\//.test(rel(p)) || /\.(test|spec)\.[^.]+$/.test(p) || /_test\.[^.]+$/.test(p);

const REQ_DECL = /\*\*(R\d+|[A-Z]{2,}-\d+)\b/g;          // requirement declarations
const DESIGN_TAG = /\[(D-[A-Z]+-\d+)\s*→\s*([^\]]+)\]/g; // [D-AAC-3 → AC-3, R6]
const IMPL_TAG = /@implements\s+([A-Za-z0-9,\s-]+)/g;
const VERIFY_TAG = /@verifies\s+([A-Za-z0-9,\s-]+)/g;
const isFoundational = (id) => /^R\d+$/.test(id);
const isFeature = (id) => /^[A-Z]{2,}-\d+$/.test(id);
const idList = (s) => s.split(',').map((x) => x.trim()).filter((x) => /^(R\d+|D-[A-Z]+-\d+|[A-Z]{2,}-\d+)$/.test(x));

const requirements = new Map(); // id -> { file }
const realizes = new Map();     // featureId -> [foundationalId]  (feature realizes these foundational reqs)
const designPoints = [];        // { id, serves:[reqId] }
const codeImpls = [];           // { file, ids:[] }
const tests = [];               // { file, ids:[] }

for (const f of files) {
  const r = rel(f);
  let text;
  try { text = readFileSync(f, 'utf8'); } catch { continue; }

  if (r.startsWith('Requirements/') && r.endsWith('.md')) {
    const decls = [...text.matchAll(REQ_DECL)];
    decls.forEach((m, i) => {
      const id = m[1];
      if (id.startsWith('UC-') || id.startsWith('D-')) return; // use-cases / design points are not requirements
      if (!requirements.has(id)) requirements.set(id, { file: r });
      if (isFeature(id)) {
        const block = text.slice(m.index, decls[i + 1]?.index ?? text.length);
        const found = [...new Set((block.match(/\bR\d+\b/g) ?? []))];
        if (found.length) realizes.set(id, found);
      }
    });
  }
  if (r.startsWith('docs/') && r.endsWith('.md') && r !== CONVENTION_DOC) {
    for (const m of text.matchAll(DESIGN_TAG)) designPoints.push({ id: m[1], serves: idList(m[2]) });
  }
  if (CODE_EXT.has(extname(f)) && !r.startsWith('tools/trace/')) {
    const bucket = isTest(f) ? tests : codeImpls;
    const tag = isTest(f) ? VERIFY_TAG : IMPL_TAG;
    const ids = new Set();
    for (const m of text.matchAll(tag)) for (const id of idList(m[1])) ids.add(id);
    if (ids.size) bucket.push({ file: r, ids: [...ids] });
  }
}

// direct coverage per requirement
const dpServes = new Map(designPoints.map((d) => [d.id, d.serves]));
const toReqs = (id) => (id.startsWith('D-') ? (dpServes.get(id) ?? []) : [id]);
const direct = new Map([...requirements.keys()].map((id) => [id, { design: [], code: [], tests: [] }]));
const ensure = (id) => { if (!direct.has(id)) direct.set(id, { design: [], code: [], tests: [] }); return direct.get(id); };
for (const d of designPoints) for (const req of d.serves) ensure(req).design.push(d.id);
for (const c of codeImpls) for (const id of c.ids) for (const req of toReqs(id)) ensure(req).code.push(c.file);
for (const t of tests) for (const id of t.ids) for (const req of toReqs(id)) ensure(req).tests.push(t.file);

// realizedBy: foundational -> [feature]
const realizedBy = new Map();
for (const [feat, founds] of realizes) for (const R of founds) realizedBy.set(R, [...(realizedBy.get(R) ?? []), feat]);

// rolled coverage: a foundational req inherits its realizing features' coverage
const uniq = (xs) => [...new Set(xs)];
function coverage(id) {
  const d = direct.get(id) ?? { design: [], code: [], tests: [] };
  if (!isFoundational(id)) return { design: uniq(d.design), code: uniq(d.code), tests: uniq(d.tests), via: [] };
  const feats = (realizedBy.get(id) ?? []).filter((f) => requirements.has(f));
  const cov = { design: [...d.design], code: [...d.code], tests: [...d.tests], via: [] };
  for (const f of feats) {
    const fd = direct.get(f) ?? { design: [], code: [], tests: [] };
    cov.design.push(...fd.design); cov.code.push(...fd.code); cov.tests.push(...fd.tests);
    if (fd.design.length || fd.code.length || fd.tests.length) cov.via.push(f);
  }
  return { design: uniq(cov.design), code: uniq(cov.code), tests: uniq(cov.tests), via: uniq(cov.via) };
}

// render
const sortIds = (a, b) => {
  const fa = isFoundational(a), fb = isFoundational(b);
  if (fa !== fb) return fa ? -1 : 1;
  const pa = a.replace(/\d+$/, ''), pb = b.replace(/\d+$/, '');
  return pa === pb ? (+a.match(/\d+$/)[0] - +b.match(/\d+$/)[0]) : pa.localeCompare(pb);
};
const flag = (arr) => (arr.length ? '✓' : '·');
const ids = [...requirements.keys()].sort(sortIds);
const rows = ids.map((id) => {
  const c = coverage(id);
  return { id, ...c, status: `D:${flag(c.design)} C:${flag(c.code)} T:${flag(c.tests)}` };
});
const gaps = {
  design: rows.filter((r) => !r.design.length).map((r) => r.id),
  code: rows.filter((r) => !r.code.length).map((r) => r.id),
  tests: rows.filter((r) => !r.tests.length).map((r) => r.id),
};

let out = `# Sigil Traceability Matrix

<!-- GENERATED by tools/trace/build-traceability.mjs — do not edit by hand. See docs/traceability.md. -->

Chain: **foundational R\\* ← feature XX-\\* ← design D-\\* ← code (@implements) ← test (@verifies)**.
Foundational \`R*\` inherit coverage from the feature requirements that realize them ("via").
${rows.length} requirements · ${designPoints.length} design points · ${codeImpls.length} tagged code files · ${tests.length} tagged test files.

| Requirement | Realized by | Design | Code | Tests | Status |
|---|---|---|---|---|---|
`;
for (const r of rows) {
  out += `| ${r.id} | ${r.via.join(', ') || '—'} | ${r.design.join(', ') || '—'} | ${r.code.join(', ') || '—'} | ${r.tests.join(', ') || '—'} | ${r.status} |\n`;
}
out += `\n## Gaps\n\n`;
out += `- **No design coverage:** ${gaps.design.join(', ') || 'none'}\n`;
out += `- **No code (pending implementation):** ${gaps.code.join(', ') || 'none'}\n`;
out += `- **No test (pending unit/e2e):** ${gaps.tests.join(', ') || 'none'}\n`;

writeFileSync(join(ROOT, 'TRACEABILITY.md'), out);
console.log(`traceability: ${rows.length} requirements, ${designPoints.length} design points, ` +
  `${codeImpls.length} code + ${tests.length} test files tagged → TRACEABILITY.md`);
console.log(`gaps → design:${gaps.design.length} code:${gaps.code.length} tests:${gaps.tests.length}`);
