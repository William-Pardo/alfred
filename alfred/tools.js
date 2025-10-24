@'
import { exec as _exec } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import { execa } from "execa";
import simpleGit from "simple-git";

const exec = promisify(_exec);
const git = simpleGit();

export async function readBriefToSpec(briefPath = "requirements/latest.md") {
  let md = "";
  try { md = await fs.readFile(briefPath, "utf8"); } catch {}
  const acceptance = [];
  for (const ln of md.split("\n")) {
    if (/criterio|aceptaci[oó]n|acceptance/i.test(ln)) acceptance.push(ln.replace(/^\W+/, "").trim());
  }
  return {
    title: (md.match(/^#\s*(.+)$/m)?.[1]) || "Feature",
    acceptanceCriteria: acceptance.length ? acceptance : ["Build ok", "Lint ok", "Tests ok"],
    uiConstraints: {},
    nonFunctional: { bundleSizeKBMax: 300, a11y: "basic" }
  };
}

export async function scanRepoTree(root = ".") {
  const entries = await fg(["**/*"], {
    dot: false,
    ignore: ["node_modules/**", "alfred/**", ".git/**"]
  });
  return entries.slice(0, 500).join("\n");
}

export async function readPackageJson() {
  try { return JSON.parse(await fs.readFile("package.json", "utf8")); }
  catch { return {}; }
}

export async function readFileSafe(p) {
  try { return await fs.readFile(p, "utf8"); }
  catch { return null; }
}

export async function applyUnifiedDiff(diffText) {
  if (!diffText || !diffText.includes("--- ") || !diffText.includes("+++ ")) return false;
  // Intento aplicar con git apply primero (más confiable)
  try {
    await git.raw(["apply", "--whitespace=fix"], diffText);
    return true;
  } catch {
    // Fallback ultra simple: si el archivo no existe y el diff contiene líneas con "+"
    try {
      const m = diffText.match(/\+\+\+\s+b\/(.+)\n/);
      if (!m) return false;
      const filePath = m[1];
      const plusLines = diffText.split("\n").filter(l => l.startsWith("+") && !l.startsWith("+++")).map(l => l.slice(1));
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, plusLines.join("\n"), "utf8");
      return true;
    } catch { return false; }
  }
}

export async function runTests() {
  // Ejecuta npm test si existe script
  try {
    const pkg = await readPackageJson();
    if (pkg?.scripts?.test) {
      await execa("npm", ["run", "test", "--silent"], { stdio: "pipe" });
      return "OK";
    }
    return "NO_TEST_SCRIPT";
  } catch (e) {
    return `FAIL\n${String(e?.stdout || e)}`.slice(0, 2000);
  }
}

export async function runBuild() {
  try {
    const pkg = await readPackageJson();
    if (pkg?.scripts?.build) {
      await execa("npm", ["run", "build", "--silent"], { stdio: "pipe" });
      return "OK";
    }
    return "NO_BUILD_SCRIPT";
  } catch (e) {
    return `FAIL\n${String(e?.stdout || e)}`.slice(0, 2000);
  }
}

export async function measureBundle() {
  // Heurística: suma tamaños de dist/**
  try {
    const files = await fg(["dist/**/*.*"], { dot: false });
    let total = 0;
    for (const f of files) {
      const st = await fs.stat(f);
      total += st.size;
    }
    return Math.round(total / 1024);
  } catch { return 0; }
}

export async function ensureBranch() {
  try {
    const status = await git.status();
    if (status.current && status.current.startsWith("alfred/")) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await git.checkoutLocalBranch(`alfred/${stamp}`);
  } catch {
    // Si no es repo git, no pasa nada
  }
}

export async function commitSafe(msg) {
  try {
    await git.add(".");
    await git.commit(msg);
  } catch {
    // Si no es repo git, ignorar
  }
}
'@ | Set-Content -Encoding UTF8 .\alfred\tools.js
