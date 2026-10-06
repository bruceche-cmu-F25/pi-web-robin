import assert from "node:assert/strict";
import { test } from "node:test";
import { PiWebHttpError, piWeb } from "./pi-web.ts";

test("piWeb preserves a route's structured refusal for safe caller recovery", async () => {
  const fetch = async () => new Response(JSON.stringify({ error: "Delivery is busy", reason: "delivery-busy" }), {
    status: 409,
    headers: { "Content-Type": "application/json" },
  });
  await assert.rejects(
    () => piWeb({ url: "http://127.0.0.1:30141", fetch }, "/api/example", {}),
    error => error instanceof PiWebHttpError
      && error.status === 409
      && error.reason === "delivery-busy"
      && error.message === "Delivery is busy",
  );
});
