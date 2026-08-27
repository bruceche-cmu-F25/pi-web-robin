import assert from "node:assert/strict";
import test from "node:test";
import { CAPABILITY_DOMAINS, CAPABILITY_NODES, CAPABILITY_ROLES } from "./capability-map.ts";
import { CAPABILITY_CLUSTERS, ROLE_STAGES } from "./capability-clusters.ts";

test("clusters partition every capability exactly once", () => {
  const assigned = CAPABILITY_CLUSTERS.flatMap((cluster) => cluster.nodeIds);
  assert.equal(assigned.length, CAPABILITY_NODES.length);
  assert.equal(new Set(assigned).size, assigned.length);
  assert.deepEqual(new Set(assigned), new Set(CAPABILITY_NODES.map((node) => node.id)));

  const domainByNode = new Map(CAPABILITY_NODES.map((node) => [node.id, node.domain]));
  for (const cluster of CAPABILITY_CLUSTERS) {
    assert.ok(cluster.nodeIds.length > 0);
    assert.ok(cluster.nodeIds.every((id) => domainByNode.get(id) === cluster.domain));
  }
});

test("each role roadmap orders every domain exactly once", () => {
  const domainIds = new Set(CAPABILITY_DOMAINS.map((domain) => domain.id));
  for (const role of CAPABILITY_ROLES) {
    const staged = ROLE_STAGES[role].flatMap((stage) => stage.domains);
    assert.equal(staged.length, domainIds.size);
    assert.deepEqual(new Set(staged), domainIds);
  }
});
