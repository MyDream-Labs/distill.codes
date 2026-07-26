export async function preflightProxy(url, options = {}) {
  const endpoint = `${url.replace(/\/$/, "")}/v1/messages`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);

  try {
    const response = await fetch(endpoint, {
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
        system: "Distill.codes preflight.",
        messages: [{ role: "user", content: "ok" }]
      })
    });
    const text = await response.text();
    const proxyCode = proxyErrorCode(text);
    if (proxyCode) {
      throw new Error(`Proxy rejected the URL/key (${proxyCode}). Open https://distill.codes/dashboard and copy a fresh proxy URL.`);
    }
    if (response.status >= 400 && response.status < 500) {
      return { ok: true, status: response.status };
    }
    throw new Error(`Proxy preflight returned HTTP ${response.status}. Check the URL and try again.`);
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("Proxy preflight timed out. Check the URL and try again.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function proxyErrorCode(text) {
  try {
    const parsed = JSON.parse(text);
    const code = parsed?.error?.code;
    if (
      code === "invalid_key" ||
      code === "unsupported_proxy_path" ||
      code === "unsupported_prompt_profile" ||
      code === "access_check_unavailable" ||
      code === "access_check_failed"
    ) {
      return code;
    }
  } catch {
    return "";
  }
  return "";
}
