import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import nextTesting from "next/experimental/testing/server.js";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { config, proxy } = await jiti.import("../proxy.ts");
const { unstable_doesMiddlewareMatch } = nextTesting;

for (const url of ["/", "/coding", "/dashboard/jobs", "/api/robin/practice"]) {
  test(`proxy protects ${url}`, () => {
    assert.equal(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url }), true);
  });
}

for (const url of ["/_next/static/app.js", "/_next/image", "/fonts/app.woff2", "/icons/icon.png", "/sw.js"]) {
  test(`proxy skips public asset ${url}`, () => {
    assert.equal(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url }), false);
  });
}

function request(path) {
  const url = new URL(path, "http://127.0.0.1:30141");
  return Object.assign(new Request(url, { headers: { host: url.host } }), { nextUrl: url });
}

test("only document authentication failures trigger a blocking Basic prompt", async () => {
  const previous = process.env.PI_WEB_PASSWORD;
  process.env.PI_WEB_PASSWORD = "secret";
  try {
    const apiResponse = proxy(request("/api/robin/practice"));
    assert.equal(apiResponse.status, 401);
    assert.equal(apiResponse.headers.get("www-authenticate"), null);
    assert.deepEqual(await apiResponse.json(), { error: "Authentication required" });

    const pageResponse = proxy(request("/coding"));
    assert.equal(pageResponse.status, 401);
    assert.match(pageResponse.headers.get("www-authenticate"), /^Basic /);
  } finally {
    if (previous === undefined) delete process.env.PI_WEB_PASSWORD;
    else process.env.PI_WEB_PASSWORD = previous;
  }
});
