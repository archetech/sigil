/**
 * The demo UI. It renders from the engine's state and drives the real Sigil calls; there is no verification logic
 * here — every accept/deny comes from `verifyPresentation`. Full re-render on each action keeps the code simple;
 * forms are read at submit time.
 */
import { DemoEngine, AUDIENCE, ACTIONS, RESOURCES, isHighConsequence, type VerifyOutcome, type TraceEntry } from './engine.ts';
import type { Capability, VerifyResult } from '@sigil';

const engine = new DemoEngine();
const app = document.getElementById('app')!;

type LogEntry = { ok: boolean; title: string; detail: string; ts: string };
let log: LogEntry[] = [];
let lastVerify: VerifyOutcome | null = null;
let showJson = false;
let busy = false;
let notice: string | null = null;
// verify-console form state (bound so the step-up control appears reactively)
let vAction = 'read';
let vResource: string = RESOURCES[0];
let vAudience = AUDIENCE;
let coSignOn = false;

const short = (did: string): string => (did.length > 22 ? `${did.slice(0, 15)}…${did.slice(-4)}` : did);
const esc = (s: string): string => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));

const REASON: Record<string, string> = {
  authorization: 'The requested action or resource is outside this credential’s scope.',
  audience: 'This capability is bound to a different verifier (audience).',
  revoked: 'A credential in the chain has been revoked — a delete operation, seen by replay.',
  'relationship-revoked': 'The root’s controller relationship (VRC) was revoked.',
  'relationship-unresolvable': 'The root’s controller relationship (VRC) could not be resolved.',
  'chain-linkage': 'A hop is missing or out of order — the chain does not link parent→child.',
  'not-delegable': 'A parent capability did not permit delegation.',
  attenuation: 'A hop tried to widen its parent — refused (monotonic attenuation).',
  'holder-mismatch': 'The presenter is not the leaf’s subject.',
  'holder-binding': 'The holder’s signature over the challenge did not verify.',
  'hop-signature': 'A delegation’s signature did not verify.',
  'issuer-signature': 'The root grant’s signature did not verify.',
  'issuer-not-party': 'The root’s issuer is not a party to the relationship.',
  validity: 'A credential is outside its validity window.',
  'root-anchoring': 'The root is not anchored to a controller relationship.',
  'challenge-binding': 'The presentation is not bound to this challenge and audience.',
  'presentation-shape': 'The presentation is malformed.',
};

function capChips(cap: Capability): string {
  const chip = (t: string, cls = '') => `<span class="chip ${cls}">${esc(t)}</span>`;
  return (
    cap.actions.map((a) => chip(a, 'act')).join('') +
    cap.resources.map((r) => chip(r.replace('res:', ''), 'res')).join('') +
    (cap.delegable ? chip('delegable', 'deleg') : '')
  );
}

/** A capability editor. Boxes not in `parent` are disabled — you can only narrow, never widen. */
function capEditor(prefix: string, parent?: Capability): string {
  const allow = (list: readonly string[], set?: readonly string[]) => list.filter((x) => !set || set.includes(x));
  const actionBoxes = ACTIONS.map((a) => {
    const on = parent ? parent.actions.includes(a) : a === 'read' || a === 'write';
    const disabled = parent && !parent.actions.includes(a);
    return `<label class="box ${disabled ? 'off' : ''}"><input type="checkbox" data-cap="${prefix}-action" value="${a}" ${on && !disabled ? 'checked' : ''} ${disabled ? 'disabled' : ''}/> ${a}</label>`;
  }).join('');
  const resBoxes = RESOURCES.map((r) => {
    const on = parent ? parent.resources.includes(r) : r === 'res:catalog' || r === 'res:orders';
    const disabled = parent && !parent.resources.includes(r);
    return `<label class="box ${disabled ? 'off' : ''}"><input type="checkbox" data-cap="${prefix}-resource" value="${r}" ${on && !disabled ? 'checked' : ''} ${disabled ? 'disabled' : ''}/> ${r.replace('res:', '')}</label>`;
  }).join('');
  void allow;
  return `
    <div class="editor">
      <div class="field"><span class="label">Actions</span><div class="boxes">${actionBoxes}</div></div>
      <div class="field"><span class="label">Resources</span><div class="boxes">${resBoxes}</div></div>
      <label class="box"><input type="checkbox" data-cap="${prefix}-delegable" ${parent ? '' : 'checked'} /> may delegate further</label>
    </div>`;
}

