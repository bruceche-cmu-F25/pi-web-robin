import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJiti } from 'jiti';
import { learningGraphCatalog, learningGraphNote, parseLearningGraph } from './learning-graph-domain.ts';
import { graphBounds, graphCut, graphEdgePath, graphTextLayout } from './learning-graph.ts';
const { GET } = await createJiti(import.meta.url, { tsconfigPaths: true }).import('../../app/api/robin/learning/graph/route.ts');
const root = mkdtempSync(join(tmpdir(), 'learning-graph-'));
const before = process.env.ROBIN_OBSIDIAN_CONFIG;
process.env.ROBIN_OBSIDIAN_CONFIG = join(root, 'registry.json');
const vault = join(root, 'Vault');
mkdirSync(join(vault, '.obsidian'), { recursive: true });
writeFileSync(process.env.ROBIN_OBSIDIAN_CONFIG, JSON.stringify({ vaults: { local: { path: vault } } }));
after(() => { rmSync(root, { recursive: true, force: true }); if (before === undefined) delete process.env.ROBIN_OBSIDIAN_CONFIG; else process.env.ROBIN_OBSIDIAN_CONFIG = before; });
const graph = { version: 1, id: 'test', title: 'Full Stack', source: 'https://roadmap.sh/full-stack', retrievedOn: '2026-10-24',
  nodes: [{ id: 'a', type: 'topic', label: 'Redis', x: -100, y: 0, width: 100, height: 40 },
    { id: 'b', type: 'subtopic', label: 'Redis', x: 200, y: 50, width: 100, height: 40 },
    { id: 'c', type: 'topic', label: 'Database', x: 0, y: 200, width: 100, height: 40 }],
  edges: [{ id: 'ab', source: 'a', target: 'b', sourceHandle: 'z2', targetHandle: 'y1', dashed: true }] };
const document = (g = graph) => `# Map\n\n\`\`\`roadmap-graph\n${JSON.stringify(g)}\n\`\`\`\n\n<!-- roadmap-node: a -->\n## Redis\n\nFirst explanation.\n\n\`\`\`html\n<!-- roadmap-node: b -->\n\`\`\`\n\n<!-- roadmap-node: c -->\n## Database\n\nSecond explanation.\n`;
writeFileSync(join(vault, '01 - Full Stack.roadmap.md'), document());
writeFileSync(join(vault, 'Unrelated.md'), '# Not a map');

test('keeps original identities, geometry and edges; only explicit markers associate content', () => {
  const parsed = parseLearningGraph(document());
  assert.equal(parsed.nodes.length, 3); assert.equal(parsed.edges.length, 1);
  assert.equal(parsed.nodes[0].x, -100); assert.equal(parsed.nodes[0].label, parsed.nodes[1].label);
  assert.match(parsed.nodes[0].content, /First explanation/); assert.equal(parsed.nodes[1].content, undefined);
  assert.equal(parsed.nodes[2].content, 'Second explanation.');
  assert.deepEqual(parseLearningGraph(document().replaceAll('\n', '\r\n')), parsed);
  assert.deepEqual(graphBounds(parsed), { left: -120, top: -20, width: 440, height: 280 });
  assert.equal(graphCut(parsed, parsed.nodes[0]), 102, 'expansion cannot cut the adjacent text box');
  assert.match(graphEdgePath(parsed.nodes[0], parsed.nodes[1], 'z2', 'y1'), /^M 0 20 C/);
});

test('paragraph text excludes embedded buttons and preceding nodes without changing the snapshot', () => {
  const node = (id, type, y, height, x = 0) => ({ id, type, label: id, x, y, width: 355, height });
  const source = { ...graph, nodes: [node('intro', 'paragraph', 0, 143), node('link', 'button', 82, 49),
    node('preceding', 'topic', 200, 49), node('explanation', 'paragraph', 239, 102),
    node('unrelated', 'topic', 10, 49, 500), node('section', 'section', 0, 500)] };
  const before = structuredClone(source);
  const layout = graphTextLayout(source);
  assert.deepEqual(layout.nodes.map(n => [n.id, n.y, n.height]), [
    ['intro', 0, 74], ['link', 82, 49], ['preceding', 200, 49], ['explanation', 257, 84],
    ['unrelated', 10, 49], ['section', 0, 500],
  ]);
  assert.deepEqual(source, before, 'display correction must never mutate Obsidian data');
  assert.equal(layout.edges, source.edges);
  assert.equal(graphCut(layout, layout.nodes[2]), 353, 'reader still clears the corrected paragraph');
});

test('rejects unsafe URLs, IDs, geometry, dangling edges and ambiguous documents', () => {
  for (const mutate of [g => g.nodes.push(g.nodes[0]), g => g.nodes[0].x = '12', g => g.nodes[0].width = -1,
    g => g.nodes[0].href = 'javascript:alert(1)', g => g.source = 'file:///secret', g => g.nodes[0].type = 'script',
    g => g.edges[0].target = 'missing', g => g.edges[0].sourceHandle = 'left', g => g.version = 2]) {
    const next = structuredClone(graph); mutate(next);
    assert.throws(() => parseLearningGraph(document(next)), e => e.status === 422);
  }
  for (const body of ['# No graph', document() + document(), document() + '\n<!-- roadmap-node: missing -->\nsecret', document() + '\n<!-- roadmap-node: a -->\nduplicate']) {
    assert.throws(() => parseLearningGraph(body), e => e.status === 422);
  }
});

test('catalog and reads use existing registered-vault bounds; refresh sees edits without writing', async () => {
  assert.deepEqual((await learningGraphCatalog('local')).notes.map(n => n.title), ['Full Stack']);
  const original = readFileSync(join(vault, '01 - Full Stack.roadmap.md'), 'utf8');
  assert.equal((await learningGraphNote('local', '01 - Full Stack.roadmap.md')).graph.nodes.length, 3);
  assert.equal(readFileSync(join(vault, '01 - Full Stack.roadmap.md'), 'utf8'), original);
  writeFileSync(join(vault, '01 - Full Stack.roadmap.md'), original.replace('First explanation.', 'Edited in Obsidian.'));
  assert.match((await learningGraphNote('local', '01 - Full Stack.roadmap.md')).graph.nodes[0].content, /Edited in Obsidian/);
  for (const path of ['../Other.roadmap.md', '.obsidian/private.roadmap.md', 'Unrelated.md', '/etc/passwd']) await assert.rejects(learningGraphNote('local', path));
  await assert.rejects(learningGraphCatalog('unknown'), e => e.status === 404);
  writeFileSync(join(root, 'outside.md'), document());
  symlinkSync(join(root, 'outside.md'), join(vault, 'Link.roadmap.md'));
  await assert.rejects(learningGraphNote('local', 'Link.roadmap.md'), e => e.status === 403);
  writeFileSync(join(vault, 'Large.roadmap.md'), 'x'.repeat(256 * 1024 + 1));
  await assert.rejects(learningGraphNote('local', 'Large.roadmap.md'), e => e.status === 413);
});

test('GET is origin-guarded, private/no-store and read-only', async () => {
  const req = (query, origin = 'http://localhost:30141') => new Request(`http://localhost:30141/api/robin/learning/graph${query}`, { headers: { host: 'localhost:30141', origin } });
  assert.equal((await GET(req(''))).status, 400);
  assert.equal((await GET(req('?vaultId=local', 'https://evil.test'))).status, 403);
  assert.equal((await GET(req('?vaultId=unknown'))).status, 404);
  const response = await GET(req('?vaultId=local&path=01%20-%20Full%20Stack.roadmap.md'));
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal((await response.json()).graph.id, 'test');
});
