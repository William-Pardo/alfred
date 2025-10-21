// tools/alfred/alfred/llm.js
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

// --- OpenRouter ---
async function callOpenRouter(body, timeout_ms) {
  const url = "https://openrouter.ai/api/v1/chat/completions";
  const key = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY;
  if (!key) throw new Error("Falta OPENROUTER_API_KEY u OPENAI_API_KEY en .env");
  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${key}`,
  };
  if (process.env.HTTP_REFERER) headers["HTTP-Referer"] = process.env.HTTP_REFERER;
  if (process.env.X_TITLE) headers["X-Title"] = process.env.X_TITLE;
  return fetchWithTimeout(url, headers, body, timeout_ms);
}

// --- Groq ---
async function callGroq(body, timeout_ms) {
  const url = "https://api.groq.com/openai/v1/chat/completions";
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("Falta GROQ_API_KEY en .env");
  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${key}`,
  };
  return fetchWithTimeout(url, headers, body, timeout_ms);
}

export async function chat(
  messages,
  { model, temperature = 0, max_tokens = 256, timeout_ms = 30000 } = {}
) {
  const msgArray = Array.isArray(messages)
    ? messages
    : [{ role: "user", content: String(messages ?? "") }];

  // Modelo final (válido en Groq por defecto)
  const requested =
    model ||
    process.env.OPENROUTER_MODEL ||
    process.env.MODEL_PLAN;
  const finalModel = requested || "llama-3.1-8b-instant";

  // Elegir proveedor: prioriza Groq si hay clave y el modelo parece Llama
  const prefer = (process.env.LLM_PROVIDER || "groq").toLowerCase();
  const canGroq = !!process.env.GROQ_API_KEY;
  const looksGroq = /^llama[-\d.]+/i.test(finalModel) || /^llama3[-\w.]*/i.test(finalModel);
  const useGroq = (prefer === "groq" && canGroq) || (canGroq && looksGroq);

  if (DEBUG) console.log("[LLM] POST", useGroq ? "groq" : "openrouter", "model=", finalModel);

  const body = { model: finalModel, messages: msgArray, temperature, max_tokens };

  if (useGroq) return callGroq(body, timeout_ms);
  return callOpenRouter(body, timeout_ms);
}
