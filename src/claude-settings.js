import { constants } from "node:fs";
import { access, chmod, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { assertDistillProxyURL, isDistillProxyURL } from "./proxy-url.js";

export function claudePaths(home = homedir()) {
  const dir = join(home, ".claude");
  return {
    dir,
    settings: join(dir, "settings.json"),
    backup: join(dir, "settings.distill-codes-backup.json")
  };
}

export async function enableProxy(url, options = {}) {
  const proxyURL = assertDistillProxyURL(url).toString().replace(/\/$/, "");
  const paths = claudePaths(options.home);
  const settings = await readSettings(paths.settings);
  ensureEnvObject(settings, paths.settings);

  if (options.preflight) {
    await options.preflight(proxyURL);
  }

  await backupSettings(paths, settings);
  settings.env.ANTHROPIC_BASE_URL = proxyURL;
  await writeJSONAtomic(paths.settings, settings);
  return { settingsPath: paths.settings, backupPath: paths.backup, url: proxyURL };
}

export async function disableProxy(options = {}) {
  const paths = claudePaths(options.home);
  const settings = await readSettings(paths.settings);
  ensureEnvObject(settings, paths.settings, { create: false });

  const current = settings.env?.ANTHROPIC_BASE_URL;
  if (!isDistillProxyURL(current)) {
    return { changed: false, reason: current ? "non_distill_value" : "missing_value", settingsPath: paths.settings };
  }

  const backup = await readSettings(paths.backup, { missing: null });
  const previous = backup?.env?.ANTHROPIC_BASE_URL;
  if (previous && !isDistillProxyURL(previous)) {
    settings.env.ANTHROPIC_BASE_URL = previous;
  } else {
    delete settings.env.ANTHROPIC_BASE_URL;
  }
  removeEmptyEnv(settings);
  await writeJSONAtomic(paths.settings, settings);
  return { changed: true, restored: Boolean(previous && !isDistillProxyURL(previous)), settingsPath: paths.settings };
}

export async function clearBaseURL(options = {}) {
  const paths = claudePaths(options.home);
  const settings = await readSettings(paths.settings);
  ensureEnvObject(settings, paths.settings, { create: false });

  if (!settings.env?.ANTHROPIC_BASE_URL) {
    return { changed: false, reason: "missing_value", settingsPath: paths.settings };
  }

  await backupSettings(paths, settings, { overwrite: true });
  delete settings.env.ANTHROPIC_BASE_URL;
  removeEmptyEnv(settings);
  await writeJSONAtomic(paths.settings, settings);
  return { changed: true, settingsPath: paths.settings, backupPath: paths.backup };
}

export async function envForTemporarySettings(home = homedir()) {
  const settings = await readSettings(claudePaths(home).settings);
  ensureEnvObject(settings, claudePaths(home).settings, { create: false });
  return { ...(settings.env ?? {}) };
}

export async function writeTemporarySettings(file, env) {
  await writeJSONAtomic(file, { env }, 0o600);
}

export async function readSettings(file, options = {}) {
  try {
    const text = await readFile(file, "utf8");
    return JSON.parse(text);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return options.missing === null ? null : {};
    }
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON in ${file}. Fix it before changing Claude Code settings.`);
    }
    throw error;
  }
}

function ensureEnvObject(settings, file, options = {}) {
  if (settings.env === undefined) {
    if (options.create === false) {
      return;
    }
    settings.env = {};
    return;
  }
  if (!settings.env || typeof settings.env !== "object" || Array.isArray(settings.env)) {
    throw new Error(`Expected "env" in ${file} to be an object.`);
  }
}

async function backupSettings(paths, settings, options = {}) {
  await mkdir(paths.dir, { recursive: true });
  if (!options.overwrite && isDistillProxyURL(settings.env?.ANTHROPIC_BASE_URL) && (await exists(paths.backup))) {
    return;
  }
  await writeJSONAtomic(paths.backup, settings, 0o600);
}

async function writeJSONAtomic(file, value, fallbackMode = 0o600) {
  await mkdir(dirname(file), { recursive: true });
  const mode = await existingMode(file, fallbackMode);
  const temp = join(dirname(file), `.${basename(file)}.${process.pid}.${Date.now()}.tmp`);
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode });
  await chmod(temp, mode);
  await rename(temp, file);
}

async function existingMode(file, fallbackMode) {
  try {
    return (await stat(file)).mode & 0o777;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return fallbackMode;
    }
    throw error;
  }
}

async function exists(file) {
  try {
    await access(file, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function removeEmptyEnv(settings) {
  if (settings.env && Object.keys(settings.env).length === 0) {
    delete settings.env;
  }
}
