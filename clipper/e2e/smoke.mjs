// Prueba de humo del flujo principal (F01 + F05):
// registro -> subir vídeo -> ajustes -> esperar clips -> editor -> descargar MP4.
// Uso: node e2e/smoke.mjs <video.mp4> [carpeta-capturas]  (con web en :3000 y worker en marcha)
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import fs from "node:fs";
import path from "node:path";

const video = process.argv[2];
const shots = process.argv[3] ?? "e2e-shots";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
if (!video || !fs.existsSync(video)) throw new Error("Pasa la ruta a un vídeo de prueba");
fs.mkdirSync(shots, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
const shot = (n) => page.screenshot({ path: path.join(shots, `${n}.png`), fullPage: true });
const t0 = Date.now();
const log = (m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${m}`);

await page.goto(`${BASE}/signup`);
await page.fill('input[name="email"]', `prueba+${Date.now()}@example.com`);
await page.fill('input[name="password"]', "contraseña-segura-123");
await page.click('button:has-text("Crear cuenta")');
await page.waitForURL(`${BASE}/`);
log("registro ok");
await shot("01-home");

await page.setInputFiles('input[type="file"]', video);
await page.waitForURL(/\/sources\//, { timeout: 120_000 });
log("subida ok");
await page.getByRole("button", { name: "45 s" }).click();
await page.getByRole("button", { name: "Generar clips" }).waitFor({ timeout: 120_000 });
await page.waitForFunction(() => {
  const b = [...document.querySelectorAll("button")].find((x) => x.textContent?.includes("Generar clips"));
  return b && !b.disabled;
}, null, { timeout: 120_000 });
await shot("02-ajustes");
await page.getByRole("button", { name: "Generar clips" }).click();
await page.waitForURL(/\/jobs\//);
log("análisis lanzado");
await page.waitForTimeout(4000);
await shot("03-procesando");
await page.getByRole("heading", { name: /clips listos|Algo falló/ }).waitFor({ timeout: 20 * 60_000 });
const heading = await page.getByRole("heading", { level: 1 }).textContent();
log(`resultado: ${heading}`);
await shot("04-resultados");
if (/falló/.test(heading ?? "")) process.exit(1);

const cards = await page.locator("ul li video").count();
log(`clips en pantalla: ${cards}`);
if (cards === 0) process.exit(1);

await page.getByRole("link", { name: "Editar" }).first().click();
await page.waitForURL(/\/clips\//);
await shot("05-editor");
const dl = page.waitForEvent("download", { timeout: 10 * 60_000 });
await page.getByRole("button", { name: "Descargar MP4" }).click();
const file = await dl;
const out = path.join(shots, file.suggestedFilename());
await file.saveAs(out);
log(`descarga ok: ${out} (${fs.statSync(out).size} bytes)`);
await browser.close();
