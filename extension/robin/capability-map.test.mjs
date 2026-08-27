import assert from "node:assert/strict";
import test from "node:test";
import {
  CAPABILITY_DOMAINS,
  CAPABILITY_NODES,
  CAPABILITY_ROLES,
  ROLE_PROFILES,
  demandFor,
} from "./capability-map.ts";

const ids = new Set(CAPABILITY_NODES.map((node) => node.id));

test("the atlas is a valid connected capability graph", () => {
  assert.equal(ids.size, CAPABILITY_NODES.length, "capability ids must be unique");
  assert.ok(CAPABILITY_NODES.length >= 55, "the map has collapsed into a topic list");

  const domainIds = new Set(CAPABILITY_DOMAINS.map((domain) => domain.id));
  for (const node of CAPABILITY_NODES) {
    assert.ok(domainIds.has(node.domain), `${node.id} has no continent`);
    for (const prerequisite of node.prerequisites) {
      assert.ok(ids.has(prerequisite), `${node.id} names missing prerequisite ${prerequisite}`);
      assert.notEqual(prerequisite, node.id, `${node.id} requires itself`);
    }
  }
});

test("prerequisites are acyclic", () => {
  const byId = new Map(CAPABILITY_NODES.map((node) => [node.id, node]));
  const visiting = new Set();
  const visited = new Set();

  const visit = (id) => {
    if (visiting.has(id)) assert.fail(`prerequisite cycle reaches ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const prerequisite of byId.get(id).prerequisites) visit(prerequisite);
    visiting.delete(id);
    visited.add(id);
  };

  for (const node of CAPABILITY_NODES) visit(node.id);
});

test("every node says what ownership looks like and how to prove it", () => {
  for (const node of CAPABILITY_NODES) {
    assert.ok(node.ability.length >= 20, `${node.id} needs an ability statement`);
    assert.ok(node.mastery.length >= 20, `${node.id} needs a real mastery bar`);
    assert.ok(node.proof.length >= 20, `${node.id} needs observable proof`);
    assert.ok(node.technologies.length >= 4, `${node.id} needs a technology surface`);
    assert.ok(CAPABILITY_ROLES.some((role) => demandFor(node, role)), `${node.id} maps to no role`);
  }
});

test("all five role lenses have a substantial core", () => {
  for (const role of CAPABILITY_ROLES) {
    assert.ok(ROLE_PROFILES[role], `${role} needs a role profile`);
    const relevant = CAPABILITY_NODES.filter((node) => demandFor(node, role));
    const core = CAPABILITY_NODES.filter((node) => demandFor(node, role) === "core");
    assert.ok(relevant.length >= 20, `${role} lens is too thin`);
    assert.ok(core.length >= 8, `${role} needs a defensible core`);
  }
});
