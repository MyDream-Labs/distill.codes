#!/usr/bin/env node

import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const ownerOnlyMode = 0o600;
let temporaryRoot;

for (const [signal, code] of [
  ["SIGINT", 130],
  ["SIGTERM", 143]
]) {
  process.once(signal, () => {
    void cleanup().finally(() => process.exit(code));
  });
}

try {
  await main();
} catch (error) {
  console.error(`npx configuration smoke-test failed: ${safeMessage(error)}`);
  process.exitCode = 1;
}

async function main() {
  const packageJson = await readJson(join(root, "package.json"));
  const proxyInput = requireProxyInput();
  const expectedProxyURL = await normalizeProxyInput(proxyInput);
  const latestVersion = await readLatestVersion(packageJson.name);

  if (latestVersion !== packageJson.version) {
    fail(`npm latest is ${latestVersion}, expected ${packageJson.version}.`);
  }

  await verifyProxyBoundary(expectedProxyURL);
  temporaryRoot = await mkdtemp(join(tmpdir(), "distill-codes-npx-"));
  try {
    const paths = {
      workdir: join(temporaryRoot, "work"),
      home: join(temporaryRoot, "home"),
      cache: join(temporaryRoot, "npm-cache"),
      invalidHome: join(temporaryRoot, "invalid-home")
    };
    await Promise.all([mkdir(paths.workdir, { recursive: true }), mkdir(paths.home, { recursive: true }), mkdir(paths.cache, { recursive: true })]);

    const environment = isolatedEnvironment(paths.home, paths.cache);
    await verifyPublishedCli(packageJson.name, packageJson.version, paths.workdir, environment);
    await verifyUntrustedHostIsRejected(packageJson.name, paths.workdir, paths.invalidHome, paths.cache);
    await verifyConfigurationLifecycle(packageJson.name, proxyInput, expectedProxyURL, paths, environment);
  } finally {
    await cleanup();
  }

  console.log(`Verified npx ${packageJson.name}@latest (${packageJson.version}).`);
  console.log("npx configuration smoke-test passed.");
}