function readCap(prefix: string): Capability {
  const vals = (kind: string) =>
    [...app.querySelectorAll<HTMLInputElement>(`input[data-cap="${prefix}-${kind}"]:checked`)].map((i) => i.value);
  const delegable = (app.querySelector<HTMLInputElement>(`input[data-cap="${prefix}-delegable"]`))?.checked ?? false;
  return { actions: vals('action'), resources: vals('resource'), constraints: { audience: [AUDIENCE] }, delegable };
}

function agentOptions(exclude: string[] = []): string {
  return engine.actors
    .filter((a) => a.role === 'agent' && !exclude.includes(a.id))
    .map((a) => `<option value="${a.id}">${esc(a.name)}</option>`)
    .join('');
}

function render(): void {
  const controller = engine.controllerId ? engine.actor(engine.controllerId) : undefined;
  const agents = engine.actors.filter((a) => a.role === 'agent');
  const leaf = engine.leaf();
  const delegateFrom = engine.canDelegateFrom();

  app.innerHTML = `
  <header class="topbar">
    <div class="brand">
      <span class="mark">◈</span>
      <div><h1>Sigil</h1><p>verifiable agent identity — interactive demo</p></div>
    </div>
    <div class="mode">
      <div class="seg">
        <button data-action="mode-offline" class="${engine.mode === 'offline' ? 'on' : ''}">Offline (simulated)</button>
        <button data-action="mode-live" class="${engine.mode === 'live' ? 'on' : ''}">Live node</button>
      </div>
      ${engine.mode === 'live' || notice === 'live-form'
        ? `<div class="liverow"><input id="nodeUrl" type="text" value="${esc(engine.nodeUrl)}" spellcheck="false" />
             <button data-action="connect" class="ghost">Connect</button></div>`
        : ''}
      ${engine.liveError ? `<p class="err">Live node unreachable (${esc(engine.liveError)}). Staying offline.</p>` : ''}
    </div>
  </header>

  <main class="grid ${busy ? 'busy' : ''}">
    <section class="card cast">
      <h2>1 · Cast</h2>
      <p class="hint">A principal and its agents. Each is its own <code>did:cid</code>, minted just now.</p>
      <ul class="actors">
        ${controller ? actorRow(controller) : `<li class="muted">No controller yet — issue a grant to create one.</li>`}
        ${agents.map(actorRow).join('') || (controller ? '' : '')}
      </ul>
      <button data-action="add-agent" class="ghost">+ Add agent</button>
      <button data-action="scenario" class="link">Load a 2-hop scenario</button>
    </section>

    <section class="card grant">
      <h2>2 · Grant &amp; delegate</h2>
      ${agents.length === 0
        ? `<p class="hint">Add an agent first.</p>`
        : engine.chain.length === 0
          ? `<div class="form">
               <p class="hint"><strong>${esc(controller?.name ?? 'The controller')}</strong> issues a root authorization to an agent (and a DTG relationship binding it).</p>
               <label class="label">To</label><select id="rootSubject">${agentOptions()}</select>
               ${capEditor('root')}
               <button data-action="issue-root" class="primary">Issue root grant</button>
             </div>`
          : delegateFrom
            ? `<div class="form">
                 <p class="hint"><strong>${esc(delegateFrom.name)}</strong> delegates a <em>narrowed</em> slice of its authority. Greyed boxes are outside the parent — you can only narrow.</p>
                 <label class="label">To</label><select id="delSubject">${agentOptions([delegateFrom.id])}</select>
                 ${capEditor('del', leaf!.cap)}
                 <button data-action="delegate" class="primary">Delegate</button>
               </div>`
            : `<p class="hint">The chain’s leaf can’t delegate further (its capability isn’t <code>delegable</code>, or it was revoked). Verify it below, or load a new scenario.</p>`}
    </section>

    <section class="card chain">
      <h2>3 · The delegation chain</h2>
      ${engine.chain.length === 0
        ? `<p class="muted">Nothing issued yet.</p>`
        : `<div class="diagramwrap">${chainDiagram()}</div>
           <p class="hint">Authority flows left → right, only narrowing. The verifier walks it <strong>root → leaf</strong> from the presented credentials alone — no delegator is contacted.</p>`}
    </section>

    <section class="card verify">
      <h2>4 · Present &amp; verify</h2>
      ${engine.chain.length === 0
        ? `<p class="muted">Issue a grant first.</p>`
        : `<p class="hint"><strong>${esc(engine.leafSubject()?.name ?? '')}</strong> presents the chain and asks to perform an action. Trust is decided from signatures + DID resolution alone.</p>
           <div class="askrow">
             <span>do</span>
             <select id="vAction">${ACTIONS.map((a) => `<option ${a === vAction ? 'selected' : ''}>${a}</option>`).join('')}</select>
             <span>on</span>
             <select id="vResource">${RESOURCES.map((r) => `<option value="${r}" ${r === vResource ? 'selected' : ''}>${r.replace('res:', '')}</option>`).join('')}</select>
             <span>for</span>
             <select id="vAudience"><option value="${AUDIENCE}" ${vAudience === AUDIENCE ? 'selected' : ''}>the vendor</option><option value="did:web:someone-else.example" ${vAudience !== AUDIENCE ? 'selected' : ''}>a different verifier</option></select>
             <button data-action="verify" class="primary">Present &amp; verify</button>
           </div>
           ${isHighConsequence(vAction)
             ? `<div class="stepup"><span class="hc">⚠ high-consequence</span> requires a human co-sign —
                  <label class="box"><input type="checkbox" id="coSignToggle" ${coSignOn ? 'checked' : ''}/> co-sign as <strong>${esc(engine.controllerId ? engine.actor(engine.controllerId).name : 'the principal')}</strong> (Signet step-up)</label></div>`
             : ''}
           ${lastVerify ? renderOutcome(lastVerify) : ''}
           ${log.length ? `<ul class="log">${log.map((e) => `<li class="${e.ok ? 'ok' : 'deny'}"><span class="tag">${e.ok ? 'ACCEPT' : 'DENY'}</span> ${esc(e.title)} <span class="ts">${esc(e.ts)}</span></li>`).join('')}</ul>` : ''}`}
    </section>
  </main>

  <footer class="foot">
    <span>${engine.mode === 'offline' ? 'Running the real verifier + issuer in your browser against a simulated gatekeeper.' : `Live: ${esc(engine.nodeUrl)}`}</span>
    <span>Sigil reference implementation · <code>verifyPresentation</code></span>
  </footer>`;
}

