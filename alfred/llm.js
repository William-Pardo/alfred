import fetch from "node-fetch";
import "dotenv/config";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEBUG = process.env.ALFRED_DEBUG === "1";

export async function chat(messages, { model, temperature = 0, max_tokens = 2048, timeout_ms = 30000 }) {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error("Falta OPENROUTER_API_KEY en .env");
  }
  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
  };
  if (process.env.HTTP_REFERER) headers["HTTP-Referer"] = process.env.HTTP_REFERER;
  if (process.env.X_TITLE) headers["X-Title"] = process.env.X_TITLE;

  const body = { model, messages, temperature, max_tokens };

  if (DEBUG) {
    console.log("[LLM] POST", OPENROUTER_URL, "model=", model);
  }

  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeout_ms);

  let res;
  try {
    res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: ctrl.signal
    });
  } catch (e) {
    clearTimeout(id);
    throw new Error("[LLM] Fetch error: " + (e?.message || e));
  }
  clearTimeout(id);

  if (DEBUG) console.log("[LLM] status", res.status);

  if (!res.ok) {
    const text = await res.text().catch(()=> "");
    throw new Error(`[LLM] HTTP ${res.status}: ${text.slice(0,500)}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content ?? "";
  if (DEBUG) console.log("[LLM] content preview:", String(content).slice(0,120));
  return content;
}
