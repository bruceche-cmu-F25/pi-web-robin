import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("scopes output tracing and allows configured remote dev hosts", async () => {
  const previousAllowedHosts = process.env.PI_WEB_ALLOWED_HOSTS;
  process.env.PI_WEB_ALLOWED_HOSTS = "pi-web.example.ts.net, second.example.ts.net ";

  try {
    const config = await createJiti(import.meta.url).import("../next.config.ts", { default: true });

    assert.equal(config.outputFileTracingRoot, projectRoot);
    assert.deepEqual(config.allowedDevOrigins, [
      "127.0.0.1",
      "192.168.*.*",
      "pi-web.example.ts.net",
      "second.example.ts.net",
    ]);
  } finally {
    if (previousAllowedHosts === undefined) delete process.env.PI_WEB_ALLOWED_HOSTS;
    else process.env.PI_WEB_ALLOWED_HOSTS = previousAllowedHosts;
  }
});
