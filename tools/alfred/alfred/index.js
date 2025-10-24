// tools/alfred/alfred/index.js
import "dotenv/config";
import fs from "node:fs/promises";
import { chat } from "./ll.js"; // usa el router (Groq/OpenRouter)
import { plannerPrompt, editorPrompt, evaluatorPrompt } from "./prompts.js";
import {
  readBriefToSpec,
  scanRepoTree,
  readPackageJson,
  readFileSafe,
  applyUnifiedDiff,
  runTests,
  runBuild,
  measureBundle,
  ensureBranch,
  commitSafe,
} from "./tools.js";

// Modelos (puedes sobreescribirlos desde .env)
const MODEL_PLAN = process.env.MODEL_PLAN || "llama-3.3-70b-versatile";
const MODEL_EDIT = process.env.MODEL_EDIT || "llama-3.1-8b-instant";
const MODEL_EVAL = process.env.MODEL_EVAL || "llama-3.1-8b-instant";

async function main() {
  const args = new Set(process.argv.slice(2));
  await ensureBranch();

  // Entrada para el planner
  const spec = await readBriefToSpec();
  const repoTree = await scanRepoTree();
  const pkg = await readPackageJson();

  // =============== PLAN ===============
  const planRaw = await chat(
    plannerPrompt(spec, repoTree, pkg),
    {
      model: MODEL_PLAN,
      temperature: 0,
      json: true, // <-- fuerza JSON estricto desde el modelo
    }
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

  // Métricas de control del loop
  let loop = 0;
  let score = 0;
  const maxLoops = Math.min(6, plan?.metrics?.maxLoops ?? 3);
  const target = Math.min(0.99, Math.max(0.5, plan?.metrics?.targetScore ?? 0.9));

  // ============ LOOP de EDICIÓN/VALIDACIÓN ============
  while (loop < maxLoops && score < target) {
    // ---------- EDITAR ----------
    for (const t of plan?.tasks || []) {
      if (!t?.path) continue;

      const fileContent = await readFileSafe(t.path);

      // El editor devuelve un "unified diff", por eso NO usamos json:true aquí
      const diff = await chat(
        editorPrompt(t, fileContent, ""),
        {
          model: MODEL_EDIT,
          temperature: 0,
        }
      );

      const ok = await applyUnifiedDiff(diff);
      if (ok) {
        await commitSafe(`[alfred] ${t.id || ""} ${t.path}`);
      }
    }

    // ---------- VALIDAR ----------
    const testRes = await runTests();
    const buildRes = await runBuild();
    const bundleKB = await measureBundle();
    const kiloLogs = await readFileSafe("kilo-logs/last-run.log");

    const evalRaw = await chat(
      evaluatorPrompt(spec, testRes, buildRes, { bundleKB }, kiloLogs),
      {
        model: MODEL_EVAL,
        temperature: 0,
        json: true, // <-- fuerza JSON estricto para el evaluador
      }
    );

    let ev;
    try {
      ev = JSON.parse(evalRaw);
    } catch {
      console.error("Evaluator devolvió JSON inválido:\n", evalRaw);
      throw new Error("Evaluator JSON inválido");
    }

    score = Number(ev?.score ?? 0);

    // Parches sugeridos por el evaluador (opcional)
    if (Array.isArray(ev?.suggestedPatches)) {
      for (const p of ev.suggestedPatches) {
        if (!p?.patch) continue;
        const ok = await applyUnifiedDiff(p.patch);
        if (ok) await commitSafe(`[alfred][eval-fix] ${p.path ?? "patch"}`);
      }
    }

    // Guarda un reporte por loop
    const report = {
      loop,
      score,
      target,
      testRes,
      buildRes,
      bundleKB,
      gaps: ev?.gaps ?? [],
    };
    await fs.writeFile("alfred-report.json", JSON.stringify(report, null, 2));

    loop++;
  }

  console.log(`Alfred terminado. score=${score} target=${target} loops=${loop}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
