// tools/alfred/alfred/ll.js
import fetch from "node-fetch";
import "dotenv/config";

const DEBUG = process.env.ALFRED_DEBUG === "1";

/* ----------------------------- key rotation manager ----------------------------- */
class KeyRotationManager {
  constructor() {
    this.providers = {
      openrouter: {
        keys: (process.env.OPENROUTER_API_KEYS || "").split(",").map(k => k.trim()).filter(k => k),
        activeKeys: 2, // Start with 2 keys per provider
        cooldownMs: 30000, // 30 seconds cooldown between switches
        lastSwitch: 0,
        usage: new Map(),
        failures: new Map()
      },
      groq: {
        keys: (process.env.GROQ_API_KEYS || "").split(",").map(k => k.trim()).filter(k => k),
        activeKeys: 2,
        cooldownMs: 30000,
        lastSwitch: 0,
        usage: new Map(),
        failures: new Map()
      },
      gemini: {
        keys: [process.env.GEMINI_API_KEY].filter(k => k),
        activeKeys: 1,
        cooldownMs: 60000, // Longer cooldown for Gemini as fallback
        lastSwitch: 0,
        usage: new Map(),
        failures: new Map()
      }
    };

    // Initialize usage tracking
    Object.keys(this.providers).forEach(provider => {
      this.providers[provider].keys.forEach(key => {
        this.providers[provider].usage.set(key, { requests: 0, lastUsed: 0, rateLimited: false });
        this.providers[provider].failures.set(key, 0);
      });
    });
  }

  logUsage(provider, key, success = true, error = null) {
    const providerData = this.providers[provider];
    if (!providerData) return;

    const usage = providerData.usage.get(key);
    if (usage) {
      usage.requests++;
      usage.lastUsed = Date.now();

      if (!success) {
        providerData.failures.set(key, providerData.failures.get(key) + 1);
        if (error && (error.includes("429") || error.includes("rate limit"))) {
          usage.rateLimited = true;
          console.log(`[KEY_ROTATION] Rate limit detected for ${provider}:${key.slice(-4)}`);
        }
      } else {
        usage.rateLimited = false;
      }
    }

    if (DEBUG) {
      console.log(`[KEY_ROTATION] ${provider}:${key.slice(-4)} - Success: ${success}, Total requests: ${usage.requests}, Failures: ${providerData.failures.get(key)}`);
    }
  }

  getNextKey(provider) {
    const providerData = this.providers[provider];
    if (!providerData || providerData.keys.length === 0) return null;

    // Check cooldown
    const now = Date.now();
    if (now - providerData.lastSwitch < providerData.cooldownMs) {
      // Return current key if still in cooldown
      return providerData.currentKey || providerData.keys[0];
    }

    // Get active keys (limit to activeKeys count initially)
    const activeKeys = providerData.keys.slice(0, providerData.activeKeys);

    // Filter out rate limited keys
    const availableKeys = activeKeys.filter(key => {
      const usage = providerData.usage.get(key);
      return !usage.rateLimited;
    });

    if (availableKeys.length === 0) {
      // All keys rate limited, use least failed key
      const sortedByFailures = activeKeys.sort((a, b) =>
        providerData.failures.get(a) - providerData.failures.get(b)
      );
      const nextKey = sortedByFailures[0];
      console.log(`[KEY_ROTATION] All keys rate limited for ${provider}, using least failed: ${nextKey.slice(-4)}`);
      return nextKey;
    }

    // Round-robin with load balancing (least recently used)
    const sortedByUsage = availableKeys.sort((a, b) => {
      const usageA = providerData.usage.get(a);
      const usageB = providerData.usage.get(b);
      return usageA.lastUsed - usageB.lastUsed;
    });

    const nextKey = sortedByUsage[0];
    providerData.lastSwitch = now;
    providerData.currentKey = nextKey;

    if (DEBUG) {
      console.log(`[KEY_ROTATION] Selected ${provider}:${nextKey.slice(-4)}`);
    }

    return nextKey;
  }

  expandKeys(provider) {
    const providerData = this.providers[provider];
    if (providerData.activeKeys < providerData.keys.length) {
      providerData.activeKeys++;
      console.log(`[KEY_ROTATION] Expanded ${provider} to ${providerData.activeKeys} active keys`);
    }
  }

  getProviderPriority() {
    // Priority: OpenRouter -> Groq -> Gemini (as fallback)
    const providers = ['openrouter', 'groq', 'gemini'];
    for (const provider of providers) {
      if (this.providers[provider].keys.length > 0) {
        const key = this.getNextKey(provider);
        if (key) return { provider, key };
      }
    }
    return null;
  }
}

const keyManager = new KeyRotationManager();

/* ------------------------ util con timeout + errores ----------------------- */
async function fetchWithTimeout(url, headers, body, timeout_ms) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeout_ms);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (DEBUG) console.log("[LLM] status", res.status);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`[LLM] HTTP ${res.status}: ${text.slice(0, 500)}`);
    }
    const data = await res.json();
    return data?.choices?.[0]?.message?.content ?? "";
  } finally {
    clearTimeout(id);
  }
}

