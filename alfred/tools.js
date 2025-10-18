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
  if (!diffText) return false;

  // Normaliza: algunos modelos no ponen prefijos a/ b/
  let patch = diffText.trim();
  if (!/^---\s/.test(patch) || !/^\+\+\+\s/m.test(patch)) return false;

  // Intenta con git apply, ENVIANDO el patch por STDIN
  try {
    await execa("git", ["apply", "--whitespace=fix"], { input: patch });
    return true;
  } catch (e) {
    // Fallback: creación básica de archivo a partir de líneas con '+'
    try {
      const m = patch.match(/\+\+\+\s+b\/(.+)\n/);
      // si no hay b/..., intenta sin prefijo
      const filePath = m?.[1] || (patch.match(/\+\+\+\s+(.+)\n/)?.[1]);
      if (!filePath) return false;

      const plusLines = patch
        .split("\n")
        .filter(l => l.startsWith("+") && !l.startsWith("+++"))
        .map(l => l.slice(1));

      await fs.mkdir(path.dirname(filePath), { recursive: true });
      // Si el archivo ya existía, no sabemos dónde insertar → como fallback, lo sobrescribimos
      await fs.writeFile(filePath, plusLines.join("\n"), "utf8");
      return true;
    } catch {
      return false;
    }
  }
}

export async function runTests() {
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
    if (!(status.current && status.current.startsWith("alfred/"))) {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      await git.checkoutLocalBranch(`alfred/${stamp}`);
    }
  } catch {
    // si no es repo git, ignorar
  }
}

export async function commitSafe(msg) {
  try {
    await git.add(".");
    await git.commit(msg);
  } catch {
    // si no es repo git, ignorar
  }
}
