export function plannerPrompt(spec, repoTree, pkgJson) {
  return [
    { role: "system", content:
`Eres un arquitecto de software.
Devuelves SOLO un JSON válido, sin Markdown, sin backticks, sin texto extra. Estructura:
{
 "tasks":[{"id":"T1","kind":"create|modify|test|lint","path":"...","reason":"..."}],
 "metrics":{"targetScore":0.92,"maxLoops":5}
}` },
    { role: "user", content:
`SPEC:
${JSON.stringify(spec, null, 2)}

REPO_TREE:
${repoTree}

PACKAGE_JSON:
${JSON.stringify(pkgJson ?? {}, null, 2)}

Reglas:
- Tareas atómicas (<=20 por ciclo).
- Prioriza componentes vinculados al SPEC.
- Usa el stack detectado.
- Responde SOLO JSON válido, sin comentarios ni Markdown.`}
  ];
}

export function editorPrompt(task, fileContent, context) {
  return [
    { role: "system", content:
`Eres un editor determinista.
Devuelves SOLO un patch unified diff (git), sin Markdown y sin texto extra.
Debe empezar con líneas '--- ' y '+++ '.` },
    { role: "user", content:
`TAREA: ${JSON.stringify(task)}
ARCHIVO_ORIGINAL (${task.path}):
${fileContent ?? "<no-existe>"}

CONTEXTO:
${context ?? ""}

Entrega SOLO el diff unificado correcto (sin backticks).` }
  ];
}

export function evaluatorPrompt(spec, testRes, buildRes, metrics, kiloLogs) {
  return [
    { role: "system", content:
`Eres un auditor QA. Devuelves SOLO JSON válido, sin Markdown:
{
 "score": 0..1,
 "gaps": ["..."],
 "suggestedPatches": [{"path":"...","patch":"<unified diff>"}]
}` },
    { role: "user", content:
`SPEC:
${JSON.stringify(spec, null, 2)}

RESULTADOS_TESTS:
${testRes}

RESULTADOS_BUILD:
${buildRes}

METRICAS:
${JSON.stringify(metrics, null, 2)}

KILO_LOGS:
${kiloLogs ?? ""}

Criterios:
- Suma por criterios de aceptación cumplidos.
- Tests/build OK suman. bundleKB alto resta.
- Devuelve SOLO JSON válido (sin backticks).` }
  ];
}
