import "dotenv/config";
const _origConsoleLog = console.log.bind(console);
if (process.env.ALFRED_QUIET === "1") {
  console.log = () => {};
}

function getTarget(plan) {
  const envT = Number(process.env.ALFRED_TARGET || 0);
  const planT = (plan?.metrics?.targetScore ?? 0.9);
  return Math.min(0.99, Math.max(0.5, envT || planT));
}
function getMaxLoops(plan) {
  const envL = Number(process.env.ALFRED_MAX_LOOPS || 0);
  const planL = (plan?.metrics?.maxLoops ?? 3);
  return Math.min(6, envL || planL);
}
import fs from "node:fs/promises";
import { chat } from "./llm.js";
import { plannerPrompt, editorPrompt, evaluatorPrompt } from "./prompts.js";
import {
  readBriefToSpec, scanRepoTree, readPackageJson, readFileSafe,
  applyUnifiedDiff, runTests, runBuild, measureBundle, ensureBranch, commitSafe
} from "./tools.js";

const MODEL_PLAN = process.env.MODEL_PLAN || "meta-llama/llama-3.1-8b-instruct:free";
const MODEL_EDIT = process.env.MODEL_EDIT || "meta-llama/llama-3.1-8b-instruct:free";
const MODEL_EVAL = process.env.MODEL_EVAL || "meta-llama/llama-3.1-8b-instruct:free";
const DEBUG = process.env.ALFRED_DEBUG === "1";
const QUIET  = process.env.ALFRED_QUIET === "1";
const log = (...a) => { if (!QUIET) console.log(...a); };

function extractJson(s) {
  if (!s) throw new Error("Respuesta vacía");
  // quita fences ```...```
  s = s.replace(/```json|```/gi, "");
  // intenta parse directo
  try { return JSON.parse(s); } catch {}
  // busca primer '{' y último '}' y reintenta
  const i = s.indexOf("{");
  const j = s.lastIndexOf("}");
  if (i >= 0 && j > i) {
    const cut = s.slice(i, j + 1);
    try { return JSON.parse(cut); } catch {}
  }
  throw new Error("No se pudo parsear JSON");
}

async function main() {
  console.log("[Alfred] start");
  const args = new Set(process.argv.slice(2));
  await ensureBranch();

  const spec = await readBriefToSpec();
  const repoTree = await scanRepoTree();
  const pkg = await readPackageJson();

  console.log("[Alfred] calling planner… model=", MODEL_PLAN);
  let planRaw = "";
  try {
    planRaw = await chat(
      plannerPrompt(spec, repoTree, pkg),
      { model: MODEL_PLAN, temperature: 0, timeout_ms: 45000 }
    );
    if (DEBUG) console.log("[Alfred] planner raw preview:", String(planRaw).slice(0,300));
  } catch (e) {
    console.error("[Alfred] planner error:", e.message || e);
    process.exit(1);
  }

  let plan;
  try { plan = extractJson(planRaw); }
  catch (e) {
    console.error("[Alfred] planner JSON inválido. preview:", String(planRaw).slice(0,300));
    throw e;
  }

  await fs.writeFile("alfred-plan.json", JSON.stringify(plan, null, 2));
  console.log("[Alfred] plan listo con", (plan.tasks||[]).length, "tareas");

  if (args.has("--plan-only")) {
    console.log("Plan guardado en alfred-plan.json");
    return;
  }

  let loop = 0;
  let score = 0;
  const maxLoops = getMaxLoops(plan);
  const target = getTarget(plan);
  console.log("[Alfred] target=", target, "maxLoops=", maxLoops);

  while (loop < maxLoops && score < target) {
    console.log("[Alfred] loop", loop+1, "edit phase…");
    for (const t of (plan.tasks || [])) {
      if (!t?.path) continue;
      const fileContent = await readFileSafe(t.path);
      let diff = "";
      try {
        diff = await chat(
          editorPrompt(t, fileContent, ""),
          { model: MODEL_EDIT, temperature: 0, timeout_ms: 45000 }
        );
      } catch (e) {
        console.error("[Alfred] editor error en", t.path, ":", e.message || e);
        continue;
      }
      const ok = await applyUnifiedDiff(diff);
      console.log("[Alfred] patch", t.path, ok ? "APLICADO" : "IGNORADO");
      if (ok) await commitSafe(`[alfred] ${(t.id || "")} ${t.path}`);
    }

    console.log("[Alfred] validate phase…");
    const testRes = await runTests();
    const buildRes = await runBuild();
    const bundleKB = await measureBundle();
    const kiloLogs = await readFileSafe("kilo-logs/last-run.log");

    let evalRaw = "";
    try {
      evalRaw = await chat(
        evaluatorPrompt(spec, testRes, buildRes, { bundleKB }, kiloLogs),
        { model: MODEL_EVAL, temperature: 0, timeout_ms: 45000 }
      );
      if (DEBUG) console.log("[Alfred] eval raw preview:", String(evalRaw).slice(0,300));
    } catch (e) {
      console.error("[Alfred] evaluator error:", e.message || e);
      process.exit(1);
    }

    let ev;
    try { ev = extractJson(evalRaw); }
    catch (e) {
      console.error("[Alfred] evaluator JSON inválido. preview:", String(evalRaw).slice(0,300));
      throw e;
    }

    score = Number(ev?.score ?? 0);
    console.log("[Alfred] score=", score, "gaps=", (ev?.gaps||[]).length);

    if (Array.isArray(ev?.suggestedPatches)) {
      for (const p of ev.suggestedPatches) {
        if (!p?.patch) continue;
        const ok = await applyUnifiedDiff(p.patch);
        console.log("[Alfred] eval-fix", p.path ?? "patch", ok ? "APLICADO" : "IGNORADO");
        if (ok) await commitSafe(`[alfred][eval-fix] ${p.path ?? "patch"}`);
      }
    }

    const report = { loop, score, target, testRes, buildRes, bundleKB, gaps: ev?.gaps ?? [] };
    await fs.writeFile("alfred-report.json", JSON.stringify(report, null, 2));
    loop++;
  }

  console.log("[Alfred] terminado. score=" + score + " target=" + target + " loops=" + loop);
}

main().catch(e => { console.error(e); process.exit(1); });


