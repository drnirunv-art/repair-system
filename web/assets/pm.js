// PM Inhouse: preventive maintenance by QR — monthly tasks, check sheets (sign 1/3), head 2/3, engineer 3/3,
// results, equipment registry + yearly plan, QR stickers and check-sheet templates.
(() => {
  const { sb, $, esc, fmt, errText, opts, uploadMedia, signed } = RS;
  const MANAGER = ["owner", "admin", "chief_engineer", "supervisor"];
  const HEAD = ["owner", "admin", "chief_engineer", "supervisor", "senior_technician"];
  const ENG = ["owner", "admin", "chief_engineer"];
  const TABS = ["work", "sign", "result", "plan", "follow", "reg", "qr", "tpl"];
  const ST = { todo: "ยังไม่ตรวจ", submitted: "ช่างส่งแล้ว รอหัวหน้า 2/3", head_signed: "รอวิศวกร 3/3", approved: "อนุมัติครบ 3/3", returned: "ถูกส่งกลับ ให้แก้" };
  const STC = { todo: "register", submitted: "assign", head_signed: "work_on", approved: "close", returned: "on_hold" };
  const LV = { ok: "ปกติ", wear: "เริ่มเสื่อม", bad: "ผิดปกติ" };
  const FREQ = { M: "รายเดือน", Q: "ราย 3 เดือน", H: "ราย 6 เดือน", Y: "รายปี" };
  const TH_M = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
  let me = null, H = null, staff = [], equipAll = [], equip = [], tpls = [], tasks = [], channel = null, week = 0, stat = "open", cur = null, scannedTag = null, editId = null, regLimit = 200;
  const store = { get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
  const role = () => me && me.role;
  const isMgr = () => MANAGER.includes(role()), isHead = () => HEAD.includes(role()), isEng = () => ENG.includes(role());
  const can = () => me && role() !== "observer";
  const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
  const ym = v => { const [y, m] = (v || today().slice(0, 7)).split("-").map(Number); return [y, m]; };
  const monthLabel = v => { const [y, m] = ym(v); return `${TH_M[m - 1]} ${y + 543}`; };
  const nameOf = id => (staff.find(s => s.id === id) || {}).full_name || "";
  const eqOf = id => equip.find(e => e.id === id) || {};
  const where = e => [e.building, e.floor, e.place].filter(Boolean).join(" · ");
  const tplFor = type => tpls.find(t => t.eq_type === type && t.hospital_id) || tpls.find(t => t.eq_type === type && !t.hospital_id) || tpls.find(t => t.eq_type === "ทั่วไป" && !t.hospital_id) || { items: [] };
  const hasOwnTpl = type => tpls.some(t => t.eq_type === type);
  const kpis = arr => arr.map(([a, b, red]) => `<div class="kpi"><b style="${red && +b > 0 ? "color:var(--bad)" : ""}">${b}</b><span>${a}</span></div>`).join("");
  const bars = pairs => { const max = Math.max(1, ...pairs.map(p => p[1])); return pairs.length ? pairs.map(([k, v]) => `<div class="bar"><span>${esc(k)}</span><i style="width:${v / max * 100}%"></i><em>${v}</em></div>`).join("") : `<div class="empty">ไม่มี</div>`; };
  function toast(m) { $("#toast").textContent = m; $("#toast").hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => $("#toast").hidden = true, 6000); }
  function csvFile(name, head, rows) {
    const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const blob = new Blob(["﻿" + [head.map(q).join(","), ...rows.map(r => r.map(q).join(","))].join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a); a.click(); a.remove();
  }
  // every list export is a real .xlsx with an executive-summary sheet first (assets/office.js)
  const csv = (name, head, rows, opts) => Office.table(name, head, rows, { org: H && H.name, ...opts });
  const note = (el, err, ok) => { $(el).innerHTML = err ? `<div class="note bad">${esc(errText(err))}</div>` : ok ? `<div class="note">${esc(ok)}</div>` : ""; };
  const sig = t => `<div class="sig"><span class="${t.submitted_at ? "on" : ""}">ช่าง 1/3${t.tech_id ? " · " + esc(nameOf(t.tech_id)) : ""}</span><span class="${t.head_at ? "on" : ""}">หัวหน้า 2/3${t.head_id ? " · " + esc(nameOf(t.head_id)) : ""}</span><span class="${t.eng_at ? "on" : ""}">วิศวกร 3/3${t.eng_id ? " · " + esc(nameOf(t.eng_id)) : ""}</span></div>`;
  const weekOfDay = d => Math.min(4, Math.ceil(d / 7));

  /* ---------- boot ---------- */
  const q0 = new URLSearchParams(location.search);
  // scope of the page: PM Inhouse = machines maintained by TW, PM MA = machines maintained by a contractor ("TW/MA" in the template shows in both)
  const SC = (q0.get("by") || "").toUpperCase() === "MA" ? "MA" : "TW", SCN = SC === "MA" ? "PM MA" : "PM Inhouse";
  const inScope = e => SC === "MA" ? (e.pm_by === "MA" || /MA/i.test(e.pm_by_raw || "")) : e.pm_by !== "MA";
  $("#scTag").textContent = SCN; $("#sc" + SC).classList.add("primary"); document.title = SCN + " บำรุงรักษาตามแผน | Repair System";
  $("#scNote").textContent = SC === "MA" ? "แสดงเฉพาะเครื่องที่ MAINTAIN BY = MA (ผู้รับเหมา)" : "แสดงเฉพาะเครื่องที่ MAINTAIN BY = TW";
  scannedTag = q0.get("tag");
  if (q0.get("h")) $("#gateLink").href = "staff.html?h=" + encodeURIComponent(q0.get("h"));
  sb.auth.onAuthStateChange((_e, session) => setTimeout(() => boot(session), 0));
  async function boot(session) {
    if (channel) { sb.removeChannel(channel); channel = null; }
    if (!session) { $("#gate").hidden = false; return; }
    const { data } = await sb.from("profiles").select("id,full_name,role,hospital_id,hospitals(id,code,name)").eq("id", session.user.id).maybeSingle();
    me = data;
    if (!me || !me.hospital_id) { $("#gate").hidden = false; return; }
    H = me.hospitals; $("#gate").hidden = true;
    $("#title").textContent = SCN + " บำรุงรักษาตามแผน · " + H.name; $("#who").textContent = me.full_name || session.user.email;
    await Promise.all([loadStaff(), loadEquip(), loadTpls()]);
    document.querySelectorAll("[data-manager]").forEach(b => b.hidden = !isMgr());
    $("#signTab").hidden = !isHead();
    $("#tabs").hidden = false;
    fillFilters();
    channel = sb.channel("pm-" + H.id).on("postgres_changes", { event: "*", schema: "public", table: "pm_tasks", filter: "hospital_id=eq." + H.id }, () => {
      if (!$("#tab-work").hidden) renderWork(); if (!$("#tab-sign").hidden) renderSign(); if (!$("#tab-result").hidden) renderResult(); signCount();
    }).subscribe();
    signCount();
    if (scannedTag) { const t = scannedTag; scannedTag = null; history.replaceState(null, "", location.pathname + (q0.get("h") ? "?h=" + q0.get("h") : "")); return openByTag(t, true); }
    show(q0.get("tab") || store.get("rs-pm-tab", "work"));
  }
  const loadStaff = async () => { const r = await sb.from("profiles").select("id,full_name,role").eq("hospital_id", H.id); staff = r.data || []; };
  async function loadEquip() {
    const out = [];
    for (let from = 0; ; from += 1000) {
      const r = await sb.from("equipment").select("*").eq("hospital_id", H.id).eq("active", true).order("tag", { nullsFirst: false }).order("name").range(from, from + 999);
      if (r.error) { toast(errText(r.error)); break; }
      out.push(...r.data); if (r.data.length < 1000) break;
    }
    equipAll = out; equip = out.filter(inScope);
  }
  const loadTpls = async () => { const r = await sb.from("pm_templates").select("*"); tpls = r.data || []; };
  async function loadTasks(v) {
    const [y, m] = ym(v);
    const r = await sb.from("pm_tasks").select("*").eq("hospital_id", H.id).eq("year", y).eq("month", m);
    if (r.error) { toast(errText(r.error)); return []; }
    const ok = new Set(equip.map(e => e.id)); return (r.data || []).filter(t => ok.has(t.equipment_id));
  }
  function fillFilters() {
    const uniq = f => [...new Set(equip.map(f).filter(Boolean))].sort((a, b) => a.localeCompare(b, "th"));
    const types = uniq(e => e.eq_type);
    opts($("#eT"), [["", "ทุกชนิด"], ...types.map(x => [x, x])]);
    opts($("#qT"), [["", "ทุกชนิด"], ...types.map(x => [x, x])]);
    opts($("#eB"), [["", "ทุกอาคาร"], ...uniq(e => e.building).map(x => [x, x])]);
    opts($("#qB"), [["", "ทุกอาคาร"], ...uniq(e => e.building).map(x => [x, x])]);
    opts($("#qF"), [["", "ทุกชั้น"], ...uniq(e => e.floor).map(x => [x, x])]);
    const all = [...new Set([...tpls.map(t => t.eq_type), ...types])].sort((a, b) => a === "ทั่วไป" ? -1 : b === "ทั่วไป" ? 1 : a.localeCompare(b, "th"));
    opts($("#tSel"), all.map(x => [x, x + (hasOwnTpl(x) ? "" : " (ยังไม่มี ใช้แบบทั่วไป)")]));
  }
  document.querySelectorAll("#tabs button").forEach(b => b.onclick = () => show(b.dataset.tab));
  function show(t) {
    if (!TABS.includes(t) || (t === "sign" && !isHead())) t = "work";
    document.querySelectorAll("#tabs button").forEach(b => b.setAttribute("aria-selected", b.dataset.tab === t));
    [...TABS, "sheet"].forEach(x => $("#tab-" + x).hidden = x !== t);
    store.set("rs-pm-tab", t);
    ({ work: renderWork, sign: renderSign, result: renderResult, plan: renderPlan, follow: renderFollow, reg: renderReg, qr: renderQr, tpl: renderTpl })[t]();
  }
  ["#wMonth", "#sMonth", "#rMonth", "#gMonth", "#fMonth"].forEach(s => $(s).value = today().slice(0, 7));
  $("#wMonth").onchange = () => renderWork(); $("#wQ").oninput = () => renderWork(true);
  $("#sMonth").onchange = () => renderSign(); $("#rMonth").onchange = () => renderResult();
  async function signCount() {
    if (!isHead()) return;
    const need = isEng() ? ["submitted", "head_signed"] : ["submitted"];
    const { data } = await sb.from("pm_tasks").select("equipment_id").eq("hospital_id", H.id).in("status", need);
    const ok = new Set(equip.map(e => e.id)), count = (data || []).filter(t => ok.has(t.equipment_id)).length;
    $("#signN").textContent = count ? `(${count})` : "";
  }

  /* ---------- work: this month's tasks ---------- */
  async function renderWork(local) {
    if (!local) tasks = await loadTasks($("#wMonth").value);
    const qq = $("#wQ").value.trim().toLowerCase();
    const base = tasks.map(t => ({ t, e: eqOf(t.equipment_id) })).filter(({ e }) => !qq || [e.tag, e.name, e.eq_type, where(e)].join(" ").toLowerCase().includes(qq));
    const inWeek = x => !week || x.t.week === week;
    const groups = { open: x => ["todo", "returned"].includes(x.t.status), done: x => !["todo", "returned"].includes(x.t.status), all: () => true };
    $("#wWeeks").innerHTML = [[0, "ทุกสัปดาห์"], [1, "W1 วันที่ 1–7"], [2, "W2 8–14"], [3, "W3 15–21"], [4, "W4 22–สิ้นเดือน"]].map(([w, l]) =>
      `<button class="chip" type="button" data-week="${w}" aria-pressed="${week === w}">${l} <b>${base.filter(x => (!w || x.t.week === w) && groups.open(x)).length}</b></button>`).join("");
    $("#wStat").innerHTML = [["open", "ยังไม่ทำ / ส่งกลับ"], ["done", "ทำแล้ว"], ["all", "ทั้งหมด"]].map(([k, l]) =>
      `<button class="chip" type="button" data-stat="${k}" aria-pressed="${stat === k}">${l} <b>${base.filter(x => inWeek(x) && groups[k](x)).length}</b></button>`).join("");
    const list = base.filter(x => inWeek(x) && groups[stat](x)).sort((a, b) => a.t.week - b.t.week || String(a.e.tag || a.e.name).localeCompare(String(b.e.tag || b.e.name)));
    const [, m] = ym($("#wMonth").value), curWeek = weekOfDay(+today().slice(8));
    $("#wMsg").innerHTML = tasks.length ? "" : `<div class="note">ยังไม่มีงาน PM ของ${monthLabel($("#wMonth").value)}${isMgr() ? " · ไปที่แท็บ “ทะเบียน & แผนปี” แล้วกด “สร้างงานเดือนนี้”" : " · แจ้งหัวหน้าให้สร้างงานของเดือน"}</div>`;
    $("#wList").innerHTML = list.map(({ t, e }) => `<div class="job"><div>
        <h4><span style="font-family:'IBM Plex Mono',monospace">${esc(e.tag || "(ไม่มี TAG)")}</span> · ${esc(e.name)}</h4>
        <div class="meta">${esc(e.eq_type || "ไม่ระบุชนิด")} · ${esc(where(e) || "-")} · W${t.week}${t.week < curWeek && ym($("#wMonth").value)[1] === m && ["todo", "returned"].includes(t.status) && $("#wMonth").value === today().slice(0, 7) ? ' · <b style="color:var(--bad)">เลยสัปดาห์แผน</b>' : ""} · ${e.pm_by || "TW"}</div>
        ${t.status === "returned" ? `<div class="meta" style="color:var(--bad)">ส่งกลับ: ${esc(t.return_reason || "")}</div>` : ""}
        ${t.submitted_at ? sig(t) : ""}</div>
      <div class="side">${RS.pill(STC[t.status], ST[t.status])}${t.score != null ? `<span class="meta">คะแนน ${t.score}${t.abnormal ? ` · <b style="color:var(--bad)">ผิดปกติ ${t.abnormal}</b>` : ""}${t.submitted_at && !t.scanned ? ' · <b style="color:var(--bad)">ไม่ได้สแกน QR</b>' : ""}</span>` : ""}
        <button class="btn small${["todo", "returned"].includes(t.status) ? " primary" : ""}" data-open="${t.id}">${["todo", "returned"].includes(t.status) && can() ? "เปิดใบตรวจ" : "ดูใบตรวจ"}</button></div></div>`).join("") || (tasks.length ? '<div class="empty">ไม่มีงานในกลุ่มนี้</div>' : "");
  }
  document.addEventListener("click", e => {
    const w = e.target.closest("[data-week]"); if (w) { week = +w.dataset.week; renderWork(true); return; }
    const s = e.target.closest("[data-stat]"); if (s) { stat = s.dataset.stat; renderWork(true); return; }
    const o = e.target.closest("[data-open]"); if (o) { openTask(o.dataset.open, false); }
  });

  /* ---------- QR scan (camera photo → jsQR) and opening by TAG ---------- */
  $("#wScan").onclick = () => $("#wScanFile").click();
  $("#wScanFile").onchange = async ev => {
    const f = ev.target.files[0]; ev.target.value = ""; if (!f) return;
    try {
      const bmp = await createImageBitmap(f), sc = Math.min(1, 1200 / Math.max(bmp.width, bmp.height));
      const c = Object.assign(document.createElement("canvas"), { width: Math.round(bmp.width * sc), height: Math.round(bmp.height * sc) });
      const ctx = c.getContext("2d"); ctx.drawImage(bmp, 0, 0, c.width, c.height);
      const img = ctx.getImageData(0, 0, c.width, c.height), code = window.jsQR && jsQR(img.data, c.width, c.height);
      if (!code) return toast("อ่าน QR ไม่ได้ ถ่ายใหม่ให้ QR อยู่กลางภาพและชัด");
      let tag = code.data;
      try { tag = new URL(code.data).searchParams.get("tag") || tag; } catch {}
      openByTag(tag, true);
    } catch (err) { toast(errText(err)); }
  };
  async function openByTag(tag, scanned) {
    const e = equip.find(x => (x.tag || "").toUpperCase() === String(tag).toUpperCase());
    if (!e) { show("work"); return toast(`ไม่พบเครื่อง TAG ${tag} ในทะเบียนของ ${H.name}`); }
    const [y, m] = ym(today().slice(0, 7));
    const { data } = await sb.from("pm_tasks").select("*").eq("equipment_id", e.id).eq("year", y).eq("month", m).maybeSingle();
    if (!data) { show("work"); return toast(`${e.tag} · ${e.name}: ไม่มีงาน PM ในเดือนนี้ (แผน: ${e.pm_freq ? FREQ[e.pm_freq] + " เดือน " + e.pm_months.join(",") : "ยังไม่มีแผน"})`); }
    openTask(data.id, scanned, data);
  }

  /* ---------- the check sheet ---------- */
  async function openTask(id, scanned, row) {
    const t = row || (await sb.from("pm_tasks").select("*").eq("id", id).single()).data;
    if (!t) return toast("ไม่พบใบตรวจ");
    const e = eqOf(t.equipment_id), editing = ["todo", "returned"].includes(t.status) && can();
    const items = editing ? tplFor(e.eq_type).items : t.items;
    cur = { t, e, items, scanned: !!scanned, answers: editing ? (t.status === "returned" ? JSON.parse(JSON.stringify(t.answers || [])) : items.map(() => ({ v: "", n: "", ph: [] }))) : t.answers };
    [...TABS].forEach(x => $("#tab-" + x).hidden = true); $("#tab-sheet").hidden = false; window.scrollTo(0, 0);
    const urls = editing ? {} : await signed((t.answers || []).flatMap(a => a.ph || []));
    const head = `<div class="panel"><div class="row" style="justify-content:space-between"><div><h2 style="margin:0"><span style="font-family:'IBM Plex Mono',monospace">${esc(e.tag || "")}</span> · ${esc(e.name)}</h2>
      <div class="meta">${esc(e.eq_type || "ไม่ระบุชนิด")}${hasOwnTpl(e.eq_type) ? "" : " (ใช้ check sheet ทั่วไป)"} · ${esc(where(e) || "-")} · แผน ${monthLabel(`${t.year}-${String(t.month).padStart(2, "0")}`)} W${t.week} · ${esc(e.pm_by || "TW")}</div></div>${RS.pill(STC[t.status], ST[t.status])}</div>
      ${t.status === "returned" ? `<div class="note bad" style="margin-top:10px">หัวหน้าส่งกลับให้แก้: ${esc(t.return_reason || "")}</div>` : ""}
      ${editing && !cur.scanned ? `<div class="note" style="margin-top:10px">เปิดจากรายการ ไม่ได้สแกน QR ที่ตัวเครื่อง ระบบจะติดป้าย “ไม่ได้สแกน QR” ในผลตรวจ</div>` : ""}</div>`;
    if (editing) {
      $("#shBody").innerHTML = head + `<form id="fSheet" class="panel" style="margin-top:12px"><h3>ตอบทุกข้อ ห้ามข้าม</h3>${items.map((it, i) => itemInput(it, i)).join("")}
        <label class="full" style="margin-top:12px">หมายเหตุรวม (ถ้ามี)<textarea id="shNote" rows="2">${esc(t.note || "")}</textarea></label>
        <div class="row" style="margin-top:12px"><button class="btn primary" type="button" id="shReview">ตรวจทาน</button></div><div id="shSum"></div><div id="shMsg"></div></form>`;
      paintAnswers();
    } else {
      $("#shBody").innerHTML = head + `<div class="panel" style="margin-top:12px"><div class="row" style="justify-content:space-between"><h3 style="margin:0">ผลตรวจ คะแนน ${t.score ?? "-"}${t.abnormal ? ` · <span style="color:var(--bad)">ผิดปกติ ${t.abnormal} ข้อ</span>` : ""}</h3>
        <span class="meta">${t.submitted_at ? "ส่งเมื่อ " + fmt(t.submitted_at) : ""}${t.submitted_at && !t.scanned ? ' · <b style="color:var(--bad)">ไม่ได้สแกน QR</b>' : ""}</span></div>
        ${(t.items || []).map((it, i) => answerView(it, (t.answers || [])[i] || {}, i, urls)).join("") || '<div class="empty">ยังไม่ได้ตรวจ</div>'}
        ${t.note ? `<p><b>หมายเหตุรวม:</b> ${esc(t.note)}</p>` : ""}${t.submitted_at ? sig(t) : ""}</div>${actionsFor(t)}`;
    }
  }
  const outOf = (it, v) => it.k === "value" && v !== "" && v != null && ((it.lo != null && +v < it.lo) || (it.hi != null && +v > it.hi));
  const crit = it => it.lo != null || it.hi != null ? `เกณฑ์ ${it.lo ?? ""}${it.lo != null && it.hi != null ? "–" : it.hi != null ? "≤ " : "≥ "}${it.hi ?? ""} ${esc(it.u || "")}` : it.u ? `หน่วย ${esc(it.u)}` : "";
  function itemInput(it, i) {
    return `<div class="item" id="it${i}"><div><b>${i + 1}.</b> ${esc(it.t)} ${it.ph ? '<span class="meta" style="color:var(--bad)">(ต้องถ่ายรูป)</span>' : ""}</div>
      ${it.k === "value" ? `<div class="row" style="margin-top:6px"><input type="number" step="any" inputmode="decimal" data-v="${i}" style="max-width:160px" placeholder="ค่าที่อ่านได้"> <span class="meta">${crit(it)}</span></div>`
        : `<div class="lv" style="margin-top:6px">${Object.entries(LV).map(([k, l]) => `<label><input type="radio" name="r${i}" value="${k}" data-v="${i}">${l}</label>`).join("")}</div>`}
      <div class="row" style="margin-top:6px"><input data-n="${i}" placeholder="หมายเหตุข้อนี้ (ถ้ามี)" style="flex:1;min-width:160px"><label class="btn small" style="cursor:pointer">📷 รูป<input type="file" accept="image/*" capture="environment" multiple hidden data-ph="${i}"></label><span class="meta" data-phn="${i}"></span></div></div>`;
  }
  function paintAnswers() {
    cur.answers.forEach((a, i) => {
      const it = cur.items[i]; if (!it) return;
      if (it.k === "value") { const el = document.querySelector(`input[data-v="${i}"]`); if (el) el.value = a.v ?? ""; }
      else { const el = document.querySelector(`input[name="r${i}"][value="${a.v}"]`); if (el) el.checked = true; }
      const n = document.querySelector(`input[data-n="${i}"]`); if (n) n.value = a.n || "";
      mark(i);
    });
  }
  function mark(i) {
    const a = cur.answers[i], it = cur.items[i];
    $("#it" + i).classList.toggle("bad", a.v === "bad" || outOf(it, a.v));
    const p = document.querySelector(`[data-phn="${i}"]`); if (p) p.textContent = (a.ph || []).length ? `แนบแล้ว ${a.ph.length} รูป` : "";
  }
  document.addEventListener("input", e => {
    if (!cur || !$("#fSheet")) return;
    const v = e.target.dataset.v, n = e.target.dataset.n;
    if (v !== undefined) { cur.answers[+v].v = e.target.value; mark(+v); $("#shSum").innerHTML = ""; }
    if (n !== undefined) cur.answers[+n].n = e.target.value;
  });
  document.addEventListener("change", async e => {
    const i = e.target.dataset && e.target.dataset.ph; if (i === undefined || !cur) return;
    const files = [...e.target.files]; e.target.value = ""; if (!files.length) return;
    const p = document.querySelector(`[data-phn="${i}"]`); p.textContent = "กำลังอัปโหลด...";
    try {
      // stamp date-time, TAG and sheet id on every photo before upload
      const stamped = await Promise.all(files.map(f => stamp(f, `${new Date().toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })} · ${cur.e.tag || ""} · PM ${cur.t.id.slice(0, 8)}`)));
      const paths = await uploadMedia(stamped, H.code, "pm");
      cur.answers[+i].ph = [...(cur.answers[+i].ph || []), ...paths]; mark(+i);
    } catch (err) { p.textContent = errText(err); }
  });
  async function stamp(file, text) {
    try {
      const bmp = await createImageBitmap(file), sc = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
      const c = Object.assign(document.createElement("canvas"), { width: Math.round(bmp.width * sc), height: Math.round(bmp.height * sc) }), ctx = c.getContext("2d");
      ctx.drawImage(bmp, 0, 0, c.width, c.height);
      const fs = Math.max(14, Math.round(c.width / 40)); ctx.font = `600 ${fs}px sans-serif`;
      ctx.fillStyle = "rgba(0,0,0,.6)"; ctx.fillRect(0, c.height - fs * 1.8, c.width, fs * 1.8); ctx.fillStyle = "#fff"; ctx.fillText(text, fs * .5, c.height - fs * .6);
      const blob = await new Promise(r => c.toBlob(r, "image/jpeg", .85));
      return new File([blob], "pm.jpg", { type: "image/jpeg" });
    } catch { return file; }
  }
  document.addEventListener("click", async e => {
    if (e.target.id === "shBack") { cur = null; return show(store.get("rs-pm-tab", "work")); }
    if (e.target.id === "shReview") {
      const miss = cur.answers.map((a, i) => (a.v === "" || a.v == null) ? i + 1 : 0).filter(Boolean);
      const noPh = cur.items.map((it, i) => it.ph && !(cur.answers[i].ph || []).length ? i + 1 : 0).filter(Boolean);
      const bad = cur.items.filter((it, i) => cur.answers[i].v === "bad" || outOf(it, cur.answers[i].v)).length;
      const photos = cur.answers.reduce((s, a) => s + (a.ph || []).length, 0);
      $("#shSum").innerHTML = `<div class="kpis" style="margin-top:12px">${kpis([["ตอบแล้ว", `${cur.items.length - miss.length}/${cur.items.length}`], ["รูป", photos], ["ผิดปกติ", bad, true], ["เวลา", new Date().toLocaleTimeString("th-TH", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit" })]])}</div>
        ${miss.length ? `<div class="note bad">ยังไม่ได้ตอบข้อ ${miss.join(", ")}</div>` : ""}${noPh.length ? `<div class="note bad">ข้อ ${noPh.join(", ")} ต้องถ่ายรูป</div>` : ""}
        ${!miss.length && !noPh.length ? `<button class="btn primary" type="button" id="shSend">ส่งผลตรวจ และลงชื่อ 1/3</button>` : ""}`;
      return;
    }
    if (e.target.id === "shSend") {
      e.target.disabled = true;
      const ans = cur.answers.map(a => ({ v: String(a.v), n: (a.n || "").trim(), ph: a.ph || [] }));
      const { data, error } = await sb.rpc("pm_submit", { p_task: cur.t.id, p_answers: ans, p_note: $("#shNote").value, p_scanned: cur.scanned });
      if (error) { e.target.disabled = false; return note("#shMsg", error); }
      toast(data ? `ส่งแล้ว มีข้อผิดปกติ ${data} ข้อ` : "ส่งผลตรวจแล้ว");
      return openTask(cur.t.id, false);
    }
    const a = e.target.closest("[data-act]"); if (!a || !cur) return;
    const act = a.dataset.act;
    if (act === "sign2" || act === "sign3") {
      const { error } = await sb.rpc("pm_sign", { p_tasks: [cur.t.id], p_level: act === "sign2" ? 2 : 3 });
      if (error) return note("#acMsg", error); toast("ลงชื่อแล้ว"); signCount(); return openTask(cur.t.id, false);
    }
    if (act === "ret") {
      const r = $("#acReason").value.trim(); if (!r) return note("#acMsg", new Error("พิมพ์เหตุผลที่ส่งกลับ เช่น รูปข้อ 4 มืด มองไม่เห็นป้าย"));
      const { error } = await sb.rpc("pm_return", { p_task: cur.t.id, p_reason: r });
      if (error) return note("#acMsg", error); toast("ส่งกลับให้ช่างแก้แล้ว"); signCount(); return openTask(cur.t.id, false);
    }
    if (act === "job") {
      const { data, error } = await sb.rpc("pm_open_job", { p_task: cur.t.id });
      if (error) return note("#acMsg", error); toast("เปิดใบแจ้งซ่อม " + data + " แล้ว"); return openTask(cur.t.id, false);
    }
  });
  function answerView(it, a, i, urls) {
    const bad = a.v === "bad" || outOf(it, a.v);
    const val = it.k === "value" ? `${esc(a.v)} ${esc(it.u || "")} <span class="meta">${crit(it)}</span>` : esc(LV[a.v] || a.v || "-");
    return `<div class="item${bad ? " bad" : ""}"><b>${i + 1}.</b> ${esc(it.t)} — <b style="${bad ? "color:var(--bad)" : ""}">${val}</b>${a.n ? `<div class="meta">${esc(a.n)}</div>` : ""}
      ${(a.ph || []).length ? `<div class="row" style="margin-top:6px">${a.ph.map(p => urls[p] ? `<a href="${urls[p]}" target="_blank" rel="noopener"><img src="${urls[p]}" alt="รูปข้อ ${i + 1}" style="width:96px;height:72px;object-fit:cover;border-radius:6px"></a>` : "").join("")}</div>` : ""}</div>`;
  }
  function actionsFor(t) {
    const b = [];
    if (t.status === "submitted" && isHead() && t.tech_id !== me.id) b.push(`<button class="btn primary" data-act="sign2">ลงชื่อ 2/3 (ถูกต้อง)</button>`);
    if (t.status === "head_signed" && isEng()) b.push(`<button class="btn primary" data-act="sign3">ลงชื่ออนุมัติ 3/3</button>`);
    if (["submitted", "head_signed"].includes(t.status) && isHead()) b.push(`<input id="acReason" placeholder="เหตุผลที่ส่งกลับ เช่น รูปข้อ 4 มืด มองไม่เห็นป้าย" style="flex:1;min-width:200px"><button class="btn" data-act="ret" style="color:var(--bad)">ส่งกลับให้ช่างแก้</button>`);
    if (t.abnormal > 0 && can()) b.push(t.job_id ? `<a class="btn" href="staff.html">ดูใบแจ้งซ่อมที่เปิดแล้ว</a>` : `<button class="btn" data-act="job" style="color:var(--bad)">เปิดใบแจ้งซ่อมจากผลนี้</button>`);
    return b.length ? `<div class="panel noprint" style="margin-top:12px"><div class="row">${b.join("")}</div><div id="acMsg"></div></div>` : "";
  }

  /* ---------- sign queue ---------- */
  let signList = [];
  async function renderSign() {
    const all = await loadTasks($("#sMonth").value);
    signList = all.filter(t => (t.status === "submitted" && t.tech_id !== me.id) || (t.status === "head_signed" && isEng()));
    $("#sList").innerHTML = signList.map(t => { const e = eqOf(t.equipment_id), clean = t.score === 100 && !t.abnormal;
      return `<div class="job"><div><label class="check" style="flex-direction:row;gap:8px;align-items:flex-start"><input type="checkbox" data-pick="${t.id}" ${clean ? "" : "disabled"}>
        <span><b style="font-family:'IBM Plex Mono',monospace">${esc(e.tag || "")}</b> · ${esc(e.name)}<br><span class="meta">${esc(where(e) || "-")} · ${esc(e.eq_type || "")} · ช่าง ${esc(nameOf(t.tech_id))} ${fmt(t.submitted_at)}${!t.scanned ? ' · <b style="color:var(--bad)">ไม่ได้สแกน QR</b>' : ""}</span></span></label></div>
        <div class="side">${RS.pill(STC[t.status], t.status === "submitted" ? "รอ 2/3" : "รอ 3/3")}<span class="meta" style="${clean ? "color:var(--s-work_on)" : "color:var(--bad)"}">คะแนน ${t.score}${t.abnormal ? " · ผิดปกติ " + t.abnormal : ""}${clean ? "" : " · มีจุดต้องดู → ข้าม"}</span><button class="btn small" data-open="${t.id}">เปิดดู</button></div></div>`; }).join("") || '<div class="empty">ไม่มีใบรอคุณเซ็น</div>';
  }
  $("#sAll").onclick = () => document.querySelectorAll("[data-pick]:not(:disabled)").forEach(c => c.checked = true);
  $("#sBatch").onclick = async () => {
    const ids = [...document.querySelectorAll("[data-pick]:checked")].map(c => c.dataset.pick);
    if (!ids.length) return note("#sMsg", new Error("ติ๊กเลือกใบที่จะลงชื่อก่อน"));
    const l2 = ids.filter(id => (signList.find(t => t.id === id) || {}).status === "submitted"), l3 = ids.filter(id => (signList.find(t => t.id === id) || {}).status === "head_signed");
    let n = 0;
    for (const [list, lv] of [[l2, 2], [l3, 3]]) if (list.length) { const { data, error } = await sb.rpc("pm_sign", { p_tasks: list, p_level: lv }); if (error) return note("#sMsg", error); n += data || 0; }
    note("#sMsg", null, `ลงชื่อแล้ว ${n} ใบ`); signCount(); renderSign();
  };

  /* ---------- results ---------- */
  let resRows = [];
  async function renderResult() {
    const all = await loadTasks($("#rMonth").value);
    resRows = all.map(t => ({ t, e: eqOf(t.equipment_id) })).sort((a, b) => a.t.week - b.t.week || String(a.e.tag).localeCompare(String(b.e.tag)));
    const done = all.filter(t => !["todo", "returned"].includes(t.status)), appr = all.filter(t => t.status === "approved");
    const pct = all.length ? Math.round(100 * done.length / all.length) : 0;
    $("#rTitle").textContent = `ผล PM ${H.name} ${monthLabel($("#rMonth").value)}`;
    $("#rKpi").innerHTML = kpis([["% ทำตามแผน", pct + "%"], ["งานตามแผน", all.length], ["ทำแล้ว", done.length], ["อนุมัติครบ 3/3", appr.length],
      ["ยังไม่ทำ", all.filter(t => t.status === "todo").length, true], ["ไม่ได้สแกน QR", done.filter(t => !t.scanned).length, true], ["มีข้อผิดปกติ", done.filter(t => t.abnormal > 0).length, true]]);
    $("#rWeek").innerHTML = [1, 2, 3, 4].map(w => { const l = all.filter(t => t.week === w), d = l.filter(t => !["todo", "returned"].includes(t.status)).length;
      return `<div class="bar"><span>W${w} (${d}/${l.length})</span><i style="width:${l.length ? d / l.length * 100 : 0}%"></i><em>${l.length ? Math.round(100 * d / l.length) : 0}%</em></div>`; }).join("");
    const pend = {}; resRows.filter(x => ["todo", "returned"].includes(x.t.status)).forEach(x => { const k = x.e.eq_type || "ไม่ระบุชนิด"; pend[k] = (pend[k] || 0) + 1; });
    $("#rType").innerHTML = bars(Object.entries(pend).sort((a, b) => b[1] - a[1]).slice(0, 10));
    $("#rTable").innerHTML = `<tr><th>W</th><th>TAG</th><th>เครื่อง</th><th>ชนิด</th><th>ที่ตั้ง</th><th>สถานะ</th><th class="num">คะแนน</th><th class="num">ผิดปกติ</th><th>สแกน QR</th><th>ช่าง</th><th>ส่งเมื่อ</th><th class="noprint"></th></tr>` +
      (resRows.map(({ t, e }) => `<tr><td>${t.week}</td><td>${esc(e.tag || "")}</td><td>${esc(e.name)}</td><td>${esc(e.eq_type || "")}</td><td>${esc(where(e))}</td><td>${esc(ST[t.status])}</td><td class="num">${t.score ?? ""}</td>
        <td class="num"${t.abnormal ? ' style="color:var(--bad)"' : ""}>${t.abnormal || ""}</td><td>${t.submitted_at ? (t.scanned ? "สแกน" : '<b style="color:var(--bad)">ไม่ได้สแกน</b>') : ""}</td><td>${esc(nameOf(t.tech_id))}</td><td>${t.submitted_at ? fmt(t.submitted_at) : ""}</td>
        <td class="noprint"><button class="btn small" data-open="${t.id}">ดู</button></td></tr>`).join("") || `<tr><td colspan="12"><div class="empty">ยังไม่มีงานของเดือนนี้</div></td></tr>`);
  }
  $("#rPrint").onclick = () => window.print();
  $("#rCsv").onclick = () => csv(`PM-${H.code}-${$("#rMonth").value}`, ["สัปดาห์", "TAG", "เครื่อง", "ชนิด", "อาคาร", "ชั้น", "ที่ตั้ง", "ผู้ทำ", "สถานะ", "คะแนน", "ข้อผิดปกติ", "สแกน QR", "ช่าง 1/3", "ส่งเมื่อ", "หัวหน้า 2/3", "วิศวกร 3/3", "หมายเหตุ", "ใบแจ้งซ่อม"],
    resRows.map(({ t, e }) => [t.week, e.tag, e.name, e.eq_type, e.building, e.floor, e.place, e.pm_by, ST[t.status], t.score, t.abnormal, t.submitted_at ? (t.scanned ? "สแกน" : "ไม่ได้สแกน") : "", nameOf(t.tech_id), fmt(t.submitted_at), nameOf(t.head_id), nameOf(t.eng_id), t.note, t.job_id ? "เปิดแล้ว" : ""]));

  /* ---------- registry & yearly plan ---------- */
  const planDots = e => `<span class="dots">${[...Array(12)].map((_, i) => (e.pm_months || []).includes(i + 1) ? "●" : "·").join("")}</span>`;
  function regList() {
    const q = $("#eQ").value.trim().toLowerCase(), t = $("#eT").value, b = $("#eB").value, p = $("#eP").value;
    return equip.filter(e => (!q || [e.tag, e.name, e.code, where(e)].join(" ").toLowerCase().includes(q)) && (!t || e.eq_type === t) && (!b || e.building === b)
      && (!p || (p === "plan" ? (e.pm_months || []).length : p === "noplan" ? !(e.pm_months || []).length : !e.tag)));
  }
  function renderReg() {
    const l = regList();
    $("#eTable").innerHTML = `<tr><th>TAG</th><th>เครื่อง</th><th>ชนิด</th><th>ที่ตั้ง</th><th>ความถี่</th><th>แผน ม.ค.→ธ.ค.</th><th>W</th><th>ผู้ทำ</th><th class="noprint"></th></tr>` +
      (l.slice(0, regLimit).map(e => `<tr><td style="font-family:'IBM Plex Mono',monospace">${esc(e.tag || "-")}</td><td>${esc(e.name)}</td><td>${esc(e.eq_type || "")}</td><td>${esc(where(e))}</td><td>${esc(FREQ[e.pm_freq] || "-")}</td><td>${planDots(e)}</td><td>${e.pm_week}</td><td>${esc(e.pm_by)}</td>
        <td class="noprint">${isMgr() ? `<button class="btn small" data-edit="${e.id}">แก้</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="9"><div class="empty">ไม่พบเครื่อง</div></td></tr>`);
    $("#eMore").innerHTML = l.length > regLimit ? `<div class="row" style="margin-top:10px"><span class="meta">แสดง ${regLimit} จาก ${l.length} เครื่อง</span><button class="btn small" id="eMoreBtn">แสดงเพิ่ม</button></div>` : `<p class="meta">${l.length} เครื่อง · อยู่ในแผน PM ${equip.filter(e => (e.pm_months || []).length).length} จากทั้งหมด ${equip.length}</p>`;
  }
  ["#eQ", "#eT", "#eB", "#eP"].forEach(s => $(s).addEventListener(s === "#eQ" ? "input" : "change", () => { regLimit = 200; renderReg(); }));
  document.addEventListener("click", async e => {
    if (e.target.id === "eMoreBtn") { regLimit += 500; return renderReg(); }
    const ed = e.target.closest("[data-edit]"); if (ed) return editForm(ed.dataset.edit);
    if (e.target.id === "edCancel") { editId = null; $("#eEdit").innerHTML = ""; }
  });
  function editForm(id) {
    editId = id; const e = eqOf(id), start = (e.pm_months || [])[0] || 1;
    const types = [...new Set([...tpls.map(t => t.eq_type), ...equip.map(x => x.eq_type)].filter(Boolean))].sort((a, b) => a.localeCompare(b, "th"));
    $("#eEdit").innerHTML = `<form class="panel noprint" id="fEq" style="margin-bottom:14px"><h3>แก้ไขเครื่อง ${esc(e.tag || e.name)}</h3><div class="grid">
      <label>TAG<input id="edTag" value="${esc(e.tag || "")}" placeholder="เช่น A-EEL-1-001"></label><label class="span2">ชื่อเครื่อง *<input id="edName" required value="${esc(e.name)}"></label>
      <label>ชนิด<input id="edType" list="typeList" value="${esc(e.eq_type || "")}"><datalist id="typeList">${types.map(x => `<option value="${esc(x)}">`).join("")}</datalist></label>
      <label>อาคาร<input id="edB" value="${esc(e.building || "")}"></label><label>ชั้น<input id="edF" value="${esc(e.floor || "")}"></label><label>ที่ตั้ง<input id="edP" value="${esc(e.place || "")}"></label>
      <label>ความถี่<select id="edFreq"><option value="">ไม่อยู่ในแผน PM</option>${Object.entries(FREQ).map(([k, l]) => `<option value="${k}"${e.pm_freq === k ? " selected" : ""}>${k} · ${l}</option>`).join("")}</select></label>
      <label>เดือนที่เริ่ม<select id="edStart">${TH_M.map((m, i) => `<option value="${i + 1}"${start === i + 1 ? " selected" : ""}>${m}</option>`).join("")}</select></label>
      <label>สัปดาห์<select id="edWeek">${[1, 2, 3, 4].map(w => `<option${e.pm_week === w ? " selected" : ""}>${w}</option>`).join("")}</select></label>
      <label>ผู้ทำ<select id="edBy"><option${e.pm_by === "TW" ? " selected" : ""}>TW</option><option${e.pm_by === "MA" ? " selected" : ""}>MA</option></select></label></div>
      <div class="row" style="margin-top:10px"><button class="btn primary">บันทึก</button><button class="btn" type="button" id="edCancel">ยกเลิก</button></div><div id="edMsg"></div></form>`;
    $("#eEdit").scrollIntoView({ behavior: "smooth" });
  }
  const monthsFor = (f, s) => !f ? [] : [...new Set([...Array(12)].map((_, i) => i).filter(i => i % ({ M: 1, Q: 3, H: 6, Y: 12 }[f]) === 0).map(i => ((s - 1 + i) % 12) + 1))].sort((a, b) => a - b);
  document.addEventListener("submit", async ev => {
    if (ev.target.id !== "fEq") return; ev.preventDefault();
    const f = $("#edFreq").value, row = { tag: $("#edTag").value.trim() || null, name: $("#edName").value.trim(), eq_type: $("#edType").value.trim() || null, building: $("#edB").value.trim() || null,
      floor: $("#edF").value.trim() || null, place: $("#edP").value.trim() || null, pm_freq: f || null, pm_months: monthsFor(f, +$("#edStart").value), pm_week: +$("#edWeek").value, pm_by: $("#edBy").value, updated_at: new Date().toISOString() };
    const { error } = await sb.from("equipment").update(row).eq("id", editId);
    if (error) return note("#edMsg", error.code === "23505" ? new Error("TAG นี้มีเครื่องอื่นใช้แล้ว") : error);
    Object.assign(eqOf(editId), row); editId = null; $("#eEdit").innerHTML = ""; toast("บันทึกแล้ว"); fillFilters(); renderReg();
  });
  $("#gRun").onclick = async () => {
    const [y, m] = ym($("#gMonth").value);
    const { data, error } = await sb.rpc("pm_generate", { p_year: y, p_month: m });
    note("#gMsg", error, error ? "" : `สร้างงาน ${data} รายการ สำหรับ${monthLabel($("#gMonth").value)}${data ? "" : " (มีครบแล้ว หรือยังไม่มีเครื่องที่แผนตรงเดือนนี้)"}`);
  };
  $("#eCsv").onclick = () => csv(`ทะเบียนPM-${H.code}`, ["TAG", "ชื่อเครื่อง", "ชนิด", "อาคาร", "ชั้น", "ที่ตั้ง", "ความถี่", "เดือนที่เริ่ม", "สัปดาห์", "ผู้ทำ", "เดือนในแผน", "รหัสเดิม", "ระบบ"],
    regList().map(e => [e.tag, e.name, e.eq_type, e.building, e.floor, e.place, e.pm_freq, (e.pm_months || [])[0] || "", e.pm_week, e.pm_by, (e.pm_months || []).join(" "), e.code, e.system]));
  $("#iTpl").onclick = () => Office.xlsx("แบบฟอร์มนำเข้าแผนPM", [{ name: "แผน PM", header: 0, rows: [["TAG", "ชื่อเครื่อง", "ชนิด", "อาคาร", "ชั้น", "ที่ตั้ง", "ความถี่", "เดือนที่เริ่ม", "สัปดาห์", "ผู้ทำ"], ["A-EEL-1-001", "ไฟฉุกเฉิน ทางออก", "ทั่วไป", "A", "1", "หน้าลิฟต์", "M", 1, 1, "TW"]] }]);

  // CSV import with preview and warnings; confirmed rows update by TAG or add new equipment
  let imp = [];
  function parseCsv(text) {
    const rows = []; let row = [], v = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"' && text[i + 1] === '"') { v += '"'; i++; } else if (c === '"') q = false; else v += c; }
      else if (c === '"') q = true; else if (c === ",") { row.push(v); v = ""; } else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(v); rows.push(row); row = []; v = ""; } else v += c;
    }
    if (v || row.length) { row.push(v); rows.push(row); }
    return rows.filter(r => r.some(x => x.trim()));
  }
  $("#iFile").onchange = async ev => {
    const f = ev.target.files[0]; if (!f) return;
    let rows;
    const sig = new Uint8Array(await f.slice(0, 2).arrayBuffer());
    if (/\.xlsx$/i.test(f.name) || (sig[0] === 0x50 && sig[1] === 0x4b)) { try { rows = Object.values(await Office.readXlsx(f))[0].map(r => [...r].map(c => cellS(c))).filter(r => r.some(x => x.trim())); } catch (err) { $("#iPrev").innerHTML = `<div class="note bad">อ่านไฟล์ Excel ไม่ได้: ${esc(err.message || err)}</div>`; return; } }
    else rows = parseCsv((await f.text()).replace(/^﻿/, ""));
    if (rows.length && /tag/i.test(rows[0][0])) rows.shift();
    const seen = {};
    imp = rows.map((r, n) => {
      const [tag, name, type, b, fl, place, freq, start, wk, by] = r.map(x => (x || "").trim()), w = [];
      const F = (freq || "").toUpperCase(); if (F && !FREQ[F]) w.push("ความถี่อ่านไม่ได้");
      if (!tag) w.push("ไม่มี TAG"); if (!name) w.push("ไม่มีชื่อ");
      if (tag && seen[tag.toUpperCase()]) w.push("TAG ซ้ำในไฟล์"); seen[(tag || "").toUpperCase()] = 1;
      const s = +start || 1; if (start && !(s >= 1 && s <= 12)) w.push("เดือนเริ่มไม่ถูก");
      const type0 = type || ""; if (type0 && !tpls.some(t => t.eq_type === type0)) w.push("ชนิดนี้ยังไม่มี check sheet (ใช้แบบทั่วไป)");
      const ex = equipAll.find(e => tag && (e.tag || "").toUpperCase() === tag.toUpperCase());
      return { n: n + 1, ex, w, ok: tag && name && !w.some(x => /ไม่มี|ซ้ำ|อ่านไม่ได้|ไม่ถูก/.test(x)),
        row: { tag, name, eq_type: type0 || null, building: b || null, floor: fl || null, place: place || null, pm_freq: FREQ[F] ? F : null, pm_months: FREQ[F] ? monthsFor(F, s) : [], pm_week: Math.min(4, Math.max(1, +wk || 1)), pm_by: (by || "TW").toUpperCase() === "MA" ? "MA" : "TW" } };
    });
    const ok = imp.filter(x => x.ok);
    $("#iPrev").innerHTML = `<div class="kpis" style="margin-top:12px">${kpis([["แถวในไฟล์", imp.length], ["อัปเดตเครื่องเดิม", ok.filter(x => x.ex).length], ["เพิ่มเครื่องใหม่", ok.filter(x => !x.ex).length], ["แถวที่อ่านไม่ได้", imp.length - ok.length, true]])}</div>
      <div class="scroll"><table><tr><th>#</th><th>TAG</th><th>ชื่อ</th><th>ชนิด</th><th>ความถี่</th><th>แผน</th><th>ผล</th></tr>${imp.slice(0, 300).map(x => `<tr${x.ok ? "" : ' style="color:var(--bad)"'}><td>${x.n}</td><td>${esc(x.row.tag)}</td><td>${esc(x.row.name)}</td><td>${esc(x.row.eq_type || "")}</td><td>${esc(x.row.pm_freq || "-")}</td><td>${planDots(x.row)}</td><td>${x.ex ? "อัปเดต" : "เพิ่มใหม่"}${x.w.length ? " · " + esc(x.w.join(", ")) : ""}</td></tr>`).join("")}</table></div>
      <div class="row" style="margin-top:10px"><button class="btn primary" type="button" id="iGo"${ok.length ? "" : " disabled"}>ยืนยันนำเข้า ${ok.length} แถว</button><button class="btn" type="button" id="iDrop">ทิ้ง (แก้ไฟล์แล้วนำเข้าใหม่)</button></div><div id="iMsg"></div>`;
  };
  document.addEventListener("click", async e => {
    if (e.target.id === "iDrop") { imp = []; $("#iPrev").innerHTML = ""; $("#iFile").value = ""; return; }
    if (e.target.id !== "iGo") return;
    e.target.disabled = true; let up = 0, add = 0;
    try {
      for (const x of imp.filter(x => x.ok)) {
        const r = x.ex ? await sb.from("equipment").update({ ...x.row, updated_at: new Date().toISOString() }).eq("id", x.ex.id)
          : await sb.from("equipment").insert({ ...x.row, hospital_id: H.id, code: x.row.tag, system: x.row.eq_type });
        if (r.error) throw new Error(`แถว ${x.n} (${x.row.tag}): ${errText(r.error)}`);
        x.ex ? up++ : add++;
      }
      note("#iMsg", null, `นำเข้าแล้ว: อัปเดต ${up} · เพิ่มใหม่ ${add}`);
    } catch (err) { note("#iMsg", err); }
    await loadEquip(); fillFilters(); renderReg();
  });

  /* ---------- follow-up table: plan of the month against what was done; mailed on the 20th ---------- */
  let fRows = [], fAll = [], fRcp = [], fExec = false, fHosp = [];
  const fHid = () => (fExec && $("#fHosp").value) || H.id;
  const fHead = ["ระบบ", "แผนเดือนนี้ (เครื่อง)", "เสร็จและอนุมัติ", "รอเซ็น", "ยังไม่ทำ", "พบผิดปกติ (ใบ)", "% เสร็จ", "แผนสะสมทั้งปี (ครั้ง)", "ทำแล้วสะสม", "% สะสม", "งานค้างเดือนนี้", "งานค้างสะสม"];
  const fLine = r => [r.planned, r.done, r.waiting_sign, r.not_done, r.abnormal, r.pct == null ? "-" : r.pct + "%", r.ytd_planned, r.ytd_done, r.ytd_pct == null ? "-" : r.ytd_pct + "%", Math.max(0, (r.planned || 0) - (r.done || 0)), Math.max(0, (r.ytd_planned || 0) - (r.ytd_done || 0))];
  const fTable = (head, rows, bold) => `<tr>${head.map((h, i) => `<th${i ? ' class="num"' : ""}>${h}</th>`).join("")}</tr>` + rows.map(r => `<tr${bold(r) ? ' style="font-weight:700"' : ""}>${r.map((v, i) => `<td${i ? ' class="num"' : ""}>${esc(v ?? "")}</td>`).join("")}</tr>`).join("");
  async function renderFollow() {
    const [y, m] = ym($("#fMonth").value); note("#fMsg");
    const [a, ex] = await Promise.all([sb.rpc("pm_followup_by", { p_year: y, p_month: m, p_by: SC }), sb.rpc("am_exec")]);
    if (a.error) return note("#fMsg", a.error);
    fRows = a.data || []; fExec = ex.data === true;
    const tot = fRows.find(r => r.grp === "รวม") || { planned: 0, done: 0, waiting_sign: 0, not_done: 0, abnormal: 0 };
    $("#fTitle").textContent = `ตารางติดตามแผน PM ${H.name} ${monthLabel($("#fMonth").value)}`;
    const nMach = equip.length, nPlan = equip.filter(e => (e.pm_months || []).length).length;
    $("#fDashT").textContent = `ภาพรวม ${SCN} ${monthLabel($("#fMonth").value)}`;
    $("#fDash").innerHTML = kpis([["จำนวนเครื่องจักรและอุปกรณ์", nMach.toLocaleString()], ["วางแผน (เดือนนี้)", tot.planned], ["เสร็จจริง", tot.done], ["งานค้างรายเดือน", Math.max(0, (tot.planned || 0) - (tot.done || 0)), 1], ["งานค้างสะสม (ตั้งแต่ต้นปี)", Math.max(0, (tot.ytd_planned || 0) - (tot.ytd_done || 0)), 1], ["อุปกรณ์ที่ไม่พร้อมใช้", tot.abnormal, 1]]);
    $("#fDashN").textContent = `เครื่องทั้งหมดในส่วน ${SCN} ${nMach.toLocaleString()} เครื่อง มีแผน PM ${nPlan.toLocaleString()} เครื่อง · งานค้าง = แผน ลบ งานที่เสร็จและอนุมัติครบ · อุปกรณ์ที่ไม่พร้อมใช้ = เครื่องที่ผลตรวจ PM เดือนนี้พบผิดปกติ`;
    $("#fKpi").innerHTML = kpis([["แผนเดือนนี้ (เครื่อง)", tot.planned], ["เสร็จและอนุมัติ", tot.done], ["รอเซ็น", tot.waiting_sign], ["ยังไม่ทำ", tot.not_done, 1], ["พบผิดปกติ (ใบ)", tot.abnormal, 1], ["% เสร็จ", tot.pct == null ? "-" : tot.pct + "%"], ["% สะสมทั้งปี", tot.ytd_pct == null ? "-" : tot.ytd_pct + "%"]]);
    const late = fRows.filter(r => r.grp !== "รวม" && r.not_done > 0).sort((x, z) => z.not_done - x.not_done);
    $("#fSum").innerHTML = !tot.planned ? '<div class="empty">เดือนนี้ยังไม่มีเครื่องในแผน PM นำเข้าแผนได้ที่แท็บ “ทะเบียน &amp; แผนปี”</div>'
      : `<b>บทสรุปผู้บริหาร:</b> แผนเดือนนี้ ${tot.planned} เครื่อง ทำเสร็จและอนุมัติแล้ว ${tot.done} เครื่อง (${tot.pct}%) รอเซ็น ${tot.waiting_sign} ยังไม่ทำ ${tot.not_done}${late.length ? ` · ระบบที่ค้างมากที่สุด: ${late.slice(0, 3).map(r => `${esc(r.grp)} ${r.not_done}`).join(", ")}` : " · ไม่มีระบบที่ค้าง"}${tot.abnormal ? ` · พบผิดปกติ ${tot.abnormal} ใบ ควรเปิดใบแจ้งซ่อมตาม` : ""}`;
    $("#fTable").innerHTML = fTable(fHead, fRows.map(r => [r.grp, ...fLine(r)]), r => r[0] === "รวม");
    $("#fAllBox").hidden = !fExec;
    if (fExec) { const b = await sb.rpc("pm_followup_all_by", { p_year: y, p_month: m, p_by: SC }); fAll = b.data || [];
      $("#fAll").innerHTML = b.error ? "" : fTable(["โรงพยาบาล", "เครื่องในแผน PM", ...fHead.slice(1)], fAll.map(r => [`${r.code} ${r.name}`, r.machines, ...fLine({ ...r, planned: r.planned ?? 0, done: r.done ?? 0, waiting_sign: r.waiting_sign ?? 0, not_done: r.not_done ?? 0, abnormal: r.abnormal ?? 0, ytd_planned: r.ytd_planned ?? 0, ytd_done: r.ytd_done ?? 0 })]), () => false); }
    if (fExec && !fHosp.length) { fHosp = (await sb.from("hospitals").select("id,code,name").order("code")).data || []; $("#fHosp").innerHTML = fHosp.map(x => `<option value="${x.id}"${x.id === H.id ? " selected" : ""}>${esc(x.code)} ${esc(x.name)}</option>`).join(""); }
    $("#fHospL").hidden = !fExec; if (fExec) $("#fRcpBox").hidden = false;
    $("#fTest").hidden = $("#fPlan").hidden = fHid() !== H.id || !isMgr();
    if (isMgr() || fExec) { const r = await sb.from("report_recipients").select("*").eq("hospital_id", fHid()).eq("kind", "pm_followup").order("created_at"); fRcp = r.data || [];
      $("#fRcp").innerHTML = fRcp.map(x => `<tr${x.active ? "" : ' style="opacity:.55"'}><td>${esc(x.email)}</td><td>${x.active ? "ส่งอยู่" : "หยุดส่ง"}</td><td><button class="btn small" type="button" data-rcp="${x.id}">${x.active ? "หยุดส่ง" : "ส่งอีกครั้ง"}</button></td></tr>`).join("") || '<tr><td class="empty">ยังไม่ได้ตั้ง email ผู้รับ</td></tr>'; }
  }
  $("#fMonth").onchange = renderFollow; $("#fHosp").onchange = renderFollow;
  $("#fPrint").onclick = () => window.print();
  $("#fCsv").onclick = () => { const tot = fRows.find(r => r.grp === "รวม");
    const sheets = [Office.summarySheet({ title: $("#fTitle").textContent, org: H.name, findings: [$("#fSum").textContent.replace(/^บทสรุปผู้บริหาร:\s*/, "")], figures: tot ? fHead.slice(1).map((h, i) => [h, fLine(tot)[i]]) : [] }), { name: "ติดตามรายระบบ", header: 0, rows: [fHead, ...fRows.map(r => [r.grp, ...fLine(r)])] }];
    if (fExec && fAll.length) sheets.push({ name: "12 โรงพยาบาล", header: 0, rows: [["รหัส", "โรงพยาบาล", "เครื่องในแผน PM", ...fHead.slice(1)], ...fAll.map(r => [r.code, r.name, r.machines, ...fLine(r)])] });
    Office.xlsx(`ติดตามแผนPM-${H.code}-${$("#fMonth").value}`, sheets); };
  $("#fAdd").onclick = async () => { const em = $("#fEmail").value.trim().toLowerCase(); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) return note("#fMsg", new Error("รูปแบบ email ไม่ถูกต้อง"));
    const { error } = await sb.from("report_recipients").insert({ hospital_id: fHid(), kind: "pm_followup", email: em, created_by: me.id });
    if (error) return note("#fMsg", /duplicate|report_recipients_uq/.test(error.message || "") ? new Error("email นี้มีอยู่แล้ว") : error); $("#fEmail").value = ""; note("#fMsg", null, "เพิ่มผู้รับแล้ว"); renderFollow(); };
  const fSend = plan => async () => { if (!fRcp.some(x => x.active)) return note("#fMsg", new Error("ยังไม่มี email ผู้รับที่เปิดส่งอยู่"));
    const [y, m] = ym($("#fMonth").value), n = fRcp.filter(x => x.active).length;
    if (!confirm(plan ? `ส่งผลงาน PM ของ${monthLabel($("#fMonth").value)} พร้อม Master Plan PM ปี ${y + 543} (ไฟล์ Excel) ไปที่ email ผู้รับ ${n} ราย ตอนนี้เลย?` : `ส่งตารางของ${monthLabel($("#fMonth").value)} ไปที่ email ผู้รับ ${n} ราย ตอนนี้เลย?`)) return;
    const { data, error } = await sb.rpc("pm_followup_send_now", { p_year: y, p_month: m, p_plan: plan }); note("#fMsg", error, error ? "" : `เข้าคิวส่ง ${data} ฉบับแล้ว จะถึงผู้รับภายในไม่กี่นาที`); };
  $("#fTest").onclick = fSend(false); $("#fPlan").onclick = fSend(true);
  document.addEventListener("click", async e => { const b = e.target.closest("[data-rcp]"); if (!b) return; const x = fRcp.find(z => z.id === b.dataset.rcp);
    const { error } = await sb.from("report_recipients").update({ active: !x.active }).eq("id", x.id); if (error) return note("#fMsg", error); renderFollow(); });

  /* ---------- yearly master plan from the Excel template ---------- */
  // PM_Plan sheet: a header row starting with NO., month names over 4 week columns each, marks (M Q S Y W 2M ...) in the week to do the work
  const MONTHS = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];
  let xRows = [];
  const cellS = v => String(v ?? "").replace(/\s+/g, " ").trim();
  function parsePlan(rows) {
    const hi = rows.findIndex(r => /^NO\.?$/i.test(cellS(r[0])) && r.some(c => /MACHINE\s*NAME/i.test(cellS(c))));
    if (hi < 0) throw new Error("ไม่พบหัวตาราง (NO. / MACHINE NAME) ในไฟล์ ตรวจว่าใช้ Template Master Plan");
    const hd = rows[hi].map(c => cellS(c).toUpperCase()), at = re => hd.findIndex(h => re.test(h)), c = { name: at(/MACHINE\s*NAME/), tag: at(/MACHINE\s*TAG/), place: at(/^LOCATION/), b: at(/^BUILDING/), f: at(/^FLOOR/), jan: at(/^JANUARY/), sys: at(/^SYSTEM/), by: at(/^MAINTAIN/), ven: at(/CONTRACTOR|VENDOR/) };
    if (c.tag < 0 || c.jan < 0 || MONTHS.some((m, i) => hd[c.jan + i * 4] !== m)) throw new Error("หัวตารางไม่ตรง Template: ต้องมี MACHINE TAG และเดือน JANUARY ถึง DECEMBER เดือนละ 4 ช่อง");
    const out = [], seen = {}; let grp = "";
    rows.slice(hi + 2).forEach((r, i) => {
      const name = cellS(r[c.name]);
      if (!name) { const t = cellS(r[0]); if (t && !/^[\d.]+$/.test(t)) grp = t; return; }
      const grid = {}; for (let k = 0; k < 48; k++) { const v = cellS(r[c.jan + k]).toUpperCase(); if (v) grid[k + 1] = v.slice(0, 6); }
      const w = []; let tag = cellS(r[c.tag]);
      if (!tag) { let hsh = 0; for (const ch of [name, cellS(r[c.b]), cellS(r[c.f]), cellS(r[c.place])].join("|")) hsh = (hsh * 31 + ch.charCodeAt(0)) >>> 0; tag = "AUTO-" + hsh.toString(36).toUpperCase(); w.push("ไม่มี TAG ในไฟล์ ระบบตั้งให้"); }
      const k0 = tag.toUpperCase(); seen[k0] = (seen[k0] || 0) + 1; if (seen[k0] > 1) { tag = `${tag}ซ้ำ${seen[k0] - 1}`; w.push("TAG ซ้ำในไฟล์ ระบบเติม ซ้ำ" + (seen[k0] - 1)); }
      if (!Object.keys(grid).length) w.push("ไม่มีแผนในปีนี้");
      out.push({ n: hi + 3 + i, w, row: { tag, name, building: cellS(r[c.b]), floor: cellS(r[c.f]), place: cellS(r[c.place]), system: c.sys < 0 ? "" : cellS(r[c.sys]), grp, by: c.by < 0 ? "" : cellS(r[c.by]), vendor: c.ven < 0 ? "" : cellS(r[c.ven]), grid } });
    });
    return out;
  }
  const ceYear = v => { v = +v; return v >= 2400 ? v - 543 : v; };   // the box takes a Thai year (2569); a CE year (2026) also works
  let xHosp = [];
  const xH = () => xHosp.find(h => h.id === $("#xHosp").value) || H;
  if ($("#xYear")) $("#xYear").value = new Date().getFullYear() + 543;
  const xInit = async () => { if (!H) return setTimeout(xInit, 400); const ex = await sb.rpc("am_exec"); if (ex.data !== true) return; if ((await sb.rpc("pm_import_for", { p_hospital: H.id, p_year: new Date().getFullYear(), p_rows: [] })).error) return;   // not available yet xHosp = (await sb.from("hospitals").select("id,code,name").order("code")).data || [];
    $("#xHosp").innerHTML = xHosp.map(h => `<option value="${h.id}"${h.id === H.id ? " selected" : ""}>${esc(h.code)} ${esc(h.name)}</option>`).join(""); $("#xHospL").hidden = !xHosp.length; }; xInit();
  $("#xFile").onchange = async ev => {
    const f = ev.target.files[0]; if (!f) return; note("#xMsg"); $("#xPrev").innerHTML = '<div class="empty">กำลังอ่านไฟล์…</div>';
    try {
      const wb = await Office.readXlsx(f), sheet = wb.PM_Plan || Object.values(wb).find(r => r.some(x => /^NO\.?$/i.test(cellS(x[0])) && x.some(c => /MACHINE\s*NAME/i.test(cellS(c)))));
      if (!sheet) throw new Error("ไม่พบแผ่นงาน PM_Plan ในไฟล์");
      const proj = cellS((sheet.find(r => /PROJECT/i.test(cellS(r[0]))) || [])[0]), code = (/PROJECT\s*:\s*([A-Z0-9]+)/i.exec(proj) || [])[1], be = +(/(25\d\d)/.exec(proj) || [])[1];
      if (be) $("#xYear").value = be; else { const ce = +(/(20\d\d)/.exec(proj) || [])[1]; if (ce) $("#xYear").value = ce + 543; }
      const fh = code && xHosp.find(h => h.code.toUpperCase() === code.toUpperCase()); if (fh) $("#xHosp").value = fh.id;
      xRows = parsePlan(sheet);
      const other = xH().id !== H.id, have = new Set(equipAll.map(e => (e.tag || "").toUpperCase())), marks = {}, cnt = t => xRows.filter(x => x.w.some(y => y.startsWith(t))).length;
      xRows.forEach(x => Object.values(x.row.grid).forEach(v => marks[v] = (marks[v] || 0) + 1));
      const up = xRows.filter(x => have.has(x.row.tag.toUpperCase())).length, wrong = code && code.toUpperCase() !== xH().code.toUpperCase();
      $("#xPrev").innerHTML = `${wrong ? `<div class="note bad">ไฟล์นี้เป็นของ ${esc(code)} แต่กำลังจะนำเข้าให้ ${esc(xH().code)} ตรวจให้แน่ใจก่อนนำเข้า</div>` : ""}${other ? `<div class="note">นำเข้าให้ ${esc(xH().code)} ${esc(xH().name)} (ปี พ.ศ. ${ceYear($("#xYear").value) + 543})</div>` : ""}<div class="kpis" style="margin-top:12px">${kpis([["เครื่องในไฟล์", xRows.length], ["ปรับแผนเครื่องเดิม", other ? "-" : up], ["เพิ่มเครื่องใหม่", other ? "-" : xRows.length - up], ["ไม่มีแผนในปีนี้", cnt("ไม่มีแผน")], ["TAG ซ้ำในไฟล์", cnt("TAG ซ้ำ")], ["ไม่มี TAG", cnt("ไม่มี TAG")]])}</div>
        <p class="meta">${esc(proj)} · จำนวนครั้งตามแผนทั้งปี: ${Object.entries(marks).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${esc(k)} ${v.toLocaleString()}`).join(" · ") || "-"}</p>
        <div class="scroll" style="max-height:340px"><table><tr><th>แถว</th><th>TAG</th><th>ชื่อเครื่อง</th><th>ที่ตั้ง</th><th>เดือนที่ทำ</th><th>ผู้ทำ</th><th>หมายเหตุ</th></tr>${xRows.slice(0, 200).map(x => `<tr><td>${x.n}</td><td class="mono">${esc(x.row.tag)}</td><td>${esc(x.row.name)}</td><td>${esc([x.row.building, x.row.floor, x.row.place].filter(Boolean).join(" · "))}</td><td>${[...new Set(Object.keys(x.row.grid).map(k => Math.ceil(k / 4)))].join(", ")}</td><td>${esc(x.row.by)}</td><td class="meta">${esc(x.w.join(" · "))}</td></tr>`).join("")}</table></div>
        ${xRows.length > 200 ? `<p class="meta">แสดง 200 แถวแรก จากทั้งหมด ${xRows.length.toLocaleString()} แถว</p>` : ""}
        <div class="row" style="margin-top:10px"><button class="btn primary" type="button" id="xGo"${xRows.length ? "" : " disabled"}>ยืนยันนำเข้าแผน ${xRows.length.toLocaleString()} เครื่อง</button><button class="btn" type="button" id="xDrop">ยกเลิก</button></div>`;
    } catch (err) { xRows = []; $("#xPrev").innerHTML = ""; note("#xMsg", err); }
  };
  document.addEventListener("click", async e => {
    if (e.target.id === "xDrop") { xRows = []; $("#xPrev").innerHTML = ""; $("#xFile").value = ""; return; }
    if (e.target.id !== "xGo") return;
    const y = ceYear($("#xYear").value), th = xH(); if (!(y >= 2024 && y <= 2100)) return note("#xMsg", new Error("ใส่ปีของแผนเป็น พ.ศ. เช่น 2569"));
    if (!confirm(`นำเข้าแผน PM ปี พ.ศ. ${y + 543} (ค.ศ. ${y}) จำนวน ${xRows.length.toLocaleString()} เครื่อง เข้า ${th.name}?`)) return;
    e.target.disabled = true; let up = 0, add = 0;
    try {
      for (let i = 0; i < xRows.length; i += 400) {
        e.target.textContent = `กำลังนำเข้า ${Math.min(i + 400, xRows.length).toLocaleString()} / ${xRows.length.toLocaleString()}`;
        const part = xRows.slice(i, i + 400).map(x => x.row), { data, error } = th.id === H.id ? await sb.rpc("pm_import", { p_year: y, p_rows: part }) : await sb.rpc("pm_import_for", { p_hospital: th.id, p_year: y, p_rows: part });
        if (error) throw new Error(`แถว ${xRows[i].n} เป็นต้นไป: ${errText(error)} (แถวก่อนหน้านี้นำเข้าแล้ว นำเข้าไฟล์เดิมซ้ำได้)`);
        up += data.updated; add += data.added;
      }
      xRows = []; $("#xPrev").innerHTML = ""; $("#xFile").value = ""; note("#xMsg", null, `นำเข้าแผนปี พ.ศ. ${y + 543} ของ ${th.code} แล้ว: ปรับแผนเครื่องเดิม ${up.toLocaleString()} · เพิ่มเครื่องใหม่ ${add.toLocaleString()} · ไปที่ “สร้างงาน PM ของเดือนจากแผน” เพื่อออกงานของแต่ละเดือน`);
    } catch (err) { note("#xMsg", err); e.target.disabled = false; e.target.textContent = "ลองนำเข้าอีกครั้ง"; }
    await loadEquip(); fillFilters(); renderReg();
  });
  // master plan rows in the template layout (also the file to edit for next year and upload again)
  const gridOf = e => e.pm_grid && Object.keys(e.pm_grid).length ? e.pm_grid : Object.fromEntries((e.pm_months || []).map(m => [(m - 1) * 4 + (e.pm_week || 1), e.pm_freq || "M"]));
  const grpOf = e => e.pm_group || e.system || e.eq_type || "อื่น ๆ";
  const planSort = l => [...l].sort((a, b) => (a.system || "").localeCompare(b.system || "") || grpOf(a).localeCompare(grpOf(b)) || String(a.tag).localeCompare(String(b.tag)));
  function planRows(list, y, label) {
    const wk = [...Array(48)].map((_, i) => (i % 4) + 1), mh = MONTHS.flatMap(m => [m, "", "", ""]);
    const rows = [["MASTER PLAN PREVENTIVE MAINTENANCE" + (label ? " : " + label : "")], [`PROJECT :  ${H.code}    ปี ${y + 543}`], ["NO.", "MACHINE NAME", "MACHINE TAG", "LOCATION", "BUILDING", "FLOOR", "PERIODES", ...mh, "SYSTEM", "MAINTAIN BY (TW/MA)", "CONTRACTOR / VENDOR"], ["", "", "", "", "", "", "", ...wk]];
    let g = null, n = 0;
    planSort(list).forEach(e => { if (grpOf(e) !== g) { g = grpOf(e); rows.push([g]); } const grid = gridOf(e);
      rows.push([++n, e.name, e.tag, e.place || "", e.building || "", e.floor || "", [...new Set(Object.values(grid))].join("/"), ...wk.map((_, i) => grid[i + 1] || ""), e.system || "", e.pm_by_raw || e.pm_by || "TW", e.pm_vendor || ""]); });
    return rows;
  }
  const HOWTO = { name: "วิธีใช้", rows: [["วิธีใช้ Template นี้"], ["1. แก้ไขได้เฉพาะแผ่นงาน PM_Plan ห้ามลบหรือย้ายคอลัมน์ และคงหัวตารางแถวที่ 3 ไว้"], ["2. หนึ่งแถวคือหนึ่งเครื่อง MACHINE TAG ต้องไม่ซ้ำกัน เครื่องใหม่ให้เพิ่มแถวและตั้ง TAG ใหม่"], ["3. ใส่ตัวอักษรแผนในช่องสัปดาห์ที่ต้องทำ: M รายเดือน, Q ราย 3 เดือน, S ราย 6 เดือน, Y รายปี (ใช้ตัวอื่นเช่น W, 2M ได้)"], ["4. MAINTAIN BY ใส่ TW หรือ MA"], ["5. บันทึกเป็น .xlsx แล้วอัปโหลดที่หน้า PM Inhouse > ทะเบียนเครื่อง > นำเข้าแผน PM ทั้งปีจากไฟล์ Excel"], ["6. เครื่องที่ไม่อยู่ในไฟล์จะไม่ถูกลบออกจากระบบ"]], styles: { 0: 2 } };
  $("#xTpl").onclick = () => { const y = ceYear($("#xYear").value) || new Date().getFullYear();
    Office.xlsx(`PM_${H.code}_${y + 543}`, [{ name: "PM_Plan", rows: planRows(equipAll.filter(e => e.tag), y), styles: { 0: 2, 1: 3, 2: 1, 3: 1 } }, HOWTO]); };

  /* ---------- Master Plan view: the year's plan of this scope (PM Inhouse = TW, PM MA = contractor) ---------- */
  let mpLimit = 150;
  const mpYearCE = () => ceYear($("#mpYear").value) || new Date().getFullYear();
  const mpList = () => { const q = $("#mpQ").value.trim().toLowerCase(), sy = $("#mpSys").value, b = $("#mpB").value;
    return planSort(equip.filter(e => (e.pm_months || []).length && (!q || [e.tag, e.name, where(e)].join(" ").toLowerCase().includes(q)) && (!sy || grpOf(e) === sy) && (!b || e.building === b))); };
  // PM MA: one contractor name in the plan = one contract; blank names are listed last and not counted as a contract
  const conRows = l => { const m = new Map();
    l.forEach(e => { const k = (e.pm_vendor || "").trim().replace(/\s+/g, " "), key = k.toLowerCase(); if (!m.has(key)) m.set(key, { name: k, n: 0, v: 0, g: new Set() }); const c = m.get(key); c.n++; c.v += Object.keys(gridOf(e)).length; c.g.add(grpOf(e)); });
    return [...m.values()].map(c => ({ ...c, g: [...c.g].sort() })).sort((a, b) => !a.name - !b.name || b.n - a.n || a.name.localeCompare(b.name, "th")); };
  function renderPlan() {
    if (!$("#mpYear").value) { const py = (equip.find(e => e.pm_year) || {}).pm_year; $("#mpYear").value = (py || new Date().getFullYear()) + 543; }
    const planned = equip.filter(e => (e.pm_months || []).length), opt = (id, all, vals) => { const cur = $(id).value; $(id).innerHTML = `<option value="">${all}</option>` + vals.map(v => `<option${v === cur ? " selected" : ""}>${esc(v)}</option>`).join(""); };
    opt("#mpSys", "ทุกระบบ / กลุ่ม", [...new Set(planned.map(grpOf))].sort((a, b) => a.localeCompare(b, "th"))); opt("#mpB", "ทุกอาคาร", [...new Set(planned.map(e => e.building).filter(Boolean))].sort());
    const l = mpList(), y = mpYearCE(), visits = l.reduce((s, e) => s + Object.keys(gridOf(e)).length, 0), other = equipAll.filter(e => (SC === "MA" ? e.pm_by !== "MA" : (e.pm_by === "MA" || /MA/i.test(e.pm_by_raw || ""))) && (e.pm_months || []).length).length;
    $("#mpTitle").textContent = `PM Master Plan ${SCN} ปี ${y + 543} · ${H.name}`;
    $("#mpSub").textContent = SC === "MA" ? "แผน PM ทั้งปีของเครื่องที่ผู้รับเหมา (MA) เป็นผู้ทำ ตามคอลัมน์ MAINTAIN BY ใน Master Plan" : "แผน PM ทั้งปีของเครื่องที่ทีม TW ทำเอง ตามคอลัมน์ MAINTAIN BY ใน Master Plan";
    $("#mpKpi").innerHTML = kpis([["เครื่องในแผน " + SCN, l.length.toLocaleString()], ["จำนวนครั้งตามแผนทั้งปี", visits.toLocaleString()], ["เครื่องที่ยังไม่มีแผน", (equip.length - planned.length).toLocaleString()], [SC === "MA" ? "เครื่องในแผน PM Inhouse (ดูอีกเมนู)" : "เครื่องในแผน PM MA (ดูอีกเมนู)", other.toLocaleString()]]);
    const con = conRows(l), nCon = con.filter(c => c.name).length, noCon = con.find(c => !c.name);
    $("#mpCon").innerHTML = SC === "MA" && l.length ? `<div class="panel"><h3 style="margin:0 0 4px">สรุปสัญญา MA ตามแผนที่วาง ปี ${y + 543}</h3><p class="meta">นับจากคอลัมน์ CONTRACTOR ใน Master Plan · 1 ผู้รับเหมา = 1 สัญญา · ${nCon.toLocaleString()} สัญญา · ${l.length.toLocaleString()} เครื่อง${noCon ? ` · ยังไม่ระบุผู้รับเหมา ${noCon.n.toLocaleString()} เครื่อง` : ""}</p><div class="scroll"><table><tr><th>#</th><th>สัญญา / ผู้รับเหมา</th><th style="text-align:right">จำนวนอุปกรณ์</th><th style="text-align:right">จำนวนครั้งตามแผนทั้งปี</th><th>ระบบ / กลุ่ม</th></tr>` +
      con.map((c, i) => `<tr><td>${c.name ? i + 1 : ""}</td><td>${c.name ? esc(c.name) : "<i>ยังไม่ระบุผู้รับเหมา (ช่อง CONTRACTOR ว่าง)</i>"}</td><td style="text-align:right">${c.n.toLocaleString()}</td><td style="text-align:right">${c.v.toLocaleString()}</td><td class="meta">${esc(c.g.slice(0, 4).join(", "))}${c.g.length > 4 ? ` และอีก ${c.g.length - 4}` : ""}</td></tr>`).join("") +
      `<tr style="font-weight:700;background:#eef3f8"><td></td><td>รวม ${nCon.toLocaleString()} สัญญา</td><td style="text-align:right">${l.length.toLocaleString()}</td><td style="text-align:right">${visits.toLocaleString()}</td><td></td></tr></table></div></div>` : "";
    const th = TH_M.map(m => `<th colspan="4" style="text-align:center">${m}</th>`).join("");
    let g = null;
    $("#mpTable").innerHTML = l.length ? `<table class="mp"><tr><th rowspan="2">TAG</th><th rowspan="2">ชื่อเครื่อง</th><th rowspan="2">ที่ตั้ง</th>${th}<th rowspan="2">ผู้ทำ</th><th rowspan="2">ผู้รับเหมา</th></tr><tr>${[...Array(48)].map((_, i) => `<th style="padding:2px 3px;font-weight:400">${(i % 4) + 1}</th>`).join("")}</tr>` +
      l.slice(0, mpLimit).map(e => { const grid = gridOf(e), head = grpOf(e) !== g ? `<tr><td colspan="53" style="background:#eef3f8;font-weight:600">${esc(g = grpOf(e))}</td></tr>` : "";
        return head + `<tr><td class="mono">${esc(e.tag || "-")}</td><td>${esc(e.name)}</td><td>${esc(where(e))}</td>${[...Array(48)].map((_, i) => `<td style="padding:2px 3px;text-align:center${grid[i + 1] ? ";background:#dcebdc;font-weight:600" : ""}">${esc(grid[i + 1] || "")}</td>`).join("")}<td>${esc(e.pm_by_raw || e.pm_by || "TW")}</td><td>${esc(e.pm_vendor || "")}</td></tr>`; }).join("") + "</table>"
      : `<div class="empty">ยังไม่มีแผน ${SCN} ของปีนี้ นำเข้าไฟล์ Master Plan ได้ที่แท็บ “ทะเบียน & แผนปี”</div>`;
    $("#mpMore").innerHTML = l.length > mpLimit ? `<div class="row noprint" style="margin-top:10px"><span class="meta">แสดง ${mpLimit} จาก ${l.length.toLocaleString()} เครื่อง (ไฟล์ Excel มีครบทุกเครื่อง)</span><button class="btn small" type="button" id="mpAll">แสดงเพิ่ม 500 เครื่อง</button></div>` : "";
  }
  $("#mpQ").oninput = $("#mpSys").onchange = $("#mpB").onchange = $("#mpYear").onchange = () => { mpLimit = 150; renderPlan(); };
  document.addEventListener("click", e => { if (e.target.id === "mpAll") { mpLimit += 500; renderPlan(); } });
  $("#mpPrint").onclick = () => window.print();
  $("#mpXlsx").onclick = () => { const y = mpYearCE(), l = mpList();
    Office.xlsx(`PM_${H.code}_${y + 543}_${SC === "MA" ? "PM-MA" : "PM-Inhouse"}`, [{ name: "PM_Plan", rows: planRows(l, y, SCN), styles: { 0: 2, 1: 3, 2: 1, 3: 1 } }].concat(SC === "MA" ? [conSheet(l, y)] : [])); };
  const conSheet = (l, y) => { const con = conRows(l), nCon = con.filter(c => c.name).length;
    return { name: "สรุปสัญญา MA", rows: [[`สรุปสัญญา MA ตามแผนที่วาง ปี ${y + 543} · ${H.name}`], ["ลำดับ", "สัญญา / ผู้รับเหมา", "จำนวนอุปกรณ์", "จำนวนครั้งตามแผนทั้งปี", "ระบบ / กลุ่ม"],
      ...con.map((c, i) => [c.name ? i + 1 : "", c.name || "ยังไม่ระบุผู้รับเหมา (ช่อง CONTRACTOR ว่าง)", c.n, c.v, c.g.join(", ")]),
      ["", `รวม ${nCon} สัญญา`, l.length, l.reduce((s, e) => s + Object.keys(gridOf(e)).length, 0), ""]], styles: { 0: 2, 1: 1 } }; };

  /* ---------- QR stickers ---------- */
  const tagUrl = e => { const u = new URL("pm.html", location.href); u.search = ""; u.searchParams.set("h", H.code); u.searchParams.set("tag", e.tag); return u.toString(); };
  const qSel = new Set();
  function renderQr() {
    const qq = $("#qQ").value.trim().toLowerCase();
    const l = equip.filter(e => e.tag && (!qq || (e.tag + " " + e.name).toLowerCase().includes(qq)) && (!$("#qB").value || e.building === $("#qB").value) && (!$("#qF").value || e.floor === $("#qF").value) && (!$("#qT").value || e.eq_type === $("#qT").value));
    const noTag = equip.filter(e => !e.tag).length;
    qSel.forEach(id => { if (!l.some(e => e.id === id)) qSel.delete(id); });
    $("#qGrid").classList.toggle("pick", qSel.size > 0);
    $("#qInfo").textContent = `${qSel.size ? "เลือกไว้ " + qSel.size + " ดวง · " : ""}${l.length} ดวง${l.length > 300 ? " (แสดง 300 ดวงแรก กรองเพิ่มเพื่อพิมพ์ทีละชุด)" : ""}${noTag ? ` · มี ${noTag} เครื่องที่ยังไม่มี TAG จึงยังพิมพ์ไม่ได้` : ""}`;
    $("#qGrid").innerHTML = l.slice(0, 300).map(e => { const q = qrcode(0, "M"); q.addData(tagUrl(e)); q.make();
      return `<div data-q="${e.id}" class="${qSel.has(e.id) ? "sel" : ""}"><small>${esc(H.name)} · ${SCN}</small><img src="${q.createDataURL(4, 2)}" alt="QR ${esc(e.tag)}"><b>${esc(e.tag)}</b><small>${esc(e.name)}</small><small>${esc(where(e))}</small></div>`; }).join("") || '<div class="empty">ไม่มีเครื่องที่มี TAG ตามตัวกรอง</div>';
  }
  ["#qB", "#qF", "#qT"].forEach(s => $(s).onchange = renderQr);
  $("#qQ").oninput = renderQr;
  $("#qClear").onclick = () => { qSel.clear(); renderQr(); };
  $("#qGrid").onclick = ev => { const d = ev.target.closest("[data-q]"); if (!d) return; qSel.has(d.dataset.q) ? qSel.delete(d.dataset.q) : qSel.add(d.dataset.q); renderQr(); };
  $("#qPrint").onclick = () => window.print();

  /* ---------- check-sheet templates ---------- */
  let tEdit = null;
  function renderTpl() {
    const type = $("#tSel").value || "ทั่วไป", own = tpls.find(t => t.eq_type === type && t.hospital_id), std = tpls.find(t => t.eq_type === type && !t.hospital_id), t = own || std || tplFor(type);
    const n = equip.filter(e => (e.eq_type || "") === type).length;
    $("#tBody").innerHTML = `<div class="panel"><div class="row" style="justify-content:space-between"><h3 style="margin:0">${esc(type)} <span class="meta">${own ? "ฉบับของโรงนี้" : std ? "มาตรฐานกลาง" : "ยังไม่มี ใช้แบบทั่วไป"} · ใช้กับ ${n} เครื่อง</span></h3>
      ${isMgr() ? `<button class="btn small" type="button" id="tEditBtn">${own ? "แก้ฉบับของโรง" : "ปรับเป็นฉบับของโรง"}</button>` : ""}</div>
      <div class="scroll"><table><tr><th>#</th><th>รายการตรวจ</th><th>แบบคำตอบ</th><th>เกณฑ์</th><th>ต้องถ่ายรูป</th></tr>${t.items.map((it, i) => `<tr><td>${i + 1}</td><td>${esc(it.t)}</td><td>${it.k === "value" ? "กรอกค่า" : "ปกติ / เริ่มเสื่อม / ผิดปกติ"}</td><td>${crit(it)}</td><td>${it.ph ? "ต้องถ่าย" : ""}</td></tr>`).join("")}</table></div></div><div id="tForm"></div>`;
  }
  $("#tSel").onchange = renderTpl;
  document.addEventListener("click", async e => {
    if (e.target.id === "tEditBtn") {
      const type = $("#tSel").value; tEdit = JSON.parse(JSON.stringify(tplFor(type).items));
      return drawTplForm();
    }
    if (e.target.id === "tAdd") { readTplForm(); tEdit.push({ t: "", k: "level" }); return drawTplForm(); }
    const del = e.target.closest("[data-tdel]"); if (del) { readTplForm(); tEdit.splice(+del.dataset.tdel, 1); return drawTplForm(); }
    if (e.target.id === "tSave") {
      readTplForm(); const items = tEdit.filter(x => x.t.trim());
      if (!items.length) return note("#tMsg", new Error("ต้องมีรายการตรวจอย่างน้อย 1 ข้อ"));
      const type = $("#tSel").value, own = tpls.find(t => t.eq_type === type && t.hospital_id);
      const r = own ? await sb.from("pm_templates").update({ items, updated_by: me.id, updated_at: new Date().toISOString() }).eq("id", own.id)
        : await sb.from("pm_templates").insert({ hospital_id: H.id, eq_type: type, items, updated_by: me.id });
      if (r.error) return note("#tMsg", r.error);
      await loadTpls(); fillFilters(); $("#tSel").value = type; toast("บันทึก check sheet แล้ว ใช้กับใบที่เปิดใหม่"); renderTpl();
    }
  });
  function drawTplForm() {
    $("#tForm").innerHTML = `<div class="panel" style="margin-top:12px"><h3>แก้ check sheet (ใบที่ตรวจไปแล้วไม่เปลี่ยน)</h3>${tEdit.map((it, i) => `<div class="grid" style="grid-template-columns:minmax(0,3fr) minmax(0,1.3fr) repeat(3,minmax(0,.8fr)) auto auto;gap:6px;margin-bottom:6px">
      <input data-tt="${i}" value="${esc(it.t)}" placeholder="รายการตรวจ"><select data-tk="${i}"><option value="level"${it.k !== "value" ? " selected" : ""}>ปกติ/เสื่อม/ผิดปกติ</option><option value="value"${it.k === "value" ? " selected" : ""}>กรอกค่า</option></select>
      <input data-tu="${i}" value="${esc(it.u || "")}" placeholder="หน่วย"><input data-tl="${i}" type="number" step="any" value="${it.lo ?? ""}" placeholder="ต่ำสุด"><input data-th="${i}" type="number" step="any" value="${it.hi ?? ""}" placeholder="สูงสุด">
      <label class="check" style="flex-direction:row;gap:4px"><input type="checkbox" data-tp="${i}"${it.ph ? " checked" : ""}>รูป</label><button class="btn small" type="button" data-tdel="${i}">×</button></div>`).join("")}
      <div class="row"><button class="btn" type="button" id="tAdd">+ เพิ่มข้อ</button><button class="btn primary" type="button" id="tSave">บันทึก</button></div><div id="tMsg"></div></div>`;
  }
  function readTplForm() {
    tEdit = tEdit.map((_, i) => { const g = a => document.querySelector(`[data-${a}="${i}"]`), it = { t: g("tt").value.trim(), k: g("tk").value };
      if (g("tu").value.trim()) it.u = g("tu").value.trim(); if (g("tl").value !== "") it.lo = +g("tl").value; if (g("th").value !== "") it.hi = +g("th").value; if (g("tp").checked) it.ph = true; return it; });
  }
})();
