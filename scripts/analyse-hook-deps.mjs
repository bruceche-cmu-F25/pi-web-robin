/**
 * Where can a React hook be split — and where can it not?
 *
 * Builds a graph of one hook's state (useState / useRef / useReducer) against
 * its units (useCallback / effects / inner functions), joins two units whenever
 * they touch the same state, and reports the connected components. A hook that
 * comes back as one big component has no seam to split along, whatever its
 * return value looks like.
 *
 *   node scripts/analyse-hook-deps.mjs [path]
 *
 * Works on a component as well as a hook — anything whose state and logic sit
 * in one top-level function. A comma-separated second argument names extra
 * state to ignore, which is how you ask "would this group's removal split it?".
 *
 * Read-only. Written for hooks/useAgentSession.ts (see
 * docs/architecture-audit.md 2.1), but the analysis is not specific to it.
 */
import { readFileSync } from "node:fs";
const target = process.argv[2] ?? "hooks/useAgentSession.ts";
const src = readFileSync(target, "utf8");
const lines = src.split("\n");

// Only analyse the body of useAgentSession itself.
const start = lines.findIndex((l) => /^export (default )?function [A-Z_a-z]/.test(l));
const body = lines.slice(start);

// --- 1. declarations ---
const state = [];   // {name, setter, kind, line}
for (let i = 0; i < body.length; i++) {
  const l = body[i];
  let m = l.match(/const \[(\w+), (\w+)\] = useState[<(]/);
  if (m) { state.push({ name: m[1], setter: m[2], kind: "state", line: i }); continue; }
  m = l.match(/const \[(\w+), (\w+)\] = useReducer\(/);
  if (m) { state.push({ name: m[1], setter: m[2], kind: "reducer", line: i }); continue; }
  m = l.match(/const (\w+) = useRef[<(]/);
  if (m) { state.push({ name: m[1], setter: null, kind: "ref", line: i }); continue; }
}

// --- 2. units: each useCallback / useEffect / useMemo / useLayoutEffect block ---
const units = [];
for (let i = 0; i < body.length; i++) {
  const l = body[i];
  let name = null, kind = null;
  let m = l.match(/const (\w+) = useCallback\(/);
  if (m) { name = m[1]; kind = "callback"; }
  else if (/use(Layout)?Effect\(/.test(l)) { name = `effect@${i}`; kind = "effect"; }
  else if ((m = l.match(/const (\w+) = useMemo\(/))) { name = m[1]; kind = "memo"; }
  else if ((m = l.match(/^  (?:async )?function (\w+)\(/))) { name = m[1]; kind = "fn"; }
  if (!name) continue;
  // Block extent: to the matching closing at the same indent.
  const indent = l.match(/^\s*/)[0].length;
  let j = i + 1;
  while (j < body.length) {
    const t = body[j];
    if (t.trim() && (t.match(/^\s*/)[0].length <= indent) && /^\s*\}[),;]/.test(t)) break;
    j++;
  }
  units.push({ name, kind, from: i, to: j, text: body.slice(i, j + 1).join("\n") });
}

// --- 3. reads / writes per unit ---
const touch = new Map(); // state name -> {reads:Set, writes:Set}
for (const s of state) touch.set(s.name, { reads: new Set(), writes: new Set() });

for (const u of units) {
  for (const s of state) {
    const t = u.text;
    let wrote = false;
    if (s.setter && new RegExp(`\\b${s.setter}\\s*\\(`).test(t)) wrote = true;
    if (s.kind === "ref" && new RegExp(`\\b${s.name}\\.current\\s*=[^=]`).test(t)) wrote = true;
    // `(?<![.\w])` keeps a plain state name from matching a property access of
    // the same name — `lifecycleRef.current.agentRunning` is not a read of the
    // `agentRunning` useState.
    const readRe = s.kind === "ref"
      ? new RegExp(`(?<![.\\w])${s.name}\\.current\\b`)
      : new RegExp(`(?<![.\\w])${s.name}\\b`);
    const read = readRe.test(t);
    if (wrote) touch.get(s.name).writes.add(u.name);
    if (read && !(s.kind !== "ref" && !read)) touch.get(s.name).reads.add(u.name);
  }
}

// --- 4. report ---
const rows = state.map((s) => {
  const t = touch.get(s.name);
  return { ...s, reads: [...t.reads], writes: [...t.writes] };
});
console.log(`state: ${rows.filter(r=>r.kind==="state").length}  refs: ${rows.filter(r=>r.kind==="ref").length}  reducers: ${rows.filter(r=>r.kind==="reducer").length}`);
console.log(`units: ${units.length} (callbacks ${units.filter(u=>u.kind==="callback").length}, effects ${units.filter(u=>u.kind==="effect").length})`);

console.log("\n=== state touched by the MOST units (the coupling hotspots) ===");
rows.map(r => ({ n: r.name, k: r.kind, u: new Set([...r.reads, ...r.writes]).size, w: r.writes.length }))
  .sort((a, b) => b.u - a.u).slice(0, 22)
  .forEach(r => console.log(`  ${String(r.u).padStart(3)} units (${String(r.w).padStart(2)} write)  ${r.k.padEnd(7)} ${r.n}`));

console.log("\n=== state touched by exactly ONE unit (trivially separable) ===");
const solo = rows.filter(r => new Set([...r.reads, ...r.writes]).size <= 1);
console.log(`  ${solo.length} of ${rows.length}: ` + solo.map(r=>r.name).join(", "));

// --- 5. connected components over units linked by shared state ---
function components(ignore = new Set()) {
  const unitState = new Map(units.map(u => [u.name, new Set()]));
  for (const r of rows) {
    if (ignore.has(r.name)) continue;
    for (const u of new Set([...r.reads, ...r.writes])) unitState.get(u)?.add(r.name);
  }
  const parent = new Map(units.map(u => [u.name, u.name]));
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  const byState = new Map();
  for (const [u, ss] of unitState) for (const s of ss) {
    if (!byState.has(s)) byState.set(s, []);
    byState.get(s).push(u);
  }
  for (const us of byState.values()) for (let i = 1; i < us.length; i++) union(us[0], us[i]);
  const groups = new Map();
  for (const u of units) {
    const r = find(u.name);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(u.name);
  }
  return [...groups.values()].sort((a, b) => b.length - a.length);
}

console.log("\n=== components with ALL state ===");
let c = components();
console.log(`  ${c.length} component(s); sizes: ${c.map(g => g.length).join(", ")}`);

// The refs that touch nearly everything are plumbing, not domain coupling.
const plumbing = new Set([
  "sessionIdRef", "agentRunningRef", "error", "data", "sessionHookMountedRef", "sessionPropIdRef",
  // A second argument adds names to ignore, for asking "what if this group of
  // state were not here?" without editing the script.
  ...(process.argv[3] ?? "").split(",").map((n) => n.trim()).filter(Boolean),
]);
console.log("\n=== components after removing plumbing (sessionIdRef, agentRunningRef, error, data, mount/prop refs) ===");
c = components(plumbing);
console.log(`  ${c.length} component(s); sizes: ${c.map(g => g.length).join(", ")}`);
c.filter(g => g.length > 1).forEach((g, i) => {
  const st = new Set();
  for (const r of rows) if (!plumbing.has(r.name) && [...r.reads, ...r.writes].some(u => g.includes(u))) st.add(r.name);
  console.log(`\n  --- component ${i + 1}: ${g.length} units, ${st.size} state ---`);
  console.log(`      units: ${g.slice(0, 14).join(", ")}${g.length > 14 ? ` … (+${g.length - 14})` : ""}`);
  console.log(`      state: ${[...st].slice(0, 18).join(", ")}${st.size > 18 ? ` … (+${st.size - 18})` : ""}`);
});
const singles = c.filter(g => g.length === 1).flat();
console.log(`\n  ${singles.length} standalone unit(s): ${singles.slice(0, 20).join(", ")}`);

// --- 6. which state holds the big component together? ---
console.log("\n=== cut test: remove one more state var, does the 52-unit blob split? ===");
const base = new Set(plumbing);
const bigBefore = components(base)[0].length;
const cuts = [];
for (const r of rows) {
  if (base.has(r.name)) continue;
  const c2 = components(new Set([...base, r.name]));
  const big = c2[0].length;
  if (big < bigBefore) cuts.push({ name: r.name, kind: r.kind, big, freed: bigBefore - big });
}
cuts.sort((a, b) => b.freed - a.freed);
if (cuts.length === 0) console.log("  none — no single state variable is an articulation point.");
cuts.slice(0, 10).forEach(c => console.log(`  removing ${c.kind} ${c.name}: blob ${bigBefore} -> ${c.big}`));

// Greedy: keep cutting until the blob halves.
console.log("\n=== greedy cut: how many must go before the blob halves? ===");
const removed = new Set(base);
let cur = bigBefore;
for (let step = 0; step < 12 && cur > bigBefore / 2; step++) {
  let best = null;
  for (const r of rows) {
    if (removed.has(r.name)) continue;
    const big = components(new Set([...removed, r.name]))[0].length;
    if (!best || big < best.big) best = { name: r.name, kind: r.kind, big };
  }
  if (!best || best.big >= cur) { console.log("  no further progress"); break; }
  removed.add(best.name);
  console.log(`  cut ${(best.kind + " " + best.name).padEnd(28)} blob ${cur} -> ${best.big}`);
  cur = best.big;
}

// --- 7. hypothesis: the "is something running" concept is spread over N variables ---
const runLifecycle = [
  "agentRunning", "agentRunningRef", "bashRunning", "bashRunningRef", "pendingBash",
  "sdkAgentActiveRef", "rpcPromptPendingRef", "eventStreamGraceActiveRef",
  "promptRunIdRef", "notifiedPromptRunIdRef", "agentPhase", "streamState",
  "isCompacting", "loading",
];
const present = runLifecycle.filter((n) => rows.some((r) => r.name === n));
console.log(`\n=== "is something running" is spelled ${present.length} ways ===`);
console.log("  " + present.join(", "));

const perUnit = new Map();
for (const r of rows) {
  if (!present.includes(r.name)) continue;
  for (const u of new Set([...r.reads, ...r.writes])) {
    if (!perUnit.has(u)) perUnit.set(u, new Set());
    perUnit.get(u).add(r.name);
  }
}
const multi = [...perUnit].filter(([, s]) => s.size >= 2).sort((a, b) => b[1].size - a[1].size);
console.log(`\n  ${multi.length} of ${units.length} units juggle two or more of them at once:`);
multi.slice(0, 14).forEach(([u, s]) => console.log(`    ${String(s.size).padStart(2)}  ${u.padEnd(30)} ${[...s].join(", ")}`));

// What happens to the blob if the whole lifecycle were one value?
const collapsed = components(new Set([...plumbing, ...present]));
console.log(`\n  If the whole run lifecycle were ONE value, the blob would be: ${collapsed[0].length} units`);
console.log(`  (components: ${collapsed.map(g => g.length).join(", ")})`);
