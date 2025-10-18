import fs from "node:fs";

function fail(msg) { console.error(msg); process.exit(1); }  

let html;
try {
  html = fs.readFileSync("index.html", "utf8");
} catch {
  fail("No se encontró index.html en la raíz");
}

// Título
if (!/<title>\s*Hola\s+Alfred\s*<\/title>/i.test(html)) {    
  fail("El título 'Hola Alfred' no está en <title>");
} else {
  console.log("TITLE_OK");
}

// lang="es"
if (!/<html[^>]*\blang=["\']es["\']/i.test(html)) {
  fail('Falta lang="es" en la etiqueta <html>');
} else {
  console.log("LANG_OK");
}

// meta viewport
if (!/<meta[^>]*name=["\']viewport["\'][^>]*>/i.test(html)) {
  fail('Falta <meta name="viewport">');
} else {
  console.log("VIEWPORT_OK");
}

// main + h1
const hasMain = /<(main|div)[^>]*(role=["\']main["\'])?[^>]*>/i.test(html);
if (!hasMain) {
  fail('Falta contenedor principal (<main> o role="main")');
}
const h1Match = /<h1[^>]*>([^<]+)<\/h1>/i.exec(html);
if (!(h1Match && h1Match[1].trim().length > 0)) {
  fail("Falta <h1> con texto");
} else {
  console.log("MAIN_H1_OK");
}

console.log("Smoke test OK (a11y básico)");
