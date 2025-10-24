// tools/alfred/alfred/ll.js
import fetch from "node-fetch";
import "dotenv/config";

const DEBUG = process.env.ALFRED_DEBUG === "1";

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

// ---------- Router ----------
function pickProvider() {
  const prefer = (process.env.LLM_PROVIDER || "groq").toLowerCase();
  const hasGroq = !!process.env.GROQ_API_KEY;
  const hasOR   = !!process.env.OPENROUTER_API_KEY || !!process.env.OPENAI_API_KEY;

  if (prefer === "groq" && hasGroq) return "groq";
  if (prefer === "openrouter" && hasOR) return "openrouter";
  if (hasGroq) return "groq";
  if (hasOR)   return "openrouter";
  throw new Error("No hay claves de LLM (.env). Define GROQ_API_KEY o OPENROUTER_API_KEY.");
}

// ---------- Providers ----------
async function callGroq({ model, messages, temperature, max_tokens, timeout_ms, json }) {
  const url = "https://api.groq.com/openai/v1/chat/completions";
  const key = process.env.GROQ_API_KEY;
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

async function callOpenRouter({ model, messages, temperature, max_tokens, timeout_ms, json }) {
  const url = "https://openrouter.ai/api/v1/chat/completions";
  const key = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY;
  if (!key) throw new Error("Falta OPENROUTER_API_KEY u OPENAI_API_KEY en .env");

  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${key}`,
  };
  if (process.env.HTTP_REFERER) headers["HTTP-Referer"] = process.env.HTTP_REFERER;
  if (process.env.X_TITLE)      headers["X-Title"]      = process.env.X_TITLE;

  const body = { model, messages, temperature, max_tokens };
  if (json) body.response_format = { type: "json_object" };

  if (DEBUG) console.log("[LLM] POST openrouter model=", model);
  return fetchWithTimeout(url, headers, body, timeout_ms);
}

// ---------- Public API ----------
export async function chat(
  messages,
  { model, temperature = 0, max_tokens = 256, timeout_ms = 30000, json = false } = {}
) {
  const msgArray = Array.isArray(messages)
    ? messages
    : [{ role: "user", content: String(messages ?? "") }];

  const provider = pickProvider();

  const finalModel =
    model ||
    process.env.MODEL_PLAN ||
    process.env.OPENROUTER_MODEL ||
    "llama-3.1-8b-instant";

  const payload = {
    model: finalModel,
    messages: msgArray,
    temperature,
    max_tokens,
    timeout_ms,
    json,
  };

  return provider === "groq"
    ? callGroq(payload)
    : callOpenRouter(payload);
}
