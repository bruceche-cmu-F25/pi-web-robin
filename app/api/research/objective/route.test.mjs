import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";

const previousDataDir = process.env.ROBIN_DATA_DIR;
const dataDir = await mkdtemp(join(tmpdir(), "pi-web-research-objective-"));
process.env.ROBIN_DATA_DIR = dataDir;

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { GET, PUT } = await jiti.import("./route.ts");

after(async () => {
  if (previousDataDir === undefined) delete process.env.ROBIN_DATA_DIR;
  else process.env.ROBIN_DATA_DIR = previousDataDir;
  await rm(dataDir, { recursive: true, force: true });
});

function request(method = "GET", body, contentType = "application/json") {
  return new Request("http://localhost/api/research/objective", {
    method,
    headers: { Host: "localhost", ...(body === undefined ? {} : { "Content-Type": contentType }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

test("weekly objective is persisted on the server and returned to another request", async () => {
  let response = await GET(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { objective: "", updatedAt: null });

  response = await PUT(request("PUT", { objective: "Finish the HEAT baseline" }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).objective, "Finish the HEAT baseline");

  response = await GET(request());
  assert.equal((await response.json()).objective, "Finish the HEAT baseline");
  assert.equal(
    JSON.parse(await readFile(join(dataDir, "research-objective.json"), "utf8")).objective,
    "Finish the HEAT baseline",
  );
});

test("weekly objective rejects invalid writes", async () => {
  let response = await PUT(request("PUT", { objective: 42 }));
  assert.equal(response.status, 400);

  response = await PUT(request("PUT", { objective: "x" }, "text/plain"));
  assert.equal(response.status, 415);

  response = await PUT(request("PUT", { objective: "x".repeat(10_001) }));
  assert.equal(response.status, 413);
});
