import assert from "node:assert/strict";
import { test } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { NextResponse } = await jiti.import("next/server");
const { apiError, apiRoute, guardApiRequest } = await jiti.import("./api-route.ts");

const HOST = "localhost:30141";
const request = (method, { host = HOST, contentType = "application/json", origin } = {}) =>
  new Request("http://localhost:30141/api/robin/todos", {
    method,
    headers: {
      host,
      ...(contentType ? { "content-type": contentType } : {}),
      ...(origin ? { origin } : {}),
    },
    ...(method === "GET" || method === "HEAD" ? {} : { body: "{}" }),
  });

const ok = () => NextResponse.json({ ok: true });

test("a trusted request reaches the handler and its response is returned untouched", async () => {
  let seen = null;
  const route = apiRoute(async (req) => {
    seen = req.method;
    return NextResponse.json({ value: 1 }, { status: 201 });
  });
  const response = await route(request("POST"), undefined);
  assert.equal(seen, "POST");
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { value: 1 });
});

test("an untrusted origin is 403 and the handler never runs", async () => {
  let ran = false;
  const route = apiRoute(async () => { ran = true; return ok(); });
  const response = await route(request("POST", { origin: "https://evil.example" }), undefined);
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "Untrusted API request" });
  assert.equal(ran, false);
});

test("a write without a JSON content type is 415 — a cross-site form post must not reach it", async () => {
  for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
    const route = apiRoute(async () => ok());
    const response = await route(
      request(method, { contentType: "application/x-www-form-urlencoded" }),
      undefined,
    );
    assert.equal(response.status, 415, method);
  }
});

test("a read is not asked for a content type", async () => {
  const route = apiRoute(async () => ok());
  const response = await route(request("GET", { contentType: null }), undefined);
  assert.equal(response.status, 200);
});

test("json:true forces the check onto a read, json:false lifts it off a write", async () => {
  const strict = apiRoute(async () => ok(), { json: true });
  assert.equal((await strict(request("GET", { contentType: null }), undefined)).status, 415);

  const relaxed = apiRoute(async () => ok(), { json: false });
  assert.equal((await relaxed(request("POST", { contentType: null }), undefined)).status, 200);
});

test("a thrown error becomes the one error shape, 400 by default", async () => {
  const route = apiRoute(async () => { throw new Error("title is required"); });
  const response = await route(request("POST"), undefined);
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "title is required" });
});

test("a read that throws is the server's fault: 500 without being asked", async () => {
  const route = apiRoute(async () => { throw new Error("ENOENT"); });
  const response = await route(request("GET"), undefined);
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "ENOENT" });
});

test("errorStatus overrides the method default in both directions", async () => {
  const read = apiRoute(async () => { throw new Error("bad query"); }, { errorStatus: 400 });
  assert.equal((await read(request("GET"), undefined)).status, 400);

  const write = apiRoute(async () => { throw new Error("disk full"); }, { errorStatus: 500 });
  assert.equal((await write(request("POST"), undefined)).status, 500);
});

test("a thrown non-Error still yields a string message", async () => {
  const route = apiRoute(async () => { throw "plain string"; });
  assert.deepEqual(await (await route(request("POST"), undefined)).json(), { error: "plain string" });
});

test("a status the handler chose itself is left alone", async () => {
  const route = apiRoute(async () => NextResponse.json({ error: "No todo" }, { status: 404 }));
  const response = await route(request("PATCH"), undefined);
  assert.equal(response.status, 404);
});

test("the second argument reaches the handler, so a dynamic segment keeps its params", async () => {
  let seen = null;
  const route = apiRoute(async (_req, { params }) => {
    seen = await params;
    return ok();
  });
  await route(request("GET"), { params: Promise.resolve({ id: "abc" }) });
  assert.deepEqual(seen, { id: "abc" });
});

test("guardApiRequest is the same policy, for routes that cannot return JSON", () => {
  assert.equal(guardApiRequest(request("GET")), null);
  assert.equal(guardApiRequest(request("POST", { origin: "https://evil.example" }))?.status, 403);
  assert.equal(guardApiRequest(request("POST", { contentType: "text/plain" }), { json: true })?.status, 415);
});

test("apiError is the shape every route answers with", async () => {
  assert.deepEqual(await apiError(new Error("boom")).json(), { error: "boom" });
  assert.equal(apiError(new Error("boom"), 500).status, 500);
});
