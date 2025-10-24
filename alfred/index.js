import "dotenv/config";
import fs from "node:fs/promises";
import { chat } from "./ll.js";
import { plannerPrompt, editorPrompt, evaluatorPrompt } from "./prompts.js";
import {
  readBriefToSpec, scanRepoTree, readPackageJson, readFileSafe,
  applyUnifiedDiff, runTests, runBuild, measureBundle, ensureBranch, commitSafe
} from "./tools.js";

const MODEL_PLAN = process.env.MODEL_PLAN || "llama-3.1-8b-instant";
const MODEL_EDIT = process.env.MODEL_EDIT || "llama-3.1-8b-instant";
const MODEL_EVAL = process.env.MODEL_EVAL || "llama-3.1-8b-instant";

const ENV_MAX_LOOPS  = Number(process.env.ALFRED_MAX_LOOPS || 0);
const ENV_TARGET     = Number(process.env.ALFRED_TARGET || 0);
const ENV_MAX_TASKS  = Number(process.env.ALFRED_MAX_TASKS || 0);

async function main() {
  const args = new Set(process.argv.slice(2));
  await ensureBranch();

  const spec = await readBriefToSpec();
  const repoTree = await scanRepoTree();
  const pkg = await readPackageJson();

  // PLAN (respuesta JSON estricta)
  const planRaw = await chat(
    plannerPrompt(spec, repoTree, pkg, { forceJson: true }),
    { model: MODEL_PLAN, temperature: 0, json: true }
  );

  let plan;
  try {
    plan = JSON.parse(planRaw);
  } catch {
    console.error("Planner devolvió JSON inválido:\n", planRaw);
    throw new Error("Planner JSON inválido");
  }

  await fs.writeFile("alfred-plan.json", JSON.stringify(plan, null, 2));
  if (args.has("--plan-only")) {
    console.log(`Plan guardado en alfred-plan.json (model: ${MODEL_PLAN} )`);
    return;
  }

  let loop = 0;
  let score = 0;

  // límites desde plan o env
  const planMaxLoops = Math.min(6, plan?.metrics?.maxLoops ?? 3);
  const planTarget   = Math.min(0.99, Math.max(0.5, plan?.metrics?.targetScore ?? 0.9));

  const maxLoops = ENV_MAX_LOOPS > 0 ? ENV_MAX_LOOPS : planMaxLoops;
  const target   = ENV_TARGET    > 0 ? Math.min(0.99, Math.max(0.5, ENV_TARGET)) : planTarget;

  // Cap de tareas por loop (para no disparar muchas llamadas)
  const tasks = Array.isArray(plan?.tasks) ? plan.tasks : [];
  const maxTasks = ENV_MAX_TASKS > 0 ? ENV_MAX_TASKS : tasks.length;

  while (loop < maxLoops && score < target) {
    // EDITAR (aplica máximo de tareas)
    for (const t of tasks.slice(0, maxTasks)) {
      if (!t?.path) continue;
      const fileContent = await readFileSafe(t.path);
      const diff = await chat(
        editorPrompt(t, fileContent, ""), // prompt de edición
        { model: MODEL_EDIT, temperature: 0 }
      );
      const ok = await applyUnifiedDiff(diff);
      if (ok) await commitSafe(`[alfred] ${t.id || ""} ${t.path}`);
    }

    // VALIDAR
    const testRes = await runTests();
    const buildRes = await runBuild();
    const bundleKB = await measureBundle();
    const kiloLogs = await readFileSafe("kilo-logs/last-run.log");

    // EVALUAR (JSON estricto)
    const evalRaw = await chat(
      evaluatorPrompt(spec, testRes, buildRes, { bundleKB }, kiloLogs, { forceJson: true }),
      { model: MODEL_EVAL, temperature: 0, json: true }
    );

    let ev;
    try {
      ev = JSON.parse(evalRaw);
    } catch {
      console.error("Evaluator devolvió JSON inválido:\n", evalRaw);
      throw new Error("Evaluator JSON inválido");
    }

    score = Number(ev?.score ?? 0);

    if (Array.isArray(ev?.suggestedPatches)) {
      for (const p of ev.suggestedPatches) {
        if (!p?.patch) continue;
        const ok = await applyUnifiedDiff(p.patch);
        if (ok) await commitSafe(`[alfred][eval-fix] ${p.path ?? "patch"}`);
      }
    }

    const report = { loop, score, target, testRes, buildRes, bundleKB, gaps: ev?.gaps ?? [] };
    await fs.writeFile("alfred-report.json", JSON.stringify(report, null, 2));
    loop++;
  }

  console.log(`Alfred terminado. score=${score} target=${target} loops=${loop}`);
}

main().catch(e => { console.error(e); process.exit(1); });

