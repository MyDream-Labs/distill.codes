import test from "node:test";
import assert from "node:assert/strict";
import { preflightProxy } from "../src/preflight.js";

test("preflight accepts provider boundary 4xx", async () => {
  const result = await preflightProxy("https://dev-proxy.distill.codes/key123456/essential/anthropic", {
    fetch: async (url, options) => {
      assert.equal(url, "https://dev-proxy.distill.codes/key123456/essential/anthropic/v1/messages");
      assert.equal(options.headers["anthropic-version"], "2023-06-01");
      return new Response(JSON.stringify({ error: { type: "authentication_error" } }), { status: 401 });
    }
  });

  assert.deepEqual(result, { ok: true, status: 401 });
});

test("preflight rejects own proxy errors", async () => {
  await assert.rejects(
    preflightProxy("https://proxy.distill.codes/key123456/essential/anthropic", {
      fetch: async () => new Response(JSON.stringify({ error: { code: "invalid_key", message: "Invalid or expired proxy key." } }), { status: 401 })
    }),
    /Proxy rejected the URL\/key/
  );
});

test("preflight rejects a non-Distill URL without fetching it", async () => {
  let fetchCalled = false;

  await assert.rejects(
    preflightProxy("https://attacker.example/key123456/essential/anthropic", {
      fetch: async () => {
        fetchCalled = true;
      }
    }),
    /distill\.codes host/
  );

  assert.equal(fetchCalled, false);
});
