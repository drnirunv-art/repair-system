// Monthly Report "tree": roots R1–R10 collected all month, red cards after the deadline (day 2 of next month),
// month-close steps (closed → KPI → book → approved → presented) and KPIs computed from the system's own data.
(() => {
  const { sb, $, esc, fmt, errText, OPEN, workMins } = RS;
  const STEPPERS = ["owner", "admin", "chief_engineer", "supervisor", "senior_technician", "safety_officer"];
  const CHIEF = ["owner", "admin", "chief_engineer"];
  const TH_M = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
  const SYSTEMS = ["ระบบไฟฟ้า", "ระบบไฟฟ้าสำรอง (Generator / UPS)", "ระบบปรับอากาศ", "ระบบน้ำประปา", "ระบบบำบัดน้ำเสีย", "ระบบลิฟต์ / บันไดเลื่อน",
    "ระบบแก๊สทางการแพทย์", "ระบบดับเพลิง / แจ้งเหตุเพลิงไหม้", "ระบบสุขาภิบาล / ระบายน้ำ", "ระบบไอน้ำ / หม้อไอน้ำ", "ระบบสื่อสาร / โทรศัพท์ / เรียกพยาบาล",
    "ระบบ BAS / ควบคุมอาคาร", "ระบบอื่น ๆ"];
  // f: [key, label, type, options]  types: sel, text, num, date, dt, area
  const ROOTS = [
    { k: "R1", t: "งานซ่อม (CM)", auto: true, d: "นับจากใบแจ้งซ่อมของเดือนนี้" },
    { k: "R2", t: "PM ตามแผน", auto: true, d: "นับจากใบงาน PM2 ของเดือนนี้" },
    { k: "R3", t: "รูปถ่ายงาน PM", auto: true, d: "รูปที่แนบในใบงาน PM2" },
    { k: "R4", t: "บันทึก OP / มิเตอร์", auto: true, d: "บันทึกประจำวันจากหน้า OP" },
    { k: "R5", t: "บิลค่าไฟ ค่าน้ำ", d: "ลงตัวเลขจากบิลและแนบไฟล์บิล", file: true,
      f: [["kind", "ประเภทบิล", "sel", ["ค่าไฟฟ้า", "ค่าน้ำประปา", "อื่น ๆ"]], ["period", "รอบบิล", "text"], ["kwh_on", "kWh On Peak", "num"], ["kwh_off", "kWh Off Peak", "num"],
        ["kw_max", "Max Demand (kW)", "num"], ["m3", "น้ำ (ลบ.ม.)", "num"], ["baht", "ยอดเงิน (บาท)", "num"]] },
    { k: "R6", t: "ผลแล็บน้ำ", d: "น้ำเสียรายเดือน · น้ำใช้ 4 ครั้ง/ปี · Legionella 2 ครั้ง/ปี แนบ PDF ผลแล็บ", file: true,
      f: [["type", "ชนิดการตรวจ", "sel", ["น้ำเสีย (รายเดือน)", "น้ำใช้ (4 ครั้ง/ปี)", "Legionella (2 ครั้ง/ปี)", "อื่น ๆ"]], ["date", "วันที่เก็บตัวอย่าง", "date"],
        ["result", "ผล", "sel", ["ผ่านเกณฑ์", "ไม่ผ่านเกณฑ์", "รอผล"]], ["detail", "รายละเอียด / ค่าที่เกิน", "area"]] },
    { k: "R7", t: "ระบบหยุดทำงาน (Downtime)", d: "ทุกครั้งที่ระบบหลักหยุด ระบบคิดชั่วโมงให้",
      f: [["system", "ระบบ", "sel", SYSTEMS], ["start", "เริ่มหยุด", "dt"], ["back", "กลับมาใช้ได้", "dt"], ["cause", "สาเหตุ", "area"], ["fix", "การแก้ไข", "area"]] },
    { k: "R8", t: "อุบัติการณ์ (Occurrence)", d: "ระดับความรุนแรง 0–5",
      f: [["date", "วันที่เกิด", "date"], ["level", "ระดับ", "sel", ["0", "1", "2", "3", "4", "5"]], ["detail", "เหตุการณ์", "area"], ["fix", "การแก้ไข / ป้องกัน", "area"]] },
    { k: "R9", t: "บุคลากร (HR)", d: "ขาด ลา สาย ค่าปรับ CN และอัตรากำลังจริง ระบบนับการมาสายจากตารางกะให้ด้วย",
      f: [["kind", "เรื่อง", "sel", ["ขาดงาน", "ลา", "มาสาย", "ค่าปรับ CN", "อัตรากำลังจริง"]], ["person", "ชื่อพนักงาน", "text"], ["date", "วันที่", "date"], ["qty", "จำนวน (วัน / ครั้ง / คน / บาท)", "num"], ["note", "หมายเหตุ", "area"]] },
    { k: "R10", t: "ซ้อมแผน อบรม ESG", d: "แนบใบลงชื่อ รูปภาพ", file: true,
      f: [["kind", "ประเภท", "sel", ["ซ้อมแผน (Drill)", "อบรม (Training)", "ESG / ประหยัดพลังงาน"]], ["date", "วันที่", "date"], ["topic", "หัวข้อ", "text"], ["people", "ผู้เข้าร่วม (คน)", "num"]] },
  ];
  const STEPS = [["closed", "ปิดรอบข้อมูล", "วันที่ 1–2"], ["kpi", "คิดคะแนน KPI", "วันที่ 3"], ["book", "ทำเล่มเสร็จ", "วันที่ 4"],
    ["approved", "Chief Engineer อนุมัติ", "ก่อนนำเสนอ"], ["presented", "นำเสนอผู้บริหาร", "วันที่ 10"]];
  let me = null, H = null, staff = [], prios = [], S = { late_grace_min: 15 }, M = "", book = null, entries = [], auto = {}, sel = null, kpi = null;
  const store = { get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
  const role = () => (me && me.role) || "";
  const canAdd = () => me && role() !== "observer";
  const isMgr = () => ["owner", "admin", "chief_engineer", "supervisor"].includes(role());
  const day = d => new Date(d).toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
  const nameOf = id => (staff.find(s => s.id === id) || {}).full_name || "";
  const rootOf = k => ROOTS.find(r => r.k === k);
  const thMonth = m => { const [y, mm] = m.split("-"); return `${TH_M[+mm - 1]} ${+y + 543}`; };
  const nextMonth = m => { const [y, mm] = m.split("-").map(Number); return mm === 12 ? `${y + 1}-01` : `${y}-${String(mm + 1).padStart(2, "0")}`; };
  const startOf = m => new Date(m + "-01T00:00:00+07:00").toISOString();
  const endOf = m => startOf(nextMonth(m));
  const deadline = m => new Date(nextMonth(m) + "-03T00:00:00+07:00"); // end of day 2 of next month
  const pct = (a, b) => b ? Math.round(a / b * 1000) / 10 : null;
  const n2 = v => v == null ? "–" : (+v).toLocaleString("th-TH", { maximumFractionDigits: 2 });
  const hoursOf = d => d && d.start && d.back ? Math.max(0, (new Date(d.back) - new Date(d.start)) / 36e5) : 0;
  function toast(m) { $("#toast").textContent = m; $("#toast").hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => $("#toast").hidden = true, 6000); }

  /* ---------- boot ---------- */
  const q0 = new URLSearchParams(location.search);
  sb.auth.onAuthStateChange((_e, session) => setTimeout(() => boot(session), 0));
  async function boot(session) {
    if (!session) { $("#gate").hidden = false; return; }
    const { data } = await sb.from("profiles").select("id,full_name,role,hospital_id,hospitals(id,code,name)").eq("id", session.user.id).maybeSingle();
    me = data;
    if (!me || !me.hospital_id) { $("#gate").hidden = false; return; }
    H = me.hospitals; $("#gate").hidden = true; $("#main").hidden = false;
    $("#title").textContent = "Monthly Report · " + H.name; $("#who").textContent = me.full_name || session.user.email;
    const [s, p, hs] = await Promise.all([sb.from("profiles").select("id,full_name").eq("hospital_id", H.id),
      sb.from("priorities").select("*"), sb.from("hospital_settings").select("*").eq("hospital_id", H.id).maybeSingle()]);
    staff = s.data || []; prios = p.data || []; if (hs.data) S = hs.data;
    // default: last month while still inside the close window (day 1–4), otherwise this month
    const now = day(Date.now()), prev = (() => { const [y, mm] = now.slice(0, 7).split("-").map(Number); return mm === 1 ? `${y - 1}-12` : `${y}-${String(mm - 1).padStart(2, "0")}`; })();
    $("#bMonth").value = q0.get("m") || (+now.slice(8) <= 4 ? prev : now.slice(0, 7));
    sel = q0.get("root") || store.get("rs-book-root", null);
    load();
  }
  $("#bMonth").onchange = () => load();
  $("#bPrint").onclick = () => { renderAll(); setTimeout(() => window.print(), 50); };

  async function load() {
    M = $("#bMonth").value; if (!M) return;
    const a = startOf(M), b = endOf(M);
    const [bk, en, jb, op, pm, ro, pts] = await Promise.all([
      sb.from("monthly_books").select("*").eq("hospital_id", H.id).eq("month", M).maybeSingle(),
      sb.from("monthly_entries").select("*").eq("hospital_id", H.id).eq("month", M).eq("active", true).order("created_at"),
      sb.from("jobs").select("id,job_no,status,created_at,cleared_at,closed_at,hold_minutes,hold_started_at,priority_id,equipment_id,location_id,detail").eq("hospital_id", H.id).gte("created_at", new Date(new Date(a) - 7 * 864e5).toISOString()).lt("created_at", b).range(0, 9999),
      sb.from("op_logs").select("id,abnormal,log_date").eq("hospital_id", H.id).gte("log_date", M + "-01").lt("log_date", nextMonth(M) + "-01").range(0, 49999),
      sb.from("pm_tasks").select("id,status,score,abnormal,answers").eq("hospital_id", H.id).eq("year", +M.slice(0, 4)).eq("month", +M.slice(5)).range(0, 9999),
      sb.from("shift_roster").select("work_date,check_in_at,profile_id,shifts(start_time)").eq("hospital_id", H.id).gte("work_date", M + "-01").lt("work_date", nextMonth(M) + "-01").range(0, 9999),
      sb.from("op_points").select("id").eq("hospital_id", H.id).eq("active", true),
    ]);
    const aging = await sb.from("jobs").select("id,created_at,status").eq("hospital_id", H.id).in("status", OPEN).lt("created_at", new Date(new Date(b) - 60 * 864e5).toISOString()).range(0, 9999);
    book = bk.data; entries = en.data || [];
    const allJobs = jb.data || [], jobs = allJobs.filter(j => j.created_at >= a);
    const tasks = pm.data || [], done = tasks.filter(t => ["submitted", "head_signed", "approved"].includes(t.status));
    const photos = done.reduce((s, t) => s + (t.answers || []).reduce((x, an) => x + ((an && an.ph) ? (Array.isArray(an.ph) ? an.ph.length : 1) : 0), 0), 0);
    const today = day(Date.now()), grace = S.late_grace_min ?? 15;
    const roster = (ro.data || []).filter(r => r.work_date <= today);
    const late = roster.filter(r => r.check_in_at && r.shifts && (new Date(r.check_in_at) - new Date(`${r.work_date}T${String(r.shifts.start_time).slice(0, 5)}:00+07:00`)) / 6e4 > grace).length;
    const noIn = roster.filter(r => !r.check_in_at && r.work_date < today).length;
    const slaOf = j => (prios.find(p => p.id === j.priority_id) || {}).sla_minutes || 1440;
    const finished = jobs.filter(j => j.cleared_at || j.closed_at), inSla = finished.filter(j => workMins(j) <= slaOf(j));
    const repeat = jobs.filter(j => j.equipment_id && allJobs.some(o => o.id !== j.id && o.equipment_id === j.equipment_id && o.created_at < j.created_at && new Date(j.created_at) - new Date(o.created_at) <= 7 * 864e5));
    const opLogs = op.data || [];
    auto = {
      R1: { n: jobs.length, line: `ใบงาน ${jobs.length} · ซ่อมเสร็จ ${finished.length} · ยังเปิด ${jobs.filter(j => OPEN.includes(j.status) && j.status !== "clear").length}` },
      R2: { n: tasks.length, line: `ทำแล้ว ${done.length}/${tasks.length} ใบ${tasks.length ? ` (${pct(done.length, tasks.length)}%)` : ""} · ผิดปกติ ${tasks.filter(t => t.abnormal > 0).length}` },
      R3: { n: photos, line: `รูปในใบ PM ${photos} รูป` },
      R4: { n: opLogs.length, line: `บันทึก ${opLogs.length} ครั้ง จาก ${(pts.data || []).length} จุด · ผิดปกติ ${opLogs.filter(l => l.abnormal).length}` },
      hr: { late, noIn },
    };
    const ent = k => entries.filter(e => e.root === k && !(e.data || {}).none);
    const occ = [0, 1, 2, 3, 4, 5].map(l => ent("R8").filter(e => String(e.data.level) === String(l)).length);
    const dHours = ent("R7").reduce((s, e) => s + hoursOf(e.data), 0);
    const pmPct = pct(done.length, tasks.length), slaPct = pct(inSla.length, finished.length);
    const bookBy5 = book && book.book_at ? book.book_at < new Date(nextMonth(M) + "-05T00:00:00+07:00").toISOString() : null;
    kpi = {
      month: M, pm_pct: pmPct, pm_done: done.length, pm_plan: tasks.length, cm_jobs: jobs.length, cm_finished: finished.length, cm_sla_pct: slaPct,
      repeat_7d: repeat.length, aging_60d: (aging.data || []).length, occurrence: occ, downtime_h: Math.round(dHours * 10) / 10,
      drills: ent("R10").filter(e => /Drill/.test(e.data.kind)).length, trainings: ent("R10").filter(e => /Training/.test(e.data.kind)).length,
      op_logs: opLogs.length, op_abnormal: opLogs.filter(l => l.abnormal).length, late: late, no_checkin: noIn, book_by_day5: bookBy5,
    };
    renderSteps(); renderRoots(); renderRoot(); renderKpi();
  }

  /* ---------- status of each root ---------- */
  function status(r) {
    const has = r.auto ? (auto[r.k] || {}).n > 0 : entries.some(e => e.root === r.k);
    if (has) return "ok";
    return new Date() >= deadline(M) ? "red" : "wait";
  }
  const stLabel = { ok: "✓ ครบ", red: "ใบแดง: ยังไม่ลงข้อมูล", wait: "รอลงข้อมูล" };

  function renderSteps() {
    const b = book || {}, idx = STEPS.findIndex(([k]) => !b[k + "_at"]);
    const canStep = STEPPERS.includes(role()), chief = CHIEF.includes(role());
    $("#bSteps").innerHTML = STEPS.map(([k, t, when], i) => {
      const at = b[k + "_at"], by = b[k + "_by"];
      const mine = i === idx && (["approved", "presented"].includes(k) ? chief : canStep);
      return `<div class="step${at ? " done" : ""}"><b>${i + 1}. ${t}</b><span class="sub">${when}</span>
        ${at ? `<div class="meta">✓ ${fmt(at)}${nameOf(by) ? " · " + esc(nameOf(by)) : ""}</div>` : mine ? `<button class="btn small primary noprint" data-step="${k}" style="margin-top:6px">ยืนยันขั้นนี้</button>` : `<div class="meta">ยังไม่ถึง</div>`}</div>`;
    }).join("") + (chief && (b.approved_at || b.presented_at) ? `<div class="noprint" style="grid-column:1/-1"><button class="btn small" data-step="undo">ยกเลิกการอนุมัติ / นำเสนอ (แก้เล่ม)</button></div>` : "")
      + `<div id="bStepMsg" style="grid-column:1/-1"></div>`;
    document.querySelectorAll("[data-step]").forEach(btn => btn.onclick = () => step(btn.dataset.step, btn));
  }
  async function step(k, btn) {
    if (k === "closed") {
      const miss = ROOTS.filter(r => status(r) !== "ok");
      if (miss.length) { $("#bStepMsg").innerHTML = `<div class="note bad">ยังปิดรอบไม่ได้ รากที่ยังไม่มีข้อมูล: ${miss.map(r => r.k + " " + esc(r.t)).join(", ")} · ถ้าเดือนนี้ไม่มีเหตุการณ์ ให้เปิดรากนั้นแล้วกด "ไม่มีเหตุการณ์เดือนนี้"</div>`; return; }
    }
    btn.disabled = true;
    const { error } = await sb.rpc("book_step", { p_month: M, p_step: k, p_kpi: k === "kpi" ? kpi : null });
    btn.disabled = false;
    if (error) { $("#bStepMsg").innerHTML = `<div class="note bad">${esc(errText(error))}</div>`; return; }
    toast("บันทึกขั้นแล้ว"); load();
  }

  function renderRoots() {
    $("#bRoots").innerHTML = ROOTS.map(r => {
      const st = status(r), list = entries.filter(e => e.root === r.k), none = list.length && list.every(e => (e.data || {}).none);
      const line = r.auto ? auto[r.k].line : none ? "ไม่มีเหตุการณ์เดือนนี้" : list.length ? `${list.length} รายการ` : r.d;
      return `<button type="button" class="root ${st}" data-root="${r.k}" aria-pressed="${sel === r.k}"><b>${r.k} · ${esc(r.t)}</b>${r.auto ? ' <span class="pill">อัตโนมัติ</span>' : ""}
        <div class="st">${stLabel[st]}</div><div class="meta">${esc(line)}</div></button>`;
    }).join("");
    document.querySelectorAll("[data-root]").forEach(b => b.onclick = () => { sel = sel === b.dataset.root ? null : b.dataset.root; store.set("rs-book-root", sel || ""); renderRoots(); renderRoot(); });
  }

  /* ---------- one root: entries + form ---------- */
  const val = (f, v) => v == null || v === "" ? "–" : f[2] === "dt" ? fmt(v) : f[2] === "num" ? n2(v) : esc(v);
  function entryHtml(r, e, urls) {
    const d = e.data || {}, canEdit = e.created_by === me.id || isMgr();
    const body = d.none ? "<b>ไม่มีเหตุการณ์เดือนนี้</b>" : (r.f || []).filter(f => d[f[0]] != null && d[f[0]] !== "").map(f => `<span><small>${esc(f[1])}</small> ${val(f, d[f[0]])}</span>`).join(" · ")
      + (r.k === "R7" ? ` · <b>${n2(hoursOf(d))} ชม.</b>` : "");
    const files = (e.files || []).map((p, i) => urls[p] ? `<a href="${urls[p]}" target="_blank" rel="noopener">📎 ไฟล์ ${i + 1}</a>` : `📎 ไฟล์ ${i + 1}`).join(" ");
    return `<div class="job" style="padding:10px"><div>${body}</div><div class="meta">${esc(nameOf(e.created_by))} · ${fmt(e.created_at)} ${files}
      ${canEdit ? `<button class="btn small noprint" data-del="${e.id}">ลบ</button>` : ""}</div></div>`;
  }
  const docUrls = async paths => {
    if (!paths.length) return {};
    const { data } = await sb.storage.from("docs").createSignedUrls(paths, 3600);
    return Object.fromEntries((data || []).filter(x => x.signedUrl).map(x => [x.path, x.signedUrl]));
  };
  async function renderRoot() {
    const r = rootOf(sel);
    if (!r) { $("#bRoot").innerHTML = ""; return; }
    if (r.auto) {
      const link = { R1: ["staff.html", "เปิดหน้าใบงาน"], R2: ["pm.html?tab=result", "เปิดผล PM2"], R3: ["pm.html?tab=result", "เปิดผล PM2"], R4: ["op.html?tab=sheet", "เปิดตาราง OP"] }[r.k];
      $("#bRoot").innerHTML = `<div class="panel"><h3>${r.k} · ${esc(r.t)}</h3><p class="sub">${esc(r.d)} ระบบดึงให้เอง ไม่ต้องลงข้อมูลหรืออัปโหลดไฟล์</p>
        <p><b>${esc(auto[r.k].line)}</b></p><a class="btn small" href="${link[0]}">${link[1]} ↗</a></div>`;
      return;
    }
    const list = entries.filter(e => e.root === r.k), urls = await docUrls(list.flatMap(e => e.files || []));
    const hr = r.k === "R9" ? `<div class="note">จากตารางกะของเดือนนี้: มาสายเกิน ${S.late_grace_min ?? 15} นาที <b>${auto.hr.late}</b> ครั้ง · ไม่ได้ลงเวลา <b>${auto.hr.noIn}</b> ครั้ง</div>` : "";
    const sum = r.k === "R7" ? `<div class="note">รวมเวลาระบบหยุด ${n2(list.reduce((s, e) => s + hoursOf(e.data), 0))} ชั่วโมง</div>` : "";
    const input = f => {
      const id = "bf_" + f[0];
      if (f[2] === "sel") return `<label>${esc(f[1])}<select id="${id}">${f[3].map(o => `<option>${esc(o)}</option>`).join("")}</select></label>`;
      if (f[2] === "area") return `<label class="span2">${esc(f[1])}<textarea id="${id}" rows="2"></textarea></label>`;
      const t = { num: 'type="number" step="any" min="0"', date: `type="date" min="${M}-01" max="${M}-31"`, dt: 'type="datetime-local"', text: "" }[f[2]];
      return `<label>${esc(f[1])}<input id="${id}" ${t}></label>`;
    };
    $("#bRoot").innerHTML = `<div class="panel"><h3>${r.k} · ${esc(r.t)} · ${thMonth(M)}</h3><p class="sub">${esc(r.d)}</p>${hr}${sum}
      <div class="jobs">${list.map(e => entryHtml(r, e, urls)).join("") || '<p class="empty">ยังไม่มีข้อมูล</p>'}</div>
      ${canAdd() ? `<form id="bForm" class="noprint" style="margin-top:12px"><h4>เพิ่มรายการ</h4><div class="grid">${r.f.map(input).join("")}
        ${r.file ? `<label class="span2">ไฟล์แนบ (PDF รูป Excel ไม่เกิน 20 MB)<input id="bFiles" type="file" multiple accept=".pdf,image/*,.xlsx,.xls,.csv"></label>` : ""}</div>
        <div class="row" style="margin-top:10px"><button class="btn primary" id="bSave">บันทึก</button>
        ${list.length ? "" : `<button class="btn" type="button" id="bNone">ไม่มีเหตุการณ์เดือนนี้</button>`}</div><div id="bMsg"></div></form>` : ""}</div>`;
    document.querySelectorAll("[data-del]").forEach(b => b.onclick = async () => {
      b.disabled = true;
      const { error } = await sb.from("monthly_entries").update({ active: false, updated_at: new Date().toISOString() }).eq("id", b.dataset.del);
      if (error) { b.disabled = false; return toast(errText(error)); }
      load();
    });
    if (!canAdd()) return;
    $("#bForm").onsubmit = async ev => {
      ev.preventDefault();
      const data = {};
      r.f.forEach(f => { const v = $("#bf_" + f[0]).value.trim(); if (v !== "") data[f[0]] = f[2] === "num" ? +v : f[2] === "dt" ? v.slice(0, 16) + ":00+07:00" : v; });
      if (!Object.keys(data).filter(k => r.f.find(f => f[0] === k)[2] !== "sel").length) return msg("กรอกข้อมูลอย่างน้อย 1 ช่อง");
      if (r.k === "R7" && (!data.start || !data.back)) return msg("ใส่เวลาเริ่มหยุดและเวลากลับมาใช้ได้");
      if (r.k === "R7" && data.back < data.start) return msg("เวลากลับมาใช้ได้ต้องหลังเวลาเริ่มหยุด");
      $("#bSave").disabled = true;
      try {
        const files = [];
        for (const f of ($("#bFiles") || { files: [] }).files) {
          if (f.size > 20 * 1024 * 1024) throw new Error(`ไฟล์ ${f.name} ใหญ่เกิน 20 MB`);
          const ext = (f.name.split(".").pop() || "bin").toLowerCase(), path = `${H.code}/${M}/${r.k}-${crypto.randomUUID()}.${ext}`;
          const up = await sb.storage.from("docs").upload(path, f, { contentType: f.type || undefined });
          if (up.error) throw up.error;
          files.push(path);
        }
        await save(r.k, data, files);
      } catch (e) { $("#bSave").disabled = false; msg(errText(e)); }
    };
    if ($("#bNone")) $("#bNone").onclick = async () => { $("#bNone").disabled = true; try { await save(r.k, { none: true }, []); } catch (e) { $("#bNone").disabled = false; msg(errText(e)); } };
  }
  const msg = t => { $("#bMsg").innerHTML = `<div class="note bad">${esc(t)}</div>`; };
  async function save(k, data, files) {
    // a real entry replaces an earlier "no event" mark
    const none = entries.filter(e => e.root === k && (e.data || {}).none && (e.created_by === me.id || isMgr()));
    if (!data.none) for (const e of none) await sb.from("monthly_entries").update({ active: false, updated_at: new Date().toISOString() }).eq("id", e.id);
    const { error } = await sb.from("monthly_entries").insert({ hospital_id: H.id, month: M, root: k, data, files, created_by: me.id });
    if (error) throw error;
    toast("บันทึกแล้ว"); load();
  }

  /* ---------- KPI table ---------- */
  function renderKpi() {
    const k = kpi, mark = (v, ok) => v == null ? "–" : `<b style="color:${ok ? "var(--s-close)" : "var(--bad)"}">${v}</b>`;
    const rows = [
      ["PM ตามแผน", `${k.pm_done}/${k.pm_plan} ใบ`, mark(k.pm_pct == null ? null : k.pm_pct + "%", k.pm_pct >= 95), "≥ 95%"],
      ["งานซ่อมเสร็จภายใน SLA", `${k.cm_finished} งานที่เสร็จ`, mark(k.cm_sla_pct == null ? null : k.cm_sla_pct + "%", k.cm_sla_pct >= 90), "≥ 90%"],
      ["ซ่อมซ้ำเครื่องเดิมภายใน 7 วัน", `${k.cm_jobs} งานในเดือน`, mark(k.repeat_7d, k.repeat_7d === 0), "0"],
      ["งานค้างเกิน 60 วัน", "ณ สิ้นเดือน", mark(k.aging_60d, k.aging_60d === 0), "0"],
      ["อุบัติการณ์ ระดับ 0–5", k.occurrence.map((n, i) => `L${i}:${n}`).join(" "), mark(k.occurrence.slice(3).reduce((a, b) => a + b, 0), k.occurrence.slice(3).every(n => !n)), "ระดับ 3 ขึ้นไป = 0"],
      ["ระบบหยุดทำงานรวม", "R7", mark(k.downtime_h + " ชม.", k.downtime_h === 0), "–"],
      ["ซ้อมแผน / อบรม", `Drill ${k.drills} · Training ${k.trainings}`, mark(k.drills + k.trainings, k.drills + k.trainings > 0), "ตามแผนปี"],
      ["บันทึก OP ผิดปกติ", `${k.op_logs} ครั้ง`, mark(k.op_abnormal, k.op_abnormal === 0), "0"],
      ["พนักงานมาสาย / ไม่ลงเวลา", "จากตารางกะ", mark(`${k.late} / ${k.no_checkin}`, !k.late && !k.no_checkin), "0"],
      ["ส่งเล่มก่อนวันที่ 5", book && book.book_at ? fmt(book.book_at) : "ยังไม่ส่ง", mark(k.book_by_day5 == null ? null : k.book_by_day5 ? "ทัน" : "ไม่ทัน", k.book_by_day5), "ก่อนวันที่ 5"],
    ];
    const saved = book && book.kpi_at ? `<caption class="sub" style="text-align:left">คะแนนที่บันทึกตอนขั้น "คิดคะแนน KPI" ${fmt(book.kpi_at)} · ตารางนี้คิดจากข้อมูลล่าสุด</caption>` : "";
    $("#bKpi").innerHTML = `${saved}<thead><tr><th>ตัวชี้วัด</th><th>ข้อมูล</th><th>ผล</th><th>เป้า</th></tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody>`;
  }

  /* ---------- print: every root on one sheet ---------- */
  async function renderAll() {
    const urls = {};
    const html = ROOTS.map(r => {
      const list = entries.filter(e => e.root === r.k);
      const body = r.auto ? `<p>${esc(auto[r.k].line)}</p>` : list.length ? list.map(e => entryHtml(r, e, urls)).join("") : '<p class="empty" style="color:var(--bad)">ใบแดง / ยังไม่มีข้อมูล</p>';
      return `<div class="panel" style="break-inside:avoid;margin-bottom:8px"><h3>${r.k} · ${esc(r.t)} · ${stLabel[status(r)]}</h3>${body}</div>`;
    }).join("");
    sel = null; renderRoots();
    $("#bRoot").innerHTML = `<h2>สรุป Monthly Report ${thMonth(M)} · ${esc(H.name)}</h2>${html}`;
  }
})();
