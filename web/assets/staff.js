(() => {
  const { sb, $, esc, STATUS, OPEN, fmt, fmtDate, mins, dur, pill, statusLabel, errText, opts, workMins, uploadMedia, isVideo, signed } = RS;
  const ROLES = { owner: "Owner", admin: "Admin", chief_engineer: "Chief Engineer", supervisor: "Supervisor",
    senior_technician: "Senior Technician", technician: "Technician", safety_officer: "จป.", observer: "Observer" };
  const MANAGER = ["owner", "admin", "chief_engineer", "supervisor"];
  const APPROVER = ["owner", "admin", "chief_engineer"];
  const HOLD_STATUS = { pending: "รอ Owner อนุมัติ", ack: "รับทราบแล้ว", ack_memo: "รับทราบ + ขอ Memo", rejected: "ไม่อนุมัติ" };
  let invites = [], me = null, H = null, staff = [], prios = [], types = [], locs = [], jobs = [], assignees = [], reasons = [];
  const grpOf = name => (reasons.find(r => r.name === name) || {}).grp || "";
  function reasonOptions() {
    const act = reasons.filter(r => r.active), groups = [...new Set(act.map(r => r.grp || "อื่น ๆ"))];
    return groups.map(g => `<optgroup label="${esc(g)}">${act.filter(r => (r.grp || "อื่น ๆ") === g).map(r => `<option>${esc(r.name)}</option>`).join("")}</optgroup>`).join("");
  }
  let parts = [], moves = [], prs = [], prItems = [], memos = [], docForm = null;
  const PR_STATUS = { requested: "รออนุมัติ", approved: "อนุมัติแล้ว", rejected: "ไม่อนุมัติ", ordered: "สั่งซื้อแล้ว", received: "ได้รับของแล้ว", cancel: "ยกเลิก" };
  const MEMO_STATUS = { submitted: "รออนุมัติ", approved: "อนุมัติแล้ว", rejected: "ไม่อนุมัติ", cancel: "ยกเลิก" };
  const MOVE = { receive: "รับเข้า", issue: "เบิก", return: "คืน", adjust: "ปรับยอด" };
  const baht = n => Number(n || 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const qtyf = n => Number(n || 0).toLocaleString("th-TH", { maximumFractionDigits: 2 });
  const TABS = ["jobs", "inbox", "parts", "docs", "dash", "report", "setup"];
  let S = { require_photo: false, max_photos: 6, alert_unassigned_min: 5, alert_not_started_min: 10, appointment_grace_min: 120, hold_needs_approval: true };
  let editing = null, channel = null, view = "all", seenAlerts = new Set(), firstAlertRun = true;
  let layout = "card", byTech = false, openRow = null, knownNew = null;
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
    ["#login", "#pending", ...TABS.map(x => "#tab-" + x)].forEach(s => $(s).hidden = true);
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
    document.querySelectorAll("[data-approver]").forEach(b => b.hidden = !isApprover());
    view = store.get("rs-view", MANAGER.includes(me.role) ? "all" : "mine"); layout = store.get("rs-layout", "card") === "table" ? "table" : "card";
    await loadRefs(); await loadDocs(); await loadJobs();
    channel = sb.channel("jobs-" + H.id)
      .on("postgres_changes", { event: "*", schema: "public", table: "jobs", filter: "hospital_id=eq." + H.id }, () => loadJobs())
      .on("postgres_changes", { event: "*", schema: "public", table: "job_assignees" }, () => loadJobs())
      .on("postgres_changes", { event: "*", schema: "public", table: "parts", filter: "hospital_id=eq." + H.id }, () => loadDocs().then(render))
      .on("postgres_changes", { event: "*", schema: "public", table: "purchase_requests", filter: "hospital_id=eq." + H.id }, () => loadDocs().then(render))
      .on("postgres_changes", { event: "*", schema: "public", table: "memos", filter: "hospital_id=eq." + H.id }, () => loadDocs().then(render)).subscribe();
    show(store.get("rs-staff-tab", "jobs"));
    bellLabel();
  }

  /* ---------- tabs and quick views ---------- */
  document.querySelectorAll("#tabs button").forEach(b => b.onclick = () => show(b.dataset.tab));
  function show(t) {
    if ((t === "setup" && !isMgr()) || (t === "inbox" && !isApprover()) || !TABS.includes(t)) t = "jobs";
    document.querySelectorAll("#tabs button").forEach(b => b.setAttribute("aria-selected", b.dataset.tab === t));
    TABS.forEach(x => $("#tab-" + x).hidden = x !== t);
    store.set("rs-staff-tab", t);
    render();
  }
  const VIEWS = [["all", "ทั้งหมด"], ["mine", "งานของฉัน"], ["review", "รอตรวจงาน"], ["approve", "รออนุมัติพักงาน"], ["appoint", "นัดหมาย"]];
  function renderViews() {
    const n = { all: jobs.filter(j => OPEN.includes(j.status)).length, mine: jobs.filter(j => OPEN.includes(j.status) && mine(j)).length,
      review: jobs.filter(j => j.status === "clear").length, approve: jobs.filter(j => j.status === "on_hold" && j.hold_status === "pending").length,
      appoint: jobs.filter(j => OPEN.includes(j.status) && (j.appointment_at || j.hold_until)).length };
    $("#wViews").innerHTML = VIEWS.map(([k, l]) => `<button type="button" class="chip" data-view="${k}" aria-pressed="${view === k}">${l}<b>${n[k]}</b></button>`).join("")
      + `<span style="flex:1"></span><button type="button" class="chip" data-bytech aria-pressed="${byTech}">งานยังไม่ปิด รายช่าง</button>
        <button type="button" class="chip" data-layout="card" aria-pressed="${layout === "card"}">การ์ด</button><button type="button" class="chip" data-layout="table" aria-pressed="${layout === "table"}">ตาราง</button>`;
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
    const fresh = jobs.filter(j => j.status === "register").map(j => j.id);
    if (knownNew && can()) { const n = fresh.filter(id => !knownNew.has(id)).length; if (n) newJobPopup(n, fresh.length); }
    knownNew = new Set(fresh);
    render(); checkAlerts();
  }
  function newJobPopup(n, waiting) {
    const d = $("#newJobs"); if (!d) return;
    $("#newJobsText").textContent = `งานใหม่ ${n} ใบ · รอรับงานทั้งหมด ${waiting} ใบ`;
    if (soundOn()) beep();
    if (!d.open) d.showModal();
  }
  // parts, stock moves, purchase requests and memos (phase B)
  async function loadDocs() {
    const since = new Date(Date.now() - 400 * 864e5).toISOString();
    const [p, m, r, mm] = await Promise.all([
      sb.from("parts").select("*").eq("hospital_id", H.id).order("code"),
      sb.from("part_moves").select("*").eq("hospital_id", H.id).gte("created_at", since).order("created_at", { ascending: false }).limit(5000),
      sb.from("purchase_requests").select("*").eq("hospital_id", H.id).order("created_at", { ascending: false }).limit(1000),
      sb.from("memos").select("*").eq("hospital_id", H.id).order("created_at", { ascending: false }).limit(1000)]);
    parts = p.data || []; moves = m.data || []; prs = r.data || []; memos = mm.data || [];
    prItems = [];
    const ids = prs.map(x => x.id);
    for (let i = 0; i < ids.length; i += 150) { const it = await sb.from("pr_items").select("*").in("pr_id", ids.slice(i, i + 150)).order("id"); if (it.data) prItems.push(...it.data); }
    inboxBadge();
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
    if (a === "on_hold") return `<label>เหตุผลที่พักงาน *<select id="iCat">${reasonOptions()}</select></label>
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
    if (a === "parts") return `<label class="span2">อะไหล่ *<select id="iPart">${partOpts(editing.part)}</select></label>
        <label>รายการ<select id="iKind"><option value="issue">เบิกใช้กับงานนี้</option><option value="return">คืนเข้าคลัง</option></select></label>
        <label>จำนวน *<input id="iQty" type="number" min="0" step="any" value="1"></label><label class="span2">หมายเหตุ<input id="iNote" placeholder="ไม่บังคับ"></label>
        ${parts.some(p => p.active) ? ok("parts") : `<div class="full note">ยังไม่มีอะไหล่ในคลัง ให้หัวหน้าเพิ่มที่แท็บ “อะไหล่” ก่อน หรือกด “ขอซื้อ”</div><div class="row"><button class="btn small" type="button" data-cancel>ปิด</button></div>`}`;
    if (a === "pr") return prForm(j.id, ok("pr"));
    if (a === "memo") return memoForm(j, null, ok("memo"));
    if (a === "reopen" || a === "cancel") return `<label class="span2">เหตุผล *<input id="iNote"></label>${ok(a)}`;
    if (a === "history") return `<div class="full" id="hist-${j.id}">กำลังโหลด…</div><div class="row"><button class="btn small" type="button" data-cancel>ปิด</button></div>`;
    return "";
  }
  /* ---------- phase B forms shared by job cards and the documents tab ---------- */
  const partOpts = (sel, withStock = true) => parts.filter(p => p.active).map(p => `<option value="${p.id}" ${p.id === sel ? "selected" : ""}>${esc(p.code)} · ${esc(p.name)}${withStock ? ` (เหลือ ${qtyf(p.qty)} ${esc(p.unit)})` : ""}</option>`).join("");
  const prRow = () => `<tr><td><select data-pr-part><option value="">— พิมพ์เอง —</option>${partOpts(null, false)}</select></td><td><input data-pr-desc placeholder="ชื่อรายการ"></td>
    <td style="width:80px"><input data-pr-qty type="number" min="0" step="any" value="1"></td><td style="width:80px"><input data-pr-unit value="ชิ้น"></td><td style="width:110px"><input data-pr-price type="number" min="0" step="any" value="0"></td>
    <td><button class="btn small" type="button" data-pr-del>ลบ</button></td></tr>`;
  const prForm = (jobId, ok) => `<label class="span2">เหตุผลที่ขอซื้อ *<input id="prReason" placeholder="เช่น คอมเพรสเซอร์เสีย ไม่มีในสต็อก"></label>
    <label>ต้องการภายในวันที่<input id="prNeed" type="date"></label><label>ผู้ขาย / ร้าน (ถ้าทราบ)<input id="prSup"></label>
    ${jobId ? "" : `<label class="span2">ผูกกับใบงาน (ไม่บังคับ)<select id="prJob"><option value="">ไม่ผูกใบงาน</option>${jobs.filter(j => OPEN.includes(j.status)).map(j => `<option value="${j.id}">${esc(j.job_no)} · ${esc((j.detail || "").slice(0, 40))}</option>`).join("")}</select></label>`}
    <div class="full scroll"><table class="items"><thead><tr><th>อะไหล่ในคลัง</th><th>รายการ *</th><th>จำนวน *</th><th>หน่วย</th><th>ราคา/หน่วย</th><th></th></tr></thead><tbody id="prRows">${prRow()}</tbody></table>
      <div class="row" style="margin-top:6px"><button class="btn small" type="button" data-pr-add>+ เพิ่มรายการ</button><span class="meta" id="prSum"></span></div></div>${ok}`;
  const memoForm = (job, prId, ok) => `<label class="span2">เรื่อง *<input id="mSubj" value="${esc(job ? "ขออนุมัติดำเนินการซ่อม " + job.job_no : "")}"></label><label>เรียน *<input id="mTo" placeholder="เช่น ผู้อำนวยการโรงพยาบาล"></label>
    <label class="full">รายละเอียด *<textarea id="mBody">${esc(job ? `ตามใบงานแจ้งซ่อมเลขที่ ${job.job_no} (${[job.building, job.floor, job.department].filter(Boolean).join(" ")}) อาการ: ${job.detail}${job.hold_category ? `\nสถานะ: พักงาน (${job.hold_category}${job.hold_reason ? " - " + job.hold_reason : ""})` : ""}\n\nจึงเรียนมาเพื่อโปรดพิจารณาอนุมัติ` : "")}</textarea></label>
    <label>จำนวนเงิน (บาท ถ้ามี)<input id="mAmt" type="number" min="0" step="any"></label>
    <label class="span2">อ้างอิงใบขอซื้อ<select id="mPr"><option value="">ไม่อ้างอิง</option>${prs.filter(x => x.status !== "cancel" && (!job || x.job_id === job.id || !x.job_id)).map(x => `<option value="${x.id}" ${x.id === prId ? "selected" : ""}>${esc(x.pr_no)} · ${baht(x.total)} บาท</option>`).join("")}</select></label>${ok}`;
  function prItemsFromForm() {
    return [...document.querySelectorAll("#prRows tr")].map(r => ({ part_id: r.querySelector("[data-pr-part]").value || null, description: r.querySelector("[data-pr-desc]").value.trim(),
      qty: +r.querySelector("[data-pr-qty]").value, unit: r.querySelector("[data-pr-unit]").value.trim(), unit_price: +r.querySelector("[data-pr-price]").value || 0 }))
      .filter(x => x.part_id || x.description);
  }
  function prSum() { const s = prItemsFromForm().reduce((a, x) => a + (x.qty || 0) * (x.unit_price || 0), 0); if ($("#prSum")) $("#prSum").textContent = "รวม " + baht(s) + " บาท"; }
  const jobParts = j => {
    const m = {}; moves.filter(x => x.job_id === j.id && (x.kind === "issue" || x.kind === "return")).forEach(x => { m[x.part_id] = m[x.part_id] || { q: 0, c: 0 }; m[x.part_id].q -= x.qty; m[x.part_id].c -= x.qty * x.unit_cost; });
    return Object.entries(m).filter(([, v]) => v.q > 0).map(([id, v]) => { const p = parts.find(x => x.id === id) || {}; return { name: p.name || "?", unit: p.unit || "", q: v.q, c: v.c }; });
  };

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
      if (!["close", "cancel"].includes(j.status)) acts += b("parts", "เบิกอะไหล่");
      if (OPEN.includes(j.status)) acts += b("pr", "ขอซื้อ") + b("memo", "เขียน Memo", j.memo_requested && !memos.some(m => m.job_id === j.id && m.status !== "cancel"));
      if (OPEN.includes(j.status) && isMgr()) acts += b("edit", "แก้ไขใบงาน") + b("cancel", "ยกเลิกใบงาน");
      if (["clear", "close"].includes(j.status) && j.summary) acts += `<a class="btn small" href="ops.html?tab=kb&job=${j.id}">บันทึกเป็นวิธีแก้</a>`;
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
        ${j.memo_requested && !memos.some(m => m.job_id === j.id && m.status !== "cancel") ? `<div class="meta"><b>ขอ Memo</b> สำหรับงานนี้ (ยังไม่ได้เขียน)</div>` : ""}
        ${(() => { const u = jobParts(j); return u.length ? `<div class="meta">อะไหล่ที่ใช้: ${u.map(x => `${esc(x.name)} ${qtyf(x.q)} ${esc(x.unit)}`).join(", ")} · รวม ${baht(u.reduce((s, x) => s + x.c, 0))} บาท</div>` : ""; })()}
        ${(() => { const d = [...prs.filter(x => x.job_id === j.id).map(x => `<a href="doc.html?pr=${x.id}" target="_blank" rel="noopener" class="mono">${esc(x.pr_no)}</a> <span class="st ${x.status}">${PR_STATUS[x.status]}</span>`),
          ...memos.filter(x => x.job_id === j.id).map(x => `<a href="doc.html?memo=${x.id}" target="_blank" rel="noopener" class="mono">${esc(x.memo_no)}</a> <span class="st ${x.status}">${MEMO_STATUS[x.status]}</span>`)];
          return d.length ? `<div class="meta">เอกสาร: ${d.join(" ")}</div>` : ""; })()}
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
  // compact one-line-per-job table (like a spreadsheet); "จัดการ" opens the full card under the row
  const timer = j => j.status === "on_hold" && j.hold_started_at ? "พักมา " + dur(mins(j.hold_started_at)) : j.status === "work_on" && j.started_at ? "ทำมา " + dur(mins(j.started_at)) : j.status === "register" ? "รอ " + dur(mins(j.created_at)) : "";
  function tableOf(list) {
    return `<div class="scroll"><table class="jt"><thead><tr><th>#</th><th>เลขใบงาน</th><th>วันที่แจ้ง</th><th>เกิน</th><th>สถานที่</th><th>รายละเอียด</th><th>ผู้แจ้ง</th><th>ช่างที่รับงาน</th><th>สถานะ</th><th></th></tr></thead><tbody>${list.map((j, i) => {
      const days = OPEN.includes(j.status) ? Math.floor(mins(j.created_at) / 1440) : 0, crew = crewOf(j), open = openRow === j.id || (editing && editing.id === j.id), n = (j.photo_paths || []).length + (j.before_photo_paths || []).length;
      return `<tr class="${isLate(j) || overDue(j) > 1 ? "late" : ""}"><td>${i + 1}</td><td class="mono">${esc(j.job_no)}</td><td>${fmt(j.created_at)}</td><td>${days ? `<span class="od">${days}</span>` : ""}</td>
        <td><b>${esc(j.building || "")}</b><br><small>${[j.floor, j.department].filter(Boolean).map(esc).join(" / ")}</small></td><td class="dt">${esc(j.detail)}${n ? ` <small>📷 ${n}</small>` : ""}</td>
        <td>${esc(j.reporter_name)}<br><small>${esc(j.reporter_phone)}</small></td><td>${crew.map(id => esc(nameOf(id))).join(", ") || "-"}</td>
        <td>${pill(j.status, statusLabel(j))}${j.status === "on_hold" ? `<br><small>${esc(j.hold_category || "")}${j.hold_status ? " · <b>" + HOLD_STATUS[j.hold_status] + "</b>" : ""}</small>` : ""}${timer(j) ? `<br><small>⏱ ${timer(j)}</small>` : ""}${isLate(j) ? '<br><small style="color:var(--bad);font-weight:700">เกิน SLA</small>' : ""}</td>
        <td><button class="btn small" type="button" data-row="${j.id}">${open ? "ปิด" : "จัดการ"}</button></td></tr>${open ? `<tr class="jopen"><td colspan="10">${card(j)}</td></tr>` : ""}`; }).join("")}</tbody></table></div>`;
  }
  // open jobs per technician; tap a name to filter the list
  function techBoard() {
    const rows = staff.filter(s => s.active && s.role !== "observer").map(s => { const mineJobs = jobs.filter(j => crewOf(j).includes(s.id)); const c = st => mineJobs.filter(j => j.status === st).length;
      return { s, a: c("assign"), w: c("work_on"), h: c("on_hold"), r: c("clear") }; }).map(x => ({ ...x, t: x.a + x.w + x.h })).sort((x, y) => y.t - x.t);
    return `<div class="panel" style="margin-bottom:12px"><b>งานยังไม่ปิด รายช่าง</b> <small style="color:var(--muted)">กดชื่อเพื่อดูเฉพาะงานของช่างคนนั้น</small><div class="scroll"><table><thead><tr><th>ช่าง</th><th>รวมยังไม่ปิด</th><th>มอบหมายแล้ว</th><th>กำลังซ่อม</th><th>พักงาน</th><th>ซ่อมเสร็จ รอตรวจ</th></tr></thead><tbody>
      ${rows.map(x => `<tr><td><a href="#" data-pick-tech="${x.s.id}">${esc(x.s.full_name || "(ไม่มีชื่อ)")}</a></td><td><b>${x.t}</b></td><td>${x.a}</td><td>${x.w}</td><td>${x.h}</td><td>${x.r}</td></tr>`).join("")}
      <tr><td>ยังไม่มีคนรับ</td><td><b>${jobs.filter(j => j.status === "register").length}</b></td><td colspan="4"></td></tr></tbody></table></div></div>`;
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
    } else if (layout === "table") html += tableOf(list.slice(0, 300));
    else html += list.slice(0, 300).map(card).join("");
    if (byTech) html = techBoard() + html;
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
    if (t.dataset.layout) { layout = t.dataset.layout; store.set("rs-layout", layout); openRow = null; render(); return; }
    if (t.dataset.bytech !== undefined) { byTech = !byTech; render(); return; }
    if (t.dataset.row) { openRow = openRow === t.dataset.row ? null : t.dataset.row; if (editing && editing.id === t.dataset.row) editing = null; render(); return; }
    if (t.dataset.pickTech) { e.preventDefault(); view = "all"; $("#wTech").value = t.dataset.pickTech; $("#wStatus").value = "open"; render(); return; }
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
        if (a === "parts") {
          if (!(+v("#iQty") > 0)) throw new Error("ใส่จำนวนให้ถูกต้อง");
          const { error } = await sb.rpc("part_move", { p_part_id: v("#iPart"), p_kind: v("#iKind"), p_qty: +v("#iQty"), p_job_id: id, p_note: v("#iNote") || null });
          if (error) throw error; editing = null; await loadDocs(); await loadJobs(); toast("บันทึกการเบิกอะไหล่แล้ว");
        }
        if (a === "pr") await savePr(id);
        if (a === "memo") await saveMemo(id);
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
    bars($("#dHold"), count(open.filter(j => j.status === "on_hold"), j => grpOf(j.hold_category) || j.hold_category || "ไม่ระบุ"));
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
    $("#hList").innerHTML = "<tr><th>หมวด</th><th>เหตุผลพักงาน</th><th></th></tr>" + reasons.map(r => `<tr><td><small>${esc(r.grp || "")}</small></td><td>${esc(r.name)}${r.active ? "" : " <small>(ซ่อน)</small>"}</td><td><button class="btn small" type="button" data-reason-toggle="${r.id}">${r.active ? "ซ่อน" : "แสดง"}</button></td></tr>`).join("");
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
  $("#fReason").onsubmit = async e => { e.preventDefault(); const { error } = await sb.from("hold_reasons").insert({ hospital_id: H.id, name: $("#hName").value.trim(), grp: $("#hGrp").value || null, sort: 900 + reasons.length }); msg("#hMsg", error, "เพิ่มเหตุผลแล้ว"); if (!error) { e.target.reset(); await loadRefs(); render(); } };
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

  /* ---------- phase B: shared helpers ---------- */
  function toast(m) { $("#toast").textContent = m; $("#toast").hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => $("#toast").hidden = true, 6000); }
  function csv(name, head, rows) {
    const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const blob = new Blob(["﻿" + [head.map(q).join(","), ...rows.map(r => r.map(q).join(","))].join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a); a.click(); a.remove();
  }
  const jobNo = id => (jobs.find(j => j.id === id) || {}).job_no || "";
  async function savePr(jobId) {
    const items = prItemsFromForm(), reason = $("#prReason").value.trim();
    if (!reason) throw new Error("ใส่เหตุผลที่ขอซื้อ");
    if (!items.length) throw new Error("ใส่รายการที่จะซื้ออย่างน้อย 1 รายการ");
    if (items.some(x => !(x.qty > 0))) throw new Error("จำนวนต้องมากกว่า 0");
    const { data, error } = await sb.rpc("pr_create", { p_job_id: jobId || ($("#prJob") && $("#prJob").value) || null, p_reason: reason,
      p_supplier: $("#prSup").value.trim() || null, p_need_by: $("#prNeed").value || null, p_items: items });
    if (error) throw error;
    editing = null; docForm = null; await loadDocs(); await loadJobs(); toast(`สร้างใบขอซื้อ ${data} แล้ว รอ Owner อนุมัติ`);
  }
  async function saveMemo(jobId) {
    const s = $("#mSubj").value.trim(), to = $("#mTo").value.trim(), body = $("#mBody").value.trim();
    if (!s || !to || !body) throw new Error("ใส่เรื่อง เรียน และรายละเอียดให้ครบ");
    const { data, error } = await sb.rpc("memo_create", { p_job_id: jobId || null, p_pr_id: $("#mPr").value || null, p_subject: s, p_to: to, p_body: body, p_amount: $("#mAmt").value === "" ? null : +$("#mAmt").value });
    if (error) throw error;
    editing = null; docForm = null; await loadDocs(); await loadJobs(); toast(`สร้าง Memo ${data} แล้ว รอ Owner อนุมัติ`);
  }
  document.addEventListener("click", e => {
    const t = e.target.closest("[data-pr-add],[data-pr-del]"); if (!t) return;
    e.preventDefault();
    if (t.dataset.prAdd !== undefined) $("#prRows").insertAdjacentHTML("beforeend", prRow());
    else if (document.querySelectorAll("#prRows tr").length > 1) t.closest("tr").remove();
    prSum();
  });
  document.addEventListener("change", e => {
    if (e.target.dataset.prPart === undefined) return;
    const p = parts.find(x => x.id === e.target.value), r = e.target.closest("tr");
    if (p) { r.querySelector("[data-pr-desc]").value = p.name; r.querySelector("[data-pr-unit]").value = p.unit; r.querySelector("[data-pr-price]").value = p.unit_cost || 0; }
    prSum();
  });
  document.addEventListener("input", e => { if (e.target.closest("#prRows")) prSum(); });

  /* ---------- phase B: approver inbox ---------- */
  const memoMissing = () => jobs.filter(j => j.memo_requested && OPEN.includes(j.status) && !memos.some(m => m.job_id === j.id && m.status !== "cancel"));
  function inboxBadge() {
    if (!isApprover()) return;
    const n = jobs.filter(j => j.status === "on_hold" && j.hold_status === "pending").length + prs.filter(x => x.status === "requested").length + memos.filter(x => x.status === "submitted").length;
    $("#inboxN").textContent = n; $("#inboxN").hidden = !n;
  }
  const decideBox = (kind, id) => `<div class="row" style="margin-top:8px"><input data-dnote="${kind}:${id}" placeholder="หมายเหตุ (ไม่บังคับ)" style="flex:1;min-width:180px">
    ${kind === "hold" ? `<button class="btn small primary" data-decide="hold:${id}:ack">รับทราบ</button><button class="btn small" data-decide="hold:${id}:ack_memo">รับทราบ + ขอ Memo</button><button class="btn small" data-decide="hold:${id}:rejected">ไม่อนุมัติ</button>`
      : `<button class="btn small primary" data-decide="${kind}:${id}:approve">อนุมัติ</button><button class="btn small" data-decide="${kind}:${id}:reject">ไม่อนุมัติ</button>`}</div>`;
  function renderInbox() {
    inboxBadge();
    const holds = jobs.filter(j => j.status === "on_hold" && j.hold_status === "pending"), pr = prs.filter(x => x.status === "requested"), mm = memos.filter(x => x.status === "submitted"), miss = memoMissing();
    let h = "";
    h += `<h3 class="grp">พักงานรออนุมัติ (${holds.length})</h3>` + (holds.map(j => `<div class="ib"><div class="meta"><span class="mono">${esc(j.job_no)}</span><span>${esc([j.building, j.floor, j.department].join(" · "))}</span><span>ช่าง ${esc(crewOf(j).map(nameOf).join(", "))}</span></div>
      <h4>${esc(j.detail)}</h4><div class="meta" style="color:var(--s-on_hold)">${esc(j.hold_category || "")} · ${esc(j.hold_reason || "")} · นัดกลับมาทำ ${fmtDate(j.hold_until)} · พักตั้งแต่ ${fmt(j.hold_started_at)}</div>${decideBox("hold", j.id)}</div>`).join("") || `<div class="empty">ไม่มี</div>`);
    h += `<h3 class="grp">ใบขอซื้อรออนุมัติ (${pr.length})</h3>` + (pr.map(x => `<div class="ib"><div class="meta"><a class="mono" href="doc.html?pr=${x.id}" target="_blank" rel="noopener">${esc(x.pr_no)}</a><span>${fmt(x.created_at)}</span><span>ผู้ขอ ${esc(nameOf(x.requested_by))}</span>${x.job_id ? `<span>ใบงาน ${esc(jobNo(x.job_id))}</span>` : ""}</div>
      <h4>${esc(x.reason)} · ${baht(x.total)} บาท</h4><div class="meta">${prItems.filter(i => i.pr_id === x.id).map(i => `${esc(i.description)} ${qtyf(i.qty)} ${esc(i.unit)} × ${baht(i.unit_price)}`).join(" · ")}${x.need_by ? ` · ต้องการภายใน ${fmtDate(x.need_by)}` : ""}${x.supplier ? ` · ร้าน ${esc(x.supplier)}` : ""}</div>${decideBox("pr", x.id)}</div>`).join("") || `<div class="empty">ไม่มี</div>`);
    h += `<h3 class="grp">Memo รออนุมัติ (${mm.length})</h3>` + (mm.map(x => `<div class="ib"><div class="meta"><a class="mono" href="doc.html?memo=${x.id}" target="_blank" rel="noopener">${esc(x.memo_no)}</a><span>${fmt(x.created_at)}</span><span>ผู้เขียน ${esc(nameOf(x.created_by))}</span>${x.job_id ? `<span>ใบงาน ${esc(jobNo(x.job_id))}</span>` : ""}</div>
      <h4>${esc(x.subject)}${x.amount != null ? ` · ${baht(x.amount)} บาท` : ""}</h4><div class="meta">เรียน ${esc(x.to_whom)} · ${esc(x.body.slice(0, 160))}${x.body.length > 160 ? "…" : ""}</div>${decideBox("memo", x.id)}</div>`).join("") || `<div class="empty">ไม่มี</div>`);
    if (miss.length) h += `<h3 class="grp">งานที่ขอ Memo แล้วแต่ยังไม่มี Memo (${miss.length})</h3>` + miss.map(j => `<div class="ib"><div class="meta"><a href="#" data-goto="${j.id}" class="mono">${esc(j.job_no)}</a><span>${esc(j.department || "")}</span><span>ช่าง ${esc(crewOf(j).map(nameOf).join(", "))}</span></div><h4>${esc(j.detail)}</h4></div>`).join("");
    $("#ibList").innerHTML = h;
  }
  document.addEventListener("click", async e => {
    const t = e.target.closest("[data-decide]"); if (!t) return;
    e.preventDefault();
    const [kind, id, d] = t.dataset.decide.split(":"), note = (document.querySelector(`[data-dnote="${kind}:${id}"]`) || {}).value || "";
    t.disabled = true;
    const { error } = kind === "hold" ? await sb.rpc("job_action", { p_job_id: id, p_action: "hold_decide", p_data: { decision: d, note } })
      : await sb.rpc(kind === "pr" ? "pr_action" : "memo_action", { [kind === "pr" ? "p_pr_id" : "p_memo_id"]: id, p_action: d, p_note: note || null });
    if (error) { t.disabled = false; alert(errText(error)); return; }
    await loadDocs(); await loadJobs(); toast("บันทึกผลการพิจารณาแล้ว");
  });

  /* ---------- phase B: parts store ---------- */
  ["#ptQ", "#ptF", "#pcFrom", "#pcTo"].forEach(s => $(s).addEventListener(s === "#ptQ" ? "input" : "change", render));
  if (!$("#pcFrom").value) { $("#pcTo").value = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" }); $("#pcFrom").value = new Date(Date.now() - 89 * 864e5).toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" }); }
  let partOpen = null; // { id, act: receive|adjust|issue|edit|hist }
  function renderParts() {
    const q = $("#ptQ").value.trim().toLowerCase(), f = $("#ptF").value;
    const low = p => p.active && p.min_qty > 0 && p.qty <= p.min_qty;
    const list = parts.filter(p => (f === "off" ? !p.active : f === "low" ? low(p) : p.active) && (!q || [p.code, p.name, p.category, p.store].some(x => String(x || "").toLowerCase().includes(q))));
    const act = parts.filter(p => p.active);
    $("#ptKpi").innerHTML = [["รายการอะไหล่", act.length], ["ต่ำกว่าขั้นต่ำ", act.filter(low).length, 1], ["มูลค่าคงคลัง (บาท)", baht(act.reduce((s, p) => s + p.qty * p.unit_cost, 0))],
      ["เบิกใช้ 30 วัน (บาท)", baht(moves.filter(m => m.kind === "issue" && mins(m.created_at) < 43200).reduce((s, m) => s - m.qty * m.unit_cost, 0) - moves.filter(m => m.kind === "return" && mins(m.created_at) < 43200).reduce((s, m) => s + m.qty * m.unit_cost, 0))],
      ["ใบขอซื้อรออนุมัติ", prs.filter(x => x.status === "requested").length], ["รอรับของ", prs.filter(x => ["approved", "ordered"].includes(x.status)).length]]
      .map(([a, b, red]) => `<div class="kpi"><b style="${red && b > 0 ? "color:var(--bad)" : ""}">${b}</b><span>${a}</span></div>`).join("");
    const mgr = isMgr();
    $("#ptList").innerHTML = `<tr><th>รหัส</th><th>ชื่อ</th><th>หมวด / ที่เก็บ</th><th class="num">คงเหลือ</th><th class="num">ขั้นต่ำ</th><th class="num">ราคา/หน่วย</th><th class="num">มูลค่า</th><th></th></tr>` +
      (list.map(p => `<tr class="${low(p) ? "low" : ""}"><td class="mono">${esc(p.code)}</td><td>${esc(p.name)}${low(p) ? ' <b style="color:var(--bad)">ต่ำกว่าขั้นต่ำ</b>' : ""}</td><td>${esc([p.category, p.store].filter(Boolean).join(" · ") || "-")}</td>
        <td class="num">${qtyf(p.qty)} ${esc(p.unit)}</td><td class="num">${qtyf(p.min_qty)}</td><td class="num">${baht(p.unit_cost)}</td><td class="num">${baht(p.qty * p.unit_cost)}</td>
        <td><div class="row" style="flex-wrap:nowrap">${can() ? `<button class="btn small" data-pt="${p.id}:issue">เบิก</button>` : ""}${mgr ? `<button class="btn small" data-pt="${p.id}:receive">รับเข้า</button><button class="btn small" data-pt="${p.id}:adjust">ปรับยอด</button><button class="btn small" data-pt="${p.id}:edit">แก้ไข</button>` : ""}<button class="btn small" data-pt="${p.id}:hist">ประวัติ</button></div></td></tr>
        ${partOpen && partOpen.id === p.id ? `<tr><td colspan="8">${partPanel(p)}</td></tr>` : ""}`).join("") || `<tr><td colspan="8"><div class="empty">${parts.length ? "ไม่พบรายการ" : "ยังไม่มีอะไหล่ในคลัง" + (mgr ? " เพิ่มได้จากฟอร์มด้านบน" : "")}</div></td></tr>`);
    // cost by equipment over a date range
    const f1 = $("#pcFrom").value, t1 = $("#pcTo").value, dd = d => new Date(d).toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
    const used = moves.filter(m => (m.kind === "issue" || m.kind === "return") && m.job_id && (!f1 || dd(m.created_at) >= f1) && (!t1 || dd(m.created_at) <= t1));
    const g = {};
    used.forEach(m => { const k = m.equipment_text || "(ไม่ระบุเครื่อง)"; g[k] = g[k] || { c: 0, jobs: new Set() }; g[k].c -= m.qty * m.unit_cost; g[k].jobs.add(m.job_id); });
    const rows = Object.entries(g).sort((a, b) => b[1].c - a[1].c);
    $("#pcList").innerHTML = `<tr><th>เครื่อง / อุปกรณ์</th><th class="num">จำนวนใบงาน</th><th class="num">ต้นทุนอะไหล่ (บาท)</th></tr>` + (rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${v.jobs.size}</td><td class="num">${baht(v.c)}</td></tr>`).join("") || `<tr><td colspan="3"><div class="empty">ยังไม่มีการเบิกอะไหล่ในช่วงนี้</div></td></tr>`);
  }
  function partPanel(p) {
    const a = partOpen.act, ok = `<div class="row" style="align-self:end"><button class="btn primary small" data-ptok="${p.id}:${a}">บันทึก</button><button class="btn small" type="button" data-ptclose>ปิด</button></div>`;
    if (a === "hist") {
      const h = moves.filter(m => m.part_id === p.id).slice(0, 100);
      return `<table><tr><th>วันที่</th><th>รายการ</th><th class="num">จำนวน</th><th class="num">คงเหลือ</th><th>ใบงาน / เอกสาร</th><th>หมายเหตุ</th><th>ผู้ทำ</th></tr>${h.map(m => `<tr><td>${fmt(m.created_at)}</td><td>${MOVE[m.kind]}</td><td class="num">${m.qty > 0 ? "+" : ""}${qtyf(m.qty)}</td><td class="num">${qtyf(m.qty_after)}</td>
        <td class="mono">${esc(jobNo(m.job_id) || (prs.find(x => x.id === m.pr_id) || {}).pr_no || "")}</td><td>${esc(m.note || "")}</td><td>${esc(nameOf(m.actor_id))}</td></tr>`).join("") || `<tr><td colspan="7">ยังไม่มีการเคลื่อนไหว</td></tr>`}</table>
        <div class="row" style="margin-top:8px"><button class="btn small" type="button" data-ptclose>ปิด</button></div>`;
    }
    if (a === "edit") return `<div class="inline"><label>รหัส<input id="peCode" value="${esc(p.code)}"></label><label class="span2">ชื่อ<input id="peName" value="${esc(p.name)}"></label><label>หน่วย<input id="peUnit" value="${esc(p.unit)}"></label>
      <label>หมวด<input id="peCat" value="${esc(p.category || "")}"></label><label>ที่เก็บ<input id="peStore" value="${esc(p.store || "")}"></label><label>ขั้นต่ำ<input id="peMin" type="number" min="0" step="any" value="${p.min_qty}"></label>
      <label>ราคา/หน่วย<input id="peCost" type="number" min="0" step="any" value="${p.unit_cost}"></label><label class="check"><input id="peAct" type="checkbox" ${p.active ? "checked" : ""}>ใช้งาน (ไม่ติ๊ก = ซ่อน)</label>${ok}</div>`;
    const lab = { receive: "จำนวนที่รับเข้า", adjust: "ยอดที่นับได้จริง", issue: "จำนวนที่เบิก" }[a];
    return `<div class="inline"><label>${lab} (${esc(p.unit)}) *<input id="pmQty" type="number" min="0" step="any" value="${a === "adjust" ? p.qty : 1}"></label>
      ${a === "receive" ? `<label>ราคาต่อหน่วยครั้งนี้ (บาท)<input id="pmCost" type="number" min="0" step="any" value="${p.unit_cost}"></label>` : ""}
      ${a === "issue" ? `<label>ใช้กับใบงาน<select id="pmJob"><option value="">ไม่ผูกใบงาน</option>${jobs.filter(j => !["close", "cancel"].includes(j.status)).map(j => `<option value="${j.id}">${esc(j.job_no)} · ${esc((j.detail || "").slice(0, 30))}</option>`).join("")}</select></label>` : ""}
      <label class="${a === "adjust" ? "span2" : ""}">หมายเหตุ ${a === "adjust" ? "* (เหตุผลที่ปรับ)" : ""}<input id="pmNote" placeholder="${a === "receive" ? "เช่น เลขที่ใบส่งของ" : ""}"></label>${ok}</div>`;
  }
  document.addEventListener("click", async e => {
    const t = e.target.closest("[data-pt],[data-ptok],[data-ptclose]"); if (!t) return;
    e.preventDefault();
    if (t.dataset.ptclose !== undefined) { partOpen = null; return renderParts(); }
    if (t.dataset.pt) { const [id, act] = t.dataset.pt.split(":"); partOpen = partOpen && partOpen.id === id && partOpen.act === act ? null : { id, act }; return renderParts(); }
    const [id, a] = t.dataset.ptok.split(":"), v = s => ($(s) ? $(s).value.trim() : "");
    let r;
    if (a === "edit") r = await sb.from("parts").update({ code: v("#peCode"), name: v("#peName"), unit: v("#peUnit") || "ชิ้น", category: v("#peCat") || null, store: v("#peStore") || null,
      min_qty: +v("#peMin") || 0, unit_cost: +v("#peCost") || 0, active: $("#peAct").checked }).eq("id", id);
    else {
      if (v("#pmQty") === "" || +v("#pmQty") < 0) return alert("ใส่จำนวนให้ถูกต้อง");
      if (a === "adjust" && !v("#pmNote")) return alert("ใส่เหตุผลที่ปรับยอด");
      r = await sb.rpc("part_move", { p_part_id: id, p_kind: a, p_qty: +v("#pmQty"), p_job_id: v("#pmJob") || null, p_note: v("#pmNote") || null, p_unit_cost: a === "receive" ? +v("#pmCost") || null : null });
    }
    if (r.error) return alert(errText(r.error));
    partOpen = null; await loadDocs(); if (a === "issue") await loadJobs(); render(); toast("บันทึกแล้ว");
  });
  $("#fPart").onsubmit = async e => {
    e.preventDefault(); const f = e.target, opening = +f.opening.value || 0;
    const { data, error } = await sb.from("parts").insert({ hospital_id: H.id, code: f.code.value.trim(), name: f.name.value.trim(), unit: f.unit.value.trim() || "ชิ้น",
      category: f.category.value.trim() || null, store: f.store.value.trim() || null, min_qty: +f.min_qty.value || 0, unit_cost: +f.unit_cost.value || 0 }).select("id").single();
    if (error) return msg("#ptMsg", error.code === "23505" ? { message: "รหัสนี้มีอยู่แล้ว" } : error);
    if (opening > 0) { const r = await sb.rpc("part_move", { p_part_id: data.id, p_kind: "receive", p_qty: opening, p_note: "ยอดยกมา", p_unit_cost: +f.unit_cost.value || null }); if (r.error) return msg("#ptMsg", r.error); }
    msg("#ptMsg", null, "เพิ่มอะไหล่แล้ว"); f.reset(); f.unit.value = "ชิ้น"; await loadDocs(); render();
  };
  $("#ptExport").onclick = () => csv(`สต็อกอะไหล่-${H.code}.csv`, ["รหัส", "ชื่อ", "หมวด", "ที่เก็บ", "หน่วย", "คงเหลือ", "ขั้นต่ำ", "ราคา/หน่วย", "มูลค่า", "สถานะ"],
    parts.map(p => [p.code, p.name, p.category, p.store, p.unit, p.qty, p.min_qty, p.unit_cost, p.qty * p.unit_cost, !p.active ? "ซ่อน" : p.min_qty > 0 && p.qty <= p.min_qty ? "ต่ำกว่าขั้นต่ำ" : "ปกติ"]));
  $("#pcExport").onclick = () => {
    const f1 = $("#pcFrom").value, t1 = $("#pcTo").value, dd = d => new Date(d).toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
    csv(`การเคลื่อนไหวอะไหล่-${H.code}-${f1}-${t1}.csv`, ["วันที่", "รายการ", "รหัส", "อะไหล่", "จำนวน", "คงเหลือหลังทำ", "ราคา/หน่วย", "มูลค่า", "ใบงาน", "เครื่อง/อุปกรณ์", "ใบขอซื้อ", "หมายเหตุ", "ผู้ทำ"],
      moves.filter(m => (!f1 || dd(m.created_at) >= f1) && (!t1 || dd(m.created_at) <= t1)).map(m => { const p = parts.find(x => x.id === m.part_id) || {};
        return [fmt(m.created_at), MOVE[m.kind], p.code, p.name, m.qty, m.qty_after, m.unit_cost, m.qty * m.unit_cost, jobNo(m.job_id), m.equipment_text, (prs.find(x => x.id === m.pr_id) || {}).pr_no, m.note, nameOf(m.actor_id)]; }));
  };

  /* ---------- phase B: purchase requests and memos ---------- */
  $("#dcF").addEventListener("change", render);
  $("#newPr").onclick = () => { docForm = docForm === "pr" ? null : "pr"; renderDocs(); };
  $("#newMemo").onclick = () => { docForm = docForm === "memo" ? null : "memo"; renderDocs(); };
  let docOpen = null;
  function renderDocs() {
    const ok = k => `<div class="row" style="align-self:end"><button class="btn primary small" data-dcok="${k}">บันทึก</button><button class="btn small" type="button" data-dcclose>ยกเลิก</button></div>`;
    const keep = $("#dcForm").dataset.k === (docForm || "");
    if (!keep) $("#dcForm").innerHTML = docForm ? `<div class="panel" style="margin-bottom:16px"><h3>${docForm === "pr" ? "ใบขอซื้อใหม่" : "Memo ใหม่"}</h3><div class="inline" style="background:none;padding:0">${docForm === "pr" ? prForm(null, ok("pr")) : memoForm(null, null, ok("memo"))}</div></div>` : "";
    $("#dcForm").dataset.k = docForm || "";
    const f = $("#dcF").value, mgr = isMgr();
    const pl = prs.filter(x => !f || ["requested", "approved", "ordered"].includes(x.status));
    $("#prList").innerHTML = `<tr><th>เลขที่</th><th>วันที่</th><th>ใบงาน</th><th>เหตุผล / รายการ</th><th class="num">รวม (บาท)</th><th>สถานะ</th><th></th></tr>` + (pl.map(x => {
      const its = prItems.filter(i => i.pr_id === x.id);
      let b = `<a class="btn small" href="doc.html?pr=${x.id}" target="_blank" rel="noopener">พิมพ์</a>`;
      if (mgr && x.status === "approved") b += `<button class="btn small" data-dc="pr:${x.id}:ordered">สั่งซื้อแล้ว</button>`;
      if (mgr && ["approved", "ordered"].includes(x.status)) b += `<button class="btn small primary" data-dc="pr:${x.id}:received">ได้รับของ (เข้าคลัง)</button>`;
      if ((mgr || x.requested_by === me.id) && !["received", "cancel"].includes(x.status)) b += `<button class="btn small" data-dc="pr:${x.id}:cancel">ยกเลิก</button>`;
      if (x.status !== "cancel") b += `<button class="btn small" data-dc="pr:${x.id}:memo">เขียน Memo</button>`;
      return `<tr><td class="mono">${esc(x.pr_no)}</td><td>${fmt(x.created_at)}<br><small>${esc(nameOf(x.requested_by))}</small></td><td class="mono">${esc(jobNo(x.job_id))}</td>
        <td>${esc(x.reason)}<br><small>${its.map(i => `${esc(i.description)} ${qtyf(i.qty)} ${esc(i.unit)}`).join(", ")}</small>${x.decision_note ? `<br><small>หมายเหตุผู้อนุมัติ: ${esc(x.decision_note)}</small>` : ""}</td>
        <td class="num">${baht(x.total)}</td><td><span class="st ${x.status}">${PR_STATUS[x.status]}</span>${x.decided_by ? `<br><small>${esc(nameOf(x.decided_by))}</small>` : ""}</td><td><div class="row">${b}</div></td></tr>`;
    }).join("") || `<tr><td colspan="7"><div class="empty">ยังไม่มีใบขอซื้อ</div></td></tr>`);
    const ml = memos.filter(x => !f || x.status === "submitted");
    $("#memoList").innerHTML = `<tr><th>เลขที่</th><th>วันที่</th><th>เรื่อง</th><th>อ้างอิง</th><th class="num">จำนวนเงิน</th><th>สถานะ</th><th></th></tr>` + (ml.map(x => `<tr><td class="mono">${esc(x.memo_no)}</td><td>${fmt(x.created_at)}<br><small>${esc(nameOf(x.created_by))}</small></td>
      <td>${esc(x.subject)}<br><small>เรียน ${esc(x.to_whom)}</small>${x.decision_note ? `<br><small>หมายเหตุผู้อนุมัติ: ${esc(x.decision_note)}</small>` : ""}</td><td class="mono">${esc([jobNo(x.job_id), (prs.find(p => p.id === x.pr_id) || {}).pr_no].filter(Boolean).join(" "))}</td>
      <td class="num">${x.amount != null ? baht(x.amount) : "-"}</td><td><span class="st ${x.status}">${MEMO_STATUS[x.status]}</span>${x.decided_by ? `<br><small>${esc(nameOf(x.decided_by))}</small>` : ""}</td>
      <td><div class="row"><a class="btn small" href="doc.html?memo=${x.id}" target="_blank" rel="noopener">พิมพ์</a>${(mgr || x.created_by === me.id) && x.status === "submitted" ? `<button class="btn small" data-dc="memo:${x.id}:cancel">ยกเลิก</button>` : ""}</div></td></tr>`).join("") || `<tr><td colspan="7"><div class="empty">ยังไม่มี Memo</div></td></tr>`);
    if (docOpen) { const fm = $("#dcForm"); if (fm) fm.scrollIntoView({ behavior: "smooth" }); docOpen = null; }
  }
  document.addEventListener("click", async e => {
    const t = e.target.closest("[data-dc],[data-dcok],[data-dcclose]"); if (!t) return;
    e.preventDefault();
    if (t.dataset.dcclose !== undefined) { docForm = null; return renderDocs(); }
    if (t.dataset.dcok) {
      t.disabled = true;
      try { if (t.dataset.dcok === "pr") await savePr(null); else await saveMemo(null); render(); }
      catch (err) { alert(errText(err)); t.disabled = false; }
      return;
    }
    const [kind, id, a] = t.dataset.dc.split(":");
    if (a === "memo") { docForm = "memo"; $("#dcForm").dataset.k = ""; renderDocs(); $("#mPr").value = id; const x = prs.find(p => p.id === id); $("#mSubj").value = "ขออนุมัติจัดซื้อตาม " + x.pr_no; $("#mAmt").value = x.total; $("#mBody").value = `ตามใบขอซื้อเลขที่ ${x.pr_no} เหตุผล: ${x.reason}\nรายการ: ${prItems.filter(i => i.pr_id === id).map(i => `${i.description} ${qtyf(i.qty)} ${i.unit}`).join(", ")}\nรวมเป็นเงิน ${baht(x.total)} บาท\n\nจึงเรียนมาเพื่อโปรดพิจารณาอนุมัติ`; docOpen = 1; $("#dcForm").scrollIntoView({ behavior: "smooth" }); return; }
    let note = null;
    if (a === "cancel") { note = window.prompt("เหตุผลที่ยกเลิก"); if (note === null) return; }
    if (a === "received" && !window.confirm("ยืนยันว่าได้รับของครบแล้ว รายการที่ผูกกับอะไหล่ในคลังจะถูกบวกเข้าสต็อกทันที")) return;
    const { error } = await sb.rpc(kind === "pr" ? "pr_action" : "memo_action", { [kind === "pr" ? "p_pr_id" : "p_memo_id"]: id, p_action: a, p_note: note });
    if (error) return alert(errText(error));
    await loadDocs(); render(); toast("บันทึกแล้ว");
  });
  $("#prExport").onclick = () => csv(`ทะเบียนใบขอซื้อ-${H.code}.csv`, ["เลขที่", "วันที่", "ผู้ขอ", "ใบงาน", "เหตุผล", "รายการ", "ผู้ขาย", "ต้องการภายใน", "รวม (บาท)", "สถานะ", "ผู้พิจารณา", "วันที่พิจารณา", "หมายเหตุผู้อนุมัติ", "สั่งซื้อ", "รับของ"],
    prs.map(x => [x.pr_no, fmt(x.created_at), nameOf(x.requested_by), jobNo(x.job_id), x.reason, prItems.filter(i => i.pr_id === x.id).map(i => `${i.description} ${i.qty} ${i.unit} x ${i.unit_price}`).join("; "), x.supplier, x.need_by, x.total, PR_STATUS[x.status], nameOf(x.decided_by), fmt(x.decided_at), x.decision_note, fmt(x.ordered_at), fmt(x.received_at)]));
  $("#memoExport").onclick = () => csv(`ทะเบียน Memo-${H.code}.csv`, ["เลขที่", "วันที่", "ผู้เขียน", "เรื่อง", "เรียน", "รายละเอียด", "จำนวนเงิน", "ใบงาน", "ใบขอซื้อ", "สถานะ", "ผู้พิจารณา", "วันที่พิจารณา", "หมายเหตุผู้อนุมัติ"],
    memos.map(x => [x.memo_no, fmt(x.created_at), nameOf(x.created_by), x.subject, x.to_whom, x.body, x.amount, jobNo(x.job_id), (prs.find(p => p.id === x.pr_id) || {}).pr_no, MEMO_STATUS[x.status], nameOf(x.decided_by), fmt(x.decided_at), x.decision_note]));

  /* ---------- phase B: open-jobs report grouped by reason ---------- */
  $("#rpG").addEventListener("change", render);
  const daysOpen = j => Math.floor(mins(j.created_at) / 1440);
  function reportGroups() {
    const g = $("#rpG").value, open = jobs.filter(j => OPEN.includes(j.status));
    const key = j => g === "reason" ? (j.status === "on_hold" ? grpOf(j.hold_category) || j.hold_category || "พักงาน (ไม่ระบุเหตุผล)" : "ยังไม่พักงาน: " + statusLabel(j))
      : g === "status" ? statusLabel(j) : g === "tech" ? (crewOf(j).map(nameOf).join(", ") || "ยังไม่มอบหมาย") : (j.department || "ไม่ระบุแผนก");
    const m = {}; open.forEach(j => (m[key(j)] = m[key(j)] || []).push(j));
    return Object.entries(m).map(([k, l]) => [k, l.sort((a, b) => a.created_at.localeCompare(b.created_at))]).sort((a, b) => (a[0].startsWith("ยังไม่พักงาน") - b[0].startsWith("ยังไม่พักงาน")) || b[1].length - a[1].length);
  }
  function renderReport() {
    const gs = reportGroups(), total = gs.reduce((s, x) => s + x[1].length, 0);
    $("#rpBody").innerHTML = `<p class="meta">${esc(H.name)} · ข้อมูล ณ ${fmt(new Date().toISOString())} · ใบงานค้างทั้งหมด ${total} ใบ</p>` + (gs.map(([k, l]) => `<h3 class="grp">${esc(k)} (${l.length})</h3>
      <div class="scroll"><table><tr><th>เลขใบงาน</th><th>วันที่แจ้ง</th><th class="num">ค้าง (วัน)</th><th>แผนก</th><th>รายละเอียด</th><th>ช่าง</th><th>เหตุผล / หมายเหตุ</th><th>นัด</th></tr>${l.map(j => `<tr${isLate(j) ? ' class="low"' : ""}><td class="mono">${esc(j.job_no)}</td><td>${fmt(j.created_at)}</td><td class="num">${daysOpen(j)}</td>
        <td>${esc(j.department || "")}</td><td>${esc(j.detail)}</td><td>${esc(crewOf(j).map(nameOf).join(", "))}</td><td>${esc([j.hold_category, j.hold_reason].filter(Boolean).join(" · ") || statusLabel(j))}</td><td>${j.hold_until ? fmtDate(j.hold_until) : j.appointment_at ? fmt(j.appointment_at) : "-"}</td></tr>`).join("")}</table></div>`).join("") || `<div class="empty">ไม่มีงานค้าง</div>`);
  }
  $("#rpPrint").onclick = () => window.print();
  $("#rpExport").onclick = () => csv(`รายงานงานค้าง-${H.code}-${new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" })}.csv`, ["กลุ่ม", "เลขใบงาน", "วันที่แจ้ง", "ค้าง (วัน)", "อาคาร", "ชั้น", "แผนก", "รายละเอียด", "ช่าง", "สถานะ", "เหตุผลพักงาน", "หมายเหตุพักงาน", "วันนัด", "เกิน SLA"],
    reportGroups().flatMap(([k, l]) => l.map(j => [k, j.job_no, fmt(j.created_at), daysOpen(j), j.building, j.floor, j.department, j.detail, crewOf(j).map(nameOf).join(", "), statusLabel(j), j.hold_category, j.hold_reason, j.hold_until || fmt(j.appointment_at), isLate(j) ? "เกิน" : ""])));

  function render() {
    if (!H) return;
    inboxBadge();
    if (!$("#tab-jobs").hidden) renderJobs();
    if (!$("#tab-inbox").hidden) renderInbox();
    if (!$("#tab-parts").hidden) renderParts();
    if (!$("#tab-docs").hidden) renderDocs();
    if (!$("#tab-report").hidden) renderReport();
    if (!$("#tab-dash").hidden) renderDash();
    if (!$("#tab-setup").hidden) renderSetup();
  }
  setInterval(() => { if (!editing && !partOpen && !docForm) render(); checkAlerts(); }, 30000);
})();
