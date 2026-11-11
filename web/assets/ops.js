// Phase C: shift handover reports, daily intake summary, shift roster with check-in, monthly report book,
// knowledge base and the 12-hospital executive overview.
(() => {
  const { sb, $, esc, STATUS, OPEN, fmt, fmtDate, mins, dur, statusLabel, errText, opts, workMins } = RS;
  const MANAGER = ["owner", "admin", "chief_engineer", "supervisor"];
  const TABS = ["shift", "daily", "roster", "month", "kb", "exec"];
  const REP = { draft: "ร่าง", submitted: "ส่งแล้ว รอรับเวร", received: "รับเวรแล้ว" };
  let me = null, H = null, staff = [], types = [], prios = [], shifts = [], S = { late_grace_min: 15 }, exec = false, channel = null, kbEdit = null;
  const store = { get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
  const isMgr = () => me && MANAGER.includes(me.role);
  const can = () => me && me.role !== "observer";
  const day = d => new Date(d).toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
  const today = () => day(Date.now());
  const addDays = (d, n) => day(new Date(d + "T12:00:00+07:00").getTime() + n * 864e5);
  const bkk = d => d + "T00:00:00+07:00";
  const nameOf = id => (staff.find(s => s.id === id) || {}).full_name || "";
  const typeOf = id => (types.find(t => t.id === id) || {}).name || "ไม่ระบุ";
  const prioOf = j => prios.find(p => p.id === j.priority_id);
  const slaOf = j => (prioOf(j) || {}).sla_minutes || 1440;
  const hm = t => String(t || "").slice(0, 5);
  const win = (date, sh) => { const s = new Date(`${date}T${hm(sh.start_time)}:00+07:00`); let e = new Date(`${date}T${hm(sh.end_time)}:00+07:00`); if (e <= s) e = new Date(e.getTime() + 864e5); return [s, e]; };
  const baht = n => Number(n || 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const thDay = d => new Date(bkk(d)).toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok", weekday: "short", day: "numeric", month: "short" });
  const kpis = arr => `<div class="kpis">${arr.map(([a, b, red]) => `<div class="kpi"><b style="${red && +b > 0 ? "color:var(--bad)" : ""}">${b}</b><span>${a}</span></div>`).join("")}</div>`;
  const count = (arr, f) => Object.entries(arr.reduce((m, x) => { const k = f(x) || "ไม่ระบุ"; m[k] = (m[k] || 0) + 1; return m; }, {})).sort((a, b) => b[1] - a[1]);
  const bars = pairs => { const max = Math.max(1, ...pairs.map(p => p[1])); return pairs.length ? pairs.map(([k, v]) => `<div class="bar"><span>${esc(k)}</span><i style="width:${v / max * 100}%"></i><em>${v}</em></div>`).join("") : `<div class="empty">ยังไม่มีข้อมูล</div>`; };
  function toast(m) { $("#toast").textContent = m; $("#toast").hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => $("#toast").hidden = true, 6000); }
  function csv(name, head, rows) {
    const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const blob = new Blob(["﻿" + [head.map(q).join(","), ...rows.map(r => r.map(q).join(","))].join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a); a.click(); a.remove();
  }
  const fail = (el, e) => { $(el).innerHTML = `<div class="note bad">${esc(errText(e))}</div>`; };

  /* ---------- boot ---------- */
  sb.auth.onAuthStateChange((_e, session) => setTimeout(() => boot(session), 0));
  async function boot(session) {
    TABS.forEach(t => $("#tab-" + t).hidden = true); $("#tabs").hidden = true; $("#gate").hidden = true;
    if (channel) { sb.removeChannel(channel); channel = null; }
    if (!session) { $("#gate").hidden = false; return; }
    const { data } = await sb.from("profiles").select("id,full_name,role,hospital_id,hospitals(id,code,name)").eq("id", session.user.id).maybeSingle();
    me = data;
    if (!me || !me.hospital_id) { $("#gate").hidden = false; return; }
    H = me.hospitals;
    $("#title").textContent = "รายงานกะและเดือน · " + H.name; $("#who").textContent = me.full_name || session.user.email;
    const [s, t, p, sh, st, ex] = await Promise.all([
      sb.from("profiles").select("id,full_name,role,active").eq("hospital_id", H.id).order("full_name"),
      sb.from("job_types").select("*").eq("hospital_id", H.id).order("code"),
      sb.from("priorities").select("*").eq("hospital_id", H.id).order("sort").order("sla_minutes"),
      sb.from("shifts").select("*").eq("hospital_id", H.id).eq("active", true).order("sort"),
      sb.from("hospital_settings").select("*").eq("hospital_id", H.id).maybeSingle(),
      sb.rpc("am_exec")]);
    staff = s.data || []; types = t.data || []; prios = p.data || []; shifts = sh.data || []; if (st.data) S = st.data; exec = !!ex.data;
    $("#execTab").hidden = !exec;
    document.querySelectorAll("[data-manager]").forEach(b => b.hidden = !isMgr());
    $("#tabs").hidden = false;
    opts($("#raShift"), shifts.map(x => [x.id, `${x.name} ${hm(x.start_time)}–${hm(x.end_time)}`]));
    opts($("#raStaff"), staff.filter(x => x.active).map(x => [x.id, x.full_name || "(ไม่มีชื่อ)"]));
    opts($("#kbT"), [["", "ทุกประเภทงาน"], ...types.map(x => [x.id, x.name])]);
    opts($("#kbType"), [["", "ไม่ระบุ"], ...types.map(x => [x.id, x.name])]);
    $("#roGrace").value = S.late_grace_min ?? 15;
    channel = sb.channel("ops-" + H.id)
      .on("postgres_changes", { event: "*", schema: "public", table: "shift_reports", filter: "hospital_id=eq." + H.id }, () => { if (!$("#tab-shift").hidden && !document.querySelector("#shBody textarea:focus")) renderShift(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "shift_roster", filter: "hospital_id=eq." + H.id }, () => { if (!$("#tab-roster").hidden) renderRoster(); if (!$("#tab-shift").hidden) renderMine(); }).subscribe();
    const q = new URLSearchParams(location.search);
    show(q.get("tab") || store.get("rs-ops-tab", "shift"));
    if (q.get("job")) kbFromJob(q.get("job"));
  }
  document.querySelectorAll("#tabs button").forEach(b => b.onclick = () => show(b.dataset.tab));
  function show(t) {
    if (!TABS.includes(t) || (t === "exec" && !exec)) t = "shift";
    document.querySelectorAll("#tabs button").forEach(b => b.setAttribute("aria-selected", b.dataset.tab === t));
    TABS.forEach(x => $("#tab-" + x).hidden = x !== t);
    store.set("rs-ops-tab", t);
    ({ shift: renderShift, daily: renderDaily, roster: renderRoster, month: renderMonth, kb: renderKb, exec: renderExec })[t]();
  }
  ["#shDate", "#dyDate", "#roDate"].forEach(s => { $(s).value = today(); });
  $("#moMonth").value = today().slice(0, 7);
  $("#exFrom").value = today().slice(0, 8) + "01"; $("#exTo").value = today();
  $("#shDate").onchange = () => renderShift(); $("#dyDate").onchange = () => renderDaily(); $("#roDate").onchange = () => renderRoster();
  $("#moMonth").onchange = () => renderMonth(); $("#exFrom").onchange = $("#exTo").onchange = () => renderExec();
  ["#shPrint", "#dyPrint", "#moPrint", "#exPrint"].forEach(s => $(s).onclick = () => window.print());

  /* ---------- my shift today + check-in (shown on the shift and roster tabs) ---------- */
  async function myShiftsBox() {
    const d0 = addDays(today(), -1), d1 = today();
    const { data } = await sb.from("shift_roster").select("*").eq("profile_id", me.id).gte("work_date", d0).lte("work_date", d1);
    const now = new Date();
    const rows = (data || []).map(r => ({ r, sh: shifts.find(x => x.id === r.shift_id) })).filter(x => x.sh).map(x => ({ ...x, w: win(x.r.work_date, x.sh) }))
      .filter(x => now >= new Date(x.w[0].getTime() - 2 * 36e5) && now < x.w[1]);
    if (!rows.length) return "";
    return `<div class="note" style="margin-bottom:14px">${rows.map(({ r, sh, w }) => `กะ${esc(sh.name)}ของคุณ ${thDay(r.work_date)} ${hm(sh.start_time)}–${hm(sh.end_time)} · ${r.check_in_at
      ? `ลงเวลาแล้ว ${fmt(r.check_in_at)}${lateMin(r, w[0]) > 0 ? ` <b style="color:var(--bad)">สาย ${lateMin(r, w[0])} นาที</b>` : ""}`
      : `<button class="btn small primary" data-checkin="${r.id}">ลงเวลาเข้างาน</button>`}`).join("<br>")}</div>`;
  }
  const lateMin = (r, start) => r.check_in_at ? Math.max(0, mins(start.toISOString(), r.check_in_at) - (S.late_grace_min ?? 15)) : 0;
  async function renderMine() { const h = await myShiftsBox(); $("#shMine").innerHTML = h; $("#roMine").innerHTML = h; }
  document.addEventListener("click", async e => {
    const t = e.target.closest("[data-checkin]"); if (!t) return;
    t.disabled = true;
    const { error } = await sb.rpc("roster_checkin", { p_roster_id: t.dataset.checkin });
    if (error) { t.disabled = false; return alert(errText(error)); }
    toast("ลงเวลาเข้างานแล้ว"); renderMine(); if (!$("#tab-roster").hidden) renderRoster();
  });

  /* ---------- shift reports ---------- */
  let shOpen = null, openJobs = [];
  async function renderShift() {
    renderMine();
    const d = $("#shDate").value || today();
    $("#shBody").innerHTML = `<div class="empty">กำลังโหลด…</div>`;
    const [r, ro, oj] = await Promise.all([
      sb.from("shift_reports").select("*").eq("hospital_id", H.id).eq("work_date", d),
      sb.from("shift_roster").select("*").eq("hospital_id", H.id).eq("work_date", d),
      sb.from("jobs").select("id,job_no,detail,department,status,accepted_at,hold_category,hold_until,created_at,technician_id").eq("hospital_id", H.id).in("status", ["register", "assign", "work_on", "on_hold", "clear"]).order("created_at").limit(500)]);
    if (r.error) return fail("#shBody", r.error);
    openJobs = oj.data || [];
    const reps = r.data || [], roster = ro.data || [];
    const live = await Promise.all(shifts.map(sh => { const rep = reps.find(x => x.shift_id === sh.id); return rep && rep.status !== "draft" ? Promise.resolve({ data: rep.stats }) : sb.rpc("shift_stats", { p_date: d, p_shift_id: sh.id }); }));
    const now = new Date();
    $("#shBody").innerHTML = `<p class="meta">${esc(H.name)} · งานวิศวกรรมอาคาร · รายงานประจำวันที่ ${fmtDate(d)}</p>` + shifts.map((sh, i) => {
      const rep = reps.find(x => x.shift_id === sh.id), st = live[i].data || {}, w = win(d, sh), crew = roster.filter(x => x.shift_id === sh.id);
      const started = now >= w[0], ended = now >= w[1];
      const status = rep ? REP[rep.status] : ended ? "ยังไม่มีรายงาน" : started ? "กำลังอยู่ในกะ" : "ยังไม่ถึงเวลา";
      const nums = [["รับแจ้ง", st.received], ["มอบหมาย", st.assigned], ["เริ่มซ่อม", st.started], ["พักงาน", st.held], ["ซ่อมเสร็จ", st.cleared], ["ปิดงาน", st.closed], ["ค้างเมื่อจบกะ", st.open_end]];
      let acts = "";
      if (can() && (!rep || rep.status !== "received") && (!rep || rep.author_id === me.id || isMgr()) && started) acts += `<button class="btn small${rep ? "" : " primary"}" data-sh="${sh.id}:edit">${rep ? "แก้ไขรายงาน" : "เขียนรายงานกะนี้"}</button>`;
      if (can() && rep && rep.status === "submitted" && rep.author_id !== me.id) acts += `<button class="btn small primary" data-sh="${sh.id}:receive">รับเวร</button>`;
      const form = shOpen && shOpen.id === sh.id ? shForm(sh, rep) : "";
      return `<div class="ib" style="break-inside:avoid"><div class="row" style="justify-content:space-between"><h3 style="margin:0">กะ${esc(sh.name)} ${hm(sh.start_time)}–${hm(sh.end_time)}</h3><span class="st ${rep ? rep.status : ""}">${status}</span></div>
        <div class="meta"><span>ในกะ: ${crew.length ? crew.map(c => esc(nameOf(c.profile_id)) + (c.check_in_at ? ` (${new Date(c.check_in_at).toLocaleTimeString("th-TH", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit" })})` : "")).join(", ") : "ยังไม่ได้จัดตารางกะ"}</span>
          ${rep ? `<span>ผู้เขียน ${esc(nameOf(rep.author_id))}${rep.submitted_at ? " · ส่ง " + fmt(rep.submitted_at) : ""}</span>` : ""}${rep && rep.received_by ? `<span>รับเวรโดย ${esc(nameOf(rep.received_by))} ${fmt(rep.received_at)}${rep.received_note ? " · " + esc(rep.received_note) : ""}</span>` : ""}</div>
        <div class="kpis k7">${nums.map(([a, b]) => `<div class="kpi"><b>${b ?? 0}</b><span>${a}</span></div>`).join("")}</div>
        ${(st.received_jobs || []).length ? `<div class="meta">ใบงานที่รับแจ้งในกะ: <span class="mono">${st.received_jobs.map(esc).join(" ")}</span></div>` : ""}
        ${(st.cleared_jobs || []).length ? `<div class="meta">ซ่อมเสร็จ / ปิดในกะ: <span class="mono">${st.cleared_jobs.map(esc).join(" ")}</span></div>` : ""}
        ${rep && rep.notes ? `<p style="white-space:pre-wrap;margin:8px 0 0"><b>เหตุการณ์สำคัญ:</b> ${esc(rep.notes)}</p>` : ""}
        ${rep && rep.issues ? `<p style="white-space:pre-wrap;margin:8px 0 0"><b>ปัญหา / อุปกรณ์ผิดปกติ:</b> ${esc(rep.issues)}</p>` : ""}
        ${rep && rep.handover ? `<p style="white-space:pre-wrap;margin:8px 0 0"><b>ส่งเวร (งานที่ต้องตามต่อ):</b> ${esc(rep.handover)}</p>` : ""}
        ${acts ? `<div class="acts noprint" style="margin-top:10px">${acts}</div>` : ""}${form}</div>`;
    }).join("") + `<div class="sign" style="display:none"></div>`;
  }
  function shForm(sh, rep) {
    if (shOpen.act === "receive") return `<div class="inline noprint" style="margin-top:10px"><label class="span2">หมายเหตุการรับเวร<input id="shRecv" placeholder="เช่น รับทราบงานค้าง 3 ใบ"></label>
      <div class="row" style="align-self:end"><button class="btn primary small" data-shok="${sh.id}:receive:${rep.id}">ยืนยันรับเวร</button><button class="btn small" type="button" data-shclose>ปิด</button></div></div>`;
    return `<div class="inline noprint" style="margin-top:10px;grid-template-columns:minmax(0,1fr)">
      <label>เหตุการณ์สำคัญในกะ<textarea id="shNotes" rows="3" placeholder="เช่น ไฟฟ้าดับ 10 นาที เครื่องปั่นไฟทำงานปกติ">${esc(rep ? rep.notes || "" : "")}</textarea></label>
      <label>ปัญหา / อุปกรณ์ผิดปกติ<textarea id="shIssues" rows="2" placeholder="เช่น ปั๊มน้ำ P2 เสียงดัง">${esc(rep ? rep.issues || "" : "")}</textarea></label>
      <label>ส่งเวร: งานที่กะถัดไปต้องตามต่อ<textarea id="shHand" rows="4">${esc(rep ? rep.handover || "" : "")}</textarea></label>
      <div class="row"><button class="btn small" type="button" data-shfill>ใส่รายการงานค้างให้อัตโนมัติ</button><span class="meta">ตัวเลขงานซ่อมจะคำนวณใหม่ทุกครั้งที่บันทึก</span></div>
      <div class="row"><button class="btn small" data-shok="${sh.id}:draft">บันทึกร่าง</button><button class="btn primary small" data-shok="${sh.id}:submit">ส่งรายงานกะ</button><button class="btn small" type="button" data-shclose>ยกเลิก</button></div></div>`;
  }
  document.addEventListener("click", async e => {
    const t = e.target.closest("[data-sh],[data-shok],[data-shclose],[data-shfill]"); if (!t) return;
    e.preventDefault();
    if (t.dataset.shclose !== undefined) { shOpen = null; return renderShift(); }
    if (t.dataset.shfill !== undefined) {
      const lines = openJobs.map(j => `- ${j.job_no} ${j.department || ""}: ${(j.detail || "").slice(0, 60)} [${statusLabel(j)}${j.hold_category ? " / " + j.hold_category : ""}${j.hold_until ? " นัด " + fmtDate(j.hold_until) : ""}]`);
      const el = $("#shHand"); el.value = (el.value ? el.value.trim() + "\n" : "") + (lines.length ? `งานค้าง ${lines.length} ใบ\n` + lines.join("\n") : "ไม่มีงานค้าง"); return;
    }
    if (t.dataset.sh) { const [id, act] = t.dataset.sh.split(":"); shOpen = shOpen && shOpen.id === id && shOpen.act === act ? null : { id, act }; return renderShift(); }
    const [id, a, rid] = t.dataset.shok.split(":"), d = $("#shDate").value || today();
    t.disabled = true;
    const r = a === "receive" ? await sb.rpc("shift_report_receive", { p_id: rid, p_note: $("#shRecv").value || null })
      : await sb.rpc("shift_report_save", { p_date: d, p_shift_id: id, p_notes: $("#shNotes").value, p_handover: $("#shHand").value, p_issues: $("#shIssues").value, p_submit: a === "submit" });
    if (r.error) { t.disabled = false; return alert(errText(r.error)); }
    shOpen = null; toast(a === "receive" ? "รับเวรแล้ว" : a === "submit" ? "ส่งรายงานกะแล้ว" : "บันทึกร่างแล้ว"); renderShift();
  });

  /* ---------- daily intake summary ---------- */
  let dyRows = [];
  async function renderDaily() {
    const d = $("#dyDate").value || today(), s = bkk(d), e = bkk(addDays(d, 1));
    $("#dyBody").innerHTML = `<div class="empty">กำลังโหลด…</div>`;
    const [a, b] = await Promise.all([
      sb.from("jobs").select("*").eq("hospital_id", H.id).gte("created_at", s).lt("created_at", e).order("created_at"),
      sb.from("jobs").select("id,job_no,status,cleared_at,closed_at").eq("hospital_id", H.id).or(`and(cleared_at.gte.${s},cleared_at.lt.${e}),and(closed_at.gte.${s},closed_at.lt.${e})`)]);
    if (a.error) return fail("#dyBody", a.error);
    const rows = dyRows = a.data || [], done = b.data || [];
    const inDay = x => x && new Date(x) >= new Date(s) && new Date(x) < new Date(e);
    const open = rows.filter(j => OPEN.includes(j.status)), late = open.filter(j => ["register", "assign", "work_on", "on_hold"].includes(j.status) && workMins(j) > slaOf(j));
    $("#dyBody").innerHTML = `<p class="meta">${esc(H.name)} · สรุปงานรับแจ้งวันที่ ${fmtDate(d)} · ข้อมูล ณ ${fmt(new Date().toISOString())}</p>` +
      kpis([["รับแจ้งวันนี้", rows.length], ["ยังไม่มีคนรับ", rows.filter(j => j.status === "register").length, 1], ["ซ่อมเสร็จวันนี้", done.filter(j => inDay(j.cleared_at)).length],
        ["ปิดงานวันนี้", done.filter(j => j.status === "close" && inDay(j.closed_at)).length], ["งานของวันนี้ที่ยังค้าง", open.length], ["เกิน SLA", late.length, 1]]) +
      `<div class="two"><div class="panel"><h3>ตามประเภทงาน</h3>${bars(count(rows, j => typeOf(j.job_type_id)))}</div><div class="panel"><h3>ตามอาคาร</h3>${bars(count(rows, j => j.building))}</div>
        <div class="panel"><h3>ตามความเร่งด่วน</h3>${bars(count(rows, j => (prioOf(j) || {}).name))}</div><div class="panel"><h3>ตามช่วงเวลา</h3>${bars(count(rows, j => { const h = +new Date(j.created_at).toLocaleString("en-GB", { timeZone: "Asia/Bangkok", hour: "2-digit", hour12: false }); return h < 8 ? "00–08 (ดึก)" : h < 16 ? "08–16 (เช้า)" : "16–24 (บ่าย)"; }))}</div></div>
      <h3 class="grp">ใบงานที่รับแจ้งวันนี้ (${rows.length})</h3><div class="scroll"><table><tr><th>เลขใบงาน</th><th>เวลา</th><th>แผนก</th><th>รายละเอียด</th><th>ประเภท</th><th>ช่าง</th><th>สถานะ</th></tr>
      ${rows.map(j => `<tr${late.includes(j) ? ' class="low"' : ""}><td class="mono">${esc(j.job_no)}</td><td>${fmt(j.created_at)}</td><td>${esc([j.building, j.department].filter(Boolean).join(" · "))}</td><td>${esc(j.detail)}</td><td>${esc(typeOf(j.job_type_id))}</td><td>${esc(nameOf(j.technician_id))}</td><td>${esc(statusLabel(j))}</td></tr>`).join("") || `<tr><td colspan="7"><div class="empty">ไม่มีการแจ้งซ่อมในวันนี้</div></td></tr>`}</table></div>`;
  }
  $("#dyExport").onclick = () => csv(`สรุปรับแจ้ง-${H.code}-${$("#dyDate").value}.csv`, ["เลขใบงาน", "เวลาแจ้ง", "อาคาร", "ชั้น", "แผนก", "รายละเอียด", "ประเภทงาน", "ความเร่งด่วน", "ช่าง", "สถานะ"],
    dyRows.map(j => [j.job_no, fmt(j.created_at), j.building, j.floor, j.department, j.detail, typeOf(j.job_type_id), (prioOf(j) || {}).name, nameOf(j.technician_id), statusLabel(j)]));

  /* ---------- roster ---------- */
  // Monday of the week; noon Bangkok time is the same calendar day in UTC
  const weekStart = d => addDays(d, -((new Date(d + "T12:00:00+07:00").getUTCDay() + 6) % 7));
  async function renderRoster() {
    renderMine();
    const w0 = weekStart($("#roDate").value || today()), days = [...Array(7)].map((_, i) => addDays(w0, i));
    if (!$("#raDate").value) $("#raDate").value = $("#roDate").value || today();
    const m0 = w0.slice(0, 8) + "01", m1 = addDays(addDays(m0, 32).slice(0, 8) + "01", -1);
    const [r, rm] = await Promise.all([
      sb.from("shift_roster").select("*").eq("hospital_id", H.id).gte("work_date", w0).lte("work_date", days[6]),
      sb.from("shift_roster").select("*").eq("hospital_id", H.id).gte("work_date", m0).lte("work_date", m1)]);
    if (r.error) return fail("#roTable", r.error);
    const rows = r.data || [], now = new Date();
    $("#roTable").innerHTML = `<tr><th>กะ</th>${days.map(d => `<th${d === today() ? ' style="color:var(--accent)"' : ""}>${thDay(d)}</th>`).join("")}</tr>` + shifts.map(sh => `<tr><td><b>${esc(sh.name)}</b><br><small>${hm(sh.start_time)}–${hm(sh.end_time)}</small></td>${days.map(d => {
      const w = win(d, sh);
      return `<td style="vertical-align:top;min-width:120px">${rows.filter(x => x.work_date === d && x.shift_id === sh.id).map(x => {
        const lm = lateMin(x, w[0]), miss = !x.check_in_at && now > w[1];
        return `<div style="white-space:nowrap">${esc(nameOf(x.profile_id))}${x.check_in_at ? ` <small style="color:${lm ? "var(--bad)" : "var(--s-work_on)"}">✓${new Date(x.check_in_at).toLocaleTimeString("th-TH", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit" })}${lm ? " สาย " + lm + "น." : ""}</small>` : miss ? ' <small style="color:var(--bad)">ไม่ได้ลงเวลา</small>' : ""}
          ${x.profile_id === me.id && !x.check_in_at && now >= new Date(w[0].getTime() - 2 * 36e5) && now < w[1] ? `<button class="btn small primary" data-checkin="${x.id}">ลงเวลา</button>` : ""}
          ${isMgr() && !x.check_in_at ? `<button class="btn small noprint" data-rodel="${x.id}" title="เอาออก">×</button>` : ""}</div>`; }).join("") || '<small class="meta">-</small>'}</td>`; }).join("")}</tr>`).join("");
    const g = {};
    (rm.data || []).forEach(x => { const sh = shifts.find(s => s.id === x.shift_id); if (!sh) return; const w = win(x.work_date, sh); if (now < w[0]) return;
      const k = x.profile_id; g[k] = g[k] || { n: 0, ok: 0, late: 0, lateMin: 0, miss: 0 }; g[k].n++;
      if (x.check_in_at) { const lm = lateMin(x, w[0]); if (lm) { g[k].late++; g[k].lateMin += lm; } else g[k].ok++; } else if (now > w[1]) g[k].miss++; });
    $("#roLate").innerHTML = `<tr><th>เจ้าหน้าที่</th><th class="num">กะที่ผ่านมา</th><th class="num">ตรงเวลา</th><th class="num">สาย</th><th class="num">รวมนาทีที่สาย</th><th class="num">ไม่ได้ลงเวลา</th></tr>` +
      (Object.entries(g).sort((a, b) => b[1].late - a[1].late).map(([id, v]) => `<tr><td>${esc(nameOf(id))}</td><td class="num">${v.n}</td><td class="num">${v.ok}</td><td class="num"${v.late ? ' style="color:var(--bad)"' : ""}>${v.late}</td><td class="num">${v.lateMin}</td><td class="num">${v.miss}</td></tr>`).join("") || `<tr><td colspan="6"><div class="empty">ยังไม่มีข้อมูลเดือนนี้</div></td></tr>`);
  }
  $("#roAdd").onsubmit = async e => {
    e.preventDefault();
    const { error } = await sb.from("shift_roster").insert({ hospital_id: H.id, work_date: $("#raDate").value, shift_id: $("#raShift").value, profile_id: $("#raStaff").value });
    $("#roMsg").innerHTML = error ? `<div class="note bad">${esc(error.code === "23505" ? "คนนี้อยู่ในกะนี้แล้ว" : errText(error))}</div>` : "";
    if (!error) { toast("เพิ่มเข้ากะแล้ว"); renderRoster(); }
  };
  $("#roCopy").onclick = async () => {
    const w0 = weekStart($("#roDate").value || today()), p0 = addDays(w0, -7);
    const { data, error } = await sb.from("shift_roster").select("work_date,shift_id,profile_id").eq("hospital_id", H.id).gte("work_date", p0).lte("work_date", addDays(p0, 6));
    if (error) return alert(errText(error));
    if (!data.length) return alert("สัปดาห์ก่อนยังไม่มีตารางกะ");
    if (!confirm(`คัดลอก ${data.length} รายการจากสัปดาห์ก่อนมาใส่สัปดาห์นี้ (คนที่มีอยู่แล้วจะไม่ซ้ำ)`)) return;
    const rows = data.map(x => ({ hospital_id: H.id, work_date: addDays(x.work_date, 7), shift_id: x.shift_id, profile_id: x.profile_id }));
    const r = await sb.from("shift_roster").upsert(rows, { onConflict: "work_date,shift_id,profile_id", ignoreDuplicates: true });
    if (r.error) return alert(errText(r.error));
    toast("คัดลอกตารางกะแล้ว"); renderRoster();
  };
  $("#roGraceSave").onclick = async () => {
    const v = Math.max(0, +$("#roGrace").value || 0);
    const { error } = await sb.from("hospital_settings").update({ late_grace_min: v, updated_at: new Date().toISOString() }).eq("hospital_id", H.id);
    if (error) return alert(errText(error)); S.late_grace_min = v; toast("บันทึกแล้ว"); renderRoster();
  };
  document.addEventListener("click", async e => {
    const t = e.target.closest("[data-rodel]"); if (!t) return;
    if (!confirm("เอาคนนี้ออกจากกะ?")) return;
    const { error } = await sb.from("shift_roster").delete().eq("id", t.dataset.rodel);
    if (error) return alert(errText(error)); renderRoster();
  });

  /* ---------- monthly report book ---------- */
  let moJobs = [];
  async function renderMonth() {
    const m = $("#moMonth").value || today().slice(0, 7), d0 = m + "-01", d1 = addDays(addDays(d0, 32).slice(0, 8) + "01", 0), s = bkk(d0), e = bkk(d1);
    $("#moBody").innerHTML = `<div class="empty">กำลังโหลด…</div>`;
    const [a, b, c, pr, mm, sr, nt, kb] = await Promise.all([
      sb.from("jobs").select("*").eq("hospital_id", H.id).gte("created_at", s).lt("created_at", e).order("created_at").limit(5000),
      sb.from("jobs").select("*").eq("hospital_id", H.id).lt("created_at", e).neq("status", "cancel").or(`closed_at.is.null,closed_at.gte.${e}`).limit(5000),
      sb.from("part_moves").select("*").eq("hospital_id", H.id).gte("created_at", s).lt("created_at", e).limit(5000),
      sb.from("purchase_requests").select("*").eq("hospital_id", H.id).gte("created_at", s).lt("created_at", e),
      sb.from("memos").select("id,status,amount").eq("hospital_id", H.id).gte("created_at", s).lt("created_at", e),
      sb.from("shift_reports").select("id,status,work_date").eq("hospital_id", H.id).gte("work_date", d0).lt("work_date", d1),
      sb.from("monthly_notes").select("*").eq("hospital_id", H.id).eq("month", m).maybeSingle(),
      sb.from("kb_articles").select("id").eq("hospital_id", H.id).gte("created_at", s).lt("created_at", e)]);
    if (a.error) return fail("#moBody", a.error);
    const jobs = moJobs = a.data || [], openEnd = (b.data || []).filter(j => j.status !== "close" || !j.closed_at || j.closed_at >= e), moves = c.data || [];
    const pids = [...new Set(moves.map(x => x.part_id))], parts = pids.length ? ((await sb.from("parts").select("id,code,name,unit").in("id", pids)).data || []) : [];
    const cleared = jobs.filter(j => j.cleared_at), closed = jobs.filter(j => j.status === "close" && j.closed_at);
    const slaOk = cleared.filter(j => workMins(j, j.cleared_at) <= slaOf(j)).length;
    const rated = jobs.filter(j => j.rating), cost = moves.filter(x => x.kind === "issue" || x.kind === "return").reduce((t, x) => t - x.qty * x.unit_cost, 0);
    const daysSoFar = Math.max(0, Math.min(Math.round((new Date(e) - new Date(s)) / 864e5), Math.ceil((Date.now() - new Date(s)) / 864e5)));
    const shiftSent = (sr.data || []).filter(x => x.status !== "draft").length, prs = pr.data || [], memos = mm.data || [];
    const pct = (x, n) => n ? Math.round(x / n * 100) + "%" : "-";
    const avg = l => l.length ? dur(Math.round(l.reduce((t, j) => t + workMins(j, j.closed_at || j.cleared_at), 0) / l.length)) : "-";
    const monthTh = new Date(bkk(d0)).toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok", month: "long", year: "numeric" });
    const tbl = (head, rows, empty) => `<div class="scroll"><table><tr>${head.map(h => `<th${/^#|จำนวน|เฉลี่ย|%|บาท|ใบ|คะแนน/.test(h) ? ' class="num"' : ""}>${h}</th>`).join("")}</tr>${rows.length ? rows.map(r => `<tr>${r.map((v, i) => `<td${i ? ' class="num"' : ""}>${v}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${head.length}"><div class="empty">${empty || "ไม่มีข้อมูล"}</div></td></tr>`}</table></div>`;
    const byType = types.map(t => { const l = jobs.filter(j => j.job_type_id === t.id); return [esc(t.name), l.length, l.filter(j => j.cleared_at).length, avg(l.filter(j => j.closed_at || j.cleared_at))]; }).filter(r => r[1]);
    const untyped = jobs.filter(j => !j.job_type_id); if (untyped.length) byType.push(["ไม่ระบุ", untyped.length, untyped.filter(j => j.cleared_at).length, avg(untyped.filter(j => j.closed_at || j.cleared_at))]);
    const slaRows = prios.map(p => { const l = cleared.filter(j => j.priority_id === p.id), ok = l.filter(j => workMins(j, j.cleared_at) <= p.sla_minutes).length; return [esc(p.name) + ` (${dur(p.sla_minutes)})`, jobs.filter(j => j.priority_id === p.id).length, l.length, ok, pct(ok, l.length)]; });
    const repeat = count(jobs.filter(j => j.equipment_text), j => j.equipment_text).filter(x => x[1] > 1).slice(0, 10);
    const techs = {}; jobs.filter(j => j.technician_id).forEach(j => { const t = techs[j.technician_id] = techs[j.technician_id] || { n: 0, done: [], r: [] }; t.n++; if (j.cleared_at) t.done.push(j); if (j.rating) t.r.push(j.rating); });
    const pc = {}; moves.filter(x => x.kind === "issue" || x.kind === "return").forEach(x => { const p = parts.find(y => y.id === x.part_id) || {}; const k = x.part_id; pc[k] = pc[k] || { name: `${p.code || ""} ${p.name || "?"}`, unit: p.unit || "", q: 0, c: 0 }; pc[k].q -= x.qty; pc[k].c -= x.qty * x.unit_cost; });
    const notes = nt.data || {};
    $("#moBody").innerHTML = `<div class="panel" style="text-align:center;margin-bottom:16px"><h2 style="margin:0">รายงานประจำเดือน ${esc(monthTh)}</h2><div class="sub" style="margin:4px 0 0">งานวิศวกรรมอาคาร ${esc(H.name)} · พิมพ์เมื่อ ${fmt(new Date().toISOString())}</div></div>
      <h3 class="grp">1. สรุปตัวเลขสำคัญ</h3>${kpis([["รับแจ้งทั้งเดือน", jobs.length], ["ซ่อมเสร็จ", cleared.length], ["ปิดงาน", closed.length], ["ค้าง ณ สิ้นเดือน", openEnd.length, 1],
        ["ซ่อมเสร็จทัน SLA", pct(slaOk, cleared.length)], ["เวลาปิดงานเฉลี่ย", avg(closed)], ["ความพึงพอใจเฉลี่ย", rated.length ? (rated.reduce((t, j) => t + j.rating, 0) / rated.length).toFixed(2) + " / 5" : "-"], ["ผู้แจ้งประเมิน", rated.length],
        ["ค่าอะไหล่ที่เบิกใช้ (บาท)", baht(cost)], ["ใบขอซื้อ", prs.length], ["Memo", memos.length], ["รายงานกะที่ส่ง", `${shiftSent} / ${daysSoFar * shifts.length}`]])}
      <h3 class="grp">2. SLA ตามความเร่งด่วน</h3>${tbl(["ความเร่งด่วน", "จำนวนใบ", "ซ่อมเสร็จ", "ทันเวลา", "% ทัน SLA"], slaRows)}
      <h3 class="grp">3. งานตามประเภท</h3>${tbl(["ประเภทงาน", "จำนวนใบ", "ซ่อมเสร็จ", "เวลาเฉลี่ย"], byType)}
      <div class="two"><div><h3 class="grp">4. อาคารที่แจ้งมากที่สุด</h3>${tbl(["อาคาร", "จำนวนใบ"], count(jobs, j => j.building).slice(0, 10).map(([k, v]) => [esc(k), v]))}</div>
        <div><h3 class="grp">5. แผนกที่แจ้งมากที่สุด</h3>${tbl(["แผนก", "จำนวนใบ"], count(jobs, j => j.department).slice(0, 10).map(([k, v]) => [esc(k), v]))}</div></div>
      <h3 class="grp">6. เครื่อง / อุปกรณ์ที่แจ้งซ่อมซ้ำ</h3>${tbl(["เครื่อง / อุปกรณ์", "จำนวนใบ"], repeat.map(([k, v]) => [esc(k), v]), "ไม่มีเครื่องที่แจ้งซ้ำในเดือนนี้")}
      <h3 class="grp">7. ผลงานช่าง (หัวหน้างานของใบ)</h3>${tbl(["ช่าง", "จำนวนใบ", "ซ่อมเสร็จ", "เวลาเฉลี่ย", "คะแนนเฉลี่ย"], Object.entries(techs).sort((x, y) => y[1].n - x[1].n).map(([id, t]) => [esc(nameOf(id) || "-"), t.n, t.done.length, avg(t.done), t.r.length ? (t.r.reduce((x, y) => x + y, 0) / t.r.length).toFixed(2) : "-"]))}
      <div class="two"><div><h3 class="grp">8. เหตุผลพักงาน</h3>${tbl(["เหตุผล", "จำนวนใบ"], count(jobs.filter(j => j.hold_category), j => j.hold_category).map(([k, v]) => [esc(k), v]), "ไม่มีการพักงาน")}</div>
        <div><h3 class="grp">9. อะไหล่ที่ใช้มากที่สุด</h3>${tbl(["อะไหล่", "จำนวน", "บาท"], Object.values(pc).filter(x => x.q > 0).sort((x, y) => y.c - x.c).slice(0, 10).map(x => [esc(x.name), `${x.q} ${esc(x.unit)}`, baht(x.c)]), "ไม่มีการเบิกอะไหล่")}</div></div>
      <h3 class="grp">10. ใบขอซื้อและ Memo</h3>${tbl(["รายการ", "จำนวน", "มูลค่า (บาท)"], [["ใบขอซื้อทั้งหมด", prs.length, baht(prs.reduce((t, x) => t + +x.total, 0))], ["ใบขอซื้อที่อนุมัติ", prs.filter(x => ["approved", "ordered", "received"].includes(x.status)).length, baht(prs.filter(x => ["approved", "ordered", "received"].includes(x.status)).reduce((t, x) => t + +x.total, 0))],
        ["ใบขอซื้อรออนุมัติ", prs.filter(x => x.status === "requested").length, "-"], ["Memo ทั้งหมด", memos.length, baht(memos.reduce((t, x) => t + (+x.amount || 0), 0))], ["Memo ที่อนุมัติ", memos.filter(x => x.status === "approved").length, "-"]])}
      <h3 class="grp">11. ความคิดเห็นจากผู้แจ้ง</h3>${rated.filter(j => j.rating_comment).length ? `<ul>${rated.filter(j => j.rating_comment).slice(0, 30).map(j => `<li>${"★".repeat(j.rating)} ${esc(j.rating_comment)} <small class="mono">${esc(j.job_no)}</small></li>`).join("")}</ul>` : `<div class="empty">ไม่มีความคิดเห็น</div>`}
      <p class="meta">วิธีแก้ที่บันทึกเข้าคลังเดือนนี้ ${(kb.data || []).length} เรื่อง</p>
      <h3 class="grp">12. บทสรุปของหัวหน้างาน และแผนเดือนถัดไป</h3>
      ${isMgr() ? `<div class="noprint" style="display:grid;gap:10px"><label>บทสรุป ปัญหาสำคัญ และสิ่งที่ปรับปรุง<textarea id="moSum" rows="4">${esc(notes.summary || "")}</textarea></label><label>แผนเดือนถัดไป<textarea id="moPlan" rows="3">${esc(notes.plan || "")}</textarea></label><div class="row"><button class="btn primary small" type="button" id="moSave">บันทึกบทสรุป</button></div></div>` : ""}
      <div class="${isMgr() ? "printonly" : ""}"><p style="white-space:pre-wrap"><b>บทสรุป:</b> ${esc(notes.summary || "-")}</p><p style="white-space:pre-wrap"><b>แผนเดือนถัดไป:</b> ${esc(notes.plan || "-")}</p></div>
      <div class="row" style="justify-content:space-around;margin-top:48px;text-align:center"><div>ลงชื่อ ........................................<br>หัวหน้างานวิศวกรรมอาคาร</div><div>ลงชื่อ ........................................<br>ผู้บริหาร</div></div>`;
    if ($("#moSave")) $("#moSave").onclick = async () => {
      const { error } = await sb.from("monthly_notes").upsert({ hospital_id: H.id, month: m, summary: $("#moSum").value.trim() || null, plan: $("#moPlan").value.trim() || null, updated_by: me.id, updated_at: new Date().toISOString() });
      if (error) return alert(errText(error)); toast("บันทึกบทสรุปแล้ว"); renderMonth();
    };
  }
  $("#moExport").onclick = () => csv(`ใบงาน-${H.code}-${$("#moMonth").value}.csv`, ["เลขใบงาน", "วันที่แจ้ง", "อาคาร", "ชั้น", "แผนก", "อุปกรณ์", "รายละเอียด", "ประเภทงาน", "ความเร่งด่วน", "สถานะ", "ช่าง", "เหตุผลพักงาน", "สรุปการซ่อม", "เวลาทำงาน (นาที)", "SLA (นาที)", "ทัน SLA", "ปิดงาน", "คะแนน"],
    moJobs.map(j => [j.job_no, fmt(j.created_at), j.building, j.floor, j.department, j.equipment_text, j.detail, typeOf(j.job_type_id), (prioOf(j) || {}).name, statusLabel(j), nameOf(j.technician_id), j.hold_category, j.summary, workMins(j), slaOf(j), workMins(j) <= slaOf(j) ? "ทัน" : "ไม่ทัน", fmt(j.closed_at), j.rating || ""]));

  /* ---------- knowledge base ---------- */
  let kb = [], kbJobs = [];
  ["#kbQ", "#kbT", "#kbS"].forEach(s => $(s).addEventListener(s === "#kbQ" ? "input" : "change", drawKb));
  async function renderKb() {
    const [a, b] = await Promise.all([
      sb.from("kb_articles").select("*, hospitals(code,name)").eq("active", true).order("created_at", { ascending: false }).limit(1000),
      sb.from("jobs").select("id,job_no,detail,equipment_text,job_type_id,summary,hold_category").eq("hospital_id", H.id).in("status", ["clear", "close"]).not("summary", "is", null).order("cleared_at", { ascending: false }).limit(300)]);
    if (a.error) return fail("#kbList", a.error);
    kb = a.data || []; kbJobs = b.data || [];
    opts($("#kbJob"), [["", "— ไม่ดึงจากใบงาน —"], ...kbJobs.map(j => [j.id, `${j.job_no} · ${(j.detail || "").slice(0, 50)}`])]);
    $("#kbBox").hidden = !can();
    drawKb();
  }
  function drawKb() {
    const q = $("#kbQ").value.trim().toLowerCase(), t = $("#kbT").value, s = $("#kbS").value;
    const words = q.split(/\s+/).filter(Boolean);
    const list = kb.filter(k => (!t || k.job_type_id === t) && (!s || (s === "own" ? k.hospital_id === H.id : k.hospital_id !== H.id))
      && words.every(w => [k.title, k.equipment_text, k.symptom, k.cause, k.solution, k.tags].some(x => String(x || "").toLowerCase().includes(w))));
    $("#kbList").innerHTML = `<p class="meta">พบ ${list.length} เรื่อง</p>` + (list.map(k => {
      const own = k.hospital_id === H.id, edit = own && can() && (k.author_id === me.id || isMgr());
      return `<div class="ib"><div class="meta">${own ? "" : `<b>${esc(k.hospitals ? k.hospitals.name : "โรงอื่น")}</b>`}<span>${esc(own ? typeOf(k.job_type_id) : "")}</span>${k.equipment_text ? `<span>เครื่อง: ${esc(k.equipment_text)}</span>` : ""}<span>${fmtDate(day(k.created_at))}${own ? " · " + esc(nameOf(k.author_id)) : ""}</span>${k.shared ? "<span>แชร์ทุกโรง</span>" : ""}</div>
        <h4>${esc(k.title)}</h4>${k.symptom ? `<div><b>อาการ:</b> ${esc(k.symptom)}</div>` : ""}${k.cause ? `<div><b>สาเหตุ:</b> ${esc(k.cause)}</div>` : ""}<div style="white-space:pre-wrap"><b>วิธีแก้:</b> ${esc(k.solution)}</div>
        ${k.tags ? `<div class="meta">${k.tags.split(/\s+/).filter(Boolean).map(x => `<span class="st">${esc(x)}</span>`).join(" ")}</div>` : ""}
        ${edit ? `<div class="row noprint" style="margin-top:8px"><button class="btn small" data-kbedit="${k.id}">แก้ไข</button><button class="btn small" data-kbhide="${k.id}">ซ่อน</button></div>` : ""}</div>`;
    }).join("") || `<div class="empty">${kb.length ? "ไม่พบเรื่องที่ค้นหา" : "ยังไม่มีวิธีแก้ในคลัง กด “+ เพิ่มวิธีแก้” ด้านบน"}</div>`);
  }
  function kbFill(j) {
    if (!j) return;
    $("#kbTitle").value = $("#kbTitle").value || (j.detail || "").slice(0, 120); $("#kbEquip").value = j.equipment_text || ""; $("#kbType").value = j.job_type_id || "";
    $("#kbSym").value = j.detail || ""; $("#kbSol").value = j.summary || ""; $("#kbJob").value = j.id;
  }
  async function kbFromJob(id) {
    show("kb"); await renderKb();
    let j = kbJobs.find(x => x.id === id);
    if (!j) { const { data } = await sb.from("jobs").select("id,job_no,detail,equipment_text,job_type_id,summary").eq("id", id).maybeSingle(); j = data; if (j) $("#kbJob").insertAdjacentHTML("afterbegin", `<option value="${j.id}">${esc(j.job_no)}</option>`); }
    $("#kbBox").open = true; kbFill(j); $("#kbBox").scrollIntoView({ behavior: "smooth" });
  }
  $("#kbJob").onchange = () => kbFill(kbJobs.find(x => x.id === $("#kbJob").value));
  const kbReset = () => { $("#fKb").reset(); kbEdit = null; $("#kbSum").textContent = "+ เพิ่มวิธีแก้"; $("#kbSave").textContent = "บันทึก"; $("#kbMsg").innerHTML = ""; };
  $("#kbReset").onclick = kbReset;
  $("#fKb").onsubmit = async e => {
    e.preventDefault();
    const row = { title: $("#kbTitle").value.trim(), job_type_id: $("#kbType").value || null, equipment_text: $("#kbEquip").value.trim() || null, symptom: $("#kbSym").value.trim() || null,
      cause: $("#kbCause").value.trim() || null, solution: $("#kbSol").value.trim(), tags: $("#kbTags").value.trim() || null, shared: $("#kbShared").checked };
    const r = kbEdit ? await sb.from("kb_articles").update({ ...row, updated_at: new Date().toISOString() }).eq("id", kbEdit)
      : await sb.from("kb_articles").insert({ ...row, hospital_id: H.id, author_id: me.id, job_id: $("#kbJob").value || null });
    if (r.error) return fail("#kbMsg", r.error);
    kbReset(); $("#kbBox").open = false; toast("บันทึกวิธีแก้แล้ว"); renderKb();
  };
  document.addEventListener("click", async e => {
    const t = e.target.closest("[data-kbedit],[data-kbhide]"); if (!t) return;
    if (t.dataset.kbhide) { if (!confirm("ซ่อนเรื่องนี้จากคลัง?")) return; const { error } = await sb.from("kb_articles").update({ active: false, updated_at: new Date().toISOString() }).eq("id", t.dataset.kbhide); if (error) return alert(errText(error)); return renderKb(); }
    const k = kb.find(x => x.id === t.dataset.kbedit); kbEdit = k.id;
    $("#kbTitle").value = k.title; $("#kbType").value = k.job_type_id || ""; $("#kbEquip").value = k.equipment_text || ""; $("#kbSym").value = k.symptom || ""; $("#kbCause").value = k.cause || "";
    $("#kbSol").value = k.solution; $("#kbTags").value = k.tags || ""; $("#kbShared").checked = k.shared; $("#kbJob").value = k.job_id || "";
    $("#kbSum").textContent = "แก้ไขวิธีแก้"; $("#kbSave").textContent = "บันทึกการแก้ไข"; $("#kbBox").open = true; $("#kbBox").scrollIntoView({ behavior: "smooth" });
  });

  /* ---------- executive overview ---------- */
  let exRows = [];
  async function renderExec() {
    const { data, error } = await sb.rpc("exec_overview", { p_from: $("#exFrom").value, p_to: $("#exTo").value });
    if (error) return fail("#exTable", error);
    exRows = data || [];
    const sum = k => exRows.reduce((t, r) => t + (+r[k] || 0), 0);
    $("#exKpi").innerHTML = [["รับแจ้งในช่วงนี้", sum("received")], ["ซ่อมเสร็จ", sum("cleared")], ["ค้างตอนนี้", sum("open_now")], ["เกิน SLA ตอนนี้", sum("late_open"), 1], ["รออนุมัติพักงาน", sum("hold_pending"), 1], ["ค่าอะไหล่ (บาท)", baht(sum("parts_cost"))]]
      .map(([a, b, red]) => `<div class="kpi"><b style="${red && +b > 0 ? "color:var(--bad)" : ""}">${b}</b><span>${a}</span></div>`).join("");
    $("#exTable").innerHTML = `<tr><th>โรงพยาบาล</th><th class="num">รับแจ้ง</th><th class="num">ซ่อมเสร็จ</th><th class="num">ปิดงาน</th><th class="num">ค้างตอนนี้</th><th class="num">เกิน SLA</th><th class="num">พักงาน</th><th class="num">รออนุมัติ</th><th class="num">เวลาปิดเฉลี่ย</th><th class="num">% ทัน SLA</th><th class="num">ความพึงพอใจ</th><th class="num">ค่าอะไหล่</th><th class="num">PR รออนุมัติ</th></tr>` +
      exRows.map(r => `<tr${r.late_open > 0 ? ' class="low"' : ""}><td><b>${esc(r.code)}</b> ${esc(r.name)}</td><td class="num">${r.received}</td><td class="num">${r.cleared}</td><td class="num">${r.closed}</td><td class="num">${r.open_now}</td><td class="num">${r.late_open}</td><td class="num">${r.on_hold}</td><td class="num">${r.hold_pending}</td>
        <td class="num">${r.avg_close_min != null ? dur(r.avg_close_min) : "-"}</td><td class="num">${r.sla_ok_pct != null ? r.sla_ok_pct + "%" : "-"}</td><td class="num">${r.rating_avg != null ? (+r.rating_avg).toFixed(2) + ` (${r.rating_n})` : "-"}</td><td class="num">${baht(r.parts_cost)}</td><td class="num">${r.pr_pending}</td></tr>`).join("");
    $("#exOpen").innerHTML = bars(exRows.map(r => [r.code, +r.open_now]).sort((a, b) => b[1] - a[1]));
    $("#exSla").innerHTML = bars(exRows.filter(r => r.sla_ok_pct != null).map(r => [r.code, +r.sla_ok_pct]).sort((a, b) => b[1] - a[1]));
  }
  $("#exExport").onclick = () => csv(`ภาพรวม-12รพ-${$("#exFrom").value}-${$("#exTo").value}.csv`, ["รหัส", "โรงพยาบาล", "รับแจ้ง", "ซ่อมเสร็จ", "ปิดงาน", "ค้างตอนนี้", "เกิน SLA", "พักงาน", "รออนุมัติพักงาน", "เวลาปิดเฉลี่ย (นาที)", "% ทัน SLA", "ความพึงพอใจเฉลี่ย", "จำนวนประเมิน", "ค่าอะไหล่ (บาท)", "PR รออนุมัติ", "มูลค่า PR อนุมัติ"],
    exRows.map(r => [r.code, r.name, r.received, r.cleared, r.closed, r.open_now, r.late_open, r.on_hold, r.hold_pending, r.avg_close_min, r.sla_ok_pct, r.rating_avg, r.rating_n, r.parts_cost, r.pr_pending, r.pr_value]));

  setInterval(() => { if (!$("#tab-shift").hidden && !shOpen) renderShift(); }, 120000);
  void STATUS;
})();
