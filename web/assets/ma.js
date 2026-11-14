// PM MA: contractor (MA) contract register, contract renewal steps, appointments and contractor PM visits for the 12 hospitals.
// Staff see their own hospital; the 12-hospital viewers (am_exec) see every hospital and the combined overview.
// Dates are stored in CE (yyyy-mm-dd) and shown / typed in the Thai Buddhist year (พ.ศ. = CE + 543).
(() => {
  const { sb, $, esc, errText } = RS;
  const GROUPS = ["1. By-law ตามกฎหมาย", "2. ความพร้อมใช้เครื่องจักร (มาตรฐาน)", "3. ลิฟต์และระบบขนส่ง", "4. สื่อสารและควบคุม", "5. อื่นๆ ยังไม่จัดกลุ่ม"];
  const BYLAW = ["ตรวจสอบอาคาร", "ระบบไฟฟ้า PM ประจำปี / วิศวกรรับรอง", "ตรวจสมรรถนะ Generator", "ตรวจสมรรถนะ Fire pump", "ล้างถังเก็บน้ำ ใต้ดิน / บนหลังคา", "MA บ่อบำบัดน้ำเสีย (WWTP)", "ตรวจสอบลิฟต์", "ตรวจระบบก๊าซประจำปี (เสนอเพิ่ม)", "ตรวจหม้อไอน้ำ Boiler (เสนอเพิ่ม)"];
  const STEPS = ["PR", "ใบเสนอราคา 3 เจ้า", "สรุปเลือกผู้รับเหมา", "PO"];
  const CONFIRM = ["ยืนยันทางอีเมลแล้ว", "ยืนยันทางโทรศัพท์/LINE", "ส่งอีเมลแล้ว รอตอบ", "ขอเลื่อน", "แจ้งไม่เข้า"];
  const FREQ = { W: 7, "2W": 14, M: 31, "2M": 62, Q: 92, "4M": 123, S: 183, Y: 366 }, FREQ_TH = { W: "ทุกสัปดาห์", "2W": "ทุก 2 สัปดาห์", M: "ทุกเดือน", "2M": "ทุก 2 เดือน", Q: "ทุก 3 เดือน", "4M": "ทุก 4 เดือน", S: "ทุก 6 เดือน", Y: "ปีละครั้ง" };
  const ALERT = 90, DAY = 86400000, MGR = ["owner", "admin", "chief_engineer", "supervisor"];
  const TODAY = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
  let me = null, exec = false, hospitals = [], contracts = [], visits = [], appts = [], procs = [], recips = [], recipErr = "", plan = null, cur = "sum";

  // ---------- dates (CE inside, พ.ศ. on screen) ----------
  const t = s => { const [y, m, d] = s.split("-"); return Date.UTC(+y, m - 1, +d); };
  const iso = ms => new Date(ms).toISOString().slice(0, 10);
  const diff = (a, b) => Math.round((t(a) - t(b)) / DAY);
  const th = s => { if (!s) return "-"; const [y, m, d] = s.split("-"); return `${+d}/${+m}/${+y + 543}`; };
  const thMonth = s => { if (!s) return "-"; const [y, m] = s.split("-"); return ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."][m - 1] + " " + (+y + 543); };
  const okDate = (y, m, d) => { if (y > 2400) y -= 543; const ms = Date.UTC(y, m - 1, d), x = new Date(ms); return y >= 1990 && y <= 2100 && x.getUTCMonth() === m - 1 && x.getUTCDate() === d ? iso(ms) : null; };
  // accepts 31/10/2569, 31/10/2026, 2026-10-31, an Excel serial number; "" → null; unreadable → undefined
  const parseDate = v => { const s = String(v ?? "").trim(); if (!s) return null; let m;
    if (/^\d{5}(\.\d+)?$/.test(s)) return iso(Date.UTC(1899, 11, 30) + Math.floor(+s) * DAY);
    if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s))) return okDate(+m[1], +m[2], +m[3]) || undefined;
    if ((m = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/.exec(s))) return okDate(+m[3], +m[2], +m[1]) || undefined;
    return undefined; };
  const num = v => { const s = String(v ?? "").replace(/,/g, "").trim(); return s && isFinite(+s) ? +s : null; };
  const n = v => (+v || 0).toLocaleString("th-TH");
  const toast = m => { const e = $("#toast"); e.textContent = m; e.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => e.hidden = true, 3500); };
  const none = (c, what) => `<tr><td colspan="${c}"><div class="empty">${what}</div></td></tr>`;
  const hName = id => (hospitals.find(h => h.id === id) || {}).name || "", hCode = id => (hospitals.find(h => h.id === id) || {}).code || "";
  const cycleDays = f => { const d = String(f || "").toUpperCase().split(/[,\s/]+/).map(x => FREQ[x]).filter(Boolean); return d.length ? Math.min(...d) : null; };
  const cycleText = f => String(f || "").toUpperCase().split(/[,\s/]+/).filter(Boolean).map(x => FREQ_TH[x] || x).join(" + ") || "-";

  // ---------- state of every contract (status, renewal stage, last visit, missed cycle) ----------
  function compute() {
    const by = (list, key) => { const m = new Map(); list.forEach(r => { (m.get(r.contract_id) || m.set(r.contract_id, []).get(r.contract_id)).push(r); }); return m; };
    const vM = by(visits), aM = by(appts), pM = by(procs);
    contracts.forEach(c => {
      c.daysLeft = c.end_date ? diff(c.end_date, TODAY) : null;
      c.siteExpired = !c.end_date && /สถานะไซต์:\s*(หมดแล้ว|ไม่เคยมี)/.test(c.note || "");
      c.status = c.cancelled || /ยกเลิก/.test(c.scope + c.note) ? "ยกเลิก" : c.siteExpired ? "หมดอายุแล้ว" : !c.end_date ? "ยังไม่มีวันที่" : c.daysLeft < 0 ? "หมดอายุแล้ว" : c.daysLeft <= ALERT ? "ใกล้หมด" : "ยังมีผล";
      const off = c.status === "ยกเลิก", cycleStart = iso((c.end_date ? t(c.end_date) : t(TODAY)) - 365 * DAY);
      const ps = (pM.get(c.id) || []).filter(p => p.step_date >= cycleStart).sort((a, b) => a.step_date < b.step_date ? -1 : 1);
      c.steps = STEPS.map(s => ps.filter(p => p.step === s).pop() || null);
      c.procs = ps; c.poDone = !!c.steps[3];
      c.renew = !off && (c.siteExpired || (c.end_date && c.daysLeft <= ALERT)) && !c.poDone;
      c.stage = !c.renew ? "" : (c.siteExpired || c.daysLeft < 0) ? "หมดสัญญาแล้ว ต้องเร่งออก PO" : c.daysLeft <= 30 ? "สรุปเลือกผู้รับเหมาและออก PO" : c.daysLeft <= 60 ? "ขอใบเสนอราคา 3 เจ้า และเปรียบเทียบ" : "ออก PR เพื่อเริ่มจัดซื้อ";
      c.visits = (vM.get(c.id) || []).sort((a, b) => a.visit_date < b.visit_date ? 1 : -1);
      c.lastVisit = c.visits.length ? c.visits[0].visit_date : "";
      const am = new Map(); (aM.get(c.id) || []).sort((a, b) => a.created_at < b.created_at ? -1 : 1).forEach(a => am.set(a.plan_month, a));   // latest record per planned month
      c.appts = [...am.values()].sort((a, b) => a.plan_month < b.plan_month ? 1 : -1);
      const iv = cycleDays(c.pm_cycle), active = !off && c.end_date && c.daysLeft >= 0 && (!c.start_date || c.start_date <= TODAY);
      const since = c.lastVisit ? diff(TODAY, c.lastVisit) : null;
      c.overdue = !!(active && iv && (since === null ? (c.start_date && diff(TODAY, c.start_date) > iv + 7) : since > iv + 7));
      c.nextDue = active && iv && c.lastVisit ? iso(t(c.lastVisit) + iv * DAY) : "";
      const a = c.appts.find(x => (x.new_date || x.appt_date || x.plan_month) >= TODAY.slice(0, 7)), due = a ? (a.new_date || a.appt_date || "") : c.nextDue;
      c.upcoming = (c.status === "ยังมีผล" || c.status === "ใกล้หมด" || c.poDone) && due && due >= TODAY && due <= iso(t(TODAY) + 14 * DAY) && !(a && /^ยืนยัน/.test(a.status)) ? { date: due, status: a ? a.status : "ยังไม่บันทึกนัด" } : null;
    });
  }
  const stPill = c => `<span class="st ${{ "ยังมีผล": "ok", "ใกล้หมด": "soon", "หมดอายุแล้ว": "exp", "ยังไม่มีวันที่": "nod", "ยกเลิก": "can" }[c.status]}">${c.status === "ใกล้หมด" ? "ใกล้หมด ≤90 วัน" : c.status}</span>`;
  const leftTxt = c => c.daysLeft == null ? "-" : c.daysLeft < 0 ? `เกิน ${n(-c.daysLeft)} วัน` : `${n(c.daysLeft)} วัน`;
  const stepsHtml = c => `<span class="steps">${STEPS.map((s, i) => `<span class="${c.steps[i] ? "y" : "n"}">${c.steps[i] ? "✓" : "○"} ${esc(s)}</span>`).join("")}</span>`;
  const sel = () => $("#hSel").value, list = () => contracts.filter(c => !sel() || c.hospital_id === sel());
  const canEdit = hid => exec || (me.hospital_id === hid && MGR.includes(me.role)), canLog = hid => exec || (me.hospital_id === hid && me.role !== "observer");
  const count = l => { const k = s => l.filter(c => c.status === s).length; return { all: l.length, ok: k("ยังมีผล"), soon: k("ใกล้หมด"), exp: k("หมดอายุแล้ว"), nod: k("ยังไม่มีวันที่"), can: k("ยกเลิก"), renew: l.filter(c => c.renew).length, od: l.filter(c => c.overdue).length,
    vis: l.reduce((s, c) => s + c.visits.filter(v => v.visit_date.slice(0, 7) === TODAY.slice(0, 7)).length, 0) }; };

  // ---------- start ----------
  sb.auth.onAuthStateChange((_e, session) => setTimeout(() => boot(session), 0));
  async function boot(session) {
    if (me) return;
    if (!session) { $("#gate").hidden = false; return; }
    const { data } = await sb.from("profiles").select("id,full_name,role,hospital_id,hospitals(id,code,name)").eq("id", session.user.id).maybeSingle();
    if (!data || !data.hospital_id) { $("#gate").hidden = false; return; }
    me = data; $("#gate").hidden = true; $("#who").textContent = me.full_name || session.user.email;
    exec = (await sb.rpc("am_exec")).data === true;
    if (exec) hospitals = ((await sb.from("hospitals").select("id,code,name").order("code")).data || []); else hospitals = [me.hospitals];
    $("#hSel").innerHTML = (exec ? `<option value="">ทุกโรงพยาบาล (${hospitals.length} โรง)</option>` : "") + hospitals.map(h => `<option value="${h.id}">${esc(h.code)} · ${esc(h.name)}</option>`).join("");
    const p = (new URLSearchParams(location.search).get("p") || "").toUpperCase(), hit = hospitals.find(h => h.code === p); if (hit) $("#hSel").value = hit.id;
    $("#asOf").textContent = "ข้อมูล ณ วันที่ " + th(TODAY);
    $("#mailTab").hidden = !(exec || MGR.includes(me.role));
    await load(); $("#body").hidden = false; $("#tabs").hidden = false;
    show(new URLSearchParams(location.search).get("tab") || (hit ? "reg" : "sum"));
  }
  async function load() {
    const all = async tb => { const out = []; for (let i = 0; ; i += 1000) { const r = await sb.from(tb).select("*").order("created_at").range(i, i + 999); if (r.error) throw r.error; out.push(...r.data); if (r.data.length < 1000) return out; } };
    try { [contracts, visits, appts, procs] = await Promise.all(["ma_contracts", "ma_visits", "ma_appts", "ma_proc"].map(all)); }
    catch (e) { contracts = []; $("#rMsg").innerHTML = `<div class="note bad">${esc(errText(e))}</div>`; toast(errText(e)); }
    contracts.sort((a, b) => hCode(a.hospital_id).localeCompare(hCode(b.hospital_id)) || a.grp.localeCompare(b.grp) || a.sort - b.sort);
    if (exec || MGR.includes(me.role)) { const r = await sb.from("ma_recipients").select("*").order("created_at"); recips = r.error ? [] : r.data; recipErr = r.error ? errText(r.error) : ""; }
    if (exec && !plan) { const [y, m] = TODAY.split("-"), r = await sb.rpc("pm_followup_all_by", { p_year: +y, p_month: +m, p_by: "MA" }); plan = r.error ? {} : Object.fromEntries((r.data || []).map(x => [x.code, x])); }
    compute();
  }
  document.querySelectorAll("#tabs button").forEach(b => b.onclick = () => show(b.dataset.tab));
  $("#hSel").onchange = () => show(cur);
  function show(tab) {
    const tabs = ["sum", "reg", "renew", "visit", "bylaw"].concat($("#mailTab").hidden ? [] : ["mail"]);
    cur = tabs.includes(tab) ? tab : "sum";
    document.querySelectorAll("#tabs button").forEach(b => b.setAttribute("aria-selected", b.dataset.tab === cur));
    ["sum", "reg", "renew", "visit", "bylaw", "mail"].forEach(x => $("#tab-" + x).hidden = x !== cur);
    const k = count(list()); $("#renewN").textContent = k.renew ? `(${k.renew})` : ""; $("#odN").textContent = k.od ? `(${k.od})` : "";
    $("#title").textContent = sel() ? "PM MA · " + hName(sel()) : "PM MA 12 โรงพยาบาล";
    ({ sum: drawSum, reg: drawReg, renew: drawRenew, visit: drawVisit, bylaw: drawBylaw, mail: drawMail })[cur]();
  }
  const kpis = (el, a) => $(el).innerHTML = a.map(([l, v, s]) => `<div class="kpi"><div class="num"${s ? ` style="color:${s}"` : ""}>${v}</div><div class="meta">${l}</div></div>`).join("");
  const shown = () => sel() ? hospitals.filter(h => h.id === sel()) : hospitals;

  // ---------- overview ----------
  const sumRows = () => shown().map(h => ({ h, k: count(contracts.filter(c => c.hospital_id === h.id)), p: plan && plan[h.code] }));
  function findings() {
    const l = list(), k = count(l), rows = sumRows(), f = [], notes = [], scope = sel() ? hName(sel()) : `${hospitals.length} โรงพยาบาล`;
    if (!l.length) return { f: [`${scope} ยังไม่มีสัญญา MA ในทะเบียน`], notes: ["นำเข้าทะเบียนสัญญาจากไฟล์ Excel ที่แท็บ ทะเบียนสัญญา เพื่อเริ่มติดตาม"] };
    const live = k.all - k.can;
    f.push(`${scope} มีสัญญา MA ในทะเบียน ${n(live)} สัญญา ยังมีผล ${n(k.ok)} ใกล้หมดภายใน 90 วัน ${n(k.soon)} หมดอายุแล้ว ${n(k.exp)} และยังไม่มีวันสิ้นสุด ${n(k.nod)} สัญญา (${live ? Math.round(k.nod * 100 / live) : 0}%)`);
    f.push(k.renew ? `มี ${n(k.renew)} สัญญาที่ต้องดำเนินการต่อสัญญาและยังไม่ได้บันทึก PO${rows.length > 1 ? " มากที่สุดที่ " + rows.filter(r => r.k.renew).sort((a, b) => b.k.renew - a.k.renew).slice(0, 3).map(r => `${r.h.code} ${r.k.renew}`).join(", ") : ""}` : "ไม่มีสัญญาที่ค้างการต่อสัญญา");
    f.push(k.od ? `ผู้รับเหมาขาดรอบ PM ตามสัญญา ${n(k.od)} สัญญา` : "ไม่พบผู้รับเหมาที่ขาดรอบ PM ในสัญญาที่มีวันที่ครบ");
    f.push(`เดือนนี้มีบันทึกการเข้า PM ของผู้รับเหมา ${n(k.vis)} ครั้ง`);
    const noV = l.filter(c => c.status !== "ยกเลิก" && !c.vendor).length;
    if (k.nod) notes.push(`ควรกรอกวันเริ่มและวันสิ้นสุดสัญญาให้ครบ ${n(k.nod)} สัญญา เพราะระบบเตือนต่อสัญญาและตรวจการขาดรอบได้เฉพาะสัญญาที่มีวันที่`);
    if (noV) notes.push(`มี ${n(noV)} รายการที่ยังไม่ระบุชื่อผู้รับเหมา`);
    const empty = rows.filter(r => !r.k.all).map(r => r.h.code); if (empty.length && rows.length > 1) notes.push(`โรงที่ยังไม่มีทะเบียนสัญญา MA: ${empty.join(", ")}`);
    const ex = l.filter(c => c.renew && (c.siteExpired || c.daysLeft < 0)).length; if (ex) notes.push(`สัญญาที่หมดแล้วและยังไม่ออก PO ${n(ex)} สัญญา ควรเร่งดำเนินการก่อน เพราะเครื่องจักรไม่มีผู้รับเหมาดูแลตามสัญญา`);
    return { f, notes };
  }
  const SUM_HEAD = ["รหัส", "โรงพยาบาล", "สัญญาทั้งหมด", "ยังมีผล", "ใกล้หมด ≤90 วัน", "หมดอายุแล้ว", "ยังไม่มีวันที่", "รอต่อสัญญา", "ขาดรอบ PM", "เข้า PM เดือนนี้ (ครั้ง)", "แผน PM MA เดือนนี้ (ครั้ง)", "ทำแล้วตามแผน (ครั้ง)"];
  const sumData = () => sumRows().map(({ h, k, p }) => [h.code, h.name, k.all - k.can, k.ok, k.soon, k.exp, k.nod, k.renew, k.od, k.vis, p ? +p.planned : "", p ? +p.done : ""]);
  const grpData = () => shown().map(h => { const l = contracts.filter(c => c.hospital_id === h.id && c.status !== "ยกเลิก"), g = GROUPS.map((_, i) => l.filter(c => { const j = GROUPS.findIndex(x => x[0] === (c.grp || "")[0]); return (j < 0 ? 4 : j) === i; }).length); return [h.code, h.name, ...g, l.length]; });
  function drawSum() {
    const k = count(list()), fd = findings();
    kpis("#sK", [["สัญญา MA ทั้งหมด", n(k.all - k.can)], ["ยังมีผล", n(k.ok), "#0a7a35"], ["ใกล้หมด ≤90 วัน", n(k.soon), "#a86400"], ["หมดอายุแล้ว", n(k.exp), "#b3261e"], ["ยังไม่มีวันที่", n(k.nod)], ["รอต่อสัญญา (ยังไม่ PO)", n(k.renew), k.renew ? "#b3261e" : ""], ["ขาดรอบ PM", n(k.od), k.od ? "#a86400" : ""], ["เข้า PM เดือนนี้ (ครั้ง)", n(k.vis)]]);
    $("#sExec").innerHTML = `<div class="panel"><h3 style="margin:0 0 6px">บทสรุปผู้บริหาร</h3><ul style="margin:0 0 6px 18px;padding:0">${fd.f.map(x => `<li>${esc(x)}</li>`).join("")}</ul>${fd.notes.length ? `<p class="meta" style="margin:8px 0 2px">ข้อสังเกตและข้อเสนอแนะ</p><ul style="margin:0 0 0 18px;padding:0">${fd.notes.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}</div>`;
    const rows = sumRows(), tot = sumData().reduce((s, r) => s.map((v, i) => i < 2 ? v : (+v || 0) + (+r[i] || 0)), ["", "รวม", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const c = (v, cls) => `<td class="r${v && cls ? " " + cls : ""}">${v === "" ? "-" : n(v)}</td>`;
    $("#sT").innerHTML = `<tr>${SUM_HEAD.map((h, i) => `<th${i > 1 ? ' class="r"' : ""}>${h}</th>`).join("")}</tr>` + sumData().map((r, i) => `<tr class="click" data-h="${rows[i].h.id}"><td><b>${esc(r[0])}</b></td><td>${esc(r[1])}</td>${c(r[2])}${c(r[3])}${c(r[4])}${c(r[5], "zero")}${c(r[6])}${c(r[7], "zero")}${c(r[8], "zero")}${c(r[9])}${c(r[10])}${c(r[11])}</tr>`).join("") +
      (rows.length > 1 ? `<tr style="font-weight:700;background:#eef3f8"><td></td><td>รวม ${rows.length} โรง</td>${tot.slice(2).map((v, i) => `<td class="r">${i > 7 && !plan ? "-" : n(v)}</td>`).join("")}</tr>` : "");
    $("#sT").querySelectorAll("tr.click").forEach(r => r.onclick = () => { $("#hSel").value = r.dataset.h; show("reg"); });
    const g = grpData(), gt = g.reduce((s, r) => s.map((v, i) => i < 2 ? v : v + r[i]), ["", "รวม", 0, 0, 0, 0, 0, 0]);
    $("#sG").innerHTML = `<tr><th>รหัส</th><th>โรงพยาบาล</th>${GROUPS.map(x => `<th class="r">${esc(x)}</th>`).join("")}<th class="r">รวม</th></tr>` + g.map(r => `<tr><td><b>${esc(r[0])}</b></td><td>${esc(r[1])}</td>${r.slice(2).map(v => `<td class="r">${n(v)}</td>`).join("")}</tr>`).join("") +
      (g.length > 1 ? `<tr style="font-weight:700;background:#eef3f8"><td></td><td>รวม ${g.length} โรง</td>${gt.slice(2).map(v => `<td class="r">${n(v)}</td>`).join("")}</tr>` : "");
  }
  const scopeName = () => sel() ? hName(sel()) : "12 โรงพยาบาล", fileTag = () => (sel() ? hCode(sel()) : "12โรง") + "_" + (+TODAY.slice(0, 4) + 543);
  $("#sX").onclick = () => { const fd = findings(); Office.xlsx(`PM_MA_ภาพรวม_${fileTag()}`, [Office.summarySheet({ title: "ภาพรวมสัญญา MA และการเข้า PM ของผู้รับเหมา", org: scopeName(), period: "ข้อมูล ณ " + th(TODAY), findings: fd.f, notes: fd.notes, figures: [], groups: [] }),
    { name: "สถานะรายโรง", rows: [SUM_HEAD, ...sumData()], header: 0 }, { name: "ตามกลุ่มงาน", rows: [["รหัส", "โรงพยาบาล", ...GROUPS, "รวม"], ...grpData()], header: 0 }, { name: "ทะเบียนสัญญา", rows: [REG_HEAD, ...regData(list())], header: 0 }]); };
  $("#sP").onclick = async e => { const b = e.currentTarget, tx = b.textContent, fd = findings(), k = count(list()); b.disabled = true; b.textContent = "กำลังสร้าง…";
    const rn = list().filter(c => c.renew).sort((a, b) => (a.daysLeft ?? -99999) - (b.daysLeft ?? -99999));
    try { await Office.pptx(`บทสรุปผู้บริหาร_PM_MA_${fileTag()}`, { title: "บทสรุปผู้บริหาร PM MA: สัญญาและการเข้า PM ของผู้รับเหมา", org: scopeName(), period: "ข้อมูล ณ " + th(TODAY), findings: fd.f, notes: fd.notes,
      kpis: [["สัญญา MA ทั้งหมด", n(k.all - k.can)], ["ยังมีผล", n(k.ok)], ["ใกล้หมด ≤90 วัน", n(k.soon)], ["หมดอายุแล้ว", n(k.exp)], ["ยังไม่มีวันที่", n(k.nod)], ["รอต่อสัญญา", n(k.renew)], ["ขาดรอบ PM", n(k.od)], ["เข้า PM เดือนนี้", n(k.vis)]],
      sections: [{ title: "สถานะสัญญา MA รายโรงพยาบาล", head: SUM_HEAD.slice(0, 9), rows: sumData().map(r => r.slice(0, 9)), chart: false }, { title: "จำนวนสัญญาแยกตามกลุ่มงาน", head: ["รหัส", "โรงพยาบาล", "By-law", "ความพร้อมใช้", "ลิฟต์/ขนส่ง", "สื่อสาร/ควบคุม", "อื่นๆ", "รวม"], rows: grpData(), chart: false },
        ...(rn.length ? [{ title: "สัญญาที่ต้องต่อสัญญา", head: ["โรง", "ขอบเขตสัญญา", "ผู้รับเหมา", "วันสิ้นสุด", "เหลือ", "ขั้นที่ควรทำ"], rows: rn.map(c => [hCode(c.hospital_id), c.scope, c.vendor || "-", th(c.end_date), leftTxt(c), c.stage]), chart: false, note: rn.length > 12 ? `แสดง 12 จาก ${rn.length} รายการ ดูครบในไฟล์ Excel` : "" }] : [])] }); } catch (err) { toast(err.message || String(err)); }
    b.disabled = false; b.textContent = tx; };

  // ---------- register ----------
  const REG_HEAD = ["รหัสโรง", "โรงพยาบาล", "กลุ่มงาน", "รายการในกลุ่ม", "ระบบ", "ขอบเขตสัญญา / กลุ่มเครื่องจักร", "จำนวนเครื่อง", "ผู้รับเหมา (Vendor)", "เลขที่สัญญา / PO", "วันเริ่มสัญญา (พ.ศ.)", "วันสิ้นสุดสัญญา (พ.ศ.)", "เหลือ (วัน)", "รอบเข้า PM ตามสัญญา", "มูลค่าสัญญา (บาท/ปี)", "ผู้ติดต่อ / โทร", "อีเมลผู้รับเหมา", "สถานะสัญญา", "เข้า PM ล่าสุด", "ขาดรอบ", "ขั้นต่อสัญญา", "หมายเหตุ"];
  const regData = l => l.map(c => [hCode(c.hospital_id), hName(c.hospital_id), c.grp, c.grp_item, c.sys, c.scope, c.qty ?? "", c.vendor, c.contract_no, c.start_date ? th(c.start_date) : "", c.end_date ? th(c.end_date) : "", c.daysLeft ?? "", c.pm_cycle, c.value_year ?? "", c.contact, c.vendor_email, c.status, c.lastVisit ? th(c.lastVisit) : "", c.overdue ? "ขาดรอบ" : "", c.stage, c.note]);
  const regRows = () => { const q = $("#rQ").value.trim().toLowerCase(), g = $("#rG").value, s = $("#rS").value;
    return list().filter(c => (!g || (c.grp || "")[0] === g[0]) && (!s || c.status === s) && (!q || [c.sys, c.scope, c.vendor, c.grp_item, c.contract_no, c.note].some(x => (x || "").toLowerCase().includes(q)))); };
  function drawReg() {
    if (!$("#rG").options.length) $("#rG").innerHTML = `<option value="">ทุกกลุ่มงาน</option>` + GROUPS.map(g => `<option>${esc(g)}</option>`).join("");
    const all = list(), l = regRows(), k = count(all), hid = sel() || (!exec && me.hospital_id), multi = !sel() && hospitals.length > 1;
    $("#rAdd").hidden = !(hid && canEdit(hid)); $("#rImp").hidden = !(exec || MGR.includes(me.role));
    kpis("#rK", [["สัญญาทั้งหมด", n(k.all - k.can)], ["ยังมีผล", n(k.ok), "#0a7a35"], ["ใกล้หมด ≤90 วัน", n(k.soon), "#a86400"], ["หมดอายุแล้ว", n(k.exp), "#b3261e"], ["ยังไม่มีวันที่", n(k.nod)], ["จำนวนเครื่องตามสัญญา", n(all.reduce((s, c) => s + (c.status === "ยกเลิก" ? 0 : c.qty || 0), 0))]]);
    $("#rN").textContent = all.length ? `แสดง ${n(l.length)} จาก ${n(all.length)} สัญญา · แตะแถวเพื่อดูรายละเอียดและบันทึกข้อมูล` : "";
    $("#rT").innerHTML = `<tr>${multi ? "<th>โรง</th>" : ""}<th>กลุ่มงาน</th><th>ระบบ</th><th>ขอบเขตสัญญา / กลุ่มเครื่องจักร</th><th class="r">จำนวน</th><th>ผู้รับเหมา</th><th>วันเริ่ม</th><th>วันสิ้นสุด</th><th class="r">เหลือ</th><th>รอบ PM</th><th>สถานะ</th><th>เข้า PM ล่าสุด</th></tr>` +
      (l.map(c => `<tr class="click" data-id="${c.id}">${multi ? `<td><b>${esc(hCode(c.hospital_id))}</b></td>` : ""}<td class="meta">${esc((c.grp || "").replace(/^(\d)\.\s*/, "$1. "))}</td><td>${esc(c.sys)}</td><td><b>${esc(c.scope)}</b>${c.grp_item ? `<div class="meta">${esc(c.grp_item)}</div>` : ""}</td><td class="r">${c.qty ?? "-"}</td><td>${esc(c.vendor || "-")}</td><td>${th(c.start_date)}</td><td>${th(c.end_date)}</td><td class="r">${leftTxt(c)}</td><td>${esc(c.pm_cycle || "-")}</td><td>${stPill(c)}${c.overdue ? ' <span class="st od">ขาดรอบ</span>' : ""}</td><td>${c.lastVisit ? th(c.lastVisit) : "-"}</td></tr>`).join("")
        || none(12, all.length ? "ไม่พบรายการที่ค้นหา" : "ยังไม่มีสัญญา MA ในทะเบียน กด นำเข้าจาก Excel หรือ + เพิ่มสัญญา"));
    $("#rT").querySelectorAll("tr.click").forEach(r => r.onclick = () => detail(r.dataset.id));
  }
  ["#rQ", "#rG", "#rS"].forEach(s => $(s).addEventListener(s === "#rQ" ? "input" : "change", drawReg));
  $("#rX").onclick = () => { const l = regRows(), k = count(l); Office.table(`ทะเบียนสัญญา_MA_${fileTag()}`, REG_HEAD, regData(l), { title: "ทะเบียนสัญญา MA (ผู้รับเหมา)", org: scopeName(), period: "ข้อมูล ณ " + th(TODAY),
    findings: [`สัญญาในรายงาน ${n(l.length)} สัญญา ยังมีผล ${n(k.ok)} ใกล้หมด ${n(k.soon)} หมดอายุแล้ว ${n(k.exp)} ยังไม่มีวันที่ ${n(k.nod)}`, `ต้องต่อสัญญา ${n(k.renew)} สัญญา ขาดรอบ PM ${n(k.od)} สัญญา`] }); };
  const TPL_HEAD = ["ลำดับ", "ระบบ", "ขอบเขตสัญญา / กลุ่มเครื่องจักร", "จำนวนเครื่อง", "ผู้รับเหมา (Vendor)", "เลขที่สัญญา / PO", "วันเริ่มสัญญา", "วันสิ้นสุดสัญญา", "รอบเข้า PM ตามสัญญา", "มูลค่าสัญญา (บาท/ปี)", "ผู้ติดต่อ / โทร", "อีเมลผู้รับเหมา", "สถานะสัญญา (คำนวณเอง)", "หมายเหตุ", "กลุ่มงาน", "รายการในกลุ่ม"];
  $("#rTpl").onclick = () => { const l = list().filter(() => sel() || !exec), code = sel() ? hCode(sel()) : exec ? "แบบฟอร์ม" : hCode(me.hospital_id);
    Office.xlsx(`ทะเบียนสัญญา_MA_${code}_${+TODAY.slice(0, 4) + 543}`, [{ name: "ทะเบียนสัญญา", rows: [["ทะเบียนสัญญา MA (ผู้รับเหมา)"], ["หนึ่งแถวต่อหนึ่งสัญญา · วันที่กรอกได้ทั้ง 31/10/2569 (พ.ศ.) และ 31/10/2026 (ค.ศ.) · รอบเข้า PM: M ทุกเดือน, 2M ทุก 2 เดือน, Q ทุก 3 เดือน, 4M ทุก 4 เดือน, S ทุก 6 เดือน, Y ปีละครั้ง"], [], TPL_HEAD,
      ...l.map((c, i) => [i + 1, c.sys, c.scope, c.qty ?? "", c.vendor, c.contract_no, c.start_date ? th(c.start_date) : "", c.end_date ? th(c.end_date) : "", c.pm_cycle, c.value_year ?? "", c.contact, c.vendor_email, c.status, c.note, c.grp, c.grp_item])], styles: { 0: 2, 3: 1 }, header: 3 }]); };

  // ---------- import from Excel (the per-hospital register file, or the 12-hospital combined file) ----------
  $("#rImp").onclick = () => $("#rFile").click();
  $("#rFile").onchange = async e => { const f = e.target.files[0]; e.target.value = ""; if (!f) return; const msg = m => $("#rMsg").innerHTML = m;
    try {
      const wb = await Office.readXlsx(f), sheet = wb["ทะเบียนสัญญา"] || wb["รวม 12 โรง"] || Object.values(wb).find(r => r.some(x => x.some(c => /ผู้รับเหมา/.test(c))));
      const hi = sheet ? sheet.findIndex(r => r.some(c => /^ผู้รับเหมา/.test(String(c).trim()))) : -1; if (hi < 0) throw new Error("ไม่พบหัวตาราง (คอลัมน์ ผู้รับเหมา) ในไฟล์นี้ กรุณาใช้แบบฟอร์ม Excel ของระบบ");
      const head = sheet[hi].map(c => String(c).trim()), ci = p => head.findIndex(x => x.startsWith(p));
      const ix = { code: ci("รหัสโรง"), grp: ci("กลุ่มงาน"), item: ci("รายการในกลุ่ม"), sys: ci("ระบบ"), scope: ci("ขอบเขตสัญญา"), qty: ci("จำนวนเครื่อง"), ven: ci("ผู้รับเหมา"), no: ci("เลขที่สัญญา"), start: ci("วันเริ่มสัญญา"), end: ci("วันสิ้นสุดสัญญา"), fq: ci("รอบเข้า PM"), val: ci("มูลค่าสัญญา"), con: ci("ผู้ติดต่อ"), em: ci("อีเมล"), note: ci("หมายเหตุ") };
      const g = (r, k) => ix[k] < 0 ? "" : String(r[ix[k]] ?? "").trim(), fileCode = (/(PT1|PT2|PT3|PTN|PTP|PTS|PTW|PLC|PLD|PLK|PLR|PLS)/i.exec(f.name) || [])[1];
      const bad = [], rows = [];
      sheet.slice(hi + 1).forEach((r, i) => { if (!g(r, "scope") && !g(r, "ven")) return;
        const code = (g(r, "code") || fileCode || (sel() ? hCode(sel()) : exec ? "" : hCode(me.hospital_id))).toUpperCase(), h = hospitals.find(x => x.code === code), line = hi + 2 + i;
        if (!h) return bad.push(`แถว ${line}: ไม่ทราบรหัสโรงพยาบาล${code ? " " + code : ""}`); if (!canEdit(h.id)) return bad.push(`แถว ${line}: ไม่มีสิทธิ์แก้ทะเบียนของ ${code}`);
        const s = parseDate(g(r, "start")), en = parseDate(g(r, "end")); if (s === undefined || en === undefined) return bad.push(`แถว ${line}: อ่านวันที่ไม่ได้ (${g(r, s === undefined ? "start" : "end")})`);
        rows.push({ hospital_id: h.id, grp: g(r, "grp"), grp_item: g(r, "item"), sys: g(r, "sys"), scope: g(r, "scope"), qty: num(g(r, "qty")), vendor: g(r, "ven"), contract_no: g(r, "no"), start_date: s, end_date: en, pm_cycle: g(r, "fq").toUpperCase(), value_year: num(g(r, "val")), contact: g(r, "con"), vendor_email: g(r, "em"), note: g(r, "note"), sort: i }); });
      if (!rows.length) throw new Error(bad[0] || "ไม่พบแถวข้อมูลในไฟล์นี้");
      // match on hospital + system + scope (+ vendor when several share them); a matched row is updated, the rest are added
      const key = c => [c.hospital_id, c.sys, c.scope].join("|").toLowerCase(), pool = new Map(); contracts.forEach(c => (pool.get(key(c)) || pool.set(key(c), []).get(key(c))).push(c));
      const upd = [], add = []; rows.forEach(r => { const p = pool.get(key(r)) || [], j = Math.max(0, p.findIndex(c => c.vendor === r.vendor)), hitC = p.splice(j, 1)[0]; if (hitC) { if (ix.grp < 0) delete r.grp; if (ix.item < 0) delete r.grp_item; upd.push({ ...r, id: hitC.id }); } else add.push(r); });
      const codes = [...new Set(rows.map(r => hCode(r.hospital_id)))].join(", ");
      form(`<h3>นำเข้าทะเบียนสัญญา MA</h3><p class="sub">ไฟล์ ${esc(f.name)}</p><dl class="dl"><dt>โรงพยาบาล</dt><dd>${esc(codes)}</dd><dt>สัญญาใหม่ที่จะเพิ่ม</dt><dd><b>${n(add.length)}</b></dd><dt>สัญญาเดิมที่จะปรับข้อมูล</dt><dd><b>${n(upd.length)}</b></dd><dt>แถวที่ข้าม</dt><dd>${n(bad.length)}</dd></dl>${bad.length ? `<div class="note bad">${bad.slice(0, 6).map(esc).join("<br>")}${bad.length > 6 ? `<br>และอีก ${bad.length - 6} แถว` : ""}</div>` : ""}<p class="meta">สัญญาเดิมที่ไม่อยู่ในไฟล์จะคงอยู่ ไม่ถูกลบ บันทึกการเข้า PM และขั้นจัดซื้อเดิมไม่เปลี่ยน</p>`, "ยืนยันนำเข้า", async () => {
        for (let i = 0; i < upd.length; i += 200) { const r = await sb.from("ma_contracts").upsert(upd.slice(i, i + 200)); if (r.error) throw r.error; }
        for (let i = 0; i < add.length; i += 200) { const r = await sb.from("ma_contracts").insert(add.slice(i, i + 200)); if (r.error) throw r.error; }
        msg(`<div class="note ok">นำเข้าแล้ว เพิ่ม ${n(add.length)} สัญญา ปรับข้อมูล ${n(upd.length)} สัญญา${bad.length ? ` ข้าม ${n(bad.length)} แถว` : ""}</div>`); });
    } catch (err) { msg(`<div class="note bad">${esc(err.message || String(err))}</div>`); } };

  // ---------- dialogs ----------
  function form(html, okText, onOk) {
    $("#dlgIn").innerHTML = `<form id="dlgF">${html}<div id="dlgE"></div><div class="acts" style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px"><button class="btn" type="button" id="dlgC">${okText ? "ยกเลิก" : "ปิด"}</button>${okText ? `<button class="btn primary" type="submit" id="dlgOk">${okText}</button>` : ""}</div></form>`;
    $("#dlgC").onclick = () => $("#dlg").close();
    $("#dlgF").onsubmit = async e => { e.preventDefault(); if (!onOk) return; const b = $("#dlgOk"); b.disabled = true;
      try { await onOk(Object.fromEntries(new FormData(e.target).entries())); $("#dlg").close(); await load(); show(cur); toast("บันทึกแล้ว"); }
      catch (err) { $("#dlgE").innerHTML = `<div class="note bad">${esc(err.message || errText(err))}</div>`; b.disabled = false; } };
    if (!$("#dlg").open) $("#dlg").showModal();
  }
  const need = (v, what) => { const d = parseDate(v); if (d === undefined) throw new Error(`${what}: รูปแบบวันที่ไม่ถูกต้อง ให้กรอกแบบ 31/10/2569`); return d; };
  const must = (v, what) => { const d = need(v, what); if (!d) throw new Error(`กรุณากรอก${what}`); return d; };
  // extra: input attributes; a leading "w" makes the field span the full width
  const inp = (label, name, val = "", extra = "") => { const wide = /^w( |$)/.test(extra); return `<label${wide ? ' class="w"' : ""}>${label}<input name="${name}" value="${esc(val ?? "")}" ${wide ? extra.slice(1) : extra}></label>`; };
  const dIn = (label, name, val) => inp(label + " (วว/ดด/ปปปป พ.ศ.)", name, val ? th(val) : "", 'placeholder="31/10/2569" inputmode="numeric"');
  const who = () => ({ created_by_name: me.full_name || "" });

  function detail(id) {
    const c = contracts.find(x => x.id === id); if (!c) return; const ed = canEdit(c.hospital_id), lg = canLog(c.hospital_id);
    const tb = (head, rows, empty) => rows.length ? `<div class="scroll"><table><tr>${head.map(h => `<th>${h}</th>`).join("")}</tr>${rows.map(r => `<tr>${r.map(v => `<td>${v}</td>`).join("")}</tr>`).join("")}</table></div>` : `<p class="meta">${empty}</p>`;
    form(`<h3>${esc(c.scope || c.sys)}</h3><p class="sub">${esc(hName(c.hospital_id))} · ${esc(c.grp)}${c.grp_item ? " · " + esc(c.grp_item) : ""}</p>
      <dl class="dl"><dt>สถานะสัญญา</dt><dd>${stPill(c)} ${c.overdue ? '<span class="st od">ขาดรอบ PM</span>' : ""}</dd><dt>ระบบ</dt><dd>${esc(c.sys || "-")}</dd><dt>ผู้รับเหมา</dt><dd>${esc(c.vendor || "-")}</dd><dt>เลขที่สัญญา / PO</dt><dd>${esc(c.contract_no || "-")}</dd>
      <dt>ระยะสัญญา</dt><dd>${th(c.start_date)} ถึง ${th(c.end_date)}${c.daysLeft != null ? ` (${c.daysLeft < 0 ? "เกินมา " + n(-c.daysLeft) : "เหลือ " + n(c.daysLeft)} วัน)` : ""}</dd><dt>รอบเข้า PM</dt><dd>${esc(c.pm_cycle || "-")} ${c.pm_cycle ? `<span class="meta">(${esc(cycleText(c.pm_cycle))})</span>` : ""}</dd>
      <dt>จำนวนเครื่อง</dt><dd>${c.qty ?? "-"}</dd><dt>มูลค่าสัญญา (บาท/ปี)</dt><dd>${c.value_year != null ? n(c.value_year) : "-"}</dd><dt>ผู้ติดต่อ</dt><dd>${esc(c.contact || "-")}${c.vendor_email ? " · " + esc(c.vendor_email) : ""}</dd>
      <dt>เข้า PM ล่าสุด</dt><dd>${c.lastVisit ? th(c.lastVisit) : "ยังไม่มีบันทึก"}${c.nextDue ? ` · ครั้งถัดไปประมาณ ${th(c.nextDue)}` : ""}</dd>${c.note ? `<dt>หมายเหตุ</dt><dd>${esc(c.note)}</dd>` : ""}
      <dt>การต่อสัญญา</dt><dd>${stepsHtml(c)}${c.stage ? `<div class="meta">ขั้นที่ควรทำตอนนี้: ${esc(c.stage)}</div>` : ""}</dd></dl>
      <div style="display:flex;gap:8px;flex-wrap:wrap">${lg ? '<button class="btn primary" type="button" data-a="visit">บันทึกการเข้า PM</button><button class="btn" type="button" data-a="appt">บันทึกนัดหมาย</button>' : ""}${ed ? '<button class="btn" type="button" data-a="proc">บันทึกขั้นจัดซื้อ</button><button class="btn" type="button" data-a="edit">แก้ไขสัญญา</button>' : ""}</div>
      <h3 class="sec">การเข้า PM (${c.visits.length})</h3>${tb(["วันที่", "รายละเอียด", "ผล", "ตรงนัด", "ปัญหาที่พบ", "ผู้บันทึก"], c.visits.slice(0, 12).map(v => [th(v.visit_date), esc(v.detail) + (v.report_link && /^https?:\/\//.test(v.report_link) ? ` <a href="${esc(v.report_link)}" target="_blank" rel="noopener">รายงาน</a>` : ""), esc(v.result || "-"), esc(v.on_time || "-"), esc(v.problem || "-") + (v.need_quote ? " (ต้องเสนอราคาซ่อม)" : ""), esc(v.created_by_name)]), "ยังไม่มีบันทึกการเข้า PM")}
      <h3 class="sec">นัดหมาย (${c.appts.length})</h3>${tb(["เดือนตามแผน", "วันที่นัด", "สถานะ", "วันใหม่", "หมายเหตุ"], c.appts.slice(0, 12).map(a => [thMonth(a.plan_month), th(a.appt_date), esc(a.status), th(a.new_date), esc(a.note || a.ref || "-")]), "ยังไม่มีบันทึกนัดหมาย")}
      <h3 class="sec">ขั้นจัดซื้อรอบปัจจุบัน (${c.procs.length})</h3>${tb(["ขั้นตอน", "วันที่", "เลขที่เอกสาร", "ผู้ขาย / ผู้เสนอราคา", "ราคา (บาท)"], c.procs.map(p => [esc(p.step), th(p.step_date), esc(p.doc_no || "-"), esc(p.seller || "-"), p.price != null ? n(p.price) : "-"]), "ยังไม่มีบันทึกขั้นจัดซื้อ")}`);
    $("#dlgIn").querySelectorAll("[data-a]").forEach(b => b.onclick = () => ({ visit: fVisit, appt: fAppt, proc: fProc, edit: fContract })[b.dataset.a](c));
  }
  function fVisit(c) {
    form(`<h3>บันทึกการเข้า PM</h3><p class="sub">${esc(c.scope)} · ${esc(c.vendor || "ไม่ระบุผู้รับเหมา")}</p><div class="fg">${dIn("วันที่เข้า PM", "d", TODAY)}<label>ตรงตามนัด<select name="on"><option></option><option>ตรงตามนัด</option><option>มาช้ากว่านัด</option><option>เลื่อนนัด</option></select></label>
      ${inp("รายละเอียดงาน", "detail", "", "w")}<label>ผลการตรวจ<select name="result"><option>ปกติ</option><option>พบปัญหา แก้ไขแล้ว</option><option>พบปัญหา รอแก้ไข</option></select></label>${inp("จำนวนเครื่องที่ทำ PM", "machines", c.qty ?? "", 'inputmode="numeric"')}
      ${inp("ช่างผู้รับเหมา", "tech")}${inp("จำนวนช่าง", "tn", "", 'inputmode="numeric"')}${inp("ปัญหาที่พบ", "problem", "", "w")}<label>ต้องเสนอราคาซ่อม<select name="quote"><option value="">ไม่ต้อง</option><option value="1">ต้องเสนอราคา</option></select></label>${inp("วิศวกรผู้ควบคุม", "sup", me.full_name || "")}${inp("ลิงก์รายงาน (ถ้ามี)", "link", "", 'w placeholder="https://"')}</div>`, "บันทึก", async v => {
      const r = await sb.from("ma_visits").insert({ hospital_id: c.hospital_id, contract_id: c.id, visit_date: must(v.d, "วันที่เข้า PM"), detail: v.detail.trim(), result: v.result, on_time: v.on, tech: v.tech.trim(), tech_n: num(v.tn), problem: v.problem.trim(), need_quote: !!v.quote, supervisor: v.sup.trim(), machines: num(v.machines), report_link: v.link.trim(), ...who() }); if (r.error) throw r.error; });
  }
  function fAppt(c) {
    const ms = Array.from({ length: 14 }, (_, i) => { const d = new Date(Date.UTC(+TODAY.slice(0, 4), +TODAY.slice(5, 7) - 2 + i, 1)); return iso(d.getTime()); });
    form(`<h3>บันทึกนัดหมาย / การยืนยันของผู้รับเหมา</h3><p class="sub">${esc(c.scope)} · ${esc(c.vendor || "ไม่ระบุผู้รับเหมา")}</p><div class="fg"><label>เดือนตามแผน<select name="m">${ms.map(m => `<option value="${m}"${m.slice(0, 7) === TODAY.slice(0, 7) ? " selected" : ""}>${thMonth(m)}</option>`).join("")}</select></label>${dIn("วันที่นัด", "d", "")}
      <label>สถานะการยืนยัน<select name="st">${CONFIRM.map(s => `<option>${s}</option>`).join("")}</select></label>${dIn("วันใหม่ ถ้าเลื่อน", "nd", "")}${inp("อ้างอิง (อีเมล / ผู้ติดต่อ)", "ref", "", "w")}${inp("หมายเหตุ", "note", "", "w")}</div>`, "บันทึก", async v => {
      const r = await sb.from("ma_appts").insert({ hospital_id: c.hospital_id, contract_id: c.id, plan_month: v.m, appt_date: need(v.d, "วันที่นัด"), status: v.st, new_date: need(v.nd, "วันใหม่"), ref: v.ref.trim(), note: v.note.trim(), ...who() }); if (r.error) throw r.error; });
  }
  function fProc(c) {
    const nx = Math.max(0, c.steps.findIndex(s => !s));
    form(`<h3>บันทึกขั้นจัดซื้อ / ต่อสัญญา</h3><p class="sub">${esc(c.scope)} · ผู้รับเหมาเดิม ${esc(c.vendor || "-")} · สิ้นสุด ${th(c.end_date)}</p><div class="fg"><label>ขั้นตอน<select name="step">${STEPS.map((s, i) => `<option${i === nx ? " selected" : ""}>${s}</option>`).join("")}</select></label>${dIn("วันที่", "d", TODAY)}
      ${inp("เลขที่เอกสาร", "doc")}${inp("ราคา (บาท)", "price", "", 'inputmode="decimal"')}${inp("ผู้ขาย / ผู้เสนอราคา", "seller", "", "w")}${inp("หมายเหตุ", "note", "", "w")}</div><p class="meta">ใบเสนอราคา 3 เจ้า ให้บันทึกทีละเจ้า เมื่อบันทึกขั้น PO แล้ว ระบบจะหยุดเตือนต่อสัญญาของรายการนี้ จากนั้นให้แก้วันเริ่มและวันสิ้นสุดสัญญาเป็นรอบใหม่</p>`, "บันทึก", async v => {
      const r = await sb.from("ma_proc").insert({ hospital_id: c.hospital_id, contract_id: c.id, step: v.step, step_date: must(v.d, "วันที่"), doc_no: v.doc.trim(), seller: v.seller.trim(), price: num(v.price), note: v.note.trim(), ...who() }); if (r.error) throw r.error; });
  }
  function fContract(c) {
    const isNew = !c.id;
    form(`<h3>${isNew ? "เพิ่มสัญญา MA" : "แก้ไขสัญญา MA"}</h3><p class="sub">${esc(hName(c.hospital_id))}</p><div class="fg"><label>กลุ่มงาน<select name="grp">${GROUPS.map(g => `<option${(c.grp || "")[0] === g[0] ? " selected" : ""}>${g}</option>`).join("")}</select></label>${inp("รายการในกลุ่ม", "item", c.grp_item, 'list="itemL"')}<datalist id="itemL">${[...new Set(BYLAW.concat(contracts.map(x => x.grp_item)))].filter(Boolean).map(x => `<option value="${esc(x)}">`).join("")}</datalist>
      ${inp("ระบบ", "sys", c.sys)}${inp("จำนวนเครื่อง", "qty", c.qty ?? "", 'inputmode="numeric"')}${inp("ขอบเขตสัญญา / กลุ่มเครื่องจักร", "scope", c.scope, "w required")}${inp("ผู้รับเหมา (Vendor)", "vendor", c.vendor)}${inp("เลขที่สัญญา / PO", "no", c.contract_no)}
      ${dIn("วันเริ่มสัญญา", "s", c.start_date)}${dIn("วันสิ้นสุดสัญญา", "e", c.end_date)}${inp("รอบเข้า PM (M, 2M, Q, 4M, S, Y)", "fq", c.pm_cycle)}${inp("มูลค่าสัญญา (บาท/ปี)", "val", c.value_year ?? "", 'inputmode="decimal"')}${inp("ผู้ติดต่อ / โทร", "con", c.contact)}${inp("อีเมลผู้รับเหมา", "em", c.vendor_email)}
      ${inp("หมายเหตุ", "note", c.note, "w")}<label>สถานะ<select name="can"><option value="">ใช้งาน</option><option value="1"${c.cancelled ? " selected" : ""}>ยกเลิกสัญญา</option></select></label></div>`, "บันทึก", async v => {
      const s = need(v.s, "วันเริ่มสัญญา"), e = need(v.e, "วันสิ้นสุดสัญญา"); if (s && e && e < s) throw new Error("วันสิ้นสุดสัญญาต้องไม่ก่อนวันเริ่มสัญญา");
      const row = { hospital_id: c.hospital_id, grp: v.grp, grp_item: v.item.trim(), sys: v.sys.trim(), scope: v.scope.trim(), qty: num(v.qty), vendor: v.vendor.trim(), contract_no: v.no.trim(), start_date: s, end_date: e, pm_cycle: v.fq.trim().toUpperCase(), value_year: num(v.val), contact: v.con.trim(), vendor_email: v.em.trim(), note: v.note.trim(), cancelled: !!v.can };
      const r = isNew ? await sb.from("ma_contracts").insert(row) : await sb.from("ma_contracts").update(row).eq("id", c.id); if (r.error) throw r.error; });
  }
  $("#rAdd").onclick = () => fContract({ hospital_id: sel() || me.hospital_id, grp: GROUPS[1], grp_item: "", sys: "", scope: "", vendor: "", contract_no: "", pm_cycle: "", contact: "", vendor_email: "", note: "" });

  // ---------- renewals ----------
  const renewRows = () => list().filter(c => c.renew).sort((a, b) => (a.daysLeft ?? -99999) - (b.daysLeft ?? -99999));
  function drawRenew() {
    const l = renewRows(), multi = !sel() && hospitals.length > 1, c0 = f => l.filter(f).length;
    kpis("#nK", [["ต้องต่อสัญญาทั้งหมด", n(l.length)], ["หมดแล้ว ยังไม่ออก PO", n(c0(c => c.siteExpired || c.daysLeft < 0)), "#b3261e"], ["เหลือ ≤30 วัน", n(c0(c => c.daysLeft != null && c.daysLeft >= 0 && c.daysLeft <= 30)), "#a86400"], ["เหลือ 31-60 วัน", n(c0(c => c.daysLeft > 30 && c.daysLeft <= 60))], ["เหลือ 61-90 วัน", n(c0(c => c.daysLeft > 60))], ["ยังไม่มีวันสิ้นสุด", n(list().filter(c => c.status === "ยังไม่มีวันที่").length)]]);
    $("#nT").innerHTML = `<tr>${multi ? "<th>โรง</th>" : ""}<th>ระบบ / ขอบเขตสัญญา</th><th>ผู้รับเหมา</th><th>วันสิ้นสุด</th><th class="r">เหลือ</th><th>ขั้นที่ควรทำ</th><th>ความคืบหน้า</th></tr>` +
      (l.map(c => `<tr class="click" data-id="${c.id}">${multi ? `<td><b>${esc(hCode(c.hospital_id))}</b></td>` : ""}<td>${esc(c.sys)}<div><b>${esc(c.scope)}</b></div></td><td>${esc(c.vendor || "-")}</td><td>${c.end_date ? th(c.end_date) : "ไซต์แจ้งว่าหมดแล้ว"}</td><td class="r"><span class="st ${c.siteExpired || c.daysLeft < 0 ? "exp" : c.daysLeft <= 30 ? "od" : "soon"}">${c.daysLeft == null ? "หมดแล้ว" : leftTxt(c)}</span></td><td>${esc(c.stage)}</td><td>${stepsHtml(c)}</td></tr>`).join("") || none(7, "ไม่มีสัญญาที่ต้องต่อในขณะนี้"));
    $("#nT").querySelectorAll("tr.click").forEach(r => r.onclick = () => detail(r.dataset.id));
  }
  $("#nX").onclick = () => { const l = renewRows(); Office.table(`ต่อสัญญา_MA_${fileTag()}`, ["รหัสโรง", "โรงพยาบาล", "ระบบ", "ขอบเขตสัญญา", "ผู้รับเหมา", "วันสิ้นสุด (พ.ศ.)", "เหลือ (วัน)", "ขั้นที่ควรทำ", ...STEPS],
    l.map(c => [hCode(c.hospital_id), hName(c.hospital_id), c.sys, c.scope, c.vendor, c.end_date ? th(c.end_date) : "", c.daysLeft ?? "", c.stage, ...c.steps.map(s => s ? th(s.step_date) : "")]), { title: "สัญญา MA ที่ต้องดำเนินการต่อสัญญา", org: scopeName(), period: "ข้อมูล ณ " + th(TODAY),
      findings: [`ต้องต่อสัญญา ${n(l.length)} สัญญา หมดแล้วยังไม่ออก PO ${n(l.filter(c => c.siteExpired || c.daysLeft < 0).length)} สัญญา`], notes: ["ลำดับงาน: ออก PR เมื่อเหลือ 90 วัน ขอใบเสนอราคา 3 เจ้าเมื่อเหลือ 60 วัน สรุปเลือกผู้รับเหมาและออก PO เมื่อเหลือ 30 วัน"] }); };

  // ---------- contractor PM visits ----------
  function drawVisit() {
    const l = list(), multi = !sel() && hospitals.length > 1, od = l.filter(c => c.overdue), up = l.filter(c => c.upcoming), k = count(l), hc = c => multi ? `<td><b>${esc(hCode(c.hospital_id))}</b></td>` : "", hh = multi ? "<th>โรง</th>" : "";
    const recent = l.flatMap(c => c.visits.map(v => [c, v])).sort((a, b) => a[1].visit_date < b[1].visit_date ? 1 : -1).slice(0, 50);
    const due = l.filter(c => c.status !== "ยกเลิก" && c.status !== "หมดอายุแล้ว" && cycleDays(c.pm_cycle)).length, inM = l.filter(c => c.visits.some(v => v.visit_date.slice(0, 7) === TODAY.slice(0, 7))).length;
    kpis("#vK", [["เข้า PM เดือนนี้ (ครั้ง)", n(k.vis), "#0a7a35"], ["สัญญาที่เข้าแล้วเดือนนี้ / ที่มีรอบ PM", `${n(inM)} / ${n(due)}`], ["ขาดรอบ PM", n(od.length), od.length ? "#a86400" : ""], ["นัด 14 วัน ยังไม่ยืนยัน", n(up.length), up.length ? "#a86400" : ""]]);
    $("#vO").innerHTML = `<tr>${hh}<th>ผู้รับเหมา</th><th>งาน</th><th>รอบ</th><th>เข้าครั้งล่าสุด</th><th class="r">ผ่านมา</th></tr>` + (od.map(c => `<tr class="click" data-id="${c.id}">${hc(c)}<td>${esc(c.vendor || "-")}</td><td><b>${esc(c.scope)}</b></td><td>${esc(c.pm_cycle)}</td><td><span class="st od">${c.lastVisit ? th(c.lastVisit) : "ยังไม่มีบันทึก"}</span></td><td class="r">${c.lastVisit ? n(diff(TODAY, c.lastVisit)) + " วัน" : "-"}</td></tr>`).join("") || none(6, "ไม่มีผู้รับเหมาที่ขาดรอบ (ตรวจได้เฉพาะสัญญาที่มีวันสิ้นสุดและรอบ PM)"));
    $("#vU").innerHTML = `<tr>${hh}<th>ผู้รับเหมา</th><th>งาน</th><th>กำหนด</th><th>สถานะการยืนยัน</th></tr>` + (up.map(c => `<tr class="click" data-id="${c.id}">${hc(c)}<td>${esc(c.vendor || "-")}</td><td><b>${esc(c.scope)}</b></td><td>${th(c.upcoming.date)}</td><td><span class="st ${c.upcoming.status === "ยังไม่บันทึกนัด" ? "od" : "soon"}">${esc(c.upcoming.status)}</span></td></tr>`).join("") || none(5, "ไม่มีนัดที่รอการยืนยันใน 14 วันข้างหน้า"));
    $("#vL").innerHTML = `<tr>${hh}<th>วันที่</th><th>ผู้รับเหมา</th><th>งาน</th><th>ผล</th><th class="r">เครื่องที่ทำ</th><th>ปัญหาที่พบ</th><th>ผู้บันทึก</th></tr>` + (recent.map(([c, v]) => `<tr class="click" data-id="${c.id}">${hc(c)}<td>${th(v.visit_date)}</td><td>${esc(c.vendor || "-")}</td><td><b>${esc(c.scope)}</b>${v.detail ? `<div class="meta">${esc(v.detail)}</div>` : ""}</td><td>${esc(v.result || "-")}</td><td class="r">${v.machines ?? "-"}</td><td>${esc(v.problem || "-")}</td><td>${esc(v.created_by_name)}</td></tr>`).join("") || none(8, "ยังไม่มีบันทึกการเข้า PM เปิดสัญญาในแท็บ ทะเบียนสัญญา แล้วกด บันทึกการเข้า PM"));
    document.querySelectorAll("#tab-visit tr.click").forEach(r => r.onclick = () => detail(r.dataset.id));
  }
  $("#vX").onclick = () => { const l = list(), rows = l.flatMap(c => c.visits.map(v => [hCode(c.hospital_id), th(v.visit_date), c.vendor, c.sys, c.scope, v.detail, v.result, v.on_time, v.machines ?? "", v.tech, v.tech_n ?? "", v.problem, v.need_quote ? "ต้องเสนอราคา" : "", v.supervisor, v.created_by_name])), k = count(l);
    Office.table(`การเข้าPM_MA_${fileTag()}`, ["รหัสโรง", "วันที่เข้า PM (พ.ศ.)", "ผู้รับเหมา", "ระบบ", "ขอบเขตสัญญา", "รายละเอียดงาน", "ผลการตรวจ", "ตรงตามนัด", "จำนวนเครื่องที่ทำ PM", "ช่างผู้รับเหมา", "จำนวนช่าง", "ปัญหาที่พบ", "ต้องเสนอราคาซ่อม", "วิศวกรผู้ควบคุม", "ผู้บันทึก"], rows, { title: "บันทึกการเข้า PM ของผู้รับเหมา (MA)", org: scopeName(), period: "ข้อมูล ณ " + th(TODAY),
      findings: [`บันทึกการเข้า PM ทั้งหมด ${n(rows.length)} ครั้ง เดือนนี้ ${n(k.vis)} ครั้ง`, `ผู้รับเหมาขาดรอบ ${n(k.od)} สัญญา`] }); };

  // ---------- by-law ----------
  const bylawData = () => shown().map(h => { const l = contracts.filter(c => c.hospital_id === h.id && c.status !== "ยกเลิก" && (c.grp || "")[0] === "1"); return [h.code, h.name, ...BYLAW.map(b => l.filter(c => c.grp_item === b).length)]; });
  function drawBylaw() { const d = bylawData();
    $("#bT").innerHTML = `<tr><th>รหัส</th><th>โรงพยาบาล</th>${BYLAW.map(b => `<th class="c">${esc(b)}</th>`).join("")}</tr>` + d.map(r => `<tr><td><b>${esc(r[0])}</b></td><td>${esc(r[1])}</td>${r.slice(2).map(v => `<td class="c ${v ? "has" : "zero"}">${v}</td>`).join("")}</tr>`).join(""); }
  $("#bX").onclick = () => { const d = bylawData(), zero = d.reduce((s, r) => s + r.slice(2).filter(v => !v).length, 0);
    Office.table(`By-law_MA_${fileTag()}`, ["รหัสโรง", "โรงพยาบาล", ...BYLAW], d, { title: "กลุ่ม 1 By-law ตามกฎหมาย: จำนวนสัญญาต่อรายการ", org: scopeName(), period: "ข้อมูล ณ " + th(TODAY), findings: [`มี ${n(zero)} ช่อง (โรง × รายการ) ที่ยังไม่พบสัญญาในทะเบียน จากทั้งหมด ${n(d.length * BYLAW.length)} ช่อง`], notes: ["ช่องที่เป็น 0 อาจหมายถึงยังไม่ได้กรอกทะเบียน หรือยังไม่มีสัญญาจริง ควรตรวจกับแต่ละโรง"] }); };

  // ---------- e-mail recipients (Monday renewal alert, Friday weekly report, monthly report on the 23rd) ----------
  const KINDS = [["renew", "ต่อสัญญา"], ["weekly", "รายสัปดาห์"], ["monthly", "รายเดือน"]];
  const canMail = hid => hid ? canEdit(hid) : exec;
  const rName = hid => hid ? `${hCode(hid)} · ${hName(hid)}` : "ภาพรวม 12 โรง (ผู้บริหาร)";
  const mailRows = () => recips.filter(r => !sel() || r.hospital_id === sel() || (!r.hospital_id && exec))
    .sort((a, b) => (a.hospital_id ? hCode(a.hospital_id) : "") .localeCompare(b.hospital_id ? hCode(b.hospital_id) : "") || a.email.localeCompare(b.email));
  function drawMail() {
    $("#mMsg").innerHTML = recipErr ? `<div class="note bad">ยังเปิดรายชื่อผู้รับอีเมลไม่ได้: ${esc(recipErr)}</div>` : "";
    const l = mailRows(), yes = v => v ? `<span class="st ok">รับ</span>` : `<span class="st nod">ไม่รับ</span>`;
    $("#mT").innerHTML = `<tr><th>ส่งของ</th><th>ชื่อ</th><th>ตำแหน่ง</th><th>อีเมล</th>${KINDS.map(k => `<th class="c">${k[1]}</th>`).join("")}<th class="c">สถานะ</th><th>หมายเหตุ</th></tr>` +
      (l.length ? l.map(r => `<tr class="click" data-id="${r.id}"><td>${esc(rName(r.hospital_id))}</td><td>${esc(r.name)}</td><td>${esc(r.position)}</td><td>${esc(r.email)}</td>${KINDS.map(k => `<td class="c">${yes(r[k[0]])}</td>`).join("")}<td class="c">${r.active ? '<span class="st ok">ใช้งาน</span>' : '<span class="st can">หยุดส่ง</span>'}</td><td>${esc(r.note)}</td></tr>`).join("")
        : none(9, "ยังไม่มีผู้รับอีเมล กด + เพิ่มผู้รับอีเมล"));
    document.querySelectorAll("#mT tr.click").forEach(tr => tr.onclick = () => fRecip(recips.find(x => x.id === tr.dataset.id)));
  }
  function fRecip(r) {
    const isNew = !r.id, opts = (exec ? [null] : []).concat(hospitals.filter(h => canEdit(h.id)).map(h => h.id));
    const ok = canMail(r.hospital_id);
    form(`<h3>${isNew ? "เพิ่มผู้รับอีเมล" : "ผู้รับอีเมล"}</h3><div class="fg">
      <label class="w">ส่งรายงานของ<select name="h"${isNew ? "" : " disabled"}>${opts.map(id => `<option value="${id || ""}"${(id || "") === (r.hospital_id || "") ? " selected" : ""}>${esc(rName(id))}</option>`).join("")}</select></label>
      ${inp("ชื่อ", "name", r.name)}${inp("ตำแหน่ง", "pos", r.position)}${inp("อีเมล", "em", r.email, 'w type="email" required')}
      ${KINDS.map(k => `<label style="flex-direction:row;align-items:center;gap:8px"><input type="checkbox" name="${k[0]}" value="1"${r[k[0]] !== false ? " checked" : ""}> รับอีเมล${k[1]}</label>`).join("")}
      <label>สถานะ<select name="act"><option value="1">ใช้งาน</option><option value=""${r.active === false ? " selected" : ""}>หยุดส่ง</option></select></label>
      ${inp("หมายเหตุ", "note", r.note, "w")}</div>
      ${!isNew && ok ? `<p><button class="btn" type="button" id="mDel" style="color:#a11">ลบผู้รับรายนี้</button></p>` : ""}`, ok ? "บันทึก" : "", async v => {
      const em = (v.em || "").trim().toLowerCase(); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) throw new Error("รูปแบบอีเมลไม่ถูกต้อง");
      const hid = isNew ? (v.h || null) : r.hospital_id;
      if (recips.some(x => x.id !== r.id && (x.hospital_id || "") === (hid || "") && x.email.toLowerCase() === em)) throw new Error("อีเมลนี้มีอยู่แล้วในรายชื่อของ " + rName(hid));
      const row = { hospital_id: hid, name: v.name.trim(), position: v.pos.trim(), email: em, renew: !!v.renew, weekly: !!v.weekly, monthly: !!v.monthly, active: !!v.act, note: v.note.trim() };
      const q = isNew ? await sb.from("ma_recipients").insert(row) : await sb.from("ma_recipients").update(row).eq("id", r.id); if (q.error) throw q.error; });
    const d = $("#mDel"); if (d) d.onclick = async () => { if (!d.dataset.sure) { d.dataset.sure = 1; d.textContent = "กดอีกครั้งเพื่อยืนยันการลบ"; return; }
      const q = await sb.from("ma_recipients").delete().eq("id", r.id); if (q.error) { $("#dlgE").innerHTML = `<div class="note bad">${esc(errText(q.error))}</div>`; return; }
      $("#dlg").close(); await load(); show(cur); toast("ลบแล้ว"); };
  }
  $("#mAdd").onclick = () => fRecip({ hospital_id: sel() || (exec ? null : me.hospital_id), name: "", position: "", email: "", note: "" });
  $("#mTest").onclick = () => { const hid = sel() || (exec ? null : me.hospital_id);
    form(`<h3>ส่งอีเมลทดสอบถึงตัวเอง</h3><p class="sub">ระบบจะส่งอีเมลตัวอย่างของ ${esc(rName(hid))} ไปที่อีเมลของบัญชีที่เข้าสู่ระบบอยู่เท่านั้น ไม่ส่งถึงผู้รับในรายชื่อ</p>
      <div class="fg"><label class="w">แบบอีเมล<select name="k">${KINDS.map(k => `<option value="${k[0]}">${k[0] === "renew" ? "แจ้งเตือนต่อสัญญา" : "รายงาน" + (k[0] === "weekly" ? "ประจำสัปดาห์" : "ประจำเดือน")}</option>`).join("")}</select></label></div>`, "ส่งทดสอบ", async v => {
      const q = await sb.rpc("ma_mail_test", { p_kind: v.k, p_hospital: hid }); if (q.error) throw q.error;
      if (!q.data) throw new Error("ไม่มีรายการที่ต้องแจ้งในอีเมลแบบนี้ตอนนี้ ระบบจึงไม่ได้ส่ง"); }); };
  $("#mX").onclick = () => { const l = mailRows();
    Office.table(`ผู้รับอีเมล_MA_${fileTag()}`, ["ส่งของ", "ชื่อ", "ตำแหน่ง", "อีเมล", ...KINDS.map(k => "รับ" + k[1]), "สถานะ", "หมายเหตุ"],
      l.map(r => [rName(r.hospital_id), r.name, r.position, r.email, ...KINDS.map(k => r[k[0]] ? "รับ" : "ไม่รับ"), r.active ? "ใช้งาน" : "หยุดส่ง", r.note]),
      { title: "รายชื่อผู้รับอีเมลอัตโนมัติ PM MA", org: scopeName(), period: "ข้อมูล ณ " + th(TODAY),
        findings: [`ผู้รับอีเมลทั้งหมด ${n(l.length)} รายชื่อ ใช้งานอยู่ ${n(l.filter(r => r.active).length)} รายชื่อ`, ...KINDS.map(k => `รับอีเมล${k[1]} ${n(l.filter(r => r.active && r[k[0]]).length)} รายชื่อ`)],
        notes: ["แจ้งเตือนต่อสัญญาส่งทุกวันจันทร์ 08:00 รายงานประจำสัปดาห์ส่งทุกวันศุกร์ 16:00 รายงานประจำเดือนส่งทุกวันที่ 23 เวลา 08:00"] }); };
})();
