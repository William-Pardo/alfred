import fs from "node:fs";

function fail(msg) { console.error(msg); process.exit(1); }

let html;
try {
  html = fs.readFileSync("index.html", "utf8");
} catch {
  fail("No se encontró index.html en la raíz");
}

if (!/<title>\s*Hola\s+Alfred\s*<\/title>/i.test(html)) {
  fail("El título 'Hola Alfred' no está en <title>");
}

if (!/<html[^>]*\blang=["\']es["\']/i.test(html)) {
  fail('Falta lang="es" en la etiqueta <html>');
}

console.log("Smoke test OK");