function actorRow(a: { name: string; role: string; did: string }): string {
  return `<li class="actor"><span class="role ${a.role}">${a.role === 'controller' ? 'controller' : 'agent'}</span>
    <span class="name">${esc(a.name)}</span><code class="did">${esc(short(a.did))}</code></li>`;
}

/** A dynamic SVG diagram of the chain: actor nodes left→right, the VRC anchoring the root, scope on each hop
 *  (shrinking as it narrows), revoked hops in red, the leaf as the presenter (tinted by the last verify). */
function chainDiagram(): string {
  const chain = engine.chain;
  const nodes = chain.length + 1;
  const PAD = 14, NODE_W = 120, NODE_H = 50, EDGE = 148, STEP = NODE_W + EDGE;
  const NODE_Y = 60, NODE_CY = NODE_Y + NODE_H / 2, LABEL_Y = 2, LABEL_H = 54, VRC_Y = 126, HEIGHT = 176;
  const WIDTH = PAD * 2 + nodes * NODE_W + (nodes - 1) * EDGE;
  const nodeX = (i: number) => PAD + i * STEP;
  const actorAt = (i: number) => (i === 0 ? engine.actor(engine.controllerId) : engine.actor(chain[i - 1]!.subjectId));
  const xn = 'xmlns="http://www.w3.org/1999/xhtml"';

  let g = '';
  for (let i = 0; i < nodes; i++) {
    const a = actorAt(i);
    const isLeaf = i === nodes - 1;
    const tint = isLeaf && lastVerify ? (lastVerify.result.ok ? 'ok' : 'deny') : '';
    g += `<foreignObject x="${nodeX(i)}" y="${NODE_Y}" width="${NODE_W}" height="${NODE_H}">
      <div ${xn} class="node ${a.role} ${isLeaf ? 'leaf' : ''} ${tint}">
        <span class="nrole">${a.role === 'controller' ? 'controller' : isLeaf ? 'presenter' : 'agent'}</span>
        <span class="nname">${esc(a.name)}</span>
      </div></foreignObject>`;
  }
  for (let k = 0; k < chain.length; k++) {
    const h = chain[k]!;
    const x1 = nodeX(k) + NODE_W, x2 = nodeX(k + 1);
    const rev = h.revoked ? 'revoked' : '';
    g += `<line x1="${x1}" y1="${NODE_CY}" x2="${x2}" y2="${NODE_CY}" class="wire ${rev}" marker-end="url(#${h.revoked ? 'arrowRev' : 'arrow'})"/>`;
    g += `<foreignObject x="${x1 + 4}" y="${LABEL_Y}" width="${EDGE - 8}" height="${LABEL_H}">
      <div ${xn} class="elabel">
        <span class="tier">${k === 0 ? 'root grant' : `delegation ${k}`}</span>
        <div class="echips">${capChips(h.cap)}</div>
        ${h.revoked ? '<span class="revtag">revoked</span>' : `<button data-action="revoke:${k}" class="erevoke">revoke</button>`}
      </div></foreignObject>`;
  }
  const midX = nodeX(0) + NODE_W + EDGE / 2;
  g += `<line x1="${midX}" y1="${NODE_CY}" x2="${midX}" y2="${VRC_Y}" class="anchor"/>
    <foreignObject x="${midX - 56}" y="${VRC_Y}" width="112" height="36"><div ${xn} class="vrc">VRC · control edge</div></foreignObject>`;

  return `<svg viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH}" height="${HEIGHT}" class="diagram" role="img" aria-label="delegation chain">
    <defs>
      <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" class="ah"/></marker>
      <marker id="arrowRev" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" class="ah rev"/></marker>
    </defs>${g}
  </svg>`;
}

