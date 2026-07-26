import test from "node:test";
import assert from "node:assert/strict";
import { isDistillProxyURL, normalizeProxyInput, redactProxyURL } from "../src/proxy-url.js";

test("normalizes raw key to production Anthropic URL", () => {
  assert.equal(
    normalizeProxyInput("iyEW3lwQMNOelKjepDvG4M"),
    "https://proxy.distill.codes/iyEW3lwQMNOelKjepDvG4M/essential/anthropic"
  );
});

test("normalizes full URL and copied config fragments", () => {
  assert.equal(
    normalizeProxyInput("https://dev-proxy.distill.codes/key123456/essential/anthropic/v1/messages?x=1"),
    "https://dev-proxy.distill.codes/key123456/essential/anthropic"
  );
  assert.equal(
    normalizeProxyInput('"env": { "ANTHROPIC_BASE_URL": "https://proxy.distill.codes/key123456/essential/anthropic" }'),
    "https://proxy.distill.codes/key123456/essential/anthropic"
  );
});

test("redacts proxy key", () => {
  assert.equal(
    redactProxyURL("https://proxy.distill.codes/secretkey123/essential/anthropic"),
    "https://proxy.distill.codes/<proxy-key>/essential/anthropic"
  );
});

test("distill URL detection requires distill.codes host", () => {
  assert.equal(isDistillProxyURL("https://proxy.distill.codes/key123456/essential/anthropic"), true);
  assert.equal(isDistillProxyURL("https://example.com/key123456/essential/anthropic"), false);
});
