// One-off bulk import of yearly PM plans (template files PM_<CODE>_<year>.xlsx) for many hospitals.
// It runs the real import page (web/pm.html) in a local browser against a mock client to build exactly the rows the page
// would send, then posts them to the database through the one-time, token-guarded function pm_import_token.
// Usage: node run.mjs <folder with PM_*.xlsx> [--token=<one-time token>] [--dry]
//   --dry : only parse and print the row counts, send nothing
import { chromium } from "playwright-core";
import fs from "node:fs"; import path from "node:path"; import os from "node:os"; import { fileURLToPath, pathToFileURL } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url)), web = path.join(here, "..", "..", "web");
const dir = process.argv[2], dry = process.argv.includes("--dry"), token = (process.argv.find(a => a.startsWith("--token=")) || "").slice(8);
if (!dir || (!dry && !token)) { console.error("usage: node run.mjs <folder> --token=<token> | --dry"); process.exit(2); }
const cfg = fs.readFileSync(path.join(web, "assets", "config.js"), "utf8");
const URL_ = /supabaseUrl:\s*"([^"]+)"/.exec(cfg)[1], KEY = /supabaseKey:\s*"([^"]+)"/.exec(cfg)[1];
const files = fs.readdirSync(dir).map(f => [/^PM_([A-Z0-9]{2,4})_(\d{4})\.xlsx$/i.exec(f), f]).filter(x => x[0]).map(([m, f]) => ({ code: m[1].toUpperCase(), file: path.join(dir, f) })).sort((a, b) => a.code.localeCompare(b.code));
if (!files.length) { console.error("no PM_<CODE>_<year>.xlsx files in " + dir); process.exit(2); }

// a private copy of the page that talks to the mock instead of the real database
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pmimp-")); fs.cpSync(web, path.join(tmp, "web"), { recursive: true });
fs.copyFileSync(path.join(here, "mock.js"), path.join(tmp, "mock.js")); fs.copyFileSync(path.join(here, "qrcode.min.js"), path.join(tmp, "qrcode.min.js"));
const html = fs.readFileSync(path.join(web, "pm.html"), "utf8").replace(/https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@[^"]+/, "../mock.js").replace(/https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/qrcode-generator\/[^"]+/, "../qrcode.min.js").replace(/^.*jsQR\.min\.js.*$/m, "").replace(/<script src="assets\/config\.js"><\/script>/, "");
fs.writeFileSync(path.join(tmp, "web", "pm-import.html"), html);

// uses the Edge or Chrome already installed (set PM_BROWSER to a browser executable to override)
let browser; if (process.env.PM_BROWSER) browser = await chromium.launch({ executablePath: process.env.PM_BROWSER, args: ["--no-sandbox"] });
else for (const channel of ["msedge", "chrome"]) { try { browser = await chromium.launch({ channel }); break; } catch (e) { if (channel === "chrome") throw e; } }
let total = 0, bad = 0;
for (const f of files) {
  const p = await browser.newPage({ viewport: { width: 1200, height: 900 } }); p.on("dialog", d => d.accept());
  await p.goto(pathToFileURL(path.join(tmp, "web", "pm-import.html")).href + "?tab=reg"); await p.waitForTimeout(900);
  await p.evaluate(() => document.querySelectorAll("details[data-manager]").forEach(d => { d.hidden = false; d.open = true; }));
  await p.setInputFiles("#xFile", f.file); await p.waitForSelector("#xGo, #xMsg .bad", { timeout: 180000 });
  if (!await p.locator("#xGo").count()) { console.log(f.code, "CANNOT READ:", (await p.locator("#xMsg").innerText()).slice(0, 200)); bad++; await p.close(); continue; }
  const kpi = (await p.locator("#xPrev .kpis").innerText()).replace(/\s+/g, " ");
  await p.click("#xGo"); await p.waitForFunction(() => document.querySelector("#xMsg").innerText.trim().length > 0, null, { timeout: 180000 }); await p.waitForTimeout(500);
  const calls = await p.evaluate(() => window.__calls.filter(c => c[0] === "rpc" && /^pm_import/.test(c[1]) && c[2].p_rows && c[2].p_rows.length).map(c => ({ y: c[2].p_year, rows: c[2].p_rows })));
  await p.close();
  const rows = calls.flatMap(c => c.rows), year = calls.length ? calls[0].y : null; total += rows.length;
  if (dry) { console.log(f.code, "| year", year, "| rows", rows.length, "|", kpi); continue; }
  let up = 0, add = 0, err = null;
  for (let i = 0; i < rows.length && !err; i += 500) {
    const r = await fetch(`${URL_}/rest/v1/rpc/pm_import_token`, { method: "POST", headers: { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json" }, body: JSON.stringify({ p_token: token, p_code: f.code, p_year: year, p_rows: rows.slice(i, i + 500) }) });
    const t = await r.text(); if (!r.ok) { err = `HTTP ${r.status} ${t.slice(0, 300)}`; break; }
    const j = JSON.parse(t); up += j.updated || 0; add += j.added || 0;
  }
  if (err) bad++;
  console.log(f.code, "| year", year, "| rows", rows.length, "| updated", up, "| added", add, err ? "| ERROR " + err : "| OK");
}
await browser.close(); fs.rmSync(tmp, { recursive: true, force: true });
console.log(`TOTAL ${files.length} files, ${total} rows, ${bad} with errors${dry ? " (dry run, nothing sent)" : ""}`);
process.exit(bad ? 1 : 0);