function resultBanner(r: VerifyResult): string {
  if (r.ok) return `<div class="banner ok"><span class="big">ACCEPT</span><span>assurance: <strong>${esc(r.assuranceLevel ?? '')}</strong></span></div>`;
  return `<div class="banner deny"><span class="big">DENY</span><span><code>${esc(r.reason ?? '')}</code> — ${esc(REASON[r.reason ?? ''] ?? 'denied')}</span></div>`;
}

const PURPOSE: Record<TraceEntry['purpose'], string> = {
  key: 'public key @ signing version',
  liveness: 'liveness (now)',
  status: 'revocation status (now)',
};

function renderOutcome(o: VerifyOutcome): string {
  return resultBanner(o.result) + tracePanel(o.trace) + `
    <div class="jsonwrap">
      <button data-action="toggle-json" class="link">${showJson ? 'hide' : 'view'} the signed presentation (VP)</button>
      ${showJson ? `<pre class="json">${esc(JSON.stringify(o.presentation, null, 2))}</pre>` : ''}
    </div>`;
}

function tracePanel(trace: TraceEntry[]): string {
  return `
    <div class="trace">
      <div class="tracehead"><strong>${trace.length}</strong> resolveDID ${trace.length === 1 ? 'lookup' : 'lookups'} · <span class="zero">0 delegators contacted for approval</span></div>
      <ol>${trace.map((t) => `<li><code>resolveDID</code> <span class="who">${esc(t.label)}</span> <span class="purpose ${t.purpose}">${PURPOSE[t.purpose]}</span></li>`).join('')}</ol>
      <p class="hint">Every step is a read-only resolution against the gatekeeper (operation-log replay). A delegator's DID is resolved for its <em>public key</em> — it is never asked to approve; its past signature <em>is</em> the trust. That is the offline (R8) property.</p>
    </div>`;
}

