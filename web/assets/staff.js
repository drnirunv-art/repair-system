(() => {
  const { sb, $, esc, STATUS, OPEN, fmt, mins, dur, pill, errText, opts } = RS;
  const ROLES = { owner: "Owner", admin: "Admin", chief_engineer: "Chief Engineer", supervisor: "Supervisor",
    senior_technician: "Senior Technician", technician: "Technician", safety_officer: "จป.", observer: "Observer" };
  const MANAGER = ["owner", "admin", "chief_engineer", "supervisor"];
  let me = null, H = null, staff = [], prios = [], types = [], locs = [], jobs = [], editing = null, channel = null;
  const isMgr = () => me && MANAGER.includes(me.role);
  const can = () => me && me.role !== "observer";
  const prioOf = j => prios.find(p => p.id === j.priority_id);
  const slaOf = j => (prioOf(j) || {}).sla_minutes || 1440;
  const isLate = j => ["register", "assign", "work_on", "on_hold"].includes(j.status) && mins(j.created_at) > slaOf(j);
  const nameOf = id => (staff.find(s => s.id === id) || {}).full_name || "";
  const typeOf = id => (types.find(t => t.id === id) || {}).name || "ไม่ระบุ";

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
  sb.auth.onAuthStateChange((_e, session) => boot(session));

  async function boot(session) {
    ["#login", "#pending", "#tab-jobs", "#tab-dash", "#tab-setup"].forEach(s => $(s).hidden = true);
    $("#tabs").hidden = true; $("#logout").hidden = !session; $("#who").textContent = "";
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
    await loadRefs(); await loadJobs();
    channel = sb.channel("jobs-" + H.id).on("postgres_changes", { event: "*", schema: "public", table: "jobs", filter: "hospital_id=eq." + H.id }, () => loadJobs()).subscribe();
    show(localTab());
  }
  function localTab() { try { return localStorage.getItem("rs-staff-tab") || "jobs"; } catch { return "jobs"; } }

  /* ---------- tabs ---------- */
  document.querySelectorAll("#tabs button").forEach(b => b.onclick = () => show(b.dataset.tab));
  function show(t) {
    if (t === "setup" && !isMgr()) t = "jobs";
    document.querySelectorAll("#tabs button").forEach(b => b.setAttribute("aria-selected", b.dataset.tab === t));
    ["jobs", "dash", "setup"].forEach(x => $("#tab-" + x).hidden = x !== t);
    try { localStorage.setItem("rs-staff-tab", t); } catch {}
    render();
  }

  /* ---------- data ---------- */
  async function loadRefs() {
    const [s, p, t, l] = await Promise.all([
      sb.from("profiles").select("id,full_name,role,active").eq("hospital_id", H.id).order("full_name"),
      sb.from("priorities").select("*").eq("hospital_id", H.id).order("sort").order("sla_minutes"),
      sb.from("job_types").select("*").eq("hospital_id", H.id).order("code"),
      sb.from("locations").select("*").eq("hospital_id", H.id).order("building").order("floor").order("department")]);
    staff = s.data || []; prios = p.data || []; types = t.data || []; locs = l.data || [];
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
    jobs = data; render();
  }

  /* ---------- jobs ---------- */
  function card(j) {
    const pr = prioOf(j), crit = pr && pr.sla_minutes <= 60;
    const b = (a, t, p) => `<button class="btn small${p ? " primary" : ""}" data-act="${a}" data-id="${j.id}">${t}</button>`;
    let acts = "";
    if (can()) {
      if (["register", "assign", "on_hold"].includes(j.status)) acts += b("assign", j.technician_id ? "เปลี่ยนช่าง" : "มอบหมายช่าง", j.status === "register");
      if (["assign", "on_hold"].includes(j.status)) acts += b("work_on", "เริ่มงาน", 1);
      if (j.status === "work_on") acts += b("clear", "ซ่อมเสร็จ", 1) + b("on_hold", "พักงาน");
      if (j.status === "clear" && isMgr()) acts += b("close", "ตรวจแล้ว ปิดงาน", 1) + b("reopen", "ส่งกลับแก้ไข");
      if (OPEN.includes(j.status) && isMgr()) acts += b("cancel", "ยกเลิกใบงาน");
      acts += b("history", "ประวัติ");
    }
    let inline = "";
    if (editing && editing.id === j.id) {
      const ok = a => `<div class="row" style="align-self:end"><button class="btn primary small" data-ok="${a}" data-id="${j.id}">บันทึก</button><button class="btn small" type="button" data-cancel>ยกเลิก</button></div>`;
      const a = editing.act;
      if (a === "assign") inline = `<label>ช่างผู้รับงาน<select id="iTech">${staff.filter(s => s.active && s.role !== "observer").map(s => `<option value="${s.id}" ${s.id === j.technician_id ? "selected" : ""}>${esc(s.full_name)}</option>`).join("")}</select></label>
        <label>ความเร่งด่วน<select id="iPrio">${prios.map(p => `<option value="${p.id}" ${p.id === j.priority_id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label>
        <label>ประเภทงาน<select id="iType"><option value="">ไม่ระบุ</option>${types.map(t => `<option value="${t.id}" ${t.id === j.job_type_id ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select></label>${ok("assign")}`;
      if (a === "on_hold") inline = `<label>เหตุผลที่หยุดงาน *<input id="iReason" placeholder="เช่น รออะไหล่"></label><label>วันนัดกลับมาทำ *<input id="iUntil" type="date"></label>${ok("on_hold")}`;
      if (a === "clear") inline = `<label class="span2">สรุปการซ่อม *<input id="iSum" placeholder="สาเหตุและสิ่งที่แก้ไข"></label><label>งานนี้ใช้อะไหล่ไหม *<select id="iParts"><option value="false">ไม่ใช้อะไหล่</option><option value="true">ใช้อะไหล่</option></select></label>${ok("clear")}`;
      if (a === "reopen" || a === "cancel") inline = `<label class="span2">เหตุผล *<input id="iNote"></label>${ok(a)}`;
      if (a === "history") inline = `<div class="full" id="hist-${j.id}">กำลังโหลด…</div><div class="row"><button class="btn small" type="button" data-cancel>ปิด</button></div>`;
      inline = `<div class="inline">${inline}</div>`;
    }
    const age = j.closed_at ? "ใช้เวลา " + dur(mins(j.created_at, j.closed_at)) : "ผ่านไป " + dur(mins(j.created_at));
    return `<article class="job${isLate(j) ? " late" : ""}">
      <div><div class="meta"><span class="mono">${esc(j.job_no)}</span><span>${fmt(j.created_at)}</span><span>${esc(typeOf(j.job_type_id))}</span></div>
        <h4>${esc(j.detail)}${j.equipment_text ? ` <span style="color:var(--muted);font-weight:500">(${esc(j.equipment_text)})</span>` : ""}</h4>
        <div class="meta"><span>${[j.building, j.floor, j.department].map(esc).join(" · ")}</span><span>ผู้แจ้ง ${esc(j.reporter_name)} ${esc(j.reporter_phone)}</span>${j.technician_id ? `<span>ช่าง ${esc(nameOf(j.technician_id))}</span>` : ""}</div>
        ${j.status === "on_hold" ? `<div class="meta" style="color:var(--s-on_hold)">พักงาน: ${esc(j.hold_reason)} · นัด ${esc(j.hold_until)}</div>` : ""}
        ${j.summary ? `<div class="meta">สรุปการซ่อม: ${esc(j.summary)}${j.uses_parts ? " · ใช้อะไหล่" : ""}</div>` : ""}
        ${j.photo_paths && j.photo_paths.length ? `<div class="meta"><a href="#" data-photo="${esc(j.photo_paths[0])}">ดูรูปที่แนบ</a></div>` : ""}</div>
      <div class="side">${pill(j.status)}${pr ? `<span class="pr${crit ? " crit" : ""}">${esc(pr.name)}</span>` : ""}<span class="meta">${age}${isLate(j) ? ' · <b style="color:var(--bad)">เกิน SLA</b>' : ""}</span></div>
      ${acts ? `<div class="acts">${acts}</div>` : ""}${inline}</article>`;
  }
  const match = (j, q) => !q || [j.job_no, j.reporter_phone, j.reporter_name, j.detail, j.department, j.equipment_text].some(x => String(x || "").toLowerCase().includes(q));
  function renderJobs() {
    const s = $("#wStatus").value, t = $("#wTech").value, ty = $("#wType").value, q = $("#wQ").value.trim().toLowerCase();
    const list = jobs.filter(j => (s === "open" ? OPEN.includes(j.status) : !s || j.status === s) && (!t || j.technician_id === t) && (!ty || j.job_type_id === ty) && match(j, q))
      .sort((a, b) => (isLate(b) - isLate(a)) || (slaOf(a) - slaOf(b)) || b.created_at.localeCompare(a.created_at)).slice(0, 300);
    $("#wList").innerHTML = (can() ? "" : `<div class="note">บัญชี Observer ดูได้อย่างเดียว</div>`) +
      (list.length ? list.map(card).join("") : `<div class="empty">ยังไม่มีใบงานในตัวกรองนี้ ใบงานใหม่จากหน้าแจ้งซ่อมจะขึ้นที่นี่ทันที</div>`);
    if (editing && editing.act === "history") loadHistory(editing.id);
  }
  async function loadHistory(id) {
    const { data } = await sb.from("job_events").select("status,note,actor_id,created_at").eq("job_id", id).order("created_at");
    const el = $("#hist-" + id); if (!el) return;
    el.innerHTML = (data || []).map(h => `<div class="meta"><span class="mono">${fmt(h.created_at)}</span><span>${STATUS[h.status]}</span><span>${esc(h.note || "")}</span><span>${esc(nameOf(h.actor_id))}</span></div>`).join("") || "ไม่มีประวัติ";
  }
  async function transition(id, status, extra = {}) {
    const { error } = await sb.rpc("job_transition", { p_job_id: id, p_status: status, ...extra });
    if (error) { alertBar(errText(error)); return; }
    editing = null; await loadJobs();
  }
  function alertBar(m) { $("#wList").insertAdjacentHTML("afterbegin", `<div class="note bad">${esc(m)}</div>`); }
  document.addEventListener("click", async e => {
    const t = e.target.closest("button,a"); if (!t) return;
    if (t.dataset.photo !== undefined) { e.preventDefault(); const { data } = await sb.storage.from("job-photos").createSignedUrl(t.dataset.photo, 300); if (data) window.open(data.signedUrl, "_blank", "noopener"); return; }
    if (t.dataset.cancel !== undefined) { e.preventDefault(); editing = null; render(); return; }
    if (t.dataset.act) {
      const id = t.dataset.id, a = t.dataset.act;
      if (a === "work_on") return transition(id, "work_on", { p_note: "เริ่มงาน" });
      if (a === "close") return transition(id, "close", { p_note: "ตรวจงานและปิดงาน" });
      editing = { id, act: a }; render(); return;
    }
    if (t.dataset.ok) {
      e.preventDefault();
      const id = t.dataset.id, a = t.dataset.ok, v = s => ($(s) ? $(s).value.trim() : "");
      if (a === "assign") return transition(id, "assign", { p_technician_id: v("#iTech") || null, p_priority_id: v("#iPrio") || null, p_job_type_id: v("#iType") || null, p_note: "มอบหมาย " + nameOf(v("#iTech")) });
      if (a === "on_hold") return transition(id, "on_hold", { p_hold_reason: v("#iReason"), p_hold_until: v("#iUntil") || null, p_note: v("#iReason") });
      if (a === "clear") return transition(id, "clear", { p_summary: v("#iSum"), p_uses_parts: v("#iParts") === "true", p_note: v("#iSum") });
      if (a === "reopen") return v("#iNote") && transition(id, "work_on", { p_note: "ส่งกลับ: " + v("#iNote") });
      if (a === "cancel") return v("#iNote") && transition(id, "cancel", { p_note: "ยกเลิก: " + v("#iNote") });
    }
  });
  ["#wStatus", "#wTech", "#wType"].forEach(s => $(s).addEventListener("change", render));
  $("#wQ").addEventListener("input", render);

  /* ---------- dashboard ---------- */
  const day = d => new Date(d).toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
  if (!$("#dFrom").value) { $("#dTo").value = day(Date.now()); $("#dFrom").value = day(Date.now() - 29 * 864e5); }
  ["#dFrom", "#dTo"].forEach(s => $(s).addEventListener("change", render));
  const count = (arr, f) => Object.entries(arr.reduce((m, x) => { const k = f(x) || "ไม่ระบุ"; m[k] = (m[k] || 0) + 1; return m; }, {})).sort((a, b) => b[1] - a[1]);
  const bars = (el, pairs) => { const max = Math.max(1, ...pairs.map(p => p[1])); el.innerHTML = pairs.length ? pairs.map(([k, v]) => `<div class="bar"><span>${esc(k)}</span><i style="width:${v / max * 100}%"></i><em>${v}</em></div>`).join("") : `<div class="empty">ยังไม่มีข้อมูล</div>`; };
  function renderDash() {
    const f = $("#dFrom").value, t = $("#dTo").value;
    const inR = jobs.filter(j => { const d = day(j.created_at); return (!f || d >= f) && (!t || d <= t); });
    const open = jobs.filter(j => OPEN.includes(j.status)), closed = inR.filter(j => j.closed_at && j.status === "close");
    const avg = closed.length ? dur(Math.round(closed.reduce((s, j) => s + mins(j.created_at, j.closed_at), 0) / closed.length)) : "-";
    const late = open.filter(isLate).length;
    $("#dKpi").innerHTML = [["ใบงานในช่วงนี้", inR.length], ["แจ้งวันนี้", jobs.filter(j => day(j.created_at) === day(Date.now())).length], ["ยังไม่ปิด", open.length],
      ["รอรับงาน", jobs.filter(j => j.status === "register").length], ["เกิน SLA ตอนนี้", late], ["เวลาปิดงานเฉลี่ย", avg]]
      .map(([a, b], i) => `<div class="kpi"><b style="${i === 4 && b > 0 ? "color:var(--bad)" : ""}">${b}</b><span>${a}</span></div>`).join("");
    bars($("#dType"), count(inR, j => typeOf(j.job_type_id)));
    bars($("#dTech"), count(open.filter(j => j.technician_id), j => nameOf(j.technician_id)));
    bars($("#dBld"), count(inR, j => j.building));
    $("#dSla").innerHTML = "<tr><th>ความเร่งด่วน</th><th>SLA</th><th>ซ่อมเสร็จ</th><th>ทันเวลา</th><th>ค้างเกิน</th></tr>" + prios.map(p => {
      const done = inR.filter(j => j.priority_id === p.id && j.cleared_at), ok = done.filter(j => mins(j.created_at, j.cleared_at) <= p.sla_minutes).length;
      return `<tr><td>${esc(p.name)}</td><td>${dur(p.sla_minutes)}</td><td>${done.length}</td><td>${done.length ? Math.round(ok / done.length * 100) + "%" : "-"}</td><td>${open.filter(j => j.priority_id === p.id && isLate(j)).length}</td></tr>`;
    }).join("");
  }

  /* ---------- setup ---------- */
  const msg = (el, err, okText) => $(el).innerHTML = err ? `<div class="note bad">${esc(errText(err))}</div>` : `<div class="note ok">${okText}</div>`;
  function renderSetup() {
    $("#sList").innerHTML = "<tr><th>ชื่อ</th><th>บทบาท</th><th>สถานะ</th><th></th></tr>" + staff.map(s => `<tr><td>${esc(s.full_name)}</td><td>${ROLES[s.role]}</td><td>${s.active ? "ใช้งาน" : "ปิดใช้"}</td>
      <td>${s.id !== me.id ? `<button class="btn small" type="button" data-staff-toggle="${s.id}">${s.active ? "ปิดใช้" : "เปิดใช้"}</button>` : ""}</td></tr>`).join("");
    $("#pList").innerHTML = "<tr><th>ชื่อ</th><th>SLA</th><th>ค่าเริ่มต้นของฟอร์ม</th><th></th></tr>" + prios.map(p => `<tr><td>${esc(p.name)}</td><td>${dur(p.sla_minutes)}</td>
      <td>${p.is_default ? "✓" : `<button class="btn small" type="button" data-prio-default="${p.id}">ตั้งเป็นค่าเริ่มต้น</button>`}</td><td><button class="btn small" type="button" data-del="priorities:${p.id}">ลบ</button></td></tr>`).join("");
    $("#oList").innerHTML = "<tr><th>อาคาร</th><th>ชั้น</th><th>แผนก</th><th></th></tr>" + locs.map(l => `<tr><td>${esc(l.building)}</td><td>${esc(l.floor)}</td><td>${esc(l.department)}</td>
      <td><button class="btn small" type="button" data-loc-toggle="${l.id}">${l.active ? "ซ่อน" : "แสดง"}</button></td></tr>`).join("");
    $("#yList").innerHTML = "<tr><th>รหัส</th><th>ชื่อ</th><th>เวลามาตรฐาน</th><th>KPI</th></tr>" + types.map(t => `<tr><td class="mono">${esc(t.code)}</td><td>${esc(t.name)}</td><td>${t.standard_minutes ? dur(t.standard_minutes) : "-"}</td><td>${t.kpi ? "นับ" : "ไม่นับ"}</td></tr>`).join("");
  }
  $("#fStaff").onsubmit = async e => { e.preventDefault(); const { error } = await sb.rpc("assign_staff", { p_email: $("#sEmail").value, p_role: $("#sRole").value, p_full_name: $("#sName").value.trim() || null }); msg("#sMsg", error, "บันทึกเจ้าหน้าที่แล้ว"); if (!error) { $("#sEmail").value = ""; $("#sName").value = ""; await loadRefs(); render(); } };
  $("#fPrio").onsubmit = async e => { e.preventDefault(); const { error } = await sb.from("priorities").insert({ hospital_id: H.id, name: $("#pName").value.trim(), sla_minutes: +$("#pSla").value, is_default: !prios.length }); msg("#pMsg", error, "เพิ่มแล้ว"); if (!error) { e.target.reset(); await loadRefs(); render(); } };
  $("#fLoc").onsubmit = async e => { e.preventDefault(); const { error } = await sb.from("locations").insert({ hospital_id: H.id, building: $("#oB").value.trim(), floor: $("#oF").value.trim(), department: $("#oD").value.trim() }); msg("#oMsg", error, "เพิ่มตำแหน่งแล้ว"); if (!error) { $("#oD").value = ""; await loadRefs(); render(); } };
  $("#fType").onsubmit = async e => { e.preventDefault(); const { error } = await sb.from("job_types").insert({ hospital_id: H.id, code: $("#yCode").value.trim(), name: $("#yName").value.trim(), standard_minutes: +$("#yStd").value || null, kpi: $("#yKpi").checked }); msg("#yMsg", error, "เพิ่มประเภทงานแล้ว"); if (!error) { e.target.reset(); await loadRefs(); render(); } };
  document.addEventListener("click", async e => {
    const t = e.target.closest("button"); if (!t) return; let r;
    if (t.dataset.staffToggle) { const s = staff.find(x => x.id === t.dataset.staffToggle); r = await sb.from("profiles").update({ active: !s.active }).eq("id", s.id); }
    else if (t.dataset.locToggle) { const l = locs.find(x => x.id === t.dataset.locToggle); r = await sb.from("locations").update({ active: !l.active }).eq("id", l.id); }
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
  setInterval(() => { if (!editing) render(); }, 60000);
})();
