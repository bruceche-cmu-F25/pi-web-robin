import assert from "node:assert/strict";
import test from "node:test";
import { hermesHrefForHost } from "./hermes-navigation.ts";

test("Hermes is a separate, context-free origin on localhost or the same tailnet node", () => {
  for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
    assert.equal(hermesHrefForHost(host), "http://127.0.0.1:8788/");
  }
  assert.equal(hermesHrefForHost("mac.tail123.ts.net"), "https://mac.tail123.ts.net:8443/");
  assert.equal(hermesHrefForHost("MAC.tail123.ts.net"), "https://mac.tail123.ts.net:8443/");
  for (const host of ["evil.test", "mac.tail123.ts.net.evil.test", "user@mac.tail123.ts.net", "mac.tail123.ts.net/?session=secret", "192.168.1.2"]) {
    assert.equal(hermesHrefForHost(host), null);
  }
});