// ── actions ────────────────────────────────────────────────────────────────
async function run(fn: () => Promise<void>): Promise<void> {
  busy = true; render();
  try { await fn(); }
  catch (e) { notice = null; lastVerify = null; alert(e instanceof Error ? e.message : String(e)); }
  finally { busy = false; render(); }
}

app.addEventListener('click', (ev) => {
  const el = (ev.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
  if (!el) return;
  const action = el.dataset.action!;

  if (action === 'toggle-json') { showJson = !showJson; render(); return; }
  if (action === 'mode-offline') return void run(async () => { await engine.setOffline(); lastVerify = null; showJson = false; log = []; notice = null; });
  if (action === 'mode-live') { notice = 'live-form'; engine.mode = 'live'; render(); return; }
  if (action === 'connect') {
    const url = (document.getElementById('nodeUrl') as HTMLInputElement)?.value.trim();
    return void run(async () => { await engine.setLive(url); lastVerify = null; showJson = false; log = []; notice = engine.mode === 'live' ? null : 'live-form'; });
  }
  if (action === 'add-agent') return void run(() => engine.addAgent().then(() => {}));
  if (action === 'issue-root') {
    const subjectId = (document.getElementById('rootSubject') as HTMLSelectElement)?.value;
    const cap = readCap('root');
    return void run(() => engine.issueRoot(subjectId, cap));
  }
  if (action === 'delegate') {
    const subjectId = (document.getElementById('delSubject') as HTMLSelectElement)?.value;
    const cap = readCap('del');
    return void run(async () => {
      if (!subjectId) { await engine.addAgent(); }
      const sid = subjectId || engine.actors.filter((a) => a.role === 'agent').at(-1)!.id;
      await engine.delegate(sid, cap);
    });
  }
  if (action.startsWith('revoke:')) {
    const i = Number(action.split(':')[1]);
    return void run(() => engine.revokeHop(i).then(() => { lastVerify = null; showJson = false; }));
  }
  if (action === 'verify') {
    return void run(async () => {
      const res = await engine.verify(vAction, vResource, vAudience, { coSign: coSignOn });
      lastVerify = res; showJson = false;
      const rr = res.result;
      const cs = isHighConsequence(vAction) && coSignOn ? ' + co-sign' : '';
      log = [{ ok: rr.ok, title: `${vAction}${cs} ${vResource.replace('res:', '')} ${vAudience === AUDIENCE ? '(vendor)' : '(other verifier)'}${rr.ok ? '' : ` — ${rr.reason}`}`, detail: rr.reason ?? '', ts: new Date().toLocaleTimeString() }, ...log].slice(0, 8);
    });
  }
  if (action === 'scenario') return void run(loadScenario);
});

app.addEventListener('change', (ev) => {
  const el = ev.target as HTMLElement;
  if (el.id === 'vAction') { vAction = (el as HTMLSelectElement).value; coSignOn = false; render(); } // re-approve per action
  else if (el.id === 'vResource') { vResource = (el as HTMLSelectElement).value; }
  else if (el.id === 'vAudience') { vAudience = (el as HTMLSelectElement).value; }
  else if (el.id === 'coSignToggle') { coSignOn = (el as HTMLInputElement).checked; }
});

async function loadScenario(): Promise<void> {
  engine.reset(); lastVerify = null; showJson = false; log = [];
  await engine.ensureController();
  const a = await engine.addAgent();
  await engine.addAgent();
  await engine.issueRoot(a.id, { actions: ['read', 'write', 'delete'], resources: ['res:catalog', 'res:orders'], constraints: { audience: [AUDIENCE] }, delegable: true });
  await engine.delegate(engine.actors.filter((x) => x.role === 'agent').at(-1)!.id, { actions: ['read', 'delete'], resources: ['res:catalog'], constraints: { audience: [AUDIENCE] }, delegable: false });
}

render();
