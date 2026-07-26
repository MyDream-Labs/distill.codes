import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { preflightProxy } from "../src/preflight.js";

test("preflight accepts provider boundary 4xx", async () => {
  await withServer(async (request, response) => {
    assert.equal(request.url, "/key123456/essential/anthropic/v1/messages");
    assert.equal(request.headers["anthropic-version"], "2023-06-01");
    response.writeHead(401, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { type: "authentication_error" } }));
  }, async (baseURL) => {
    const result = await preflightProxy(`${baseURL}/key123456/essential/anthropic`);
    assert.deepEqual(result, { ok: true, status: 401 });
  });
});

test("preflight rejects own proxy errors", async () => {
  await withServer(async (_request, response) => {
    response.writeHead(401, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { code: "invalid_key", message: "Invalid or expired proxy key." } }));
  }, async (baseURL) => {
    await assert.rejects(
      preflightProxy(`${baseURL}/key123456/essential/anthropic`),
      /Proxy rejected the URL\/key/
    );
  });
});

async function withServer(handler, run) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}
