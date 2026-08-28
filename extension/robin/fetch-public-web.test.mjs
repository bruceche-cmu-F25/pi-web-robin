import assert from "node:assert/strict";
import { test } from "node:test";
import { isPublicWebAddress } from "./fetch-public-web.ts";

test("DNS results must be globally routable before a public-web connection opens", () => {
  for (const address of ["127.0.0.1", "10.0.0.5", "169.254.169.254", "192.168.1.1", "198.51.100.2"]) {
    assert.equal(isPublicWebAddress(address, 4), false, address);
  }
  for (const address of ["::1", "::ffff:127.0.0.1", "fc00::1", "fe80::1", "2001:db8::1"]) {
    assert.equal(isPublicWebAddress(address, 6), false, address);
  }
  assert.equal(isPublicWebAddress("8.8.8.8", 4), true);
  assert.equal(isPublicWebAddress("2606:4700:4700::1111", 6), true);
});
