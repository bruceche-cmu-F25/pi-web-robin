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

test("research objective and note are persisted on the server", async () => {
  let response = await GET(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { objective: "", note: "", updatedAt: null });

  response = await PUT(request("PUT", { objective: "Finish the HEAT baseline", note: "Ask Samuel about the labels" }));
  assert.equal(response.status, 200);
  assert.deepEqual(
    Object.fromEntries(Object.entries(await response.json()).filter(([key]) => key !== "updatedAt")),
    { objective: "Finish the HEAT baseline", note: "Ask Samuel about the labels" },
  );

  response = await GET(request());
  const stored = await response.json();
  assert.equal(stored.objective, "Finish the HEAT baseline");
  assert.equal(stored.note, "Ask Samuel about the labels");
  assert.deepEqual(
    Object.fromEntries(Object.entries(JSON.parse(await readFile(join(dataDir, "research-objective.json"), "utf8"))).filter(([key]) => key !== "updatedAt")),
    { objective: "Finish the HEAT baseline", note: "Ask Samuel about the labels" },
  );
});

test("research notes reject invalid writes", async () => {
  let response = await PUT(request("PUT", { objective: 42 }));
  assert.equal(response.status, 400);

  response = await PUT(request("PUT", { objective: "x" }, "text/plain"));
  assert.equal(response.status, 415);

  response = await PUT(request("PUT", { objective: "x".repeat(10_001) }));
  assert.equal(response.status, 413);

  response = await PUT(request("PUT", { objective: "x", note: 42 }));
  assert.equal(response.status, 400);

  response = await PUT(request("PUT", { objective: "x", note: "x".repeat(100_001) }));
  assert.equal(response.status, 413);
});
