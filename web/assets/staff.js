(() => {
  const { sb, $, esc, STATUS, OPEN, fmt, fmtDate, mins, dur, pill, statusLabel, errText, opts, workMins, uploadMedia, isVideo, signed } = RS;
  const ROLES = { owner: "Owner", admin: "Admin", chief_engineer: "Chief Engineer", supervisor: "Supervisor",
    senior_technician: "Senior Technician", technician: "Technician", safety_officer: "จป.", observer: "Observer" };
  const MANAGER = ["owner", "admin", "chief_engineer", "supervisor"];
  const APPROVER = ["owner", "admin", "chief_engineer"];
  const HOLD_STATUS = { pending: "รอ Owner อนุมัติ", ack: "รับทราบแล้ว", ack_memo: "รับทราบ + ขอ Memo", rejected: "ไม่อนุมัติ" };
  let invites = [], me = null, H = null, staff = [], prios = [], types = [], locs = [], jobs = [], assignees = [], reasons = [];
  let S = { require_photo: false, max_photos: 6, alert_unassigned_min: 5, alert_not_started_min: 10, appointment_grace_min: 120, hold_needs_approval: true };
  let editing = null, channel = null, view = "all", seenAlerts = new Set(), firstAlertRun = true;
  const isMgr = () => me && MANAGER.includes(me.role);
  const isApprover = () => me && APPROVER.includes(me.role);
  const can = () => me && me.role !== "observer";
  const prioOf = j => prios.find(p => p.id === j.priority_id);
  const slaOf = j => (prioOf(j) || {}).sla_minutes || 1440;
  const isLate = j => ["register", "assign", "work_on", "on_hold"].includes(j.status) && workMins(j) > slaOf(j);
  const overDue = j => j.due_minutes && ["assign", "work_on", "on_hold"].includes(j.status) ? workMins(j) / j.due_minutes : 0;
  const nameOf = id => (staff.find(s => s.id === id) || {}).full_name || "";
  const typeOf = id => (types.find(t => t.id === id) || {}).name || "ไม่ระบุ";
  const crewOf = j => { const a = assignees.filter(x => x.job_id === j.id && x.active).sort((x, y) => y.is_lead - x.is_lead).map(x => x.profile_id); return a.length ? a : (j.technician_id ? [j.technician_id] : []); };
  const mine = j => me && crewOf(j).includes(me.id);
  const store = { get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };

  /* ---------- auth ---------- */
  $("#fLogin").onsubmit = async e => {
    e.preventDefault();
    const { error } = await sb.auth.signInWithPassword({ email: $("#lEmail").value.trim(), password: $("#lPass").value });
    $("#lMsg").innerHTML = error ? `<div class="note bad">${esc(error.message === "Invalid login credentials" ? "อีเมลหรือรหัสผ่านไม่ถูกต้อง" : errText(error))}</div>` : "";
  };
  $("#lSignup").onclick = async () => {
    if (!$("#fLogin").reportValidity()) return;
    const { error } = await sb.auth.signUp({ email: $("#lEmail").value.trim(), password: $("#lPass").value });
    $("#lMsg").innerHTML = error ? `<div class="note bad">${esc(errText(error))}</div>`
      : `<div class="note ok">สมัครแล้ว ถ้ามีอีเมลยืนยันให้กดลิงก์ในอีเมลก่อน จากนั้นแจ้งหัวหน้าให้เพิ่มสิทธิ์</div>`;
  };
  $("#logout").onclick = () => sb.auth.signOut();
  sb.auth.onAuthStateChange((_e, session) => { setTimeout(() => boot(session), 0); });

  async function boot(session) {
    ["#login", "#pending", "#tab-jobs", "#tab-dash", "#tab-setup"].forEach(s => $(s).hidden = true);
    $("#tabs").hidden = true; $("#logout").hidden = !session; $("#bell").hidden = !session; $("#who").textContent = "";
    if (channel) { sb.removeChannel(channel); channel = null; }
    if (!session) { $("#login").hidden = false; return; }
    const { data } = await sb.from("profiles").select("id,full_name,role,hospital_id,hospitals(id,code,name)").eq("id", session.user.id).maybeSingle();
    me = data;
    if (!me || !me.hospital_id) { $("#pending").hidden = false; $("#who").textContent = session.user.email; return; }
    H = me.hospitals;
    $("#title").textContent = "ระบบใบงาน · " + H.name;
    $("#who").textContent = `${me.full_name || session.user.email} · ${ROLES[me.role]}`;
    $("#tabs").hidden = false;
    document.querySelectorAll("[data-manager]").forEach(b => b.hidden = !isMgr());
    view = store.get("rs-view", MANAGER.includes(me.role) ? "all" : "mine");
    await loadRefs(); await loadJobs();
    channel = sb.channel("jobs-" + H.id)
      .on("postgres_changes", { event: "*", schema: "public", table: "jobs", filter: "hospital_id=eq." + H.id }, () => loadJobs())
      .on("postgres_changes", { event: "*", schema: "public", table: "job_assignees" }, () => loadJobs()).subscribe();
    show(store.get("rs-staff-tab", "jobs"));
    bellLabel();
  }

  /* ---------- tabs and quick views ---------- */
  document.querySelectorAll("#tabs button").forEach(b => b.onclick = () => show(b.dataset.tab));
  function show(t) {
    if (t === "setup" && !isMgr()) t = "jobs";
    document.querySelectorAll("#tabs button").forEach(b => b.setAttribute("aria-selected", b.dataset.tab === t));
    ["jobs", "dash", "setup"].forEach(x => $("#tab-" + x).hidden = x !== t);
    store.set("rs-staff-tab", t);
    render();
  }
  const VIEWS = [["all", "ทั้งหมด"], ["mine", "งานของฉัน"], ["review", "รอตรวจงาน"], ["approve", "รออนุมัติพักงาน"], ["appoint", "นัดหมาย"]];
  function renderViews() {
    const n = { all: jobs.filter(j => OPEN.includes(j.status)).length, mine: jobs.filter(j => OPEN.includes(j.status) && mine(j)).length,
      review: jobs.filter(j => j.status === "clear").length, approve: jobs.filter(j => j.status === "on_hold" && j.hold_status === "pending").length,
      appoint: jobs.filter(j => OPEN.includes(j.status) && (j.appointment_at || j.hold_until)).length };
    $("#wViews").innerHTML = VIEWS.map(([k, l]) => `<button type="button" class="chip" data-view="${k}" aria-pressed="${view === k}">${l}<b>${n[k]}</b></button>`).join("");
  }

  /* ---------- data ---------- */
  async function loadRefs() {
    const [s, p, t, l, r, st] = await Promise.all([
      sb.from("profiles").select("id,full_name,role,active").eq("hospital_id", H.id).order("full_name"),
      sb.from("priorities").select("*").eq("hospital_id", H.id).order("sort").order("sla_minutes"),
      sb.from("job_types").select("*").eq("hospital_id", H.id).order("code"),
      sb.from("locations").select("*").eq("hospital_id", H.id).order("building").order("floor").order("department"),
      sb.from("hold_reasons").select("*").eq("hospital_id", H.id).order("sort").order("name"),
      sb.from("hospital_settings").select("*").eq("hospital_id", H.id).maybeSingle()]);
    if (isMgr()) { const iv = await sb.from("staff_invites").select("email,role,full_name").eq("hospital_id", H.id).is("used_at", null).order("created_at"); invites = iv.data || []; }
    staff = s.data || []; prios = p.data || []; types = t.data || []; locs = l.data || []; reasons = r.data || [];
    if (st.data) S = st.data;
    opts($("#wStatus"), [["open", "งานที่ยังไม่ปิด"], ["", "ทุกสถานะ"], ...Object.entries(STATUS)]);
    opts($("#wTech"), [["", "ช่างทุกคน"], ...staff.filter(x => x.active).map(x => [x.id, x.full_name || "(ไม่มีชื่อ)"])]);
    opts($("#wType"), [["", "ทุกประเภทงาน"], ...types.map(x => [x.id, x.name])]);
    opts($("#sRole"), Object.entries(ROLES).filter(([k]) => k !== "owner" || me.role === "owner"));
    if (!$("#sRole").dataset.init) { $("#sRole").value = "technician"; $("#sRole").dataset.init = 1; }
  }
  async function loadJobs() {
    const since = new Date(Date.now() - 180 * 864e5).toISOString();
    const { data, error } = await sb.from("jobs").select("*").eq("hospital_id", H.id)
      .or(`created_at.gte.${since},status.in.(register,assign,work_on,on_hold,clear)`).order("created_at", { ascending: false }).limit(2000);
    if (error) { $("#wList").innerHTML = `<div class="note bad">${esc(errText(error))}</div>`; return; }
    jobs = data;
    const open = jobs.filter(j => OPEN.includes(j.status)).map(j => j.id);
    assignees = [];
    for (let i = 0; i < open.length; i += 150) {
      const a = await sb.from("job_assignees").select("job_id,profile_id,is_lead,active").in("job_id", open.slice(i, i + 150));
      if (a.data) assignees.push(...a.data);
    }
    render(); checkAlerts();
  }

  /* ---------- workload, used when assigning ---------- */
  function workload() {
    const today = new Date(new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" }) + "T00:00:00+07:00");
    const w = {};
    staff.forEach(s => w[s.id] = { hold: 0, today: 0 });
    jobs.forEach(j => crewOf(j).forEach(id => { if (!w[id]) return; if (["assign", "work_on", "on_hold"].includes(j.status)) w[id].hold++; if (j.assigned_at && new Date(j.assigned_at) >= today) w[id].today++; }));
    return w;
  }

  /* ---------- job cards ---------- */
  const photoLinks = (label, arr) => arr && arr.length ? `<span>${label}: ${arr.map((p, i) => `<a href="#" data-photo="${esc(p)}">${isVideo(p) ? "วิดีโอ" : "รูป"} ${i + 1}</a>`).join(" ")}</span>` : "";
  const fileInput = id => `<label class="full">รูป/วิดีโอ (สูงสุด ${S.max_photos} ไฟล์)<input id="${id}" type="file" accept="image/*,video/*" multiple></label>`;
  function inlineForm(j) {
    const ok = a => `<div class="row" style="align-self:end"><button class="btn primary small" data-ok="${a}" data-id="${j.id}">บันทึก</button><button class="btn small" type="button" data-cancel>ยกเลิก</button></div>`;
    const a = editing.act;
    if (a === "assign") {
      const w = workload(), crew = crewOf(j);
      const techs = staff.filter(s => s.active && s.role !== "observer").sort((x, y) => w[x.id].hold - w[y.id].hold || w[x.id].today - w[y.id].today);
      const least = techs.length ? w[techs[0].id].hold : 0;
      const std = (types.find(t => t.id === j.job_type_id) || {}).standard_minutes;
      return `<div class="full"><b style="font-size:13px">ผู้รับงาน (เลือกได้หลายคน คนแรกที่ติ๊กเป็นหัวหน้างาน)</b><div class="techs">${techs.map(s => `<label class="tech"><input type="checkbox" name="iTech" value="${s.id}" ${crew.includes(s.id) ? "checked" : ""}>
          <span>${esc(s.full_name || "(ไม่มีชื่อ)")}${w[s.id].hold === least ? ' <em class="free">ว่างสุด</em>' : ""}<small>ถืออยู่ ${w[s.id].hold} · วันนี้ ${w[s.id].today}</small></span></label>`).join("")}</div></div>
        <label>ความเร่งด่วน<select id="iPrio">${prios.map(p => `<option value="${p.id}" ${p.id === j.priority_id ? "selected" : ""}>${esc(p.name)} (SLA ${dur(p.sla_minutes)})</option>`).join("")}</select></label>
        <label>ประเภทงาน<select id="iType"><option value="">ไม่ระบุ</option>${types.map(t => `<option value="${t.id}" data-std="${t.standard_minutes || ""}" ${t.id === j.job_type_id ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select></label>
        <label>⏱ กำหนดเสร็จภายใน (นาทีเวลาทำงาน)<input id="iDue" type="number" min="1" placeholder="เว้นว่าง = ไม่เตือน" value="${j.due_minutes || std || ""}"></label>
        <label class="span2">หมายเหตุถึงช่าง<input id="iNote" placeholder="ไม่บังคับ"></label>${ok("assign")}`;
    }
    if (a === "start") return `${fileInput("iFiles")}<label class="span2">หมายเหตุ<input id="iNote" placeholder="ไม่บังคับ เช่น ตรวจพบว่า..."></label>${ok("start")}`;
    if (a === "on_hold") return `<label>เหตุผลที่พักงาน *<select id="iCat">${reasons.filter(r => r.active).map(r => `<option>${esc(r.name)}</option>`).join("")}</select></label>
        <label>วันนัดกลับมาทำ *<input id="iUntil" type="date"></label><label class="full">หมายเหตุ * (รออะไร จากใคร)<input id="iNote" placeholder="เช่น รอคอมเพรสเซอร์ สั่งแล้ว ของถึง 20 พ.ย."></label>
        ${S.hold_needs_approval ? `<div class="full meta">ใบงานจะขึ้นใน “รออนุมัติพักงาน” ให้ Owner / Admin / Chief Engineer พิจารณา เวลาช่วงพักงานไม่นับใน SLA</div>` : ""}${ok("on_hold")}`;
    if (a === "decide") return `<label>ผลการพิจารณา *<select id="iDec"><option value="ack">รับทราบ (อนุมัติพักงาน)</option><option value="ack_memo">รับทราบ + ขอ Memo</option><option value="rejected">ไม่อนุมัติ (ให้ทำต่อ)</option></select></label>
        <label class="span2">หมายเหตุ<input id="iNote" placeholder="ไม่บังคับ"></label>${ok("decide")}`;
    if (a === "clear") return `<label class="span2">สรุปการซ่อม *<input id="iSum" placeholder="สาเหตุและสิ่งที่แก้ไข"></label><label>งานนี้ใช้อะไหล่ไหม *<select id="iParts"><option value="false">ไม่ใช้อะไหล่</option><option value="true">ใช้อะไหล่</option></select></label>
        ${fileInput("iFiles")}${S.require_photo ? `<div class="full meta">โรงนี้ตั้งให้ต้องแนบรูปหลังซ่อมอย่างน้อย 1 รูป</div>` : ""}${ok("clear")}`;
    if (a === "appoint") return `<label>วันและเวลานัด<input id="iAt" type="datetime-local" value="${j.appointment_at ? new Date(new Date(j.appointment_at).getTime() + 7 * 36e5).toISOString().slice(0, 16) : ""}"></label><label class="span2">หมายเหตุ<input id="iNote" placeholder="เช่น นัดกับหัวหน้าแผนก"></label>${ok("appoint")}`;
    if (a === "edit") {
      const cur = j.location_id;
      return `<label class="full">รายละเอียดปัญหา<textarea id="eDetail">${esc(j.detail)}</textarea></label>
        <label class="span2">ตำแหน่ง<select id="eLoc">${locs.map(l => `<option value="${l.id}" ${l.id === cur ? "selected" : ""}>${esc(l.building)} · ${esc(l.floor)} · ${esc(l.department)}</option>`).join("")}</select></label>
        <label>อุปกรณ์<input id="eEquip" value="${esc(j.equipment_text || "")}"></label>
        <label>ชื่อผู้แจ้ง<input id="eName" value="${esc(j.reporter_name)}"></label><label>เบอร์โทร<input id="ePhone" value="${esc(j.reporter_phone)}"></label>
        <label>เหตุผลที่แก้ *<input id="iNote" placeholder="เช่น ผู้แจ้งเลือกแผนกผิด"></label>${ok("edit")}`;
    }
    if (a === "reopen" || a === "cancel") return `<label class="span2">เหตุผล *<input id="iNote"></label>${ok(a)}`;
    if (a === "history") return `<div class="full" id="hist-${j.id}">กำลังโหลด…</div><div class="row"><button class="btn small" type="button" data-cancel>ปิด</button></div>`;
    return "";
  }
  function card(j) {
    const pr = prioOf(j), crit = pr && pr.sla_minutes <= 60, crew = crewOf(j), od = overDue(j);
    const b = (a, t, p) => `<button class="btn small${p ? " primary" : ""}" data-act="${a}" data-id="${j.id}">${t}</button>`;
    let acts = "";
    if (can()) {
      if (["register", "assign", "work_on", "on_hold"].includes(j.status)) acts += b("assign", crew.length ? "เปลี่ยน/เพิ่มช่าง" : "มอบหมายช่าง", j.status === "register");
      if (j.status === "assign" && !j.accepted_at && (mine(j) || isMgr())) acts += b("accept", "รับงาน", 1);
      if (j.status === "assign") acts += b("start", "เริ่มงาน", !!j.accepted_at);
      if (j.status === "on_hold" && (j.hold_status !== "pending" || !S.hold_needs_approval || isApprover())) acts += b("start", "กลับมาทำต่อ", 1);
      if (j.status === "on_hold" && j.hold_status === "pending" && isApprover()) acts += b("decide", "พิจารณาพักงาน", 1);
      if (j.status === "work_on") acts += b("clear", "ซ่อมเสร็จ", 1) + b("on_hold", "พักงาน");
      if (j.status === "clear" && isMgr()) acts += b("close", "ตรวจแล้ว ปิดงาน", 1) + b("reopen", "ส่งกลับแก้ไข");
      if (["register", "assign", "work_on", "on_hold"].includes(j.status)) acts += b("appoint", "นัดหมาย");
      if (OPEN.includes(j.status) && isMgr()) acts += b("edit", "แก้ไขใบงาน") + b("cancel", "ยกเลิกใบงาน");
      acts += b("history", "ประวัติ");
    }
    const inline = editing && editing.id === j.id ? `<div class="inline">${inlineForm(j)}</div>` : "";
    const age = j.closed_at ? "ใช้เวลา " + dur(workMins(j, j.closed_at)) : "เวลาทำงาน " + dur(workMins(j));
    const graceOver = t => t && mins(t) > S.appointment_grace_min;
    return `<article class="job${isLate(j) || od > 1 ? " late" : ""}">
      <div><div class="meta"><span class="mono">${esc(j.job_no)}</span><span>${fmt(j.created_at)}</span><span>${esc(typeOf(j.job_type_id))}</span>${j.edited_at ? "<span>แก้ไขแล้ว</span>" : ""}</div>
        <h4>${esc(j.detail)}${j.equipment_text ? ` <span style="color:var(--muted);font-weight:500">(${esc(j.equipment_text)})</span>` : ""}</h4>
        <div class="meta"><span>${[j.building, j.floor, j.department].map(esc).join(" · ")}</span><span>ผู้แจ้ง ${esc(j.reporter_name)} ${esc(j.reporter_phone)}${j.reporter_email ? " · " + esc(j.reporter_email) : ""}</span>${crew.length ? `<span>ช่าง ${crew.map((id, i) => esc(nameOf(id)) + (i === 0 && crew.length > 1 ? " (หัวหน้างาน)" : "")).join(", ")}</span>` : ""}</div>
        ${j.status === "on_hold" ? `<div class="meta" style="color:var(--s-on_hold)">พักงาน: ${esc(j.hold_category || "")}${j.hold_reason ? " · " + esc(j.hold_reason) : ""} · นัด ${fmtDate(j.hold_until)}${j.hold_status ? ` · <b>${HOLD_STATUS[j.hold_status]}</b>` : ""}${graceOver(j.hold_until && j.hold_until + "T00:00:00+07:00") ? ' · <b style="color:var(--bad)">เลยวันนัด</b>' : ""}</div>` : ""}
        ${j.appointment_at && OPEN.includes(j.status) ? `<div class="meta">นัดเข้าทำงาน ${fmt(j.appointment_at)}${graceOver(j.appointment_at) && j.status !== "work_on" ? ' · <b style="color:var(--bad)">เลยนัด</b>' : ""}</div>` : ""}
        ${j.memo_requested ? `<div class="meta"><b>ขอ Memo</b> สำหรับงานนี้</div>` : ""}
        ${j.summary ? `<div class="meta">สรุปการซ่อม: ${esc(j.summary)}${j.uses_parts ? " · ใช้อะไหล่" : ""}</div>` : ""}
        ${j.rating ? `<div class="meta">ผู้แจ้งให้คะแนน ${"★".repeat(j.rating)}${"☆".repeat(5 - j.rating)}${j.rating_comment ? " · " + esc(j.rating_comment) : ""}</div>` : ""}
        <div class="meta">${photoLinks("ผู้แจ้ง", j.photo_paths)}${photoLinks("ก่อนซ่อม", j.before_photo_paths)}${photoLinks("หลังซ่อม", j.close_photo_paths)}</div></div>
      <div class="side">${pill(j.status, statusLabel(j))}${pr ? `<span class="pr${crit ? " crit" : ""}">${esc(pr.name)}</span>` : ""}
        <span class="meta">${age}${isLate(j) ? ' · <b style="color:var(--bad)">เกิน SLA</b>' : ""}</span>
        ${j.due_minutes && OPEN.includes(j.status) && j.status !== "clear" ? `<span class="meta">กำหนด ${dur(j.due_minutes)}${od > 2 ? ' · <b style="color:var(--bad)">⏰ เกินกำหนด 2 เท่า</b>' : od > 1 ? ' · <b style="color:var(--bad)">⏰ เกินกำหนด</b>' : ""}</span>` : ""}</div>
      ${acts ? `<div class="acts">${acts}</div>` : ""}${inline}</article>`;
  }
  const match = (j, q) => !q || [j.job_no, j.reporter_phone, j.reporter_name, j.detail, j.department, j.equipment_text].some(x => String(x || "").toLowerCase().includes(q));
  function inView(j) {
    if (view === "mine") return mine(j) && OPEN.includes(j.status);
    if (view === "review") return j.status === "clear";
    if (view === "approve") return j.status === "on_hold" && j.hold_status === "pending";
    if (view === "appoint") return OPEN.includes(j.status) && (j.appointment_at || j.hold_until);
    return true;
  }
  const apptKey = j => j.appointment_at || (j.hold_until ? j.hold_until + "T00:00:00+07:00" : "9999");
  function renderJobs() {
    renderViews();
    const s = $("#wStatus").value, t = $("#wTech").value, ty = $("#wType").value, q = $("#wQ").value.trim().toLowerCase();
    const useStatus = view === "all";
    let list = jobs.filter(j => inView(j) && (!useStatus || (s === "open" ? OPEN.includes(j.status) : !s || j.status === s)) && (!t || crewOf(j).includes(t)) && (!ty || j.job_type_id === ty) && match(j, q));
    list = view === "appoint" ? list.sort((a, b) => apptKey(a).localeCompare(apptKey(b)))
      : list.sort((a, b) => (isLate(b) - isLate(a)) || (slaOf(a) - slaOf(b)) || b.created_at.localeCompare(a.created_at));
    $("#wStatus").disabled = !useStatus;
    let html = can() ? "" : `<div class="note">บัญชี Observer ดูได้อย่างเดียว</div>`;
    if (view === "appoint") {
      let last = "";
      list.slice(0, 300).forEach(j => { const d = fmtDate(apptKey(j).slice(0, 10)); if (d !== last) { html += `<h3 class="day">${d}</h3>`; last = d; } html += card(j); });
    } else html += list.slice(0, 300).map(card).join("");
    $("#wList").innerHTML = list.length ? html : html + `<div class="empty">ยังไม่มีใบงานในมุมมองนี้</div>`;
    if (editing && editing.act === "history") loadHistory(editing.id);
  }
  async function loadHistory(id) {
    const { data } = await sb.from("job_events").select("status,note,actor_id,created_at").eq("job_id", id).order("created_at");
    const el = $("#hist-" + id); if (!el) return;
    el.innerHTML = (data || []).map(h => `<div class="meta"><span class="mono">${fmt(h.created_at)}</span><span>${STATUS[h.status]}</span><span>${esc(h.note || "")}</span><span>${esc(nameOf(h.actor_id))}</span></div>`).join("") || "ไม่มีประวัติ";
  }
  async function act(id, action, data = {}) {
    const { error } = await sb.rpc("job_action", { p_job_id: id, p_action: action, p_data: data });
    if (error) { alertBar(errText(error)); return false; }
    editing = null; await loadJobs(); return true;
  }
  async function transition(id, status, extra = {}) {
    const { error } = await sb.rpc("job_transition", { p_job_id: id, p_status: status, ...extra });
    if (error) { alertBar(errText(error)); return; }
    editing = null; await loadJobs();
  }
  function alertBar(m) { $("#wList").insertAdjacentHTML("afterbegin", `<div class="note bad">${esc(m)}</div>`); window.scrollTo({ top: 0, behavior: "smooth" }); }
  async function files(sel, kind) {
    const f = [...(($(sel) || {}).files || [])];
    if (f.length > S.max_photos) throw new Error(`แนบได้สูงสุด ${S.max_photos} ไฟล์`);
    return f.length ? uploadMedia(f, H.code, kind) : [];
  }
  document.addEventListener("click", async e => {
    const t = e.target.closest("button,a"); if (!t) return;
    if (t.dataset.view) { view = t.dataset.view; store.set("rs-view", view); editing = null; render(); return; }
    if (t.dataset.photo !== undefined) { e.preventDefault(); const { data } = await sb.storage.from("job-photos").createSignedUrl(t.dataset.photo, 600); if (data) window.open(data.signedUrl, "_blank", "noopener"); return; }
    if (t.dataset.cancel !== undefined) { e.preventDefault(); editing = null; render(); return; }
    if (t.dataset.act) {
      const id = t.dataset.id, a = t.dataset.act;
      if (a === "accept") return act(id, "accept");
      if (a === "close") return transition(id, "close", { p_note: "ตรวจงานและปิดงาน" });
      editing = { id, act: a }; render(); return;
    }
    if (t.dataset.ok) {
      e.preventDefault();
      const id = t.dataset.id, a = t.dataset.ok, v = s => ($(s) ? $(s).value.trim() : "");
      t.disabled = true; t.textContent = "กำลังบันทึก…";
      try {
        if (a === "assign") {
          const ids = [...document.querySelectorAll('input[name="iTech"]:checked')].map(x => x.value);
          if (!ids.length) throw new Error("เลือกช่างอย่างน้อย 1 คน");
          const lead = editing.order && editing.order.find(x => ids.includes(x)) || ids[0];
          await act(id, "reassign", { technicians: [lead, ...ids.filter(x => x !== lead)], priority_id: v("#iPrio"), job_type_id: v("#iType"), due_minutes: v("#iDue"), note: v("#iNote") });
        }
        if (a === "start") await act(id, "start", { photos: await files("#iFiles", "before"), note: v("#iNote") });
        if (a === "on_hold") { if (!v("#iNote") || !v("#iUntil")) throw new Error("ใส่หมายเหตุและวันนัดให้ครบ"); await act(id, "hold", { category: v("#iCat"), note: v("#iNote"), until: v("#iUntil") }); }
        if (a === "decide") await act(id, "hold_decide", { decision: v("#iDec"), note: v("#iNote") });
        if (a === "clear") {
          if (!v("#iSum")) throw new Error("ใส่สรุปการซ่อม");
          if (S.require_photo && !($("#iFiles").files || []).length) throw new Error("แนบรูปหลังซ่อมอย่างน้อย 1 รูป");
          await act(id, "clear", { note: v("#iSum"), uses_parts: v("#iParts") === "true", photos: await files("#iFiles", "after") });
        }
        if (a === "appoint") await act(id, "appoint", { at: v("#iAt") ? new Date(v("#iAt") + ":00+07:00").toISOString() : "", note: v("#iNote") });
        if (a === "edit") { if (!v("#iNote")) throw new Error("ใส่เหตุผลที่แก้"); await act(id, "edit", { detail: v("#eDetail"), location_id: v("#eLoc"), equipment_text: v("#eEquip"), reporter_name: v("#eName"), reporter_phone: v("#ePhone"), note: v("#iNote") }); }
        if (a === "reopen") { if (!v("#iNote")) throw new Error("ใส่เหตุผล"); await transition(id, "work_on", { p_note: "ส่งกลับ: " + v("#iNote") }); }
        if (a === "cancel") { if (!v("#iNote")) throw new Error("ใส่เหตุผล"); await transition(id, "cancel", { p_note: "ยกเลิก: " + v("#iNote") }); }
      } catch (err) { alertBar(errText(err)); t.disabled = false; t.textContent = "บันทึก"; }
    }
  });
  // remember tick order so the first technician ticked becomes the lead
  document.addEventListener("change", e => {
    if (e.target.name === "iTech" && editing) { editing.order = (editing.order || []).filter(x => x !== e.target.value); if (e.target.checked) editing.order.push(e.target.value); }
    if (e.target.id === "iType") { const o = e.target.selectedOptions[0]; if (o && o.dataset.std && !$("#iDue").value) $("#iDue").value = o.dataset.std; }
  });
  ["#wStatus", "#wTech", "#wType"].forEach(s => $(s).addEventListener("change", render));
  $("#wQ").addEventListener("input", render);

  /* ---------- alerts: popup, sound, browser notification ---------- */
  const soundOn = () => store.get("rs-sound", "0") === "1";
  function bellLabel() { $("#bell").textContent = soundOn() ? "🔔 เสียงเตือน: เปิด" : "🔕 เสียงเตือน: ปิด"; }
  $("#bell").onclick = async () => {
    store.set("rs-sound", soundOn() ? "0" : "1"); bellLabel();
    if (soundOn()) { beep(); if ("Notification" in window && Notification.permission === "default") { try { await Notification.requestPermission(); } catch {} } }
  };
  let ctx = null;
  function beep() {
    try {
      ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
      [0, 0.25, 0.5].forEach(t => { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = 880; o.connect(g); g.connect(ctx.destination);
        g.gain.setValueAtTime(0.25, ctx.currentTime + t); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.2); o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.2); });
    } catch {}
  }
  function alertsNow() {
    const out = [], add = (key, j, text) => out.push({ key, j, text });
    jobs.forEach(j => {
      if (j.status === "register" && isMgr() && mins(j.created_at) >= S.alert_unassigned_min) add("un-" + j.id, j, `ยังไม่มีคนรับงานมา ${dur(mins(j.created_at))}`);
      if (j.status === "assign" && !j.started_at && j.assigned_at && mins(j.assigned_at) >= S.alert_not_started_min && (mine(j) || isMgr()))
        add("ns-" + j.id, j, j.accepted_at ? `รับงานแล้วแต่ยังไม่เริ่ม ${dur(mins(j.assigned_at))}` : `มอบหมายแล้วยังไม่มีคนรับ ${dur(mins(j.assigned_at))}`);
      const od = overDue(j);
      if (od > 1 && (mine(j) || isMgr())) add((od > 2 ? "d2-" : "d1-") + j.id, j, od > 2 ? "⏰ เกินกำหนด 2 เท่า" : "⏰ เกินกำหนดเสร็จ");
      if (isLate(j) && (mine(j) || isMgr())) add("sla-" + j.id, j, `เกิน SLA (${esc((prioOf(j) || {}).name || "")})`);
      if (j.status === "on_hold" && j.hold_status === "pending" && isApprover()) add("ap-" + j.id, j, "รออนุมัติพักงาน");
      const appt = j.appointment_at && ["assign", "on_hold"].includes(j.status) ? j.appointment_at : j.status === "on_hold" && j.hold_until ? j.hold_until + "T00:00:00+07:00" : null;
      if (appt && mins(appt) > S.appointment_grace_min && (mine(j) || isMgr())) add("ap2-" + j.id, j, `เลยนัด ${dur(mins(appt))}`);
      if (OPEN.includes(j.status) && mins(j.created_at) > 1440 && (mine(j) || isMgr())) add("24-" + j.id + "-" + Math.floor(mins(j.created_at) / 1440), j, `ค้างเกิน ${Math.floor(mins(j.created_at) / 1440)} วัน`);
    });
    return out;
  }
  function checkAlerts() {
    if (!H) return;
    const list = alertsNow(), fresh = list.filter(a => !seenAlerts.has(a.key));
    list.forEach(a => seenAlerts.add(a.key));
    const box = $("#alerts");
    box.hidden = !list.length;
    const urgent = list.filter(a => !a.key.startsWith("24-"));
    box.innerHTML = list.length ? `<div class="alert-head"><b>ต้องดูแล ${list.length} รายการ</b><button class="btn small" type="button" id="alertToggle">${box.dataset.open ? "ซ่อน" : "ดูรายการ"}</button></div>
      ${box.dataset.open ? `<ul>${list.slice(0, 40).map(a => `<li><a href="#" data-goto="${a.j.id}" class="mono">${esc(a.j.job_no)}</a> ${esc(a.text)} · ${esc(a.j.department || "")}</li>`).join("")}</ul>` : ""}` : "";
    if (!firstAlertRun && fresh.some(a => !a.key.startsWith("24-"))) {
      if (soundOn()) beep();
      if (soundOn() && "Notification" in window && Notification.permission === "granted" && document.hidden) {
        try { new Notification("ระบบแจ้งซ่อม: " + fresh.length + " รายการใหม่", { body: fresh.slice(0, 3).map(a => a.j.job_no + " " + a.text).join("\n") }); } catch {}
      }
      $("#toast").textContent = fresh.length === 1 ? `${fresh[0].j.job_no}: ${fresh[0].text}` : `มีเรื่องต้องดูแลใหม่ ${fresh.length} รายการ`;
      $("#toast").hidden = false; clearTimeout(checkAlerts.t); checkAlerts.t = setTimeout(() => $("#toast").hidden = true, 8000);
    }
    // a once-a-session 24h summary popup, like the reference system's SLA popup
    if (firstAlertRun && list.some(a => a.key.startsWith("24-")) && !sessionStorage.getItem("rs-24")) {
      try { sessionStorage.setItem("rs-24", 1); } catch {}
      $("#toast").textContent = `มีงานค้างเกิน 24 ชั่วโมง ${list.filter(a => a.key.startsWith("24-")).length} ใบ กด “ดูรายการ” ด้านบน`; $("#toast").hidden = false;
      setTimeout(() => $("#toast").hidden = true, 10000);
    }
    firstAlertRun = false; void urgent;
  }
  document.addEventListener("click", e => {
    const t = e.target.closest("#alertToggle,[data-goto],#toast"); if (!t) return;
    e.preventDefault();
    if (t.id === "alertToggle") { const b = $("#alerts"); if (b.dataset.open) delete b.dataset.open; else b.dataset.open = 1; checkAlerts(); return; }
    if (t.id === "toast") { t.hidden = true; return; }
    view = "all"; $("#wStatus").value = ""; $("#wQ").value = (jobs.find(j => j.id === t.dataset.goto) || {}).job_no || ""; show("jobs");
  });

  /* ---------- dashboard ---------- */
  const day = d => new Date(d).toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
  if (!$("#dFrom").value) { $("#dTo").value = day(Date.now()); $("#dFrom").value = day(Date.now() - 29 * 864e5); }
  ["#dFrom", "#dTo"].forEach(s => $(s).addEventListener("change", render));
  const count = (arr, f) => Object.entries(arr.reduce((m, x) => { (Array.isArray(f(x)) ? f(x) : [f(x)]).forEach(k => { k = k || "ไม่ระบุ"; m[k] = (m[k] || 0) + 1; }); return m; }, {})).sort((a, b) => b[1] - a[1]);
  const bars = (el, pairs) => { const max = Math.max(1, ...pairs.map(p => p[1])); el.innerHTML = pairs.length ? pairs.map(([k, v]) => `<div class="bar"><span>${esc(k)}</span><i style="width:${v / max * 100}%"></i><em>${v}</em></div>`).join("") : `<div class="empty">ยังไม่มีข้อมูล</div>`; };
  function renderDash() {
    const f = $("#dFrom").value, t = $("#dTo").value;
    const inR = jobs.filter(j => { const d = day(j.created_at); return (!f || d >= f) && (!t || d <= t); });
    const open = jobs.filter(j => OPEN.includes(j.status)), closed = inR.filter(j => j.closed_at && j.status === "close");
    const avg = closed.length ? dur(Math.round(closed.reduce((s, j) => s + workMins(j, j.closed_at), 0) / closed.length)) : "-";
    const rated = inR.filter(j => j.rating), sat = rated.length ? (rated.reduce((s, j) => s + j.rating, 0) / rated.length).toFixed(1) + " / 5" : "-";
    const late = open.filter(isLate).length;
    $("#dKpi").innerHTML = [["ใบงานในช่วงนี้", inR.length], ["แจ้งวันนี้", jobs.filter(j => day(j.created_at) === day(Date.now())).length], ["ยังไม่ปิด", open.length],
      ["รอรับงาน", jobs.filter(j => j.status === "register").length], ["เกิน SLA ตอนนี้", late, 1], ["เวลาปิดงานเฉลี่ย", avg],
      ["รอตรวจงาน", jobs.filter(j => j.status === "clear").length], ["รออนุมัติพักงาน", jobs.filter(j => j.status === "on_hold" && j.hold_status === "pending").length, 1],
      ["พักงานอยู่", jobs.filter(j => j.status === "on_hold").length], ["เกินกำหนดเสร็จ", open.filter(j => overDue(j) > 1).length, 1],
      ["ความพึงพอใจเฉลี่ย", sat], ["ผู้แจ้งประเมินแล้ว", rated.length]]
      .map(([a, b, red]) => `<div class="kpi"><b style="${red && b > 0 ? "color:var(--bad)" : ""}">${b}</b><span>${a}</span></div>`).join("");
    bars($("#dType"), count(inR, j => typeOf(j.job_type_id)));
    bars($("#dTech"), count(open.filter(j => crewOf(j).length), j => crewOf(j).map(nameOf)));
    bars($("#dBld"), count(inR, j => j.building));
    bars($("#dHold"), count(open.filter(j => j.status === "on_hold"), j => j.hold_category || "ไม่ระบุ"));
    $("#dSla").innerHTML = "<tr><th>ความเร่งด่วน</th><th>SLA</th><th>ซ่อมเสร็จ</th><th>ทันเวลา</th><th>ค้างเกิน</th></tr>" + prios.map(p => {
      const done = inR.filter(j => j.priority_id === p.id && j.cleared_at), ok = done.filter(j => workMins(j, j.cleared_at) <= p.sla_minutes).length;
      return `<tr><td>${esc(p.name)}</td><td>${dur(p.sla_minutes)}</td><td>${done.length}</td><td>${done.length ? Math.round(ok / done.length * 100) + "%" : "-"}</td><td>${open.filter(j => j.priority_id === p.id && isLate(j)).length}</td></tr>`;
    }).join("") + `<tr><td colspan="5" class="meta">เวลา SLA ไม่นับช่วงพักงาน</td></tr>`;
  }
  $("#dExport").onclick = () => {
    const f = $("#dFrom").value, t = $("#dTo").value;
    const rows = jobs.filter(j => { const d = day(j.created_at); return (!f || d >= f) && (!t || d <= t); });
    const head = ["เลขใบงาน", "วันที่แจ้ง", "อาคาร", "ชั้น", "แผนก", "อุปกรณ์", "รายละเอียด", "ผู้แจ้ง", "เบอร์", "ประเภทงาน", "ความเร่งด่วน", "สถานะ", "ช่าง", "เหตุผลพักงาน", "หมายเหตุพักงาน", "วันนัด", "สรุปการซ่อม", "ใช้อะไหล่", "เวลาทำงาน (นาที)", "SLA (นาที)", "ทัน SLA", "ปิดงาน", "คะแนน"];
    const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const body = rows.map(j => [j.job_no, fmt(j.created_at), j.building, j.floor, j.department, j.equipment_text, j.detail, j.reporter_name, j.reporter_phone + (j.reporter_email ? " " + j.reporter_email : ""), typeOf(j.job_type_id), (prioOf(j) || {}).name, statusLabel(j),
      crewOf(j).map(nameOf).join(", "), j.hold_category, j.hold_reason, j.hold_until, j.summary, j.uses_parts ? "ใช้" : "", workMins(j), slaOf(j), workMins(j) <= slaOf(j) ? "ทัน" : "ไม่ทัน", fmt(j.closed_at), j.rating || ""].map(q).join(","));
    const blob = new Blob(["﻿" + [head.map(q).join(","), ...body].join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `ใบงาน-${H.code}-${f || "all"}-${t || ""}.csv` });
    document.body.appendChild(a); a.click(); a.remove();
  };

  /* ---------- setup ---------- */
  const msg = (el, err, okText) => $(el).innerHTML = err ? `<div class="note bad">${esc(errText(err))}</div>` : `<div class="note ok">${okText}</div>`;
  function renderSetup() {
    $("#sList").innerHTML = "<tr><th>ชื่อ</th><th>บทบาท</th><th>สถานะ</th><th></th></tr>" + staff.map(s => `<tr><td>${esc(s.full_name)}</td><td>${ROLES[s.role]}</td><td>${s.active ? "ใช้งาน" : "ปิดใช้"}</td>
      <td>${s.id !== me.id ? `<button class="btn small" type="button" data-staff-toggle="${s.id}">${s.active ? "ปิดใช้" : "เปิดใช้"}</button>` : ""}</td></tr>`).join("")
      + invites.map(i => `<tr><td>${esc(i.full_name || i.email)}<br><small class="mono">${esc(i.email)}</small></td><td>${ROLES[i.role]}</td><td>รอสมัครบัญชี</td><td></td></tr>`).join("");
    $("#pList").innerHTML = "<tr><th>ชื่อ</th><th>SLA</th><th>ค่าเริ่มต้นของฟอร์ม</th><th></th></tr>" + prios.map(p => `<tr><td>${esc(p.name)}</td><td>${dur(p.sla_minutes)}</td>
      <td>${p.is_default ? "✓" : `<button class="btn small" type="button" data-prio-default="${p.id}">ตั้งเป็นค่าเริ่มต้น</button>`}</td><td><button class="btn small" type="button" data-del="priorities:${p.id}">ลบ</button></td></tr>`).join("");
    $("#oList").innerHTML = "<tr><th>อาคาร</th><th>ชั้น</th><th>แผนก</th><th></th></tr>" + locs.map(l => `<tr><td>${esc(l.building)}</td><td>${esc(l.floor)}</td><td>${esc(l.department)}${l.active ? "" : " <small>(ซ่อน)</small>"}</td>
      <td><button class="btn small" type="button" data-loc-rename="${l.id}">แก้ชื่อ</button> <button class="btn small" type="button" data-loc-toggle="${l.id}">${l.active ? "ซ่อน" : "แสดง"}</button> <a class="btn small" href="qr.html?h=${encodeURIComponent(H.code)}&loc=${l.id}" target="_blank" rel="noopener">QR</a></td></tr>`).join("");
    $("#oQrAll").href = `qr.html?h=${encodeURIComponent(H.code)}`;
    $("#yList").innerHTML = "<tr><th>รหัส</th><th>ชื่อ</th><th>เวลามาตรฐาน</th><th>KPI</th><th></th></tr>" + types.map(t => `<tr><td class="mono">${esc(t.code)}</td><td>${esc(t.name)}</td><td>${t.standard_minutes ? dur(t.standard_minutes) : "-"}</td><td>${t.kpi ? "นับ" : "ไม่นับ"}</td>
      <td><button class="btn small" type="button" data-type-edit="${t.id}">แก้ไข</button> <button class="btn small" type="button" data-type-kpi="${t.id}">${t.kpi ? "ไม่นับ KPI" : "นับ KPI"}</button></td></tr>`).join("");
    $("#hList").innerHTML = "<tr><th>เหตุผลพักงาน</th><th></th></tr>" + reasons.map(r => `<tr><td>${esc(r.name)}${r.active ? "" : " <small>(ซ่อน)</small>"}</td><td><button class="btn small" type="button" data-reason-toggle="${r.id}">${r.active ? "ซ่อน" : "แสดง"}</button></td></tr>`).join("");
    const f = $("#fSet");
    f.gReqPhoto.checked = S.require_photo; f.gMax.value = S.max_photos; f.gUn.value = S.alert_unassigned_min; f.gNs.value = S.alert_not_started_min;
    f.gGrace.value = S.appointment_grace_min; f.gApprove.checked = S.hold_needs_approval;
  }
  $("#fSet").onsubmit = async e => {
    e.preventDefault(); const f = e.target;
    const { error } = await sb.from("hospital_settings").update({ require_photo: f.gReqPhoto.checked, max_photos: +f.gMax.value, alert_unassigned_min: +f.gUn.value,
      alert_not_started_min: +f.gNs.value, appointment_grace_min: +f.gGrace.value, hold_needs_approval: f.gApprove.checked, updated_at: new Date().toISOString() }).eq("hospital_id", H.id);
    msg("#gMsg", error, "บันทึกการตั้งค่าแล้ว"); if (!error) { await loadRefs(); render(); }
  };
  $("#fStaff").onsubmit = async e => { e.preventDefault(); const { data, error } = await sb.rpc("add_staff", { p_email: $("#sEmail").value, p_role: $("#sRole").value, p_full_name: $("#sName").value.trim() || null }); msg("#sMsg", error, data === "invited" ? "บันทึกแล้ว อีเมลนี้ยังไม่ได้สมัคร ให้เจ้าตัวเปิดหน้านี้แล้วกด “สมัครบัญชี” ด้วยอีเมลนี้ ระบบจะใส่สิทธิ์ให้อัตโนมัติ" : "บันทึกเจ้าหน้าที่แล้ว"); if (!error) { $("#sEmail").value = ""; $("#sName").value = ""; await loadRefs(); render(); } };
  $("#fPrio").onsubmit = async e => { e.preventDefault(); const { error } = await sb.from("priorities").insert({ hospital_id: H.id, name: $("#pName").value.trim(), sla_minutes: +$("#pSla").value, is_default: !prios.length }); msg("#pMsg", error, "เพิ่มแล้ว"); if (!error) { e.target.reset(); await loadRefs(); render(); } };
  $("#fLoc").onsubmit = async e => { e.preventDefault(); const { error } = await sb.from("locations").insert({ hospital_id: H.id, building: $("#oB").value.trim(), floor: $("#oF").value.trim(), department: $("#oD").value.trim() }); msg("#oMsg", error, "เพิ่มตำแหน่งแล้ว"); if (!error) { $("#oD").value = ""; await loadRefs(); render(); } };
  $("#fType").onsubmit = async e => { e.preventDefault(); const { error } = await sb.from("job_types").insert({ hospital_id: H.id, code: $("#yCode").value.trim(), name: $("#yName").value.trim(), standard_minutes: +$("#yStd").value || null, kpi: $("#yKpi").checked }); msg("#yMsg", error, "เพิ่มประเภทงานแล้ว"); if (!error) { e.target.reset(); await loadRefs(); render(); } };
  $("#fReason").onsubmit = async e => { e.preventDefault(); const { error } = await sb.from("hold_reasons").insert({ hospital_id: H.id, name: $("#hName").value.trim(), sort: reasons.length + 1 }); msg("#hMsg", error, "เพิ่มเหตุผลแล้ว"); if (!error) { e.target.reset(); await loadRefs(); render(); } };
  document.addEventListener("click", async e => {
    const t = e.target.closest("button"); if (!t) return; let r;
    if (t.dataset.staffToggle) { const s = staff.find(x => x.id === t.dataset.staffToggle); r = await sb.from("profiles").update({ active: !s.active }).eq("id", s.id); }
    else if (t.dataset.locRename) { const l = locs.find(x => x.id === t.dataset.locRename); const n = (window.prompt("ชื่อแผนกใหม่", l.department) || "").trim(); if (!n || n === l.department) return; r = await sb.from("locations").update({ department: n }).eq("id", l.id); }
    else if (t.dataset.locToggle) { const l = locs.find(x => x.id === t.dataset.locToggle); r = await sb.from("locations").update({ active: !l.active }).eq("id", l.id); }
    else if (t.dataset.reasonToggle) { const x = reasons.find(y => y.id === t.dataset.reasonToggle); r = await sb.from("hold_reasons").update({ active: !x.active }).eq("id", x.id); }
    else if (t.dataset.typeEdit) {
      const x = types.find(y => y.id === t.dataset.typeEdit);
      const n = (window.prompt("ชื่อประเภทงาน", x.name) || "").trim(); if (!n) return;
      const m = window.prompt("เวลามาตรฐาน (นาที) เว้นว่าง = ไม่เตือน", x.standard_minutes || ""); if (m === null) return;
      r = await sb.from("job_types").update({ name: n, standard_minutes: +m || null }).eq("id", x.id);
    }
    else if (t.dataset.typeKpi) { const x = types.find(y => y.id === t.dataset.typeKpi); r = await sb.from("job_types").update({ kpi: !x.kpi }).eq("id", x.id); }
    else if (t.dataset.prioDefault) { await sb.from("priorities").update({ is_default: false }).eq("hospital_id", H.id); r = await sb.from("priorities").update({ is_default: true }).eq("id", t.dataset.prioDefault); }
    else if (t.dataset.del) { const [tb, id] = t.dataset.del.split(":"); r = await sb.from(tb).delete().eq("id", id); }
    else return;
    if (r && r.error) alert(errText(r.error)); await loadRefs(); render();
  });

  function render() {
    if (!H) return;
    if (!$("#tab-jobs").hidden) renderJobs();
    if (!$("#tab-dash").hidden) renderDash();
    if (!$("#tab-setup").hidden) renderSetup();
  }
  setInterval(() => { if (!editing) render(); checkAlerts(); }, 30000);
})();
