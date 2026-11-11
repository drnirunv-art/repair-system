// Daily operation logs (OP check sheets) + meter registry and water/electric use summary.
(() => {
  const { sb, $, esc, fmt, errText, opts } = RS;
  const MANAGER = ["owner", "admin", "chief_engineer", "supervisor"];
  const TABS = ["today", "sheet", "meter", "points"];
  const TH_M = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
  let me = null, H = null, staff = [], forms = [], points = [], dayLogs = [], channel = null, cur = null, editPt = null, sheetRows = [];
  const store = { get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
  const isMgr = () => me && MANAGER.includes(me.role);
  const can = () => me && me.role !== "observer";
  const day = d => new Date(d).toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
  const today = () => day(Date.now());
  const addDays = (d, n) => day(new Date(d + "T12:00:00+07:00").getTime() + n * 864e5);
  const nameOf = id => (staff.find(s => s.id === id) || {}).full_name || "";
  const formOf = id => forms.find(f => f.id === id) || { fields: [], title: "?" };
  const where = p => [p.building, p.floor, p.place].filter(Boolean).join(" · ");
  const crit = f => f.t === "ok" ? (f.s || "ปกติ") : f.t === "read" ? (f.hi != null ? `ใช้/วัน ≤ ${f.hi}` : "ค่าสะสม") : f.lo != null && f.hi != null ? `${f.lo}–${f.hi}` : f.hi != null ? `≤ ${f.hi}` : f.lo != null ? `≥ ${f.lo}` : f.s || "บันทึกค่า";
  const num = v => v === "" || v == null ? null : +v;
  const kpis = arr => arr.map(([a, b, red]) => `<div class="kpi"><b style="${red && +b > 0 ? "color:var(--bad)" : ""}">${b}</b><span>${a}</span></div>`).join("");
  function toast(m) { $("#toast").textContent = m; $("#toast").hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => $("#toast").hidden = true, 6000); }
  function csv(name, head, rows) {
    const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const blob = new Blob(["﻿" + [head.map(q).join(","), ...rows.map(r => r.map(q).join(","))].join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a); a.click(); a.remove();
  }
  const note = (el, err, ok) => { $(el).innerHTML = err ? `<div class="note bad">${esc(errText(err))}</div>` : ok ? `<div class="note">${esc(ok)}</div>` : ""; };
  const badField = (f, v, use) => {
    if (v === "" || v == null) return false;
    if (f.t === "ok") return v === "x";
    if (f.t === "read") return use != null && f.hi != null && use > f.hi;
    if (f.t === "num") return (f.lo != null && +v < f.lo) || (f.hi != null && +v > f.hi);
    return false;
  };

  /* ---------- boot ---------- */
  const q0 = new URLSearchParams(location.search);
  sb.auth.onAuthStateChange((_e, session) => setTimeout(() => boot(session), 0));
  async function boot(session) {
    if (channel) { sb.removeChannel(channel); channel = null; }
    if (!session) { $("#gate").hidden = false; return; }
    const { data } = await sb.from("profiles").select("id,full_name,role,hospital_id,hospitals(id,code,name)").eq("id", session.user.id).maybeSingle();
    me = data;
    if (!me || !me.hospital_id) { $("#gate").hidden = false; return; }
    H = me.hospitals; $("#gate").hidden = true;
    $("#title").textContent = "บันทึกประจำวัน OP · " + H.name; $("#who").textContent = me.full_name || session.user.email;
    const [s, f] = await Promise.all([sb.from("profiles").select("id,full_name").eq("hospital_id", H.id), sb.from("op_forms").select("*").eq("active", true).order("sort")]);
    staff = s.data || []; forms = f.data || [];
    await loadPoints();
    document.querySelectorAll("[data-manager]").forEach(b => b.hidden = !isMgr());
    $("#tabs").hidden = false;
    opts($("#pForm"), forms.map(x => [x.id, `${x.code} · ${x.title}`]));
    channel = sb.channel("op-" + H.id).on("postgres_changes", { event: "*", schema: "public", table: "op_logs", filter: "hospital_id=eq." + H.id }, () => { if (!$("#tab-today").hidden && !cur) renderToday(); }).subscribe();
    if (q0.get("pt")) { show("today"); return openEntry(q0.get("pt")); }
    show(q0.get("tab") || store.get("rs-op-tab", "today"));
  }
  async function loadPoints() {
    const r = await sb.from("op_points").select("*").eq("hospital_id", H.id).eq("active", true).order("sort").order("name");
    points = r.data || [];
    const fs = [...new Set(points.map(p => p.form_id))];
    opts($("#tForm"), [["", "ทุกแบบฟอร์ม"], ...forms.filter(f => fs.includes(f.id)).map(f => [f.id, f.code + " · " + f.title.split(" · ")[0]])]);
    opts($("#sPoint"), points.map(p => [p.id, `${p.name}${where(p) ? " (" + where(p) + ")" : ""}`]));
  }
  document.querySelectorAll("#tabs button").forEach(b => b.onclick = () => show(b.dataset.tab));
  function show(t) {
    if (!TABS.includes(t)) t = "today";
    document.querySelectorAll("#tabs button").forEach(b => b.setAttribute("aria-selected", b.dataset.tab === t));
    TABS.forEach(x => $("#tab-" + x).hidden = x !== t);
    store.set("rs-op-tab", t); cur = null;
    ({ today: renderToday, sheet: renderSheet, meter: renderMeter, points: renderPoints })[t]();
  }
  $("#tDate").value = $("#mDate").value = today(); $("#sMonth").value = today().slice(0, 7);
  $("#tDate").onchange = () => { cur = null; renderToday(); }; $("#tQ").oninput = () => renderToday(true); $("#tForm").onchange = () => renderToday(true);
  $("#sPoint").onchange = $("#sMonth").onchange = () => renderSheet(); $("#mDate").onchange = () => renderMeter();
  ["#sPrint", "#mPrint"].forEach(s => $(s).onclick = () => window.print());

  /* ---------- today: points to log ---------- */
  async function renderToday(local) {
    if (!local) { const r = await sb.from("op_logs").select("*").eq("hospital_id", H.id).eq("log_date", $("#tDate").value); dayLogs = r.data || []; }
    const qq = $("#tQ").value.trim().toLowerCase(), ff = $("#tForm").value;
    const list = points.filter(p => (!ff || p.form_id === ff) && (!qq || [p.name, where(p), formOf(p.form_id).title].join(" ").toLowerCase().includes(qq)));
    const logOf = id => dayLogs.find(l => l.point_id === id);
    const done = points.filter(p => logOf(p.id)).length, bad = dayLogs.filter(l => l.abnormal > 0).length;
    $("#tKpi").innerHTML = kpis([["จุดตรวจทั้งหมด", points.length], ["บันทึกแล้ว", done], ["ยังไม่บันทึก", points.length - done, true], ["มีค่าผิดปกติ", bad, true], ["% บันทึก", points.length ? Math.round(100 * done / points.length) + "%" : "-"]]);
    if (!points.length) { $("#tList").innerHTML = `<div class="note">ยังไม่มีจุดตรวจ${isMgr() ? " · ไปที่แท็บ “จุดตรวจ & มิเตอร์” เพื่อเพิ่ม เช่น MDB อาคาร A, Generator 1, มิเตอร์ไฟไตเทียม" : " · แจ้งหัวหน้าให้เพิ่มจุดตรวจ"}</div>`; return; }
    list.sort((a, b) => !!logOf(a.id) - !!logOf(b.id) || formOf(a.form_id).sort - formOf(b.form_id).sort);
    $("#tList").innerHTML = list.map(p => { const l = logOf(p.id), f = formOf(p.form_id);
      return `<div class="job"><div><h4>${esc(p.name)}</h4><div class="meta">${esc(f.code)} · ${esc(f.title.split(" · ")[0])}${where(p) ? " · " + esc(where(p)) : ""}${p.meter_no ? " · No." + esc(p.meter_no) : ""}${+p.multiplier !== 1 ? " · ×" + p.multiplier : ""}</div>
        ${l ? `<div class="meta">บันทึกโดย ${esc(nameOf(l.logged_by))} ${fmt(l.logged_at)}${Object.keys(l.usage || {}).length ? " · ใช้ " + Object.entries(l.usage).map(([k, v]) => `${v} ${esc((f.fields.find(x => x.k === k) || {}).u || "")}`).join(", ") : ""}</div>` : ""}</div>
        <div class="side">${l ? (l.abnormal ? `<span class="pill" style="color:var(--bad)">ผิดปกติ ${l.abnormal}</span>` : `<span class="pill" style="color:var(--s-close)">ปกติ</span>`) : `<span class="pill" style="color:var(--s-register)">ยังไม่บันทึก</span>`}
        <button class="btn small${l ? "" : " primary"}" data-entry="${p.id}">${l ? "ดู / แก้" : "บันทึก"}</button></div></div>`; }).join("") || '<div class="empty">ไม่พบจุดตรวจ</div>';
  }
  document.addEventListener("click", e => { const t = e.target.closest("[data-entry]"); if (t) openEntry(t.dataset.entry); });

  async function openEntry(id) {
    const p = points.find(x => x.id === id); if (!p) return toast("ไม่พบจุดตรวจ");
    const f = formOf(p.form_id), d = $("#tDate").value;
    const [cr, pr] = await Promise.all([
      sb.from("op_logs").select("*").eq("point_id", id).eq("log_date", d).maybeSingle(),
      sb.from("op_logs").select("*").eq("point_id", id).lt("log_date", d).order("log_date", { ascending: false }).limit(1).maybeSingle()]);
    cur = { p, f, log: cr.data, prev: pr.data, vals: { ...((cr.data || {}).values || {}) } };
    $("#tList").innerHTML = ""; window.scrollTo(0, 0);
    $("#tEntry").innerHTML = `<form class="panel" id="fLog"><div class="row" style="justify-content:space-between"><div><h2 style="margin:0">${esc(p.name)}</h2>
      <div class="meta">${esc(f.code)} · ${esc(f.title)}${where(p) ? " · " + esc(where(p)) : ""}${p.meter_no ? " · No." + esc(p.meter_no) : ""}${+p.multiplier !== 1 ? " · ตัวคูณ ×" + p.multiplier : ""}</div>
      <div class="meta">วันที่ ${esc(d)}${cur.prev ? ` · ครั้งก่อน ${esc(cur.prev.log_date)}` : ""}${cur.log ? ` · บันทึกแล้วโดย ${esc(nameOf(cur.log.logged_by))} ${fmt(cur.log.logged_at)}` : ""}</div></div>
      <button class="btn" type="button" id="lBack">← กลับ</button></div>
      ${f.fields.map(fl => fieldInput(fl)).join("")}
      <label class="full" style="margin-top:10px">บันทึกเหตุผิดปกติ / หมายเหตุ<input id="lNote" value="${esc((cur.log || {}).note || "")}"></label>
      ${can() ? `<div class="row" style="margin-top:12px"><button class="btn primary">บันทึก</button></div>` : ""}<div id="lMsg"></div></form>`;
    f.fields.forEach(fl => paint(fl.k));
  }
  function fieldInput(f) {
    const v = cur.vals[f.k] ?? "", pv = cur.prev && cur.prev.values[f.k];
    const inp = f.t === "ok" ? `<div class="yn"><label><input type="radio" name="v-${f.k}" value="/" data-k="${f.k}"${v === "/" ? " checked" : ""}>/ ปกติ</label><label><input type="radio" name="v-${f.k}" value="x" data-k="${f.k}"${v === "x" ? " checked" : ""}>× ผิดปกติ</label></div>`
      : f.t === "text" ? `<input data-k="${f.k}" value="${esc(v)}">`
      : `<input data-k="${f.k}" type="number" step="any" inputmode="decimal" value="${esc(v)}">`;
    return `<div class="fld" id="f-${f.k}"><div><b>${esc(f.l)}</b>${f.u ? ` <span class="meta">(${esc(f.u)})</span>` : ""}<div class="meta">เกณฑ์: ${esc(crit(f))}${f.t === "read" && pv != null ? ` · ครั้งก่อน ${esc(pv)}` : ""}</div><div class="meta" id="u-${f.k}"></div></div>${inp}</div>`;
  }
  function paint(k) {
    const f = cur.f.fields.find(x => x.k === k), v = cur.vals[k], pv = cur.prev && cur.prev.values[k];
    let use = null;
    if (f.t === "read" && v !== "" && v != null && pv != null) { use = Math.round((+v - +pv) * (+cur.p.multiplier || 1) * 100) / 100; $("#u-" + k).innerHTML = use < 0 ? '<b style="color:var(--bad)">ต่ำกว่าครั้งก่อน ตรวจเลขอีกครั้ง</b>' : `ใช้ไป ${use} ${esc(f.u || "")}`; }
    $("#f-" + k).classList.toggle("bad", badField(f, v, use) || (use != null && use < 0));
  }
  document.addEventListener("input", e => { const k = e.target.dataset && e.target.dataset.k; if (!k || !cur) return; cur.vals[k] = e.target.value; paint(k); });
  document.addEventListener("click", e => { if (e.target.id === "lBack") { cur = null; $("#tEntry").innerHTML = ""; renderToday(); } });
  document.addEventListener("submit", async ev => {
    if (ev.target.id !== "fLog") return; ev.preventDefault();
    const empty = cur.f.fields.filter(f => f.t !== "text" && (cur.vals[f.k] === "" || cur.vals[f.k] == null));
    if (empty.length && !confirm(`ยังไม่ได้กรอก ${empty.length} ช่อง (${empty.map(f => f.l).slice(0, 3).join(", ")}${empty.length > 3 ? "…" : ""}) บันทึกต่อไหม`)) return;
    const { data, error } = await sb.rpc("op_save", { p_point: cur.p.id, p_date: $("#tDate").value, p_values: cur.vals, p_note: $("#lNote").value });
    if (error) return note("#lMsg", error);
    toast(data && data.abnormal ? `บันทึกแล้ว มีค่าผิดปกติ ${data.abnormal} ช่อง` : "บันทึกแล้ว");
    cur = null; $("#tEntry").innerHTML = ""; renderToday();
  });

  /* ---------- monthly sheet (same layout as the paper form) ---------- */
  async function renderSheet() {
    const p = points.find(x => x.id === $("#sPoint").value);
    if (!p) { $("#sBody").innerHTML = '<div class="empty">ยังไม่มีจุดตรวจ</div>'; return; }
    const f = formOf(p.form_id), [y, m] = $("#sMonth").value.split("-").map(Number), d0 = `${$("#sMonth").value}-01`, n = new Date(y, m, 0).getDate(), d1 = `${$("#sMonth").value}-${n}`;
    const r = await sb.from("op_logs").select("*").eq("point_id", p.id).gte("log_date", d0).lte("log_date", d1);
    const logs = r.data || [], by = Object.fromEntries(logs.map(l => [+l.log_date.slice(8), l]));
    const cols = f.fields.flatMap(fl => fl.t === "read" ? [{ ...fl, sub: "อ่านค่า" }, { ...fl, sub: "ใช้/วัน", use: true }] : [fl]);
    sheetRows = [...Array(n)].map((_, i) => { const l = by[i + 1]; return { d: i + 1, l, vals: cols.map(c => l ? (c.use ? (l.usage || {})[c.k] : l.values[c.k]) : "") }; });
    const agg = (i, fn) => { const xs = sheetRows.map(r => r.vals[i]).filter(v => v !== "" && v != null && !isNaN(+v)).map(Number); return xs.length ? fn(xs) : ""; };
    const sum = xs => Math.round(xs.reduce((a, b) => a + b, 0) * 100) / 100, avg = xs => Math.round(xs.reduce((a, b) => a + b, 0) / xs.length * 100) / 100;
    $("#sBody").innerHTML = `<div class="panel"><div style="text-align:center"><b>${esc(f.title)}</b><br><span class="meta">${esc(H.name)} · ${esc(p.name)} · อาคาร ${esc(p.building || "-")} · ชั้น ${esc(p.floor || "-")} · สถานที่ ${esc(p.place || "-")} · เดือน ${TH_M[m - 1]} ปี พ.ศ. ${y + 543}${p.meter_no ? " · No." + esc(p.meter_no) : ""}${p.brand ? " · " + esc(p.brand) : ""}</span></div>
      <div class="scroll" style="margin-top:10px"><table class="op"><tr><th rowspan="2">วันที่</th><th rowspan="2">เวลา</th>${cols.map(c => `<th>${esc(c.l)}${c.sub ? `<br>${c.sub}` : ""}${c.u ? `<br>(${esc(c.u)})` : ""}</th>`).join("")}<th rowspan="2">ผู้บันทึก</th><th rowspan="2">หมายเหตุ</th></tr>
        <tr>${cols.map(c => `<th style="font-weight:400">${esc(c.use ? "วันนี้ − ครั้งก่อน" : crit(c))}</th>`).join("")}</tr>
        ${sheetRows.map(r => `<tr><td>${r.d}</td><td>${r.l ? new Date(r.l.logged_at).toLocaleTimeString("th-TH", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit" }) : ""}</td>${cols.map((c, i) => { const v = r.vals[i];
          return `<td class="${r.l && !c.use && (r.l.bad_keys || []).includes(c.k) ? "bad" : ""}">${c.t === "ok" ? (v === "x" ? "×" : v === "/" ? "/" : "") : esc(v ?? "")}</td>`; }).join("")}<td>${r.l ? esc(nameOf(r.l.logged_by)) : ""}</td><td style="white-space:normal;text-align:left">${r.l ? esc(r.l.note || "") : ""}</td></tr>`).join("")}
        <tr><th colspan="2">รวม</th>${cols.map((c, i) => `<th>${c.use ? agg(i, sum) : ""}</th>`).join("")}<th colspan="2"></th></tr>
        <tr><th colspan="2">เฉลี่ย</th>${cols.map((c, i) => `<th>${c.t === "num" || c.use ? agg(i, avg) : ""}</th>`).join("")}<th colspan="2"></th></tr></table></div>
      <p class="meta">สัญลักษณ์ (/) = ปกติ, (×) = ผิดปกติ · บันทึกแล้ว ${logs.length} จาก ${n} วัน · ค่าผิดปกติ ${logs.reduce((s, l) => s + l.abnormal, 0)} ช่อง</p>
      <div class="two" style="margin-top:24px"><div>ตรวจสอบโดย หัวหน้างาน / วิศวกร บริษัท Technical Water (TW)<br><br>ลงชื่อ ……………………………………… วันที่ ……………</div><div>ตรวจสอบโดย ผู้จัดการอาคาร<br><br>ลงชื่อ ……………………………………… วันที่ ……………</div></div></div>`;
    $("#sCsv").onclick = () => csv(`${f.code}-${p.name}-${$("#sMonth").value}.csv`, ["วันที่", ...cols.map(c => c.l + (c.sub ? " " + c.sub : "") + (c.u ? ` (${c.u})` : "")), "ผู้บันทึก", "หมายเหตุ"],
      sheetRows.map(r => [r.d, ...r.vals.map((v, i) => cols[i].t === "ok" ? (v === "x" ? "×" : v) : v), r.l ? nameOf(r.l.logged_by) : "", r.l ? r.l.note || "" : ""]));
  }

  /* ---------- meter summary: day vs yesterday, vs same day last week, month vs last month ---------- */
  let meterRows = [];
  async function renderMeter() {
    const d = $("#mDate").value, mPts = points.filter(p => formOf(p.form_id).fields.some(f => f.t === "read") && /^OP-22/.test(formOf(p.form_id).code));
    const m0 = d.slice(0, 8) + "01", pm0 = addDays(m0, -1).slice(0, 8) + "01";
    const r = await sb.from("op_logs").select("point_id,log_date,usage").eq("hospital_id", H.id).gte("log_date", pm0).lte("log_date", d);
    const L = r.data || [], useOn = (pid, dd) => { const l = L.find(x => x.point_id === pid && x.log_date === dd); return l ? Object.values(l.usage || {})[0] : null; };
    const avgIn = (pid, a, b) => { const xs = L.filter(x => x.point_id === pid && x.log_date >= a && x.log_date <= b).map(x => Object.values(x.usage || {})[0]).filter(v => v != null); return xs.length ? Math.round(xs.reduce((s, v) => s + +v, 0) / xs.length * 100) / 100 : null; };
    const pct = (a, b) => a == null || b == null || !+b ? "" : Math.round((a - b) / b * 100);
    const cell = (a, b) => { const p = pct(a, b); return `<td class="num">${a ?? "-"}</td><td class="num">${b ?? "-"}</td><td class="num"${p !== "" && Math.abs(p) >= 20 ? ' style="color:var(--bad);font-weight:700"' : ""}>${p === "" ? "" : (p > 0 ? "+" : "") + p + "%"}</td>`; };
    meterRows = mPts.map(p => { const u = (formOf(p.form_id).fields.find(f => f.t === "read") || {}).u || "";
      const t = useOn(p.id, d), y = useOn(p.id, addDays(d, -1)), w = useOn(p.id, addDays(d, -7)), am = avgIn(p.id, m0, d), apm = avgIn(p.id, pm0, addDays(m0, -1));
      return { p, u, t, y, w, am, apm }; });
    $("#mTable").innerHTML = `<tr><th rowspan="2">มิเตอร์</th><th rowspan="2">หน่วย</th><th colspan="3">วันนี้ vs เมื่อวาน</th><th colspan="3">วันนี้ vs วันเดียวกันสัปดาห์ก่อน</th><th colspan="3">เฉลี่ย/วัน เดือนนี้ vs เดือนก่อน</th></tr>
      <tr><th class="num">วันนี้</th><th class="num">เมื่อวาน</th><th class="num">ต่าง</th><th class="num">วันนี้</th><th class="num">สัปดาห์ก่อน</th><th class="num">ต่าง</th><th class="num">เดือนนี้</th><th class="num">เดือนก่อน</th><th class="num">ต่าง</th></tr>` +
      (meterRows.map(x => `<tr><td>${esc(x.p.name)}${x.p.meter_no ? `<br><small class="meta">No.${esc(x.p.meter_no)}</small>` : ""}</td><td>${esc(x.u)}</td>${cell(x.t, x.y)}${cell(x.t, x.w)}${cell(x.am, x.apm)}</tr>`).join("")
        || `<tr><td colspan="11"><div class="empty">ยังไม่มีมิเตอร์ (เพิ่มจุดตรวจด้วยแบบ OP-22E มิเตอร์ไฟ หรือ OP-22W มิเตอร์น้ำ)</div></td></tr>`);
  }
  $("#mCsv").onclick = () => csv(`มิเตอร์-${H.code}-${$("#mDate").value}.csv`, ["มิเตอร์", "เลขมิเตอร์", "หน่วย", "วันนี้", "เมื่อวาน", "สัปดาห์ก่อน", "เฉลี่ย/วัน เดือนนี้", "เฉลี่ย/วัน เดือนก่อน"],
    meterRows.map(x => [x.p.name, x.p.meter_no, x.u, x.t, x.y, x.w, x.am, x.apm]));

  /* ---------- points & meter registry ---------- */
  function renderPoints() {
    $("#pTable").innerHTML = `<tr><th>ชื่อจุด</th><th>แบบฟอร์ม</th><th>ที่ตั้ง</th><th>เลขมิเตอร์ / No.</th><th class="num">ตัวคูณ</th><th class="noprint"></th></tr>` +
      (points.map(p => `<tr><td>${esc(p.name)}</td><td>${esc(formOf(p.form_id).code)} · ${esc(formOf(p.form_id).title.split(" · ")[0])}</td><td>${esc(where(p))}</td><td>${esc(p.meter_no || "")}</td><td class="num">${p.multiplier}</td>
        <td class="noprint">${isMgr() ? `<button class="btn small" data-ptedit="${p.id}">แก้</button> <button class="btn small" data-ptoff="${p.id}">ปิดใช้</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="6"><div class="empty">ยังไม่มีจุดตรวจ</div></td></tr>`);
    $("#pGrid").innerHTML = "";
  }
  function resetPt() { editPt = null; $("#fPt").reset(); $("#pMul").value = 1; $("#pTitle").textContent = "เพิ่มจุดตรวจ"; $("#pMsg").innerHTML = ""; }
  $("#pReset").onclick = resetPt;
  $("#fPt").onsubmit = async e => {
    e.preventDefault();
    const row = { form_id: $("#pForm").value, name: $("#pName").value.trim(), building: $("#pB").value.trim() || null, floor: $("#pF").value.trim() || null, place: $("#pP").value.trim() || null,
      meter_no: $("#pNo").value.trim() || null, multiplier: +$("#pMul").value || 1, brand: $("#pBrand").value.trim() || null };
    const r = editPt ? await sb.from("op_points").update(row).eq("id", editPt) : await sb.from("op_points").insert({ ...row, hospital_id: H.id, sort: points.length + 1 });
    if (r.error) return note("#pMsg", r.error);
    toast(editPt ? "แก้ไขแล้ว" : "เพิ่มจุดตรวจแล้ว"); resetPt(); await loadPoints(); renderPoints();
  };
  document.addEventListener("click", async e => {
    const ed = e.target.closest("[data-ptedit]");
    if (ed) { const p = points.find(x => x.id === ed.dataset.ptedit); editPt = p.id; $("#pTitle").textContent = "แก้ไข " + p.name;
      $("#pForm").value = p.form_id; $("#pName").value = p.name; $("#pB").value = p.building || ""; $("#pF").value = p.floor || ""; $("#pP").value = p.place || ""; $("#pNo").value = p.meter_no || ""; $("#pMul").value = p.multiplier; $("#pBrand").value = p.brand || "";
      $("#fPt").scrollIntoView({ behavior: "smooth" }); return; }
    const off = e.target.closest("[data-ptoff]");
    if (off) { if (!confirm("ปิดใช้จุดตรวจนี้? (ข้อมูลที่บันทึกไว้ยังอยู่)")) return; const r = await sb.from("op_points").update({ active: false }).eq("id", off.dataset.ptoff); if (r.error) return toast(errText(r.error)); await loadPoints(); renderPoints(); }
  });
  $("#pQr").onclick = () => {
    $("#pGrid").innerHTML = points.map(p => { const u = new URL("op.html", location.href); u.search = ""; u.searchParams.set("pt", p.id); const q = qrcode(0, "M"); q.addData(u.toString()); q.make();
      return `<div><small>${esc(H.name)} · บันทึกประจำวัน</small><img src="${q.createDataURL(4, 2)}" alt="QR ${esc(p.name)}"><b>${esc(p.name)}</b><small>${esc(formOf(p.form_id).code)} · ${esc(where(p))}</small></div>`; }).join("");
    setTimeout(() => window.print(), 300);
  };
})();