async function verifyProxyBoundary(proxyURL) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${proxyURL}/v1/messages`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "anthropic-version": "2023-06-01",
        "x-api-key": "invalid-provider-key"
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 1,
        system: "Distill.codes npx smoke-test.",
        messages: [{ role: "user", content: "ok" }]
      })
    });
    const body = await response.text();
    const proxyCode = readProxyErrorCode(body);
    if (proxyCode) {
      fail("proxy rejected the configured key or route.");
    }
    if (response.status < 400 || response.status >= 500) {
      fail("proxy did not reach the expected provider boundary.");
    }
    if (response.headers.get("x-distill-injection") !== "applied") {
      fail("proxy did not confirm Distill injection.");
    }
  } catch (error) {
    if (error?.name === "AbortError") {
      fail("proxy boundary check timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function verifyPublishedCli(packageName, version, cwd, env) {
  const versionResult = await runNpx(packageName, ["--version"], { cwd, env });
  expectSuccess("npx --version", versionResult);
  if (versionResult.stdout.trim() !== version) {
    fail("npx reported a version different from package.json.");
  }

  const helpResult = await runNpx(packageName, ["--help"], { cwd, env });
  expectSuccess("npx --help", helpResult);
  if (!helpResult.stdout.includes("distill-codes")) {
    fail("npx help did not render the distill-codes CLI.");
  }
}

async function verifyUntrustedHostIsRejected(packageName, cwd, home, cache) {
  const result = await runNpx(
    packageName,
    ["enable", "https://example.com/test-key-123/essential/anthropic"],
    { cwd, env: isolatedEnvironment(home, cache) }
  );
  if (result.code === 0) {
    fail("enable accepted an untrusted proxy host.");
  }
  if (await exists(join(home, ".claude", "settings.json")) || (await exists(join(home, ".claude", "settings.distill-codes-backup.json")))) {
    fail("untrusted proxy input wrote Claude settings.");
  }
}

async function verifyConfigurationLifecycle(packageName, proxyInput, expectedProxyURL, paths, env) {
  const settingsPath = join(paths.home, ".claude", "settings.json");
  const backupPath = join(paths.home, ".claude", "settings.distill-codes-backup.json");
  const originalSettings = {
    permissions: { allow: ["Bash(git status)"] },
    env: {
      ANTHROPIC_BASE_URL: "https://api.anthropic.com",
      KEEP_ME: "yes"
    }
  };

  await writeJson(settingsPath, originalSettings);

  const firstEnable = await runNpx(packageName, ["enable", proxyInput], { cwd: paths.workdir, env });
  expectSuccess("first enable", firstEnable);
  assertNoSecret("first enable output", firstEnable, proxyInput, expectedProxyURL);
  await assertEnabledState(settingsPath, backupPath, originalSettings, expectedProxyURL);

  const secondEnable = await runNpx(packageName, ["enable", proxyInput], { cwd: paths.workdir, env });
  expectSuccess("second enable", secondEnable);
  assertNoSecret("second enable output", secondEnable, proxyInput, expectedProxyURL);
  await assertEnabledState(settingsPath, backupPath, originalSettings, expectedProxyURL);

  const firstDisable = await runNpx(packageName, ["disable"], { cwd: paths.workdir, env });
  expectSuccess("first disable", firstDisable);
  await assertJsonEquals(settingsPath, originalSettings, "disable did not restore the original settings.");

  const beforeSecondDisable = await readFile(settingsPath, "utf8");
  const secondDisable = await runNpx(packageName, ["disable"], { cwd: paths.workdir, env });
  expectSuccess("second disable", secondDisable);
  if ((await readFile(settingsPath, "utf8")) !== beforeSecondDisable) {
    fail("second disable changed settings instead of being a no-op.");
  }

  const clearBaseURL = await runNpx(packageName, ["clear-base-url"], { cwd: paths.workdir, env });
  expectSuccess("clear-base-url", clearBaseURL);
  await assertJsonEquals(
    settingsPath,
    { permissions: originalSettings.permissions, env: { KEEP_ME: "yes" } },
    "clear-base-url removed unrelated settings."
  );
  await assertJsonEquals(backupPath, originalSettings, "clear-base-url did not retain the expected backup.");
}

async function assertEnabledState(settingsPath, backupPath, originalSettings, expectedProxyURL) {
  const settings = await readJson(settingsPath);
  if (settings.env?.ANTHROPIC_BASE_URL !== expectedProxyURL) {
    fail("enable did not write the expected normalized proxy URL.");
  }
  if (settings.env?.KEEP_ME !== "yes" || settings.permissions?.allow?.[0] !== "Bash(git status)") {
    fail("enable changed unrelated settings.");
  }
  await assertJsonEquals(backupPath, originalSettings, "enable did not preserve the original backup.");
  await assertOwnerOnly([settingsPath, backupPath]);
}

async function assertOwnerOnly(files) {
  if (process.platform === "win32") {
    return;
  }
  for (const file of files) {
    if (((await stat(file)).mode & 0o777) !== ownerOnlyMode) {
      fail("Claude settings files are not owner-restricted.");
    }
  }
}

async function normalizeProxyInput(value) {
  const { normalizeProxyInput: normalize } = await import("../src/proxy-url.js");
  return normalize(value);
}

async function readLatestVersion(packageName) {
  const result = await runCommand(npmCommand, ["view", `${packageName}@latest`, "version", "--json"], {
    env: environmentWithoutSecret()
  });
  expectSuccess("npm view latest", result);
  try {
    const version = JSON.parse(result.stdout);
    if (typeof version !== "string") {
      fail("npm view latest returned an invalid version.");
    }
    return version;
  } catch (error) {
    if (error?.message?.startsWith("npm view latest")) {
      throw error;
    }
    fail("npm view latest did not return JSON.");
  }
}

function requireProxyInput() {
  const value = process.env.DISTILL_PROXY_URL?.trim();
  if (!value) {
    fail("DISTILL_PROXY_URL must be set.");
  }
  return value;
}

function readProxyErrorCode(body) {
  try {
    const code = JSON.parse(body)?.error?.code;
    return [
      "invalid_key",
      "unsupported_proxy_path",
      "unsupported_prompt_profile",
      "access_check_unavailable",
      "access_check_failed"
    ].includes(code)
      ? code
      : "";
  } catch {
    return "";
  }
}

function isolatedEnvironment(home, cache) {
  return {
    ...environmentWithoutSecret(),
    HOME: home,
    USERPROFILE: home,
    npm_config_cache: cache,
    npm_config_update_notifier: "false",
    npm_config_fund: "false",
    npm_config_audit: "false"
  };
}

function environmentWithoutSecret() {
  const env = { ...process.env };
  delete env.DISTILL_PROXY_URL;
  return env;
}

async function runNpx(packageName, cliArgs, options) {
  return await runCommand(npxCommand, ["--yes", packageName, ...cliArgs], options);
}

async function runCommand(command, args, options = {}) {
  return await new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, options.timeoutMs ?? 120_000);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: 127, stdout, stderr: `${stderr}${error.message}\n`, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

async function writeJson(file, value) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { mode: ownerOnlyMode });
  if (process.platform !== "win32") {
    await chmod(file, ownerOnlyMode);
  }
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function assertJsonEquals(file, expected, message) {
  if (JSON.stringify(await readJson(file)) !== JSON.stringify(expected)) {
    fail(message);
  }
}

function assertNoSecret(label, result, ...secrets) {
  const output = `${result.stdout}${result.stderr}`;
  if (secrets.some((secret) => secret && output.includes(secret))) {
    fail(`${label} exposed the proxy input.`);
  }
}

function expectSuccess(label, result) {
  if (result.timedOut) {
    fail(`${label} timed out.`);
  }
  if (result.code !== 0) {
    fail(`${label} exited with status ${result.code}.`);
  }
}

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function cleanup() {
  if (!temporaryRoot) {
    return;
  }
  const target = temporaryRoot;
  temporaryRoot = undefined;
  await rm(target, { recursive: true, force: true });
}

function fail(message) {
  throw new Error(message);
}

function safeMessage(error) {
  return error instanceof Error ? error.message : "unexpected error";
}
