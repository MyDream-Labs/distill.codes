const PROD_PROXY_BASE_URL = "https://proxy.distill.codes";
const RAW_KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

export function normalizeProxyInput(input) {
  const value = String(input ?? "").trim();
  if (!value) {
    throw new Error("Pass your Distill.codes proxy key or Claude config URL.");
  }

  if (RAW_KEY_PATTERN.test(value)) {
    return `${PROD_PROXY_BASE_URL}/${encodeURIComponent(value)}/essential/anthropic`;
  }

  const candidate = extractProxyURL(value);
  if (!candidate) {
    throw new Error("Could not find a Distill.codes Anthropic proxy URL in the input.");
  }

  const url = new URL(candidate);
  assertDistillProxyURL(url);

  const segments = url.pathname.split("/").filter(Boolean);
  const essentialIndex = segments.findIndex(
    (segment, index) => segment === "essential" && segments[index + 1] === "anthropic"
  );
  if (essentialIndex < 1) {
    throw new Error("Proxy URL must look like /<key>/essential/anthropic.");
  }

  url.pathname = `/${segments.slice(0, essentialIndex + 2).join("/")}`;
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export function isDistillProxyURL(value) {
  if (!value || typeof value !== "string") {
    return false;
  }
  try {
    const url = assertDistillProxyURL(value);
    return /\/[^/]+\/essential\/anthropic(?:\/|$)/.test(url.pathname);
  } catch {
    return false;
  }
}

export function assertDistillProxyURL(value) {
  const url = value instanceof URL ? value : new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Proxy URL must use http or https.");
  }
  const host = url.hostname.toLowerCase();
  if (host !== "distill.codes" && !host.endsWith(".distill.codes")) {
    throw new Error("Proxy URL must use a distill.codes host.");
  }
  return url;
}

export function redactProxyURL(value) {
  if (!value || typeof value !== "string") {
    return value;
  }
  try {
    const url = new URL(value);
    const segments = url.pathname.split("/").filter(Boolean);
    const essentialIndex = segments.findIndex(
      (segment, index) => segment === "essential" && segments[index + 1] === "anthropic"
    );
    if (essentialIndex > 0) {
      segments[essentialIndex - 1] = "<proxy-key>";
      return `${url.origin}/${segments.join("/")}`;
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    return value.replace(/[A-Za-z0-9_-]{8,128}/g, "<redacted>");
  }
}

function extractProxyURL(input) {
  const normalized = input.replaceAll("\\/", "/");
  const matches = normalized.match(/https?:\/\/[^\s"'<>}]+/g) ?? [];
  const preferred = matches.find((match) => match.includes("/essential/anthropic")) ?? matches[0];
  return preferred?.replace(/[),.;]+$/, "");
}
