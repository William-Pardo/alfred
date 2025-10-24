// tools/alfred/alfred/ll.js
import fetch from "node-fetch";
import "dotenv/config";

const DEBUG = process.env.ALFRED_DEBUG === "1";

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

async function callOpenRouter({ model, messages, temperature, max_tokens, timeout_ms, json }) {
  const url = "https://openrouter.ai/api/v1/chat/completions";
  const key = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY;
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

/* ------------------------------- enrutador -------------------------------- */
function pickProvider() {
  const prefer = (process.env.LLM_PROVIDER || "gemini").toLowerCase();
  const hasGemini = !!process.env.GEMINI_API_KEY;
  const hasOR   = !!process.env.OPENROUTER_API_KEY || !!process.env.OPENAI_API_KEY;

  if (prefer === "gemini" && hasGemini) return "gemini";
  if (prefer === "openrouter" && hasOR) return "openrouter";
  if (hasGemini) return "gemini";
  if (hasOR)   return "openrouter";
  throw new Error("No hay claves de LLM (.env). Define GEMINI_API_KEY o OPENROUTER_API_KEY.");
}

/* --------------------------------- chat ----------------------------------- */
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
    "gemini-2.0-flash";

  const payload = {
    model: finalModel,
    messages: msgArray,
    temperature,
    max_tokens,
    timeout_ms,
    json,
  };

  // pequeño auto-retry para 429 temporales (TPM)
  const MAX_RETRIES = Number(process.env.ALFRED_RETRIES || 2);
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return provider === "gemini"
        ? await callGemini(payload)
        : await callOpenRouter(payload);
    } catch (e) {
      const msg = String(e?.message || "");
      const is429 = msg.includes("429") || msg.includes("rate limit");
      if (!is429 || attempt === MAX_RETRIES) throw e;
      const backoff = 600 + Math.floor(Math.random() * 900);
      if (DEBUG) console.log(`[LLM] 429 – retry in ${backoff}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
      await new Promise(r => setTimeout(r, backoff));
    }
  }
}
