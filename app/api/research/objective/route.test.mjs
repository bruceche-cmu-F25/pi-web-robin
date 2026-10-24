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
const { GET, PUT, PATCH } = await jiti.import("./route.ts");
const projectsRoute = await jiti.import("../projects/route.ts");
const { readResearchObjective } = await jiti.import("../../../../extension/robin/research-domain.ts");

after(async () => {
  if (previousDataDir === undefined) delete process.env.ROBIN_DATA_DIR;
  else process.env.ROBIN_DATA_DIR = previousDataDir;
  await rm(dataDir, { recursive: true, force: true });
});

function request(method = "GET", body, contentType = "application/json") {
  if (method === "PUT" && body && typeof body === "object") body = { revision: readResearchObjective().revision, ...body };
  return new Request("http://localhost/api/research/objective", {
    method,
    headers: { Host: "localhost", ...(body === undefined ? {} : { "Content-Type": contentType }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

test("research objective and note are persisted on the server", async () => {
  let response = await GET(request());
  assert.equal(response.status, 200);
  const empty = await response.json();
  assert.deepEqual(empty, { objective: "", note: "", updatedAt: null, revision: readResearchObjective().revision });

  response = await PUT(request("PUT", { objective: "Finish the HEAT baseline", note: "Ask Samuel about the labels" }));
  assert.equal(response.status, 200);
  assert.deepEqual(
    Object.fromEntries(Object.entries(await response.json()).filter(([key]) => key !== "updatedAt" && key !== "revision")),
    { objective: "Finish the HEAT baseline", note: "Ask Samuel about the labels" },
  );

  response = await GET(request());
  const stored = await response.json();
  assert.equal(stored.objective, "Finish the HEAT baseline");
  assert.equal(stored.note, "Ask Samuel about the labels");
  const projects = JSON.parse(await readFile(join(dataDir, "research-projects.json"), "utf8"));
  assert.equal(projects.projects.length, 1, "the first write creates a general project");
  assert.equal(projects.projects[0].objective, "Finish the HEAT baseline");
  assert.equal(projects.projects[0].note, "Ask Samuel about the labels");
});

test("each project keeps its own focus and notebook; unknown projects are refused", async () => {
  const create = (name) => projectsRoute.POST(request("POST", { name, brief: `${name} brief` }));
  const first = (await (await create("Alpha")).json()).project;
  const second = (await (await create("Beta")).json()).project;
  const url = (id) => `http://localhost/api/research/objective?project=${id}`;
  const at = (method, id, body) => new Request(url(id), { method, headers: { Host: "localhost", "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(method === "PUT" ? { revision: readResearchObjective(id).revision, ...body } : body) } : {}) });
  await PUT(at("PUT", first.id, { objective: "Alpha focus", note: "" }));
  await PATCH(at("PATCH", second.id, { text: "Beta insight" }));
  assert.equal((await (await GET(at("GET", first.id))).json()).objective, "Alpha focus");
  assert.equal((await (await GET(at("GET", second.id))).json()).note, "Beta insight");
  assert.equal((await (await GET(at("GET", first.id))).json()).note, "");
  assert.equal((await GET(at("GET", "missing"))).status, 404);
  const listed = await (await projectsRoute.GET(request())).json();
  assert.equal(listed.activeId, second.id);
  assert.ok(listed.projects.every((project) => !("note" in project)), "listing omits notebook bodies");
  assert.equal((await projectsRoute.PUT(request("PUT", { activeId: first.id }))).status, 200);
  assert.equal((await (await GET(request())).json()).objective, "Alpha focus", "no ?project= reads the current project");
  assert.equal((await projectsRoute.POST(request("POST", { name: "" }))).status, 400);
  assert.equal((await projectsRoute.PATCH(request("PATCH", { id: first.id, patch: { links: [{ title: "x", url: "file:///etc/passwd" }] } }))).status, 400);
  await PUT(at("PUT", first.id, { objective: "", note: "" }));
  await projectsRoute.PUT(request("PUT", { activeId: (listed.projects.find((project) => project.name === "Research")).id }));
});

test("capturing an answer appends to the latest notes, preserves the goal and safely retries", async () => {
  await PUT(request("PUT", { objective: "Latest goal", note: "A note edited in another tab\n" }));
  const capture = () => PATCH(request("PATCH", { text: "An evidence-linked takeaway", objective: "Must not replace", note: "Must not replace" }));
  const first = await (await capture()).json();
  assert.equal(first.objective, "Latest goal");
  assert.equal(first.note, "A note edited in another tab\n\n\nAn evidence-linked takeaway");
  assert.deepEqual(await (await capture()).json(), first);
  const denied = await PATCH(new Request("http://localhost/api/research/objective", { method: "PATCH", headers: { Host: "localhost", Origin: "https://evil.invalid", "Content-Type": "application/json" }, body: JSON.stringify({ text: "intrusion" }) }));
  assert.equal(denied.status, 403);
  assert.deepEqual(await (await GET(request())).json(), first);
});

test("capture refuses invalid or over-limit appends without modifying the notebook", async () => {
  assert.equal((await PATCH(request("PATCH", { text: "" }))).status, 400);
  assert.equal((await PATCH(request("PATCH", null))).status, 400);
  assert.equal((await PATCH(request("PATCH", { text: "x" }, "text/plain"))).status, 415);
  assert.equal((await PATCH(request("PATCH", { text: "x".repeat(420_001) }))).status, 413);
  await PUT(request("PUT", { objective: "Keep this", note: "n".repeat(100_000) }));
  assert.equal((await PATCH(request("PATCH", { text: "Extra insight" }))).status, 413);
  assert.equal((await (await GET(request())).json()).note.length, 100_000);
});

test("stale and unversioned PUTs return 409 after an append without changing the notebook", async () => {
  await PUT(request("PUT", { note: "Original" }));
  const stale = await (await GET(request())).json();
  const kept = await (await PATCH(request("PATCH", { text: "Newly kept answer" }))).json();
  const response = await PUT(request("PUT", { ...stale, objective: "New focus" }));
  assert.equal(response.status, 409);
  assert.deepEqual(await (await GET(request())).json(), kept);
  assert.equal((await PUT(request("PUT", { objective: "Unversioned", revision: undefined }))).status, 409);
  assert.equal((await PUT(request("PUT", { objective: "New focus", revision: kept.revision }))).status, 200);
  assert.equal((await (await GET(request())).json()).note, kept.note);
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