/* ------------------------------ proveedores ------------------------------- */
async function callGemini({ model, messages, temperature, max_tokens, timeout_ms, json }) {
  const url = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("Falta GEMINI_API_KEY en .env");

  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${key}`,
  };

  const body = { model, messages, temperature, max_tokens };
  if (json) body.response_format = { type: "json_object" };

  if (DEBUG) console.log("[LLM] POST gemini model=", model);
  return fetchWithTimeout(url, headers, body, timeout_ms);
}

async function callOpenRouter({ model, messages, temperature, max_tokens, timeout_ms, json, apiKey }) {
  const url = "https://openrouter.ai/api/v1/chat/completions";
  const key = apiKey || process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY;
  if (!key) throw new Error("Falta OPENROUTER_API_KEY u OPENAI_API_KEY en .env");

  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${key}`,
  };
  if (process.env.HTTP_REFERER) headers["HTTP-Referer"] = process.env.HTTP_REFERER;
  if (process.env.X_TITLE) headers["X-Title"] = process.env.X_TITLE;

  const body = { model, messages, temperature, max_tokens };
  if (json) body.response_format = { type: "json_object" };

  if (DEBUG) console.log("[LLM] POST openrouter model=", model);
  return fetchWithTimeout(url, headers, body, timeout_ms);
}

async function callGroq({ model, messages, temperature, max_tokens, timeout_ms, json, apiKey }) {
  const url = "https://api.groq.com/openai/v1/chat/completions";
  const key = apiKey;
  if (!key) throw new Error("Falta GROQ_API_KEY en .env");

  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${key}`,
  };

  const body = { model, messages, temperature, max_tokens };
  if (json) body.response_format = { type: "json_object" };

  if (DEBUG) console.log("[LLM] POST groq model=", model);
  return fetchWithTimeout(url, headers, body, timeout_ms);
}

/* ------------------------------- enrutador -------------------------------- */
function pickProvider() {
  // Use the key rotation manager to get the best available provider and key
  const result = keyManager.getProviderPriority();
  if (!result) {
    throw new Error("No hay claves de LLM disponibles. Define GEMINI_API_KEY, OPENROUTER_API_KEYS, o GROQ_API_KEYS en .env.");
  }

  if (DEBUG) {
    console.log(`[PROVIDER] Selected ${result.provider}:${result.key.slice(-4)}`);
  }

  return result;
}

/* --------------------------------- chat ----------------------------------- */
export async function chat(
  messages,
  { model, temperature = 0, max_tokens = 256, timeout_ms = 30000, json = false } = {}
) {
  const msgArray = Array.isArray(messages)
    ? messages
    : [{ role: "user", content: String(messages ?? "") }];

  const providerInfo = pickProvider();
  const { provider, key } = providerInfo;

  const finalModel =
    model ||
    process.env.MODEL_PLAN ||
    process.env.OPENROUTER_MODEL ||
    (provider === "groq" ? "llama3-8b-8192" : "gemini-2.0-flash");

  const payload = {
    model: finalModel,
    messages: msgArray,
    temperature,
    max_tokens,
    timeout_ms,
    json,
    apiKey: key,
  };

  // Enhanced retry logic with key rotation
  const MAX_RETRIES = Number(process.env.ALFRED_RETRIES || 3);
  let lastError = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      let result;
      if (provider === "gemini") {
        result = await callGemini(payload);
      } else if (provider === "openrouter") {
        result = await callOpenRouter(payload);
      } else if (provider === "groq") {
        result = await callGroq(payload);
      }

      // Log successful usage
      keyManager.logUsage(provider, key, true);
      return result;

    } catch (e) {
      lastError = e;
      const msg = String(e?.message || "");
      const is429 = msg.includes("429") || msg.includes("rate limit") || msg.includes("quota exceeded");

      // Log failure
      keyManager.logUsage(provider, key, false, msg);

      if (is429 && attempt < MAX_RETRIES) {
        // Try next key/provider immediately on rate limit
        console.log(`[LLM] Rate limit detected for ${provider}:${key.slice(-4)}, switching keys...`);
        const nextProviderInfo = pickProvider();
        if (nextProviderInfo && (nextProviderInfo.provider !== provider || nextProviderInfo.key !== key)) {
          payload.apiKey = nextProviderInfo.key;
          providerInfo.provider = nextProviderInfo.provider;
          providerInfo.key = nextProviderInfo.key;
          if (DEBUG) console.log(`[LLM] Switched to ${nextProviderInfo.provider}:${nextProviderInfo.key.slice(-4)}`);
          continue;
        }
      }

      // For non-rate-limit errors, use exponential backoff
      if (!is429 && attempt < MAX_RETRIES) {
        const backoff = 600 + Math.floor(Math.random() * 900);
        if (DEBUG) console.log(`[LLM] Error – retry in ${backoff}ms (attempt ${attempt + 1}/${MAX_RETRIES}): ${msg.slice(0, 100)}`);
        await new Promise(r => setTimeout(r, backoff));
        continue;
      }

      // If we've exhausted retries or it's a non-recoverable error
      if (attempt === MAX_RETRIES) {
        throw lastError;
      }
    }
  }
}
