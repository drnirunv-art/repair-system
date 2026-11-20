// แฟ้มพร้อมตรวจ JCI: machine file for Reverse-Tracer practice (PM + certificates + repairs of one machine, timed against 15 minutes),
// certificate / calibration register with expiry, ILSM register, Code drill log by shift and quarter. 4 exports on every results table.
(() => {
  const { sb, $, esc, errText, STATUS } = RS;
  const MGR = ["owner", "admin", "chief_engineer", "supervisor"], SHIFTS = ["เช้า", "บ่าย", "ดึก"], SOON = 60, LIMIT = 15 * 60;
  const GRPS = ["ช่าง", "แม่บ้าน", "รปภ.", "ผู้รับเหมา", "พยาบาล / แพทย์", "อื่น ๆ"];
  const MEAS = ["เดินตรวจทางหนีไฟทุกวัน", "จัดคนเฝ้าระวังไฟ (Fire watch)", "เพิ่มถังดับเพลิงในพื้นที่", "แจ้งและอบรมเจ้าหน้าที่ในพื้นที่", "ซ้อมดับเพลิงเพิ่มในพื้นที่",
    "ห้ามสูบบุหรี่ / ควบคุมงานความร้อน (Hot work)", "เก็บวัสดุติดไฟออกจากพื้นที่", "กั้นพื้นที่และควบคุมฝุ่น (ICRA)", "ติดป้ายเตือน / ทางเลี่ยง", "แจ้งหน่วยดับเพลิง / รปภ."];
  const EVID = ["สติกเกอร์ PM / สอบเทียบที่ตัวเครื่อง", "ประวัติ PM", "ใบสอบเทียบ / ใบรับรอง", "ประวัติงานซ่อม", "คู่มือ / Spec เครื่อง"];
  const PMST = { todo: "ยังไม่ตรวจ", submitted: "ช่างส่งแล้ว", head_signed: "รอวิศวกร", approved: "อนุมัติครบ 3/3", returned: "ส่งกลับให้แก้" };
  const CST = { ok: "ยังไม่หมดอายุ", soon: "จะหมดใน 60 วัน", exp: "หมดอายุแล้ว", none: "ไม่ระบุวันหมดอายุ" };
  let me = null, exec = false, hosps = [], canWrite = false, cur = "sum", busy = false, editId = null;
  let eqs = [], certs = [], ilsm = [], drills = [], runs = [], openEq = null, t0 = null, tick = null;
  const toast = (m, bad) => { const t = $("#toast"); t.textContent = m; t.hidden = false; t.style.background = bad ? "var(--bad)" : ""; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, bad ? 6000 : 3000); };
  const guard = fn => async ev => { if (ev && ev.preventDefault) ev.preventDefault(); if (busy) return; busy = true; try { await fn(ev); } catch (e) { toast(errText(e), true); } finally { busy = false; } };
  const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
  const addD = (d, n) => { const x = new Date(d + "T00:00:00"); x.setDate(x.getDate() + n); return x.toLocaleDateString("en-CA"); };
  const dTH = d => d ? new Date(String(d).slice(0, 10) + "T00:00:00").toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" }) : "-";
  const dtTH = d => d ? new Date(d).toLocaleString("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "-";
  const pct = (a, b) => b ? Math.round(a * 1000 / b) / 10 : null;
  const mmss = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const hosp = () => hosps.find(h => h.id === $("#h").value) || {};
  const eqOf = id => eqs.find(e => e.id === id);
  const eqLabel = e => e ? `${e.tag || "-"} · ${e.name}` : "";
  const findEq = v => { const s = String(v || "").trim().toUpperCase(); if (!s) return null; const tag = s.split(" · ")[0];
    return eqs.find(e => (e.tag || "").toUpperCase() === tag) || eqs.find(e => (e.code || "").toUpperCase() === tag) || null; };
  const cState = c => !c.expires_on ? "none" : c.expires_on < today() ? "exp" : c.expires_on <= addD(today(), SOON) ? "soon" : "ok";
  const quarter = d => Math.floor((+String(d).slice(5, 7) - 1) / 3) + 1;
  const isRed = c => /red|อัคคี|ไฟไหม้/i.test(c);
  const where = e => [e.building, e.floor, e.place].filter(Boolean).join(" · ");
  async function all(q) { const out = []; for (let i = 0; ; i += 1000) { const { data, error } = await q().range(i, i + 999); if (error) throw error; out.push(...data); if (data.length < 1000) return out; } }

  // ---------- boot ----------
  sb.auth.onAuthStateChange((_e, session) => setTimeout(() => boot(session), 0));
  async function boot(session) {
    if (me) return;
    if (!session) { $("#gate").hidden = false; return; }
    const { data } = await sb.from("profiles").select("id,full_name,role,hospital_id,hospitals(id,code,name)").eq("id", session.user.id).maybeSingle();
    if (!data || !data.hospital_id) { $("#gate").hidden = false; return; }
    me = data; $("#who").textContent = `${me.full_name || ""} · ${me.hospitals.name}`;
    exec = !!(await sb.rpc("am_exec")).data;
    const mh = await sb.rpc("my_hospitals");
    hosps = (mh.data && mh.data.length ? mh.data : [me.hospitals]).map(h => ({ id: h.id, code: h.code, name: h.name }));
    $("#h").innerHTML = hosps.map(h => `<option value="${h.id}">${esc(h.code)} · ${esc(h.name)}</option>`).join("");
    const q = new URLSearchParams(location.search), want = (q.get("h") || "").toUpperCase(), pt2 = hosps.find(h => h.code === "PT2");
    $("#h").value = (hosps.find(h => h.code === want) || hosps.find(h => h.id === me.hospital_id) || pt2 || hosps[0]).id; $("#h").disabled = hosps.length < 2;
    const ty = +today().slice(0, 4); $("#dy").innerHTML = [ty, ty - 1, ty - 2].map(y => `<option value="${y}">${y + 543}</option>`).join("");
    $("#iM").innerHTML = MEAS.map(m => `<label><input type="checkbox" value="${esc(m)}"> ${esc(m)}</label>`).join("");
    $("#dG").innerHTML = GRPS.map(g => `<label><input type="checkbox" value="${esc(g)}"> ${esc(g)}</label>`).join("");
    $("#iS").value = $("#dD").value = today();
    $("#body").hidden = false; $("#tabs").hidden = false;
    await load();
    if (q.get("tag")) { $("#eT").value = q.get("tag"); show("eq"); openFile(); } else show(q.get("tab") || "sum");
  }
  async function load() {
    const h = $("#h").value;
    canWrite = exec || (MGR.includes(me.role) && hosps.some(x => x.id === h));
    $("#ro").textContent = canWrite ? "" : "ดูได้อย่างเดียว (บันทึกได้เฉพาะหัวหน้าของโรงนี้)";
    ["#certForm", "#ilsmForm", "#drillForm"].forEach(s => $(s).hidden = !canWrite);
    const [e, c, i, d, t] = await Promise.all([
      all(() => sb.from("equipment").select("id,tag,code,name,eq_type,system,building,floor,place,pm_freq,pm_months,pm_by,active").eq("hospital_id", h).order("tag")),
      sb.from("jci_certs").select("*").eq("hospital_id", h).eq("active", true).order("expires_on", { nullsFirst: false }),
      sb.from("jci_ilsm").select("*").eq("hospital_id", h).order("started_on", { ascending: false }),
      sb.from("jci_drills").select("*").eq("hospital_id", h).order("held_on", { ascending: false }),
      sb.from("jci_tracer").select("*").eq("hospital_id", h).order("created_at", { ascending: false }).limit(200)]);
    for (const r of [c, i, d, t]) if (r.error) throw r.error;
    eqs = e; certs = c.data || []; ilsm = i.data || []; drills = d.data || []; runs = t.data || [];
    $("#tags").innerHTML = eqs.filter(x => x.tag).map(x => `<option value="${esc(eqLabel(x))}">`).join("");
  }
  document.querySelectorAll("#tabs button").forEach(b => b.onclick = () => show(b.dataset.tab));
  const TABS = ["sum", "eq", "cert", "ilsm", "drill"];
  function show(t) {
    cur = TABS.includes(t) ? t : "sum";
    document.querySelectorAll("#tabs button").forEach(b => b.setAttribute("aria-selected", b.dataset.tab === cur));
    TABS.forEach(k => $("#tab-" + k).hidden = k !== cur);
    try { ({ sum: rSum, eq: rEq, cert: rCert, ilsm: rIlsm, drill: rDrill })[cur](); } catch (e) { toast(errText(e), true); }
  }
  $("#h").onchange = guard(async () => { openEq = null; stopTimer(); $("#eBody").innerHTML = ""; await load(); show(cur); });
  const period = () => `${hosp().code || ""} · ข้อมูล ณ ${dTH(today())}`;
  const tbl = (head, rows, cls) => `<thead><tr>${head.map(h => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.length ? rows.map((r, i) => `<tr${cls && cls[i] ? ` class="${cls[i]}"` : ""}>${r.map(v => `<td>${v}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${head.length}" class="sub">ยังไม่มีข้อมูล</td></tr>`}</tbody>`;

  // ---------- ภาพรวม ----------
  function summary() {
    const t = today(), cs = certs.map(c => ({ c, st: cState(c) })), n = k => cs.filter(x => x.st === k).length;
    const open = ilsm.filter(x => !x.ended_on), late = open.filter(x => x.target_end && x.target_end < t);
    const y = t.slice(0, 4), q = quarter(t), dq = drills.filter(d => d.held_on.startsWith(y) && quarter(d.held_on) === q);
    const shiftsRed = SHIFTS.filter(s => dq.some(d => d.shift === s && isRed(d.code))), shiftsAny = SHIFTS.filter(s => dq.some(d => d.shift === s));
    const r90 = runs.filter(r => r.created_at.slice(0, 10) >= addD(t, -90)), fast = r90.filter(r => r.seconds <= LIMIT).length;
    const avg = r90.length ? Math.round(r90.reduce((s, r) => s + r.seconds, 0) / r90.length) : null;
    return { cs, ok: n("ok"), soon: n("soon"), exp: n("exp"), none: n("none"), open, late, y, q, dq, shiftsRed, shiftsAny, r90, fast, avg, improve: dq.filter(d => d.result !== "ผ่าน") };
  }
  function findings(S) {
    const f = [];
    f.push(`ใบรับรอง / สอบเทียบ ${S.cs.length} รายการ: ยังไม่หมดอายุ ${S.ok} · จะหมดใน 60 วัน ${S.soon} · หมดอายุแล้ว ${S.exp} · ไม่ระบุวันหมดอายุ ${S.none}`);
    f.push(`ILSM ที่ยังเปิดอยู่ ${S.open.length} รายการ${S.late.length ? ` (เลยกำหนดปิด ${S.late.length} รายการ)` : ""}`);
    f.push(`ซ้อม Code ไตรมาส ${S.q}/${+S.y + 543}: ${S.dq.length} ครั้ง ครอบคลุม ${S.shiftsAny.length}/3 กะ · Code Red ครบ ${S.shiftsRed.length}/3 กะ${S.shiftsRed.length < 3 ? ` (ยังขาดกะ${SHIFTS.filter(s => !S.shiftsRed.includes(s)).join(", ")})` : ""}`);
    f.push(S.r90.length ? `ซ้อม Reverse-Tracer 90 วันล่าสุด ${S.r90.length} ครั้ง หาเอกสารได้ภายใน 15 นาที ${S.fast} ครั้ง (${pct(S.fast, S.r90.length)}%) เวลาเฉลี่ย ${mmss(S.avg)} นาที` : "ยังไม่มีการซ้อม Reverse-Tracer ใน 90 วันล่าสุด");
    if (S.improve.length) f.push(`การซ้อมไตรมาสนี้ที่ผล "ต้องปรับปรุง" ${S.improve.length} ครั้ง ต้องติดตามสิ่งที่ต้องแก้ไขให้ครบ`);
    return f;
  }
  function rSum() {
    const S = summary(), k = (l, v, c) => `<div class="kpi"><b class="${c || ""}">${esc(String(v))}</b><span>${esc(l)}</span></div>`;
    $("#tot").innerHTML = k("ใบรับรองยังไม่หมดอายุ", `${S.ok}/${S.cs.length}`, S.exp ? "bad" : "good") + k("หมดอายุแล้ว", S.exp, S.exp ? "bad" : "good") + k("จะหมดใน 60 วัน", S.soon, S.soon ? "mid" : "")
      + k("ILSM เปิดอยู่", S.open.length, S.late.length ? "bad" : "") + k(`Code Red ครบกะ (ไตรมาส ${S.q})`, `${S.shiftsRed.length}/3`, S.shiftsRed.length < 3 ? "bad" : "good")
      + k("Reverse-Tracer ≤ 15 นาที", S.r90.length ? `${pct(S.fast, S.r90.length)}%` : "-", S.r90.length && S.fast < S.r90.length ? "mid" : "");
    $("#finds").innerHTML = findings(S).map(x => `<div class="note">${esc(x)}</div>`).join("");
    const codes = [...new Set(S.dq.map(d => d.code))];
    $("#qMx").innerHTML = tbl(["Code / เหตุการณ์", ...SHIFTS.map(s => "กะ" + s)], codes.map(c => [esc(c), ...SHIFTS.map(s => { const n = S.dq.filter(d => d.code === c && d.shift === s).length; return n ? `✓ ${n} ครั้ง` : "–"; })]));
    const due = S.cs.filter(x => x.st === "exp" || x.st === "soon").sort((a, b) => a.c.expires_on.localeCompare(b.c.expires_on));
    $("#dueC").innerHTML = tbl(["รายการ", "เครื่อง", "ประเภท", "หมดอายุ", "สถานะ"], due.map(x => [esc(x.c.item), esc(eqLabel(eqOf(x.c.equipment_id))), esc(x.c.kind), dTH(x.c.expires_on), CST[x.st]]), due.map(x => x.st));
  }
  $("#oX").onclick = () => { const S = summary();
    const rows = [...S.cs.filter(x => x.st !== "ok").map(x => ["ใบรับรอง", x.c.item, eqLabel(eqOf(x.c.equipment_id)), CST[x.st], dTH(x.c.expires_on)]),
      ...S.open.map(x => ["ILSM เปิดอยู่", x.title, x.area || "", x.target_end && x.target_end < today() ? "เลยกำหนดปิด" : "ยังเปิด", dTH(x.target_end)]),
      ...SHIFTS.filter(s => !S.shiftsRed.includes(s)).map(s => ["ซ้อม Code Red", `ยังไม่ได้ซ้อมกะ${s} ในไตรมาส ${S.q}/${+S.y + 543}`, "", "ขาด", ""])];
    Office.table("JCI_ความพร้อม_" + (hosp().code || ""), ["เรื่อง", "รายการ", "เครื่อง / พื้นที่", "สถานะ", "วันที่"], rows,
      { title: "สรุปความพร้อมหลักฐาน JCI", period: period(), findings: findings(S), notes: ["JCI 8th FMS.06 / FMS.07 / FMS.08 / FMS.09 / FMS.10 (ILSM) · KPI ข้อ 6 ซ้อม Code", "ตารางนี้แสดงเฉพาะเรื่องที่ต้องแก้ไข"] }); };

  // ---------- แฟ้มเครื่อง ----------
  function stopTimer() { clearInterval(tick); tick = null; t0 = null; }
  const elapsed = () => t0 ? Math.floor((Date.now() - t0) / 1000) : 0;
  function rEq() {
    $("#tList").innerHTML = tbl(["เวลา", "เครื่อง", "ใช้เวลา", "ผล", "หลักฐานที่หาเจอ", "หมายเหตุ"], runs.slice(0, 50).map(r => [dtTH(r.created_at), esc(eqLabel(eqOf(r.equipment_id)) || r.tag || ""), mmss(r.seconds),
      r.seconds <= LIMIT ? "ทัน 15 นาที" : "เกิน 15 นาที (Gap)", esc((r.found || []).join(", ")), esc(r.note || "")]), runs.slice(0, 50).map(r => r.seconds <= LIMIT ? "ok" : "exp"));
  }
  const openFile = guard(async () => {
    const e = findEq($("#eT").value);
    if (!e) return toast("ไม่พบเครื่องนี้ในทะเบียนของ " + (hosp().name || ""), true);
    openEq = e; stopTimer();
    const [pm, jb] = await Promise.all([
      sb.from("pm_tasks").select("year,month,week,status,submitted_at,eng_at,abnormal,score").eq("equipment_id", e.id).order("year", { ascending: false }).order("month", { ascending: false }).limit(24),
      sb.from("jobs").select("job_no,created_at,status,detail,summary,hold_reason").eq("equipment_id", e.id).order("created_at", { ascending: false }).limit(30)]);
    if (pm.error) throw pm.error; if (jb.error) throw jb.error;
    const cs = certs.filter(c => c.equipment_id === e.id), FREQ = { M: "ทุกเดือน", Q: "ทุก 3 เดือน", H: "ทุก 6 เดือน", Y: "ปีละครั้ง" };
    const lastPm = (pm.data || []).find(t => t.status === "approved" || t.status === "head_signed" || t.status === "submitted");
    $("#eBody").innerHTML = `<div class="panel">
      <h2 style="margin:0"><span style="font-family:'IBM Plex Mono',monospace">${esc(e.tag || "-")}</span> · ${esc(e.name)}</h2>
      <div class="eqh"><div><small>ชนิด</small>${esc(e.eq_type || e.system || "-")}</div><div><small>ที่ตั้ง</small>${esc(where(e) || "-")}</div>
        <div><small>แผน PM</small>${e.pm_freq ? `${FREQ[e.pm_freq]} (เดือน ${(e.pm_months || []).join(", ")}) · ${esc(e.pm_by)}` : "ยังไม่มีแผน"}</div>
        <div><small>PM ครั้งล่าสุด</small>${lastPm ? `${lastPm.month}/${lastPm.year + 543} · ${PMST[lastPm.status]}` : "ยังไม่มีผล"}</div></div>
      <div class="acts noprint"><span class="timer" id="tmr">0:00</span><button class="btn primary" type="button" id="tGo">เริ่มจับเวลา</button></div>
      <div class="noprint" id="tBox" hidden><b>หลักฐานที่ทีมหาเจอ</b><div class="chk" id="tEv">${EVID.map(x => `<label><input type="checkbox" value="${esc(x)}"> ${esc(x)}</label>`).join("")}</div>
        <div class="hsel"><input id="tNote" placeholder="หมายเหตุ (เช่น ใบสอบเทียบอยู่ที่ผู้รับเหมา)" style="min-width:280px"><button class="btn primary" type="button" id="tStop">หยุดและบันทึกผล</button></div></div>
    </div>
    <h3>ใบรับรอง / สอบเทียบของเครื่องนี้</h3>
    <div class="tw"><table class="tt" id="eC">${tbl(["รายการ", "ประเภท", "เลขที่", "หน่วยงาน", "ออก", "หมดอายุ", "สถานะ", "ไฟล์"], cs.map(c => [esc(c.item), esc(c.kind), esc(c.cert_no || ""), esc(c.issuer || ""), dTH(c.issued_on), dTH(c.expires_on), CST[cState(c)], fileBtns(c)]), cs.map(cState))}</table></div>
    ${cs.length ? "" : `<div class="note bad">ยังไม่มีใบรับรอง / ใบสอบเทียบของเครื่องนี้ในระบบ ถ้าเครื่องนี้ต้องสอบเทียบ ให้เพิ่มในแท็บ "ใบรับรอง · สอบเทียบ"</div>`}
    <h3>ประวัติ PM (24 รอบล่าสุด)</h3>
    <div class="tw"><table class="tt">${tbl(["แผน", "สถานะ", "ช่างส่งผล", "วิศวกรอนุมัติ", "ผิดปกติ"], (pm.data || []).map(t => [`${t.month}/${t.year + 543} W${t.week}`, PMST[t.status] || t.status, dtTH(t.submitted_at), dtTH(t.eng_at), t.abnormal ? `${t.abnormal} ข้อ` : "-"]), (pm.data || []).map(t => t.status === "approved" ? "ok" : t.status === "todo" ? "none" : t.status === "returned" ? "exp" : "soon"))}</table></div>
    <h3>ประวัติงานซ่อม (30 งานล่าสุด)</h3>
    <div class="tw"><table class="tt">${tbl(["เลขงาน", "วันที่แจ้ง", "สถานะ", "อาการ", "สรุปการซ่อม"], (jb.data || []).map(j => [esc(j.job_no), dtTH(j.created_at), esc(STATUS[j.status] || j.status), esc(j.detail || ""), esc(j.summary || j.hold_reason || "")]))}</table></div>`;
    bindFiles($("#eBody"));
    $("#tGo").onclick = () => { t0 = Date.now(); $("#tGo").hidden = true; $("#tBox").hidden = false;
      tick = setInterval(() => { const s = elapsed(), el = $("#tmr"); if (!el) return stopTimer(); el.textContent = mmss(s); el.classList.toggle("over", s > LIMIT); }, 500); };
    $("#tStop").onclick = guard(async () => { const s = elapsed(); if (!t0) return;
      const found = [...document.querySelectorAll("#tEv input:checked")].map(x => x.value);
      const { error } = await sb.from("jci_tracer").insert({ hospital_id: $("#h").value, equipment_id: e.id, tag: e.tag, seconds: s, found, note: $("#tNote").value.trim() || null, created_by: me.id });
      if (error) throw error; stopTimer(); toast(s <= LIMIT ? `บันทึกแล้ว ใช้เวลา ${mmss(s)} นาที ทัน 15 นาที` : `บันทึกแล้ว ใช้เวลา ${mmss(s)} นาที เกิน 15 นาที เป็น Gap ที่ต้องแก้`, s > LIMIT);
      const r = await sb.from("jci_tracer").select("*").eq("hospital_id", $("#h").value).order("created_at", { ascending: false }).limit(200); runs = r.data || runs; $("#tBox").hidden = true; $("#tGo").hidden = false; rEq(); });
    rEq();
  });
  $("#eOpen").onclick = openFile;
  $("#eT").onkeydown = ev => { if (ev.key === "Enter") { ev.preventDefault(); openFile(); } };
  $("#ePrint").onclick = () => openEq ? print() : toast("เปิดแฟ้มเครื่องก่อน");
  $("#tX").onclick = () => { const r90 = runs.filter(r => r.created_at.slice(0, 10) >= addD(today(), -90)), fast = r90.filter(r => r.seconds <= LIMIT).length;
    Office.table("JCI_ReverseTracer_" + (hosp().code || ""), ["เวลา", "TAG", "เครื่อง", "ใช้เวลา (นาที)", "ผล", "หลักฐานที่หาเจอ", "หมายเหตุ"],
      runs.map(r => { const e = eqOf(r.equipment_id); return [dtTH(r.created_at), r.tag || (e && e.tag) || "", e ? e.name : "", Math.round(r.seconds / 6) / 10, r.seconds <= LIMIT ? "ทัน 15 นาที" : "เกิน 15 นาที (Gap)", (r.found || []).join(", "), r.note || ""]; }),
      { title: "ผลซ้อม Reverse-Tracer (หาหลักฐานของเครื่องให้ได้ภายใน 15 นาที)", period: period(),
        findings: [r90.length ? `90 วันล่าสุด ซ้อม ${r90.length} ครั้ง ทัน 15 นาที ${fast} ครั้ง (${pct(fast, r90.length)}%)` : "ยังไม่มีการซ้อมใน 90 วันล่าสุด",
          ...runs.filter(r => r.seconds > LIMIT).slice(0, 5).map(r => `เกิน 15 นาที: ${eqLabel(eqOf(r.equipment_id)) || r.tag} ใช้ ${mmss(r.seconds)} นาที${r.note ? " · " + r.note : ""}`)] }); };

  // ---------- ใบรับรอง ----------
  const fileBtns = c => (c.files || []).map((p, i) => `<button class="btn small" type="button" data-file="${esc(p)}">ไฟล์ ${i + 1}</button>`).join(" ") || "-";
  function bindFiles(root) { root.querySelectorAll("[data-file]").forEach(b => b.onclick = guard(async () => {
    const { data, error } = await sb.storage.from("docs").createSignedUrl(b.dataset.file, 600); if (error) throw error; window.open(data.signedUrl, "_blank", "noopener"); })); }
  function rCert() {
    const f = $("#cF").value, list = certs.filter(c => !f || cState(c) === f);
    $("#cList").innerHTML = tbl(["รายการ", "เครื่อง", "ประเภท", "เลขที่", "หน่วยงาน", "ออก", "หมดอายุ", "สถานะ", "อ้างอิง", "ไฟล์", ""],
      list.map(c => [esc(c.item), esc(eqLabel(eqOf(c.equipment_id))), esc(c.kind), esc(c.cert_no || ""), esc(c.issuer || ""), dTH(c.issued_on), dTH(c.expires_on), CST[cState(c)], esc(c.ref || ""), fileBtns(c),
        canWrite ? `<button class="btn small" type="button" data-edit="${c.id}">แก้ไข / ต่ออายุ</button> <button class="btn small" type="button" data-off="${c.id}">เลิกใช้</button>` : ""]), list.map(cState));
    bindFiles($("#cList"));
    $("#cList").querySelectorAll("[data-edit]").forEach(b => b.onclick = () => editCert(certs.find(c => c.id === +b.dataset.edit)));
    $("#cList").querySelectorAll("[data-off]").forEach(b => b.onclick = guard(async () => { const c = certs.find(x => x.id === +b.dataset.off);
      if (!confirmOff(c)) return; const { error } = await sb.from("jci_certs").update({ active: false, updated_at: new Date().toISOString() }).eq("id", c.id); if (error) throw error; await load(); rCert(); toast("นำออกจากทะเบียนแล้ว"); }));
  }
  const confirmOff = c => { const b = $("#cMsg"); if (b.dataset.off === String(c.id)) { b.dataset.off = ""; b.textContent = ""; return true; }
    b.dataset.off = c.id; b.textContent = `กด "เลิกใช้" อีกครั้งเพื่อยืนยันการนำ "${c.item}" ออกจากทะเบียน`; return false; };
  $("#cF").onchange = rCert;
  function editCert(c) { editId = c.id; $("#cTitle").textContent = "แก้ไข / ต่ออายุใบรับรอง"; $("#cCancel").hidden = false;
    $("#cItem").value = c.item; $("#cTag").value = eqLabel(eqOf(c.equipment_id)); $("#cKind").value = c.kind; $("#cIss").value = c.issuer || ""; $("#cNo").value = c.cert_no || "";
    $("#cOn").value = c.issued_on || ""; $("#cExp").value = c.expires_on || ""; $("#cRef").value = c.ref || ""; $("#cNote").value = c.note || ""; $("#cFile").value = "";
    $("#cMsg").textContent = "ไฟล์เดิมยังอยู่ ไฟล์ที่แนบเพิ่มจะต่อท้าย"; $("#certForm").scrollIntoView({ behavior: "smooth" }); }
  function resetCert() { editId = null; $("#fC").reset(); $("#cTitle").textContent = "เพิ่มใบรับรอง / ใบสอบเทียบ"; $("#cCancel").hidden = true; }
  $("#cCancel").onclick = () => { resetCert(); $("#cMsg").textContent = ""; };
  $("#fC").onsubmit = guard(async () => {
    const tagV = $("#cTag").value.trim(), e = tagV ? findEq(tagV) : null;
    if (tagV && !e) throw new Error("ไม่พบเครื่อง TAG นี้ เลือกจากรายการ หรือเว้นว่าง");
    if ($("#cOn").value && $("#cExp").value && $("#cExp").value < $("#cOn").value) throw new Error("วันหมดอายุต้องอยู่หลังวันที่ออก");
    $("#cSave").disabled = true;
    try {
      const files = [];
      for (const f of $("#cFile").files) {
        if (f.size > 20 * 1024 * 1024) throw new Error(`ไฟล์ ${f.name} ใหญ่เกิน 20 MB`);
        const ext = (f.name.split(".").pop() || "bin").toLowerCase(), path = `${hosp().code}/JCI/cert-${crypto.randomUUID()}.${ext}`;
        const up = await sb.storage.from("docs").upload(path, f, { contentType: f.type || undefined }); if (up.error) throw up.error; files.push(path);
      }
      const row = { item: $("#cItem").value.trim(), equipment_id: e ? e.id : null, kind: $("#cKind").value, issuer: $("#cIss").value.trim() || null, cert_no: $("#cNo").value.trim() || null,
        issued_on: $("#cOn").value || null, expires_on: $("#cExp").value || null, ref: $("#cRef").value.trim() || null, note: $("#cNote").value.trim() || null, updated_at: new Date().toISOString() };
      if (editId) { const old = certs.find(c => c.id === editId); const { error } = await sb.from("jci_certs").update({ ...row, files: [...(old.files || []), ...files] }).eq("id", editId); if (error) throw error; }
      else { const { error } = await sb.from("jci_certs").insert({ ...row, files, hospital_id: $("#h").value, created_by: me.id }); if (error) throw error; }
      resetCert(); $("#cMsg").textContent = "บันทึกแล้ว"; await load(); rCert();
    } finally { $("#cSave").disabled = false; }
  });
  $("#cX").onclick = () => { const S = summary();
    Office.table("JCI_ใบรับรอง_" + (hosp().code || ""), ["รายการ", "TAG", "เครื่อง", "ประเภท", "เลขที่", "หน่วยงาน", "วันที่ออก", "วันหมดอายุ", "สถานะ", "อ้างอิง", "ไฟล์แนบ", "หมายเหตุ"],
      certs.map(c => { const e = eqOf(c.equipment_id); return [c.item, e ? e.tag : "", e ? e.name : "", c.kind, c.cert_no || "", c.issuer || "", dTH(c.issued_on), dTH(c.expires_on), CST[cState(c)], c.ref || "", (c.files || []).length, c.note || ""]; }),
      { title: "ทะเบียนใบรับรองและการสอบเทียบ", period: period(), findings: [findings(S)[0], ...S.cs.filter(x => x.st === "exp").slice(0, 8).map(x => `หมดอายุแล้ว: ${x.c.item} (${dTH(x.c.expires_on)}) ต้องต่ออายุหรือสอบเทียบใหม่`)],
        notes: ["สถานะคิดจากวันหมดอายุ: จะหมดใน 60 วัน = ควรนัดสอบเทียบล่วงหน้า"] }); };

  // ---------- ILSM ----------
  function rIlsm() {
    const t = today();
    $("#iList").innerHTML = tbl(["เริ่ม", "ข้อบกพร่อง", "พื้นที่", "ความเสี่ยง", "มาตรการชั่วคราว", "กำหนดปิด", "ปิดเมื่อ", "ผู้รับผิดชอบ", "สถานะ", ""],
      ilsm.map(x => [dTH(x.started_on), esc(x.title), esc(x.area || ""), esc(x.risk), esc((x.measures || []).join(", ")), dTH(x.target_end), dTH(x.ended_on), esc(x.owner_name || ""),
        x.ended_on ? "ปิดแล้ว" : x.target_end && x.target_end < t ? "เลยกำหนดปิด" : "เปิดอยู่", canWrite && !x.ended_on ? `<button class="btn small" type="button" data-close="${x.id}">ปิด ILSM วันนี้</button>` : ""]),
      ilsm.map(x => x.ended_on ? "ok" : x.target_end && x.target_end < t ? "exp" : "soon"));
    $("#iList").querySelectorAll("[data-close]").forEach(b => b.onclick = guard(async () => {
      const { error } = await sb.from("jci_ilsm").update({ ended_on: today(), updated_at: new Date().toISOString() }).eq("id", +b.dataset.close); if (error) throw error; await load(); rIlsm(); toast("ปิด ILSM แล้ว"); }));
  }
  $("#fI").onsubmit = guard(async () => {
    const measures = [...document.querySelectorAll("#iM input:checked")].map(x => x.value);
    if (!measures.length) throw new Error("เลือกมาตรการชั่วคราวอย่างน้อย 1 ข้อ");
    if ($("#iE").value && $("#iE").value < $("#iS").value) throw new Error("กำหนดปิดต้องอยู่หลังวันเริ่ม");
    const { error } = await sb.from("jci_ilsm").insert({ hospital_id: $("#h").value, title: $("#iT").value.trim(), area: $("#iA").value.trim() || null, ref: $("#iRef").value.trim() || null, risk: $("#iR").value,
      measures, started_on: $("#iS").value, target_end: $("#iE").value || null, owner_name: $("#iO").value.trim() || null, note: $("#iN").value.trim() || null, created_by: me.id });
    if (error) throw error; $("#fI").reset(); $("#iS").value = today(); $("#iRef").value = "FMS.10.00"; $("#iMsg").textContent = "บันทึกแล้ว"; await load(); rIlsm();
  });
  $("#iX").onclick = () => { const S = summary();
    Office.table("JCI_ILSM_" + (hosp().code || ""), ["วันเริ่ม", "ข้อบกพร่อง", "พื้นที่", "อ้างอิง", "ความเสี่ยง", "มาตรการชั่วคราว", "กำหนดปิด", "ปิดเมื่อ", "จำนวนวัน", "ผู้รับผิดชอบ", "สถานะ", "หมายเหตุ"],
      ilsm.map(x => [dTH(x.started_on), x.title, x.area || "", x.ref || "", x.risk, (x.measures || []).join(", "), dTH(x.target_end), dTH(x.ended_on),
        Math.round((new Date((x.ended_on || today()) + "T00:00:00") - new Date(x.started_on + "T00:00:00")) / 864e5), x.owner_name || "", x.ended_on ? "ปิดแล้ว" : x.target_end && x.target_end < today() ? "เลยกำหนดปิด" : "เปิดอยู่", x.note || ""]),
      { title: "ทะเบียน ILSM (มาตรการความปลอดภัยชีวิตชั่วคราว)", period: period(), findings: [findings(S)[1], ...S.late.map(x => `เลยกำหนดปิด: ${x.title} (กำหนด ${dTH(x.target_end)}) ต้องเร่งแก้ไขหรือขยายกำหนดพร้อมเหตุผล`)] }); };

  // ---------- ซ้อม Code ----------
  function rDrill() {
    const y = $("#dy").value, ds = drills.filter(d => d.held_on.startsWith(y)), codes = [...new Set(ds.map(d => d.code))];
    $("#dMx").innerHTML = tbl(["Code / เหตุการณ์", ...[1, 2, 3, 4].flatMap(q => SHIFTS.map(s => `ไตรมาส ${q} · ${s}`))],
      codes.map(c => [esc(c), ...[1, 2, 3, 4].flatMap(q => SHIFTS.map(s => { const n = ds.filter(d => d.code === c && d.shift === s && quarter(d.held_on) === q).length; return n ? `✓ ${n}` : "–"; }))]));
    $("#dList").innerHTML = tbl(["วันที่", "กะ", "Code / เหตุการณ์", "สถานที่", "ผู้เข้าร่วม", "กลุ่ม", "นาที", "ผล", "สิ่งที่พบ", "สิ่งที่ต้องแก้ไข"],
      ds.map(d => [dTH(d.held_on), esc(d.shift), esc(d.code), esc(d.place || ""), d.participants ?? "-", esc((d.groups || []).join(", ")), d.minutes ?? "-", esc(d.result), esc(d.findings || ""), esc(d.actions || "")]),
      ds.map(d => d.result === "ผ่าน" ? "ok" : "soon"));
  }
  $("#dy").onchange = rDrill;
  $("#fD").onsubmit = guard(async () => {
    const groups = [...document.querySelectorAll("#dG input:checked")].map(x => x.value), n = $("#dN").value, m = $("#dMin").value;
    const { error } = await sb.from("jci_drills").insert({ hospital_id: $("#h").value, code: $("#dC").value.trim(), held_on: $("#dD").value, shift: $("#dS").value, place: $("#dP").value.trim() || null,
      participants: n === "" ? null : +n, minutes: m === "" ? null : +m, groups, result: $("#dR").value, findings: $("#dF").value.trim() || null, actions: $("#dA").value.trim() || null, created_by: me.id });
    if (error) throw error; $("#fD").reset(); $("#dD").value = today(); $("#dMsg").textContent = "บันทึกแล้ว"; await load(); rDrill();
  });
  $("#dX").onclick = () => { const y = $("#dy").value, ds = drills.filter(d => d.held_on.startsWith(y)), S = summary();
    const qs = +y === +S.y ? [1, 2, 3, 4].filter(q => q <= S.q) : +y < +S.y ? [1, 2, 3, 4] : [];
    const gaps = qs.flatMap(q => SHIFTS.filter(s => !ds.some(d => quarter(d.held_on) === q && d.shift === s && isRed(d.code))).map(s => `ไตรมาส ${q}: ยังไม่มีการซ้อม Code Red กะ${s}`));
    Office.table(`JCI_ซ้อมCode_${hosp().code || ""}_${+y + 543}`, ["วันที่", "ไตรมาส", "กะ", "Code / เหตุการณ์", "สถานที่", "ผู้เข้าร่วม", "กลุ่ม", "นาที", "ผล", "สิ่งที่พบ", "สิ่งที่ต้องแก้ไข"],
      ds.map(d => [dTH(d.held_on), quarter(d.held_on), d.shift, d.code, d.place || "", d.participants ?? "", (d.groups || []).join(", "), d.minutes ?? "", d.result, d.findings || "", d.actions || ""]),
      { title: `บันทึกการซ้อม Code ปี ${+y + 543}`, period: period(), findings: [`ปี ${+y + 543} ซ้อมทั้งหมด ${ds.length} ครั้ง ผ่าน ${ds.filter(d => d.result === "ผ่าน").length} ครั้ง ต้องปรับปรุง ${ds.filter(d => d.result !== "ผ่าน").length} ครั้ง`, ...gaps],
        notes: ["JCI ต้องการซ้อมดับเพลิงทุกกะทุกไตรมาสในอาคารที่มีผู้ป่วย (FMS.06.01)", "KPI ข้อ 6 ของสัญญา: ซ้อม Code"] }); };
})();
