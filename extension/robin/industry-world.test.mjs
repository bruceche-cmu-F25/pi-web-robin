import assert from "node:assert/strict";
import test from "node:test";
import { CAPABILITY_NODES, CAPABILITY_ROLES } from "./capability-map.ts";
import {
  INDUSTRY_CLUSTERS,
  INDUSTRY_DIAGRAMS,
  INDUSTRY_PILLARS,
  INDUSTRY_REFERENCES,
  ROADMAP_SH_COLLECTIONS,
  ROADMAP_SH_HOMEPAGE,
  UNDERSTANDING_LEVELS,
  targetUnderstanding,
} from "./industry-world.ts";

test("the industry world partitions every capability exactly once", () => {
  const capabilityIds = new Set(CAPABILITY_NODES.map((node) => node.id));
  const assigned = INDUSTRY_CLUSTERS.flatMap((cluster) => cluster.nodeIds);
  assert.equal(assigned.length, capabilityIds.size);
  assert.equal(new Set(assigned).size, assigned.length);
  assert.deepEqual(new Set(assigned), capabilityIds);

  const pillars = new Set(INDUSTRY_PILLARS.map((pillar) => pillar.id));
  assert.equal(pillars.size, INDUSTRY_PILLARS.length);
  assert.ok(INDUSTRY_CLUSTERS.every((cluster) => pillars.has(cluster.pillar)));
  assert.equal(INDUSTRY_PILLARS.filter((pillar) => pillar.region === "core").length, 6);
  assert.equal(INDUSTRY_PILLARS.filter((pillar) => pillar.region === "extension").length, 1);
});

test("understanding targets turn job demand into a bounded depth reference", () => {
  assert.deepEqual(UNDERSTANDING_LEVELS.map((item) => item.level), [0, 1, 2, 3, 4]);
  for (const node of CAPABILITY_NODES) {
    for (const role of CAPABILITY_ROLES) {
      const target = targetUnderstanding(node, role);
      assert.ok(target >= 0 && target <= 4);
      if (node.roles[role] === 3) assert.equal(target, 4);
    }
  }
});

test("the external reference shelf includes roadmap.sh and explicit reuse metadata", () => {
  const pillarIds = new Set(INDUSTRY_PILLARS.map((pillar) => pillar.id));
  const roadmap = INDUSTRY_REFERENCES.find((source) => source.label === "roadmap.sh");
  assert.equal(roadmap?.reuse, "link-only");
  assert.equal(roadmap?.url, ROADMAP_SH_HOMEPAGE);
  assert.ok(INDUSTRY_REFERENCES.some((source) => source.reuse === "CC-BY-4.0"));
  assert.ok(INDUSTRY_REFERENCES.every((source) => source.url.startsWith("https://")));
  assert.ok(INDUSTRY_REFERENCES.every((source) => source.pillarIds.every((id) => pillarIds.has(id))));
  assert.ok(INDUSTRY_DIAGRAMS.every((diagram) => diagram.author && diagram.license && diagram.modification));
});

test("roadmap.sh search cues cover every world pillar without prohibited deep links", () => {
  assert.deepEqual(new Set(ROADMAP_SH_COLLECTIONS.map((group) => group.pillarId)), new Set(INDUSTRY_PILLARS.map((pillar) => pillar.id)));
  assert.ok(ROADMAP_SH_COLLECTIONS.every((group) => group.roadmaps.length >= 3));
  assert.equal(new URL(ROADMAP_SH_HOMEPAGE).pathname, "/");
});
