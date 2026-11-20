// แผนผังอาคาร · ปักหมุดงานซ่อม: one plan picture per hospital / building / floor (bucket floor-plans), pins for departments,
// machines and other points (floor_pins, x y from 0 to 1), the exact spot of a job set on site (floor_job_pins).
// A job lands on the plan by: its own spot > the pin of its machine > the pin of its department on the plan of its building + floor.
// Pins are coloured by how many jobs they had in the chosen dates, so the hot spots of frequent problems stand out.
(() => {
  const { sb, $, esc, errText, STATUS, OPEN } = RS;
  const MGR = ["owner", "admin", "chief_engineer", "supervisor"];
  const KIND = { dept: "แผนก", equip: "เครื่องจักร", point: "จุดอื่น" };
  let me = null, exec = false, hosps = [], canEdit = false, canPin = false, cur = "map", busy = false;
  let plans = [], pins = [], jpins = [], jobs = [], locs = [], eqNames = {}, imgUrl = {}, place = new Map();
  let plan = null, sel = null, pick = null, zoom = 1;
  const toast = (m, bad) => { const t = $("#toast"); t.textContent = m; t.hidden = false; t.style.background = bad ? "var(--bad)" : ""; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, bad ? 6000 : 3000); };
  const guard = fn => async ev => { if (ev && ev.preventDefault) ev.preventDefault(); if (busy) return; busy = true; try { await fn(ev); } catch (e) { toast(errText(e), true); } finally { busy = false; } };
  const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
  const addD = (d, n) => { const x = new Date(d + "T00:00:00"); x.setDate(x.getDate() + n); return x.toLocaleDateString("en-CA"); };
  const dTH = d => d ? new Date(String(d).length === 10 ? d + "T00:00:00+07:00" : d).toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", year: "numeric" }) : "-";
  const norm = s => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  const hosp = () => hosps.find(h => h.id === $("#h").value) || {};
  const period = () => `งานซ่อมวันที่ ${dTH($("#d1").value)} ถึง ${dTH($("#d2").value)}`;
  const planName = p => p ? `อาคาร ${p.building} ชั้น ${p.floor}${p.title ? ` · ${p.title}` : ""}` : "";
  const pinName = p => p.kind === "equip" ? (eqNames[p.equipment_id] || p.label || "เครื่องจักร") : p.kind === "dept" ? (p.department || p.label || "แผนก") : (p.label || "จุดอื่น");
  const cls = n => n >= 5 ? "c3" : n >= 3 ? "c2" : n >= 1 ? "c1" : "c0";
  const level = n => n >= 5 ? "เสียบ่อย" : n >= 3 ? "เฝ้าระวัง" : n >= 1 ? "ปกติ" : "ยังไม่มีงาน";
  const isOpen = j => OPEN.includes(j.status);
  const shown = () => $("#only").value === "open" ? jobs.filter(isOpen) : jobs;

  // ---------- where each job lands ----------
  function locate() {
    place = new Map();
    const planById = Object.fromEntries(plans.map(p => [p.id, p])), byBF = {}, eqPin = {}, deptPin = {};
    plans.forEach(p => (byBF[norm(p.building) + "|" + norm(p.floor)] ||= []).push(p));
    pins.forEach(p => { if (p.kind === "equip" && p.equipment_id) eqPin[p.equipment_id] ||= p; if (p.kind === "dept" && p.department) deptPin[p.plan_id + "|" + norm(p.department)] ||= p; });
    const jp = Object.fromEntries(jpins.map(x => [x.job_id, x]));
    jobs.forEach(j => {
      const own = jp[j.id];
      if (own && planById[own.plan_id]) { place.set(j.id, { plan: planById[own.plan_id], x: +own.x, y: +own.y, own: true, pin: nearPin(own) }); return; }
      if (j.equipment_id && eqPin[j.equipment_id]) { const p = eqPin[j.equipment_id]; place.set(j.id, { plan: planById[p.plan_id], x: +p.x, y: +p.y, pin: p }); return; }
      const ps = byBF[norm(j.building) + "|" + norm(j.floor)] || [];
      for (const pl of ps) { const p = deptPin[pl.id + "|" + norm(j.department)]; if (p) { place.set(j.id, { plan: pl, x: +p.x, y: +p.y, pin: p }); return; } }
      if (ps.length) place.set(j.id, { plan: ps[0], none: true });
    });
  }
  // a job's own spot counts for the nearest pin when it is close to one (8% of the plan), so hot spots still add up
  function nearPin(o) { let best = null, bd = 0.08; pins.forEach(p => { if (p.plan_id !== o.plan_id) return; const d = Math.hypot(p.x - o.x, p.y - o.y); if (d < bd) { bd = d; best = p; } }); return best; }
  const jobsOfPin = (p, list = shown()) => list.filter(j => { const L = place.get(j.id); return L && L.pin && L.pin.id === p.id; });
  const jobsOnPlan = (pl, list = shown()) => list.filter(j => { const L = place.get(j.id); return L && L.plan && L.plan.id === pl.id; });
  const freeOwn = (pl, list = shown()) => list.filter(j => { const L = place.get(j.id); return L && L.own && !L.pin && L.plan.id === pl.id; });
  const unplaced = (pl, list = shown()) => list.filter(j => { const L = place.get(j.id); return L && L.none && L.plan.id === pl.id; });
  const repeat30 = list => { const t = list.map(j => +new Date(j.created_at)).sort((a, b) => a - b); let n = 0; for (let i = 1; i < t.length; i++) if (t[i] - t[i - 1] <= 30 * 864e5) n++; return n; };
  const topType = list => { const c = {}; list.forEach(j => { const k = j.job_type || "ไม่ระบุประเภท"; c[k] = (c[k] || 0) + 1; }); return Object.entries(c).sort((a, b) => b[1] - a[1]); };

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
    const q = new URLSearchParams(location.search), qh = hosps.find(h => h.code === (q.get("h") || "").toUpperCase());
    $("#h").value = qh ? qh.id : hosps.some(h => h.id === me.hospital_id) ? me.hospital_id : hosps[0].id; $("#h").disabled = hosps.length < 2;
    $("#d2").value = today(); $("#d1").value = addD(today(), q.get("job") ? -730 : -90);
    $("#body").hidden = false; $("#tabs").hidden = false;
    await load();
    if (q.get("plan") && plans.some(p => p.id === +q.get("plan"))) $("#pl").value = q.get("plan");
    if (q.get("job")) {
      const j = jobs.find(x => x.job_no === q.get("job"));
      if (j) { const L = place.get(j.id); if (L && L.plan) $("#pl").value = L.plan.id; show("map"); await openPlan(); selectJob(j); if (L && L.none && canPin) startPick({ type: "job", job: j }); return; }
      toast("ไม่พบใบงาน " + q.get("job") + " ในโรงนี้", true);
    }
    show(q.get("tab") || "map");
  }
  async function load() {
    const h = $("#h").value;
    canEdit = exec || (MGR.includes(me.role) && hosps.some(x => x.id === h));
    canPin = canEdit || (me.role !== "observer" && hosps.some(x => x.id === h));
    $("#ro").textContent = canEdit ? "" : canPin ? "ปักจุดของงานซ่อมได้ (เพิ่มแผนผังและหมุดได้เฉพาะหัวหน้า)" : "ดูได้อย่างเดียว";
    $("#upForm").hidden = !canEdit; $("#editBar").hidden = !canEdit;
    const [p, l, j] = await Promise.all([
      sb.from("floor_plans").select("*").eq("hospital_id", h).eq("active", true).order("building").order("floor"),
      sb.from("locations").select("building,floor,department").eq("hospital_id", h).eq("active", true).limit(5000),
      sb.rpc("fp_jobs", { p_hospital: h, p_from: $("#d1").value, p_to: $("#d2").value })]);
    for (const r of [p, l, j]) if (r.error) throw r.error;
    plans = p.data || []; locs = l.data || []; jobs = j.data || [];
    pins = []; jpins = [];
    if (plans.length) {
      const ids = plans.map(x => x.id);
      const [a, b] = await Promise.all([sb.from("floor_pins").select("*").in("plan_id", ids).eq("active", true), sb.from("floor_job_pins").select("*").in("plan_id", ids)]);
      if (a.error) throw a.error; if (b.error) throw b.error;
      pins = (a.data || []).map(x => ({ ...x, x: +x.x, y: +x.y })); jpins = b.data || [];
    }
    const need = [...new Set(pins.filter(x => x.equipment_id && !eqNames[x.equipment_id]).map(x => x.equipment_id))];
    if (need.length) { const e = await sb.from("equipment").select("id,tag,code,name").in("id", need); (e.data || []).forEach(x => eqNames[x.id] = [x.tag || x.code, x.name].filter(Boolean).join(" · ")); }
    locate();
    const keep = $("#pl").value;
    $("#pl").innerHTML = plans.length ? plans.map(x => `<option value="${x.id}">${esc(planName(x))} (${jobsOnPlan(x).length} งาน)</option>`).join("") : `<option value="">ยังไม่มีแผนผัง</option>`;
    if (plans.some(x => String(x.id) === keep)) $("#pl").value = keep;
    const uniq = a => [...new Set(a.filter(Boolean).map(s => String(s).trim()))].sort((x, y) => x.localeCompare(y, "th"));
    $("#blist").innerHTML = uniq(locs.map(x => x.building)).map(v => `<option value="${esc(v)}">`).join("");
    $("#flist").innerHTML = uniq(locs.map(x => x.floor)).map(v => `<option value="${esc(v)}">`).join("");
  }
  document.querySelectorAll("#tabs button").forEach(b => b.onclick = () => show(b.dataset.tab));
  function show(t) {
    cur = ["map", "hot", "plans"].includes(t) ? t : "map";
    document.querySelectorAll("#tabs button").forEach(b => b.setAttribute("aria-selected", b.dataset.tab === cur));
    ["map", "hot", "plans"].forEach(k => $("#tab-" + k).hidden = k !== cur);
    ({ map: () => openPlan(), hot: rHot, plans: rPlans })[cur]().catch?.(e => toast(errText(e), true));
  }
  const reload = guard(async () => { await load(); sel = null; stopPick(); show(cur); });
  $("#h").onchange = reload; $("#d1").onchange = reload; $("#d2").onchange = reload;
  $("#qr").onchange = () => { const n = +$("#qr").value; if (!n) return; $("#d2").value = today(); $("#d1").value = addD(today(), -n); $("#qr").value = ""; reload(); };
  $("#pl").onchange = () => { sel = null; stopPick(); openPlan(); };
  $("#only").onchange = () => show(cur);
  $("#heat").onchange = () => drawHeat();
  $("#lbl").onchange = () => $("#plan").classList.toggle("nolabel", !$("#lbl").checked);
  const setZoom = z => { zoom = Math.max(1, Math.min(4, z)); $("#plan").style.width = zoom * 100 + "%"; $("#zr").textContent = Math.round(zoom * 100) + "%"; };
  $("#zi").onclick = () => setZoom(zoom + 0.5); $("#zo").onclick = () => setZoom(zoom - 0.5); $("#zr").onclick = () => setZoom(1);

  // ---------- plan picture ----------
  async function picture(pl) {
    if (imgUrl[pl.image_path]) return imgUrl[pl.image_path];
    const { data, error } = await sb.storage.from("floor-plans").download(pl.image_path);
    if (error) throw new Error("เปิดรูปแผนผังไม่ได้: " + errText(error));
    return imgUrl[pl.image_path] = URL.createObjectURL(data);
  }
  async function openPlan() {
    plan = plans.find(p => String(p.id) === $("#pl").value) || null;
    $("#noPlan").hidden = !!plan; $("#lay").hidden = !plan;
    if (!plan) {
      $("#noPlan").innerHTML = canEdit ? `ยังไม่มีแผนผังของโรงนี้ ไปที่แท็บ <b>จัดการแผนผัง</b> เพื่ออัปโหลดรูปแผนผังชั้นแรก` : "ยังไม่มีแผนผังของโรงนี้ ขอให้หัวหน้าอัปโหลดแผนผังในแท็บ จัดการแผนผัง";
      $("#pk").innerHTML = ""; $("#pTab").innerHTML = ""; return;
    }
    const img = $("#pimg"), url = await picture(plan);
    if (img.src !== url) { img.src = url; await img.decode().catch(() => {}); }
    drawPins(); drawHeat(); side(); rPlanTable();
  }
  function drawPins() {
    const box = $("#plan"); box.querySelectorAll(".pin").forEach(x => x.remove());
    pins.filter(p => p.plan_id === plan.id).forEach(p => {
      const n = jobsOfPin(p).length, el = document.createElement("button");
      el.type = "button"; el.className = `pin ${p.kind} ${cls(n)}${sel && sel.pin === p ? " sel" : ""}`;
      el.style.left = p.x * 100 + "%"; el.style.top = p.y * 100 + "%"; el.textContent = n;
      el.title = `${KIND[p.kind]}: ${pinName(p)} · ${n} งาน`; el.setAttribute("aria-label", el.title);
      el.innerHTML = `${n}<span class="lb">${esc(pinName(p))}</span>`;
      el.onclick = ev => { ev.stopPropagation(); if (pick) return planClick(ev); sel = { pin: p }; drawPins(); side(); };
      box.appendChild(el);
    });
    freeOwn(plan).forEach(j => { const L = place.get(j.id), el = document.createElement("button");
      el.type = "button"; el.className = `pin job${sel && sel.job === j ? " sel" : ""}`; el.style.left = L.x * 100 + "%"; el.style.top = L.y * 100 + "%";
      el.title = `${j.job_no} ${j.detail}`; el.setAttribute("aria-label", el.title);
      el.onclick = ev => { ev.stopPropagation(); if (pick) return planClick(ev); selectJob(j); }; box.appendChild(el); });
    box.classList.toggle("nolabel", !$("#lbl").checked);
  }
  function selectJob(j) { sel = { job: j }; drawPins(); side(); }
  // heat: every job adds a soft spot; overlapping spots turn from blue to green, yellow and red
  function drawHeat() {
    const c = $("#hc"); c.hidden = !$("#heat").checked || !plan; if (c.hidden) return;
    heatOn(c, plan, 800);
  }
  function heatOn(c, pl, W) {
    const img = $("#pimg"), r0 = (img.naturalHeight || pl.img_h || 600) / (img.naturalWidth || pl.img_w || 800);
    c.width = W; c.height = Math.round(W * r0); const g = c.getContext("2d"); g.clearRect(0, 0, c.width, c.height);
    const pts = jobsOnPlan(pl).map(j => place.get(j.id)).filter(L => !L.none), R = W * 0.06;
    if (!pts.length) return;
    pts.forEach(L => { const x = L.x * c.width, y = L.y * c.height, gr = g.createRadialGradient(x, y, 0, x, y, R);
      gr.addColorStop(0, "rgba(0,0,0,0.35)"); gr.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = gr; g.fillRect(x - R, y - R, R * 2, R * 2); });
    const d = g.getImageData(0, 0, c.width, c.height), a = d.data;
    for (let i = 0; i < a.length; i += 4) { const v = a[i + 3] / 255; if (!v) continue;
      const t = Math.min(1, v * 1.6), col = t < 0.33 ? [40, 110, 220] : t < 0.55 ? [30, 170, 80] : t < 0.78 ? [240, 190, 20] : [220, 40, 30];
      a[i] = col[0]; a[i + 1] = col[1]; a[i + 2] = col[2]; a[i + 3] = Math.round(Math.min(0.8, 0.25 + t * 0.6) * 255); }
    g.putImageData(d, 0, 0);
  }

  // ---------- side panel ----------
  const jobLi = j => `<li><b>${esc(j.job_no)}</b> · ${esc(dTH(j.created_at))} · ${esc(STATUS[j.status] || j.status)}<br>${esc(j.detail)}${j.department ? `<br><span class="sub">${esc(j.department)}${j.equipment_text ? " · " + esc(j.equipment_text) : ""}</span>` : ""}</li>`;
  function side() {
    const s = $("#side");
    if (pick) { s.innerHTML = `<h3>กำลังปักหมุด</h3><p>${esc(pick.msg)}</p><p class="sub">แตะหรือคลิกบนแผนผังตรงจุดที่ต้องการ</p>`; return; }
    if (sel && sel.pin) {
      const p = sel.pin, L = jobsOfPin(p), op = L.filter(isOpen).length, tt = topType(L);
      s.innerHTML = `<h3>${esc(KIND[p.kind])}: ${esc(pinName(p))}</h3>
        <p><b class="${n2c(L.length)}">${L.length} งาน · ${esc(level(L.length))}</b><br>ยังไม่ปิด ${op} งาน · ซ้ำภายใน 30 วัน ${repeat30(L)} ครั้ง</p>
        ${tt.length ? `<p class="sub">ประเภทงาน: ${tt.map(([k, v]) => `${esc(k)} ${v}`).join(", ")}</p>` : ""}
        ${canEdit ? `<div class="acts"><button class="btn small" type="button" id="pMove">ย้ายหมุด</button><button class="btn small" type="button" id="pRen">แก้ชื่อ</button><button class="btn small" type="button" id="pDel">เอาหมุดออก</button></div>` : ""}
        <ul class="jl">${L.map(jobLi).join("") || "<li>ยังไม่มีงานซ่อมที่จุดนี้ในช่วงวันที่เลือก</li>"}</ul>
        <div class="acts"><button class="btn small" type="button" id="back">← ดูภาพรวมแผนผัง</button></div>`;
      if (canEdit) { $("#pMove").onclick = () => startPick({ type: "move", pin: p });
        $("#pRen").onclick = () => ask("แก้ชื่อหมุด", `<label>ชื่อที่แสดง<input name="v" value="${esc(p.label || pinName(p))}" required></label>`, guard(async f => { const v = f.v.value.trim();
          const { error } = await sb.from("floor_pins").update({ label: v }).eq("id", p.id); if (error) throw error; p.label = v; drawPins(); side(); toast("แก้ชื่อแล้ว"); }));
        $("#pDel").onclick = () => ask("เอาหมุดนี้ออก?", `<p>งานซ่อมเดิมยังอยู่ครบ แค่ไม่แสดงที่หมุดนี้</p>`, guard(async () => {
          const { error } = await sb.from("floor_pins").update({ active: false }).eq("id", p.id); if (error) throw error;
          pins = pins.filter(x => x !== p); sel = null; locate(); drawPins(); drawHeat(); side(); rPlanTable(); toast("เอาหมุดออกแล้ว"); }), "เอาออก"); }
      $("#back").onclick = () => { sel = null; drawPins(); side(); };
      return;
    }
    if (sel && sel.job) {
      const j = sel.job, L = place.get(j.id) || {};
      s.innerHTML = `<h3>ใบงาน ${esc(j.job_no)}</h3><ul class="jl">${jobLi(j)}</ul>
        <p class="sub">${L.own ? "ปักจุดของงานนี้เองแล้ว" : L.pin ? `อยู่ที่หมุด ${esc(pinName(L.pin))}` : "ยังไม่มีจุดบนแผนผัง"}</p>
        ${canPin ? `<div class="acts"><button class="btn small" type="button" id="jPin">${L.own ? "ย้ายจุดของงานนี้" : "ปักจุดของงานนี้เอง"}</button>${L.own ? `<button class="btn small" type="button" id="jUn">เอาจุดที่ปักเองออก</button>` : ""}</div>` : ""}
        <div class="acts"><button class="btn small" type="button" id="back">← ดูภาพรวมแผนผัง</button></div>`;
      if (canPin) { $("#jPin").onclick = () => startPick({ type: "job", job: j });
        if ($("#jUn")) $("#jUn").onclick = guard(async () => { const { error } = await sb.from("floor_job_pins").delete().eq("job_id", j.id); if (error) throw error;
          jpins = jpins.filter(x => x.job_id !== j.id); locate(); drawPins(); drawHeat(); side(); rPlanTable(); toast("เอาจุดออกแล้ว"); }); }
      $("#back").onclick = () => { sel = null; drawPins(); side(); };
      return;
    }
    const on = jobsOnPlan(plan), un = unplaced(plan), mine = pins.filter(p => p.plan_id === plan.id);
    const hot = mine.map(p => [p, jobsOfPin(p).length]).filter(x => x[1]).sort((a, b) => b[1] - a[1]).slice(0, 5);
    s.innerHTML = `<h3>${esc(planName(plan))}</h3><p>งานซ่อมบนแผนผังนี้ <b>${on.length}</b> งาน · หมุด ${mine.length} จุด</p>
      ${hot.length ? `<p><b>จุดที่มีงานมากที่สุด</b></p><ul class="jl">${hot.map(([p, n]) => `<li><a href="#" data-pin="${p.id}">${esc(pinName(p))}</a> · <b class="${n2c(n)}">${n} งาน</b></li>`).join("")}</ul>` : ""}
      <p style="margin-top:10px"><b>งานของชั้นนี้ที่ยังไม่มีจุด (${un.length})</b></p>
      <p class="sub">${un.length ? (canEdit ? "เพิ่มหมุดของแผนกนั้น งานทั้งหมดของแผนกจะขึ้นบนแผนผังเอง หรือกด ปักจุด ทีละงาน" : canPin ? "กด ปักจุด แล้วแตะบนแผนผังตรงจุดที่ซ่อม" : "") : "ทุกงานของชั้นนี้อยู่บนแผนผังแล้ว"}</p>
      <ul class="jl">${un.map(j => `<li><b>${esc(j.job_no)}</b> · ${esc(j.department || "-")}<br>${esc(j.detail)}${canPin ? `<br><button class="btn small" type="button" data-job="${j.id}">ปักจุด</button>` : ""}</li>`).join("")}</ul>`;
    s.querySelectorAll("[data-pin]").forEach(a => a.onclick = ev => { ev.preventDefault(); sel = { pin: pins.find(p => p.id === +a.dataset.pin) }; drawPins(); side(); });
    s.querySelectorAll("[data-job]").forEach(b => b.onclick = () => startPick({ type: "job", job: jobs.find(j => j.id === b.dataset.job) }));
  }
  const n2c = n => n >= 5 ? "bad" : n >= 3 ? "mid" : "good";

  // ---------- pinning ----------
  function startPick(p) {
    pick = { ...p, msg: p.type === "move" ? `ย้ายหมุด "${pinName(p.pin)}" ไปที่ใหม่` : p.type === "job" ? `จุดของงาน ${p.job.job_no} (${p.job.detail})` : `หมุด${KIND[p.kind]} "${p.name}"` };
    $("#plan").classList.add("picking"); $("#pickMsg").textContent = "แตะบนแผนผังตรงจุดที่ต้องการ"; $("#pickCancel").hidden = false;
    if (!canEdit) { $("#editBar").hidden = false; ["#addDept", "#addEq", "#addPt"].forEach(s => $(s).hidden = true); }
    side(); $("#stage").scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function stopPick() { pick = null; $("#plan").classList.remove("picking"); $("#pickMsg").textContent = ""; $("#pickCancel").hidden = true; if (!canEdit) $("#editBar").hidden = true; }
  $("#pickCancel").onclick = () => { stopPick(); side(); };
  const planClick = guard(async ev => {
    if (!pick || !plan) return;
    const r = $("#plan").getBoundingClientRect(), x = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)), y = Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height));
    const P = pick; stopPick();
    if (P.type === "move") {
      const { error } = await sb.from("floor_pins").update({ x, y }).eq("id", P.pin.id); if (error) throw error; P.pin.x = x; P.pin.y = y; toast("ย้ายหมุดแล้ว");
    } else if (P.type === "job") {
      const row = { job_id: P.job.id, plan_id: plan.id, x, y, set_by: me.id, set_at: new Date().toISOString() };
      const { error } = await sb.from("floor_job_pins").upsert(row); if (error) throw error;
      jpins = jpins.filter(q => q.job_id !== P.job.id).concat(row); sel = { job: P.job }; toast(`ปักจุดของงาน ${P.job.job_no} แล้ว`);
    } else {
      const row = { plan_id: plan.id, kind: P.kind, department: P.department || null, equipment_id: P.equipment_id || null, label: P.label || null, x, y, created_by: me.id };
      const { data, error } = await sb.from("floor_pins").insert(row).select().single(); if (error) throw error;
      pins.push({ ...data, x: +data.x, y: +data.y }); if (P.equipment_id) eqNames[P.equipment_id] = P.name; sel = { pin: pins[pins.length - 1] };
      toast(`ปักหมุด ${P.name} แล้ว`);
    }
    locate(); drawPins(); drawHeat(); side(); rPlanTable();
  });
  $("#plan").addEventListener("click", ev => { if (pick) planClick(ev); });

  // small form in a dialog (no browser pop-ups)
  function ask(title, inner, onOk, okText = "ตกลง") {
    const d = $("#dlg"), f = $("#dlgF");
    f.innerHTML = `<h3>${esc(title)}</h3><div style="text-align:left;display:flex;flex-direction:column;gap:8px;margin:10px 0">${inner}</div>
      <div class="acts" style="justify-content:center"><button class="btn primary" value="ok">${esc(okText)}</button><button class="btn" value="no" formnovalidate>ยกเลิก</button></div>`;
    f.onsubmit = ev => { if (ev.submitter && ev.submitter.value === "no") return; ev.preventDefault(); if (!f.reportValidity()) return; d.close(); onOk(f); };
    d.showModal(); const first = f.querySelector("input,select"); if (first) first.focus();
    return f;
  }
  $("#addDept").onclick = () => {
    if (!plan) return;
    const here = [...new Set(locs.filter(l => norm(l.building) === norm(plan.building) && norm(l.floor) === norm(plan.floor)).map(l => l.department))];
    const fromJobs = [...new Set(unplaced(plan, jobs).map(j => j.department).filter(Boolean))];
    const used = new Set(pins.filter(p => p.plan_id === plan.id && p.kind === "dept").map(p => norm(p.department)));
    const all = [...new Set([...fromJobs, ...here])].filter(d => !used.has(norm(d))).sort((a, b) => a.localeCompare(b, "th"));
    ask("เพิ่มหมุดแผนก", `<p class="sub">เลือกแผนกของชั้นนี้ (ที่มีงานแต่ยังไม่มีหมุดขึ้นก่อน) หรือพิมพ์ชื่อแผนกให้ตรงกับในใบแจ้งซ่อม</p>
      <label>แผนก<input name="v" list="dlist" required autocomplete="off"></label><datalist id="dlist">${all.map(d => `<option value="${esc(d)}">`).join("")}</datalist>
      ${all.length ? `<div style="display:flex;flex-wrap:wrap;gap:6px">${all.slice(0, 40).map(d => `<button type="button" class="btn small" data-d="${esc(d)}">${esc(d)}</button>`).join("")}</div>` : ""}`,
      f => { const v = f.v.value.trim(); startPick({ kind: "dept", department: v, name: v }); }, "ต่อไป: แตะบนแผนผัง")
      .querySelectorAll("[data-d]").forEach(b => b.onclick = () => { $("#dlgF").v.value = b.dataset.d; });
  };
  $("#addPt").onclick = () => { if (!plan) return;
    ask("เพิ่มหมุดจุดอื่น", `<p class="sub">เช่น ห้องเครื่อง ตู้ไฟ ท่อหลัก ช่องชาร์ป</p><label>ชื่อจุด<input name="v" required></label>`,
      f => { const v = f.v.value.trim(); startPick({ kind: "point", label: v, name: v }); }, "ต่อไป: แตะบนแผนผัง"); };
  $("#addEq").onclick = () => { if (!plan) return;
    const f = ask("เพิ่มหมุดเครื่องจักร", `<p class="sub">พิมพ์ TAG รหัส หรือชื่อเครื่อง แล้วกดค้นหา จากนั้นกดเลือกเครื่อง</p>
      <div style="display:flex;gap:6px"><input name="q" placeholder="เช่น AHU-01 หรือ ปั๊มน้ำ" style="flex:1"><button type="button" class="btn small" id="eqGo">ค้นหา</button></div>
      <div id="eqRes" style="max-height:260px;overflow:auto"></div><input type="hidden" name="v"><input type="hidden" name="n">`,
      f => { if (!f.v.value) return toast("ยังไม่ได้เลือกเครื่อง", true); startPick({ kind: "equip", equipment_id: f.v.value, name: f.n.value }); }, "ต่อไป: แตะบนแผนผัง");
    const go = guard(async () => {
      const q = f.q.value.replace(/[,()%*\\]/g, " ").trim();
      let r = sb.from("equipment").select("id,tag,code,name,building,floor,place").eq("hospital_id", $("#h").value).eq("active", true).limit(40);
      if (q) r = r.or(`tag.ilike.%${q}%,code.ilike.%${q}%,name.ilike.%${q}%`); else r = r.eq("building", plan.building).eq("floor", plan.floor);
      const { data, error } = await r; if (error) throw error;
      const list = (data || []).sort((a, b) => (norm(b.floor) === norm(plan.floor)) - (norm(a.floor) === norm(plan.floor)));
      $("#eqRes").innerHTML = list.length ? list.map(e => `<button type="button" class="btn small" style="display:block;width:100%;text-align:left;margin:3px 0" data-e="${e.id}">${esc([e.tag || e.code, e.name].filter(Boolean).join(" · "))}<br><span class="sub">${esc([e.building && "อาคาร " + e.building, e.floor && "ชั้น " + e.floor, e.place].filter(Boolean).join(" · "))}</span></button>`).join("") : `<p class="sub">ไม่พบเครื่อง ลองพิมพ์คำอื่น</p>`;
      $("#eqRes").querySelectorAll("[data-e]").forEach(b => b.onclick = () => { const e = list.find(x => x.id === b.dataset.e); f.v.value = e.id; f.n.value = [e.tag || e.code, e.name].filter(Boolean).join(" · ");
        $("#eqRes").querySelectorAll("[data-e]").forEach(x => x.style.outline = x === b ? "3px solid #0b5cad" : ""); });
    });
    $("#eqGo").onclick = go; f.q.onkeydown = ev => { if (ev.key === "Enter") { ev.preventDefault(); go(); } }; go();
  };

  // ---------- tables ----------
  const tb = (head, rows) => `<tr>${head.map(h => `<th>${esc(h)}</th>`).join("")}</tr>` + (rows.length ? rows.map(r => `<tr>${r.map(v => `<td${typeof v === "number" ? ' class="n"' : ""}>${esc(v)}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${head.length}" class="sub">ไม่มีข้อมูล</td></tr>`);
  const PIN_HEAD = ["ลำดับ", "จุด", "ชนิด", "แผนผัง", "งานทั้งหมด", "ยังไม่ปิด", "ซ้ำใน 30 วัน", "ระดับ", "ประเภทงานที่พบมาก", "งานล่าสุด"];
  function pinRows(list) {
    return list.map(p => { const L = jobsOfPin(p), pl = plans.find(x => x.id === p.plan_id), last = L[0];
      return { p, n: L.length, row: [0, pinName(p), KIND[p.kind], planName(pl), L.length, L.filter(isOpen).length, repeat30(L), level(L.length), topType(L).slice(0, 3).map(([k, v]) => `${k} ${v}`).join(", ") || "-", last ? `${last.job_no} ${dTH(last.created_at)}` : "-"] }; })
      .sort((a, b) => b.n - a.n || a.row[1].localeCompare(b.row[1], "th")).map((x, i) => { x.row[0] = i + 1; return x; });
  }
  function rPlanTable() {
    if (!plan) return;
    const on = jobsOnPlan(plan), mine = pins.filter(p => p.plan_id === plan.id), pr = pinRows(mine), un = unplaced(plan);
    $("#pk").innerHTML = [["งานซ่อมบนแผนผัง", on.length], ["ยังไม่ปิด", on.filter(isOpen).length], ["หมุดทั้งหมด", mine.length], ["จุดเสียบ่อย (5 งานขึ้นไป)", pr.filter(x => x.n >= 5).length], ["งานที่ยังไม่มีจุด", un.length]]
      .map(([k, v]) => `<div class="kpi"><b>${v}</b><span>${esc(k)}</span></div>`).join("");
    $("#pTab").innerHTML = tb(PIN_HEAD, pr.map(x => x.row));
  }
  function hotData() {
    const pr = pinRows(pins), list = shown(), off = {};
    list.forEach(j => { const L = place.get(j.id); if (L && !L.none) return;
      const k = [j.building || "-", j.floor || "-", j.department || "-"].join("|"); (off[k] ||= { b: j.building || "-", f: j.floor || "-", d: j.department || "-", L: [], why: L ? "มีแผนผังชั้นนี้ แต่ยังไม่มีหมุดแผนกนี้" : "ยังไม่มีแผนผังของชั้นนี้" }).L.push(j); });
    const offRows = Object.values(off).sort((a, b) => b.L.length - a.L.length).map(o => [o.b, o.f, o.d, o.L.length, o.L.filter(isOpen).length, repeat30(o.L), topType(o.L).slice(0, 3).map(([k, v]) => `${k} ${v}`).join(", "), o.why]);
    const onPlans = list.filter(j => { const L = place.get(j.id); return L && !L.none; }).length, freeN = plans.reduce((s, p) => s + freeOwn(p).length, 0);
    return { pr, offRows, list, onPlans, freeN };
  }
  const OFF_HEAD = ["อาคาร", "ชั้น", "แผนก", "งานทั้งหมด", "ยังไม่ปิด", "ซ้ำใน 30 วัน", "ประเภทงานที่พบมาก", "เหตุที่ยังไม่ขึ้นแผนผัง"];
  async function rHot() {
    const H = hotData(), red = H.pr.filter(x => x.n >= 5), amber = H.pr.filter(x => x.n >= 3 && x.n < 5);
    $("#hk").innerHTML = [["งานซ่อมในช่วงที่เลือก", H.list.length], ["อยู่บนแผนผังแล้ว", H.onPlans], ["แผนผัง", plans.length], ["หมุด", pins.length], ["จุดเสียบ่อย (5 งานขึ้นไป)", red.length], ["จุดเฝ้าระวัง (3-4 งาน)", amber.length]]
      .map(([k, v]) => `<div class="kpi"><b>${v}</b><span>${esc(k)}</span></div>`).join("");
    $("#hNote").innerHTML = findingsHot(H).map(esc).join("<br>");
    $("#hTop").innerHTML = tb(PIN_HEAD, H.pr.filter(x => x.n).slice(0, 10).map(x => x.row));
    $("#hAll").innerHTML = tb(PIN_HEAD, H.pr.map(x => x.row));
    $("#hOff").innerHTML = tb(OFF_HEAD, H.offRows);
  }
  function findingsHot(H) {
    const f = [], red = H.pr.filter(x => x.n >= 5), amber = H.pr.filter(x => x.n >= 3 && x.n < 5);
    f.push(`${hosp().code || ""} ${period()}: งานซ่อม ${H.list.length} งาน อยู่บนแผนผังแล้ว ${H.onPlans} งาน (${H.list.length ? Math.round(H.onPlans * 100 / H.list.length) : 0}%) จากแผนผัง ${plans.length} แผ่น หมุด ${pins.length} จุด`);
    if (red.length) f.push(`จุดเสียบ่อย 5 งานขึ้นไป ${red.length} จุด: ${red.slice(0, 5).map(x => `${x.row[1]} (${x.n} งาน)`).join(", ")}`);
    else f.push("ยังไม่มีจุดที่มีงานซ่อม 5 งานขึ้นไปในช่วงนี้");
    if (amber.length) f.push(`จุดเฝ้าระวัง 3-4 งาน ${amber.length} จุด: ${amber.slice(0, 5).map(x => `${x.row[1]} (${x.n} งาน)`).join(", ")}`);
    const rep = H.pr.filter(x => x.row[6] > 0);
    if (rep.length) f.push(`จุดที่เสียซ้ำภายใน 30 วัน ${rep.length} จุด ควรหาสาเหตุรากและแก้ที่ต้นเหตุ`);
    if (H.offRows.length) f.push(`งานที่ยังไม่ขึ้นแผนผัง ${H.list.length - H.onPlans} งาน ใน ${H.offRows.length} แผนก มากที่สุดคือ อาคาร ${H.offRows[0][0]} ชั้น ${H.offRows[0][1]} ${H.offRows[0][2]} (${H.offRows[0][3]} งาน)`);
    return f;
  }
  function analysisFor(pr) {
    const a = [];
    pr.filter(x => x.n >= 3).slice(0, 8).forEach(x => { const L = jobsOfPin(x.p), tt = topType(L), r = x.row[6];
      a.push(`${x.row[1]} (${x.row[3]}): ${x.n} งาน ยังไม่ปิด ${x.row[5]} งาน ประเภทที่พบมากคือ ${tt[0][0]} ${tt[0][1]} งาน${r ? ` เสียซ้ำภายใน 30 วัน ${r} ครั้ง` : ""} ${x.p.kind === "equip" ? "ควรตรวจสภาพเครื่อง ทบทวนรอบ PM และพิจารณาเปลี่ยนเครื่องหรืออะไหล่หลัก" : "ควรเดินตรวจพื้นที่ หาสาเหตุร่วม (ระบบท่อ ไฟฟ้า แอร์ หรือการใช้งาน) และแก้ที่ต้นเหตุ"}`); });
    if (!a.length) a.push("ยังไม่มีจุดที่มีงาน 3 งานขึ้นไป ให้ติดตามต่อและปักหมุดแผนกหรือเครื่องให้ครบ เพื่อให้เห็นจุดเสียบ่อยได้ชัดขึ้น");
    return a;
  }
  const NOTES = ["สีของหมุด: เทา = ยังไม่มีงาน, เขียว = 1-2 งาน, ส้ม = 3-4 งาน (เฝ้าระวัง), แดง = 5 งานขึ้นไป (เสียบ่อย) ในช่วงวันที่เลือก",
    "งานขึ้นแผนผังโดย: จุดที่ช่างปักเองก่อน ถ้าไม่มีใช้หมุดของเครื่องจักรในใบงาน ถ้าไม่มีใช้หมุดของแผนกในอาคารและชั้นเดียวกัน",
    "ข้อมูลนี้ใช้ประกอบการวางแผนปรับปรุงระบบอาคาร แผน PM และการเตรียมรับตรวจ JCI (FMS) ไม่มีผลกับ KPI หรือ SLA"];

  // ---------- picture of a plan with its pins, for PPT / Word / PDF ----------
  async function planPng(pl) {
    const img = new Image(); img.src = await picture(pl); await img.decode();
    const W = Math.min(1600, img.naturalWidth || 1600), H = Math.round(W * img.naturalHeight / img.naturalWidth);
    const c = Object.assign(document.createElement("canvas"), { width: W, height: H }), g = c.getContext("2d");
    g.fillStyle = "#fff"; g.fillRect(0, 0, W, H); g.drawImage(img, 0, 0, W, H);
    const hc = document.createElement("canvas"); heatOn(hc, pl, W); g.globalAlpha = 0.6; g.drawImage(hc, 0, 0, W, H); g.globalAlpha = 1;
    const col = { c0: "#8a95a1", c1: "#1f8a4c", c2: "#d08a00", c3: "#c2352b" }, R = Math.max(12, W / 70), fs = Math.round(R * 0.95);
    pins.filter(p => p.plan_id === pl.id).forEach(p => { const n = jobsOfPin(p).length, x = p.x * W, y = p.y * H;
      g.fillStyle = col[cls(n)]; g.strokeStyle = "#fff"; g.lineWidth = 3; g.beginPath();
      if (p.kind === "equip") g.rect(x - R, y - R, 2 * R, 2 * R); else g.arc(x, y, R, 0, Math.PI * 2); g.fill(); g.stroke();
      g.fillStyle = "#fff"; g.font = `bold ${fs}px Tahoma, sans-serif`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(String(n), x, y + 1);
      const t = pinName(p); g.font = `bold ${Math.round(fs * 0.8)}px Tahoma, sans-serif`; const tw = g.measureText(t).width;
      g.fillStyle = "rgba(255,255,255,.92)"; g.fillRect(x - tw / 2 - 4, y + R + 3, tw + 8, fs + 4); g.fillStyle = "#17212b"; g.fillText(t, x, y + R + 5 + fs / 2); });
    freeOwn(pl).forEach(j => { const L = place.get(j.id); g.fillStyle = "#6b4bb8"; g.strokeStyle = "#fff"; g.lineWidth = 2; g.beginPath(); g.arc(L.x * W, L.y * H, R * 0.5, 0, Math.PI * 2); g.fill(); g.stroke(); });
    return { img: c.toDataURL("image/png"), imgR: H / W };
  }

  // ---------- exports: Excel, PPT, Word, PDF ----------
  const fname = k => `แผนผัง_${k}_${hosp().code || ""}_${$("#d2").value}`;
  async function planDeck() {
    if (!plan) throw new Error("ยังไม่มีแผนผัง");
    const on = jobsOnPlan(plan), mine = pins.filter(p => p.plan_id === plan.id), pr = pinRows(mine), un = unplaced(plan), red = pr.filter(x => x.n >= 5);
    const findings = [`${planName(plan)} ${period()}: งานซ่อมบนแผนผัง ${on.length} งาน ยังไม่ปิด ${on.filter(isOpen).length} งาน หมุด ${mine.length} จุด`,
      red.length ? `จุดเสียบ่อย 5 งานขึ้นไป ${red.length} จุด: ${red.map(x => `${x.row[1]} (${x.n} งาน)`).join(", ")}` : "ยังไม่มีจุดที่มีงาน 5 งานขึ้นไปบนแผนผังนี้",
      ...(pr[0] && pr[0].n ? [`จุดที่มีงานมากที่สุด: ${pr[0].row[1]} ${pr[0].n} งาน ประเภทที่พบมาก ${pr[0].row[8]}`] : []),
      un.length ? `งานของชั้นนี้ที่ยังไม่มีจุดบนแผนผัง ${un.length} งาน ควรเพิ่มหมุดแผนกให้ครบ` : "งานของชั้นนี้อยู่บนแผนผังครบทุกงาน"];
    const pic = await planPng(plan);
    return { title: `แผนผังอาคาร · จุดเสียบ่อย ${planName(plan)}`, org: hosp().name, period: period(), findings,
      kpis: [["งานซ่อมบนแผนผัง", on.length], ["ยังไม่ปิด", on.filter(isOpen).length], ["หมุดทั้งหมด", mine.length], ["จุดเสียบ่อย (5 งานขึ้นไป)", red.length], ["งานที่ยังไม่มีจุด", un.length]],
      analysis: analysisFor(pr),
      sections: [{ title: `แผนผังพร้อมหมุด ${planName(plan)}`, img: pic.img, imgR: pic.imgR, note: "ตัวเลขในหมุด = จำนวนงานซ่อมในช่วงวันที่เลือก" },
        { title: "จุดบนแผนผัง เรียงจากงานมากไปน้อย", head: ["จุด", "งาน", "ยังไม่ปิด", "ซ้ำใน 30 วัน", "ระดับ"], rows: pr.map(x => [x.row[1], x.n, x.row[5], x.row[6], x.row[7]]), chart: false, left: true },
        { title: "งานที่ยังไม่มีจุดบนแผนผัง", head: ["ใบงาน", "แผนก", "รายละเอียด", "สถานะ"], rows: un.map(j => [j.job_no, j.department || "-", j.detail, STATUS[j.status] || j.status]), chart: false, left: true }],
      notes: NOTES, _pr: pr, _on: on, _un: un };
  }
  async function hotDeck() {
    const H = hotData(), secs = [];
    for (const pl of plans) { if (!jobsOnPlan(pl).length) continue; const pic = await planPng(pl); secs.push({ title: `แผนผังพร้อมหมุด ${planName(pl)}`, img: pic.img, imgR: pic.imgR, note: `งานบนแผนผังนี้ ${jobsOnPlan(pl).length} งาน` }); }
    const top = H.pr.filter(x => x.n).slice(0, 10);
    return { title: "แผนผังอาคาร · จุดเสียบ่อยของงานซ่อม", org: hosp().name, period: period(), findings: findingsHot(H),
      kpis: [["งานซ่อมในช่วงที่เลือก", H.list.length], ["อยู่บนแผนผังแล้ว", H.onPlans], ["แผนผัง", plans.length], ["หมุด", pins.length], ["จุดเสียบ่อย (5 งานขึ้นไป)", H.pr.filter(x => x.n >= 5).length], ["จุดเฝ้าระวัง (3-4 งาน)", H.pr.filter(x => x.n >= 3 && x.n < 5).length]],
      analysis: analysisFor(H.pr),
      sections: [{ title: "10 จุดที่เสียบ่อยที่สุด", head: ["จุด", "งาน", "ยังไม่ปิด", "ซ้ำใน 30 วัน", "แผนผัง"], rows: top.map(x => [x.row[1], x.n, x.row[5], x.row[6], x.row[3]]), chart: false, left: true },
        ...secs,
        { title: "งานที่ยังไม่อยู่บนแผนผัง", head: ["อาคาร", "ชั้น", "แผนก", "งาน", "เหตุ"], rows: H.offRows.map(r => [r[0], r[1], r[2], r[3], r[7]]), chart: false, left: true }],
      notes: NOTES, _H: H };
  }
  const jobRow = j => { const L = place.get(j.id) || {}; return [j.job_no, dTH(j.created_at), j.building || "-", j.floor || "-", j.department || "-", j.equipment_text || "-", j.job_type || "-", j.detail, STATUS[j.status] || j.status,
    L.own ? "ปักจุดเอง" + (L.pin ? ` (ใกล้ ${pinName(L.pin)})` : "") : L.pin ? pinName(L.pin) : L.none ? "ยังไม่มีจุด" : "ยังไม่มีแผนผัง"]; };
  const JOB_HEAD = ["ใบงาน", "วันที่แจ้ง", "อาคาร", "ชั้น", "แผนก", "เครื่อง", "ประเภทงาน", "รายละเอียด", "สถานะ", "จุดบนแผนผัง"];
  const sum = d => Office.summarySheet({ title: d.title, org: d.org, period: d.period, findings: [...d.findings, ...d.analysis.map(a => "วิเคราะห์: " + a)], notes: d.notes, figures: d.kpis });
  const run = fn => guard(async () => { toast("กำลังสร้างไฟล์…"); await fn(); toast("สร้างไฟล์แล้ว ดูในโฟลเดอร์ดาวน์โหลด"); });
  $("#mP").onclick = run(async () => Office.pptx(fname("ชั้น"), await planDeck()));
  $("#mW").onclick = run(async () => Office.docx(fname("ชั้น"), await planDeck()));
  $("#mF").onclick = run(async () => Office.pdf(fname("ชั้น"), await planDeck()));
  $("#mX").onclick = run(async () => { const d = await planDeck();
    Office.xlsx(fname("ชั้น"), [sum(d), { name: "จุดบนแผนผัง", rows: [PIN_HEAD, ...d._pr.map(x => x.row)], header: 0 },
      { name: "งานบนแผนผัง", rows: [JOB_HEAD, ...d._on.map(jobRow)], header: 0 }, { name: "งานที่ยังไม่มีจุด", rows: [JOB_HEAD, ...d._un.map(jobRow)], header: 0 }]); });
  $("#hP").onclick = run(async () => Office.pptx(fname("จุดเสียบ่อย"), await hotDeck()));
  $("#hW").onclick = run(async () => Office.docx(fname("จุดเสียบ่อย"), await hotDeck()));
  $("#hF").onclick = run(async () => Office.pdf(fname("จุดเสียบ่อย"), await hotDeck()));
  $("#hX").onclick = run(async () => { const d = await hotDeck();
    Office.xlsx(fname("จุดเสียบ่อย"), [sum(d), { name: "ทุกจุดบนแผนผัง", rows: [PIN_HEAD, ...d._H.pr.map(x => x.row)], header: 0 },
      { name: "ยังไม่อยู่บนแผนผัง", rows: [OFF_HEAD, ...d._H.offRows], header: 0 }, { name: "งานซ่อมทั้งหมด", rows: [JOB_HEAD, ...d._H.list.map(jobRow)], header: 0 }]); });

  // ---------- manage plans ----------
  async function rPlans() {
    const box = $("#pCards");
    if (!plans.length) { box.innerHTML = `<p class="sub">ยังไม่มีแผนผัง${canEdit ? " เพิ่มแผนผังแรกด้วยแบบฟอร์มด้านบน" : ""}</p>`; return; }
    box.innerHTML = plans.map(p => `<div class="pc"><img alt="" data-img="${p.id}"><b>${esc(planName(p))}</b><span class="sub">งาน ${jobsOnPlan(p).length} · หมุด ${pins.filter(x => x.plan_id === p.id).length} · เพิ่มเมื่อ ${esc(dTH(p.created_at))}</span>
      ${p.note ? `<br><span class="sub">${esc(p.note)}</span>` : ""}
      <div class="acts"><button class="btn small primary" type="button" data-open="${p.id}">เปิดแผนผัง</button>${canEdit ? `<button class="btn small" type="button" data-rep="${p.id}">เปลี่ยนรูป</button><button class="btn small" type="button" data-hide="${p.id}">ซ่อนแผนผัง</button>` : ""}</div></div>`).join("");
    box.querySelectorAll("[data-open]").forEach(b => b.onclick = () => { $("#pl").value = b.dataset.open; sel = null; show("map"); });
    box.querySelectorAll("[data-rep]").forEach(b => b.onclick = () => { const p = plans.find(x => x.id === +b.dataset.rep);
      ask("เปลี่ยนรูปแผนผัง", `<p class="sub">หมุดเดิมอยู่ที่ตำแหน่งเดิมบนรูป ใช้รูปที่ขนาดและมุมเดียวกับรูปเดิม</p><label>ไฟล์ใหม่<input type="file" name="f" accept="image/jpeg,image/png,image/webp,application/pdf" required></label>`,
        guard(async f => { toast("กำลังอัปโหลด…"); const u = await upload(f.f.files[0]);
          const { error } = await sb.from("floor_plans").update({ image_path: u.path, img_w: u.w, img_h: u.h, updated_at: new Date().toISOString() }).eq("id", p.id); if (error) throw error;
          Object.assign(p, { image_path: u.path, img_w: u.w, img_h: u.h }); toast("เปลี่ยนรูปแล้ว"); rPlans(); }), "อัปโหลด"); });
    box.querySelectorAll("[data-hide]").forEach(b => b.onclick = () => { const p = plans.find(x => x.id === +b.dataset.hide);
      ask("ซ่อนแผนผังนี้?", `<p>${esc(planName(p))}</p><p class="sub">หมุดและงานซ่อมยังอยู่ในระบบครบ ถ้าต้องการกลับมาใช้ ให้แจ้งผู้ดูแลระบบ</p>`, guard(async () => {
        const { error } = await sb.from("floor_plans").update({ active: false }).eq("id", p.id); if (error) throw error; await load(); rPlans(); toast("ซ่อนแผนผังแล้ว"); }), "ซ่อน"); });
    for (const p of plans) { const im = box.querySelector(`[data-img="${p.id}"]`); picture(p).then(u => im.src = u).catch(() => im.alt = "เปิดรูปไม่ได้"); }
  }
  let pdfLib;
  const loadPdf = () => pdfLib || (pdfLib = new Promise((ok, bad) => { const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"; ok(window.pdfjsLib); };
    s.onerror = () => { pdfLib = null; bad(new Error("โหลดตัวอ่าน PDF ไม่สำเร็จ ลองใหม่ หรือใช้ไฟล์รูป JPG / PNG แทน")); }; document.head.appendChild(s); }));
  // the file becomes one JPEG of at most 3000 px (a PDF: its first page), so plans open fast on a phone
  async function upload(file) {
    if (!file) throw new Error("ยังไม่ได้เลือกไฟล์");
    if (file.size > 40 * 1024 * 1024) throw new Error("ไฟล์ใหญ่เกิน 40 MB");
    let src;
    if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
      const lib = await loadPdf(), doc = await lib.getDocument({ data: await file.arrayBuffer() }).promise, pg = await doc.getPage(1), v0 = pg.getViewport({ scale: 1 });
      const vp = pg.getViewport({ scale: Math.min(4, 3000 / Math.max(v0.width, v0.height)) });
      src = Object.assign(document.createElement("canvas"), { width: Math.round(vp.width), height: Math.round(vp.height) });
      const g = src.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, src.width, src.height);
      await pg.render({ canvasContext: g, viewport: vp }).promise;
    } else {
      try { src = await createImageBitmap(file); } catch (e) { throw new Error("เปิดไฟล์รูปนี้ไม่ได้ ใช้ไฟล์ JPG หรือ PNG"); }
    }
    const k = Math.min(1, 3000 / Math.max(src.width, src.height)), c = Object.assign(document.createElement("canvas"), { width: Math.round(src.width * k), height: Math.round(src.height * k) });
    const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(src, 0, 0, c.width, c.height);
    const blob = await new Promise(r => c.toBlob(r, "image/jpeg", 0.86)), path = `${hosp().code}/${crypto.randomUUID()}.jpg`;
    const up = await sb.storage.from("floor-plans").upload(path, blob, { contentType: "image/jpeg" }); if (up.error) throw up.error;
    return { path, w: c.width, h: c.height };
  }
  $("#fU").onsubmit = guard(async () => {
    const b = $("#uB").value.trim(), f = $("#uF").value.trim();
    if (plans.some(p => norm(p.building) === norm(b) && norm(p.floor) === norm(f)) && !confirm(`มีแผนผังของ อาคาร ${b} ชั้น ${f} อยู่แล้ว ต้องการเพิ่มอีกแผ่นหรือไม่ (ถ้าต้องการแทนรูปเดิม ให้กด ยกเลิก แล้วใช้ปุ่ม เปลี่ยนรูป)`)) return;
    $("#uMsg").textContent = "กำลังอัปโหลด…";
    try {
      const u = await upload($("#uFile").files[0]);
      const { data, error } = await sb.from("floor_plans").insert({ hospital_id: $("#h").value, building: b, floor: f, title: $("#uT").value.trim() || null, note: $("#uN").value.trim() || null,
        image_path: u.path, img_w: u.w, img_h: u.h, created_by: me.id }).select().single();
      if (error) throw error;
      $("#uMsg").textContent = "อัปโหลดแล้ว"; $("#fU").reset(); await load(); $("#pl").value = data.id;
      toast("อัปโหลดแผนผังแล้ว ต่อไปปักหมุดแผนกและเครื่องจักรบนแผนผัง"); show("map");
    } catch (e) { $("#uMsg").textContent = errText(e); throw e; }
  });
})();
