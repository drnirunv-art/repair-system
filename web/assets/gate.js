// Security gate desk for contractors (Work Permit): the guard finds the permit (search or scan its QR), checks the person is
// on the permit's worker list, swaps an ID badge and checks them in; checks them out when the badge comes back.
// The server refuses: permits not approved / outside their dates, a person or badge already inside, a missing badge number.
(() => {
  const { sb, $, esc, fmt, errText } = RS;
  const TD = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
  const OK = ["approved", "working", "fix"];
  let me = null, permits = [], open = [], log = [], cur = "in", busy = false, stream = null;
  const toast = (m, bad) => { const t = $("#toast"); t.textContent = m; t.hidden = false; t.style.background = bad ? "var(--bad)" : ""; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, bad ? 6000 : 3000); };
  const rpc = async (name, args) => { const { data, error } = await sb.rpc(name, args); if (error) throw error; return data; };
  const guard = fn => async ev => { if (busy) return; busy = true; try { await fn(ev); } catch (e) { toast(errText(e), true); } finally { busy = false; } };
  const n = v => (+v || 0).toLocaleString("th-TH");
  const none = (c, w) => `<tr><td colspan="${c}"><div class="empty">${w}</div></td></tr>`;
  const be = d => d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${+d.slice(0, 4) + 543}` : "-";
  const hm = iso => iso ? new Date(iso).toLocaleTimeString("th-TH", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit" }) : "";
  const since = iso => { const m = Math.round((Date.now() - new Date(iso)) / 60000); return m < 60 ? `${m} นาที` : m < 1440 ? `${Math.floor(m / 60)} ชม. ${m % 60} นาที` : `${(m / 1440).toFixed(1)} วัน`; };
  const key = s => String(s || "").trim().toLowerCase();
  const haz = h => (WP.HAZ.find(x => x[0] === h) || [h, h])[1];
  const valid = p => OK.includes(p.status) && (!p.start_date || p.start_date <= TD()) && (!p.end_date || p.end_date >= TD());
  const pOf = g => g.wp_permits || permits.find(p => p.id === g.permit_id) || {};

  sb.auth.onAuthStateChange((_e, session) => setTimeout(() => boot(session), 0));
  async function boot(session) {
    if (me) return;
    if (!session) { $("#gate").hidden = false; return; }
    const { data } = await sb.from("profiles").select("id,full_name,role,hospital_id,hospitals(id,code,name)").eq("id", session.user.id).maybeSingle();
    if (!data || !data.hospital_id) { $("#gate").hidden = false; return; }
    if (data.role === "observer") { $("#gateH").textContent = "หน้านี้สำหรับเจ้าหน้าที่ป้อม รปภ. และงานวิศวกรรม"; $("#gateP").textContent = "บัญชีผู้สังเกตการณ์เปิดหน้านี้ไม่ได้"; $("#gate").hidden = false; return; }
    me = data; $("#who").textContent = `${me.full_name || ""} · ${me.hospitals.name}`;
    $("#d").value = TD(); $("#body").hidden = false; $("#tabs").hidden = false;
    await load(); show(new URLSearchParams(location.search).get("tab") || "in");
    setInterval(() => { if (!busy && !document.hidden) load().then(() => render()); }, 60000);
  }
  async function load() {
    const sel = "id,permit_id,work_date,worker,badge,in_at,out_at,wp_permits(permit_no,title,company,area,hospital_id)";
    const [p, o, l] = await Promise.all([
      sb.from("wp_permits").select("id,permit_no,token,title,company,area,start_date,end_date,work_hours,hazards,workers,status,contact_name,contact_phone").eq("hospital_id", me.hospital_id).in("status", OK).order("permit_no").limit(500),
      sb.from("wp_gate").select(sel).is("out_at", null).order("in_at").limit(1000),
      sb.from("wp_gate").select(sel).eq("work_date", $("#d").value || TD()).order("in_at", { ascending: false }).limit(2000)]);
    if (p.error) return toast(errText(p.error), true);
    permits = (p.data || []).filter(x => OK.includes(x.status));
    open = (o.data || []).filter(g => !g.out_at);
    log = (l.data || []).filter(g => g.work_date === ($("#d").value || TD()));
    const today = log.length && $("#d").value === TD() ? log : (await sb.from("wp_gate").select("id,work_date,out_at").eq("work_date", TD()).limit(2000)).data?.filter(g => g.work_date === TD()) || [];
    $("#k").innerHTML = [["อยู่ในพื้นที่ตอนนี้", open.length, open.some(g => g.work_date < TD())], ["เข้าวันนี้ (ครั้ง)", today.length], ["ออกแล้ววันนี้", today.filter(g => g.out_at).length], ["ใบอนุญาตที่เข้าได้วันนี้", permits.filter(valid).length]]
      .map(([k, v, bad]) => `<div class="kpi"><b style="${bad ? "color:var(--bad)" : ""}">${n(v)}</b><span>${esc(k)}</span></div>`).join("");
    $("#nowN").textContent = open.length || "";
  }

  document.querySelectorAll("#tabs button").forEach(b => b.onclick = () => show(b.dataset.tab));
  function show(t) {
    cur = ["in", "now", "log"].includes(t) ? t : "in";
    document.querySelectorAll("#tabs button").forEach(b => b.setAttribute("aria-selected", b.dataset.tab === cur));
    ["in", "now", "log"].forEach(x => $("#tab-" + x).hidden = x !== cur);
    if (cur !== "in") stopCam();
    render();
  }
  function render() { if (cur === "in") renderIn(); else if (cur === "now") renderNow(); else renderLog(); }

  // ---------- check in ----------
  function tokenOf(s) { const m = String(s || "").match(/[?&#]t=([0-9a-f-]{36})/i) || String(s || "").match(/^([0-9a-f]{8}-[0-9a-f-]{27})$/i); return m ? m[1].toLowerCase() : null; }
  function renderIn() {
    const raw = $("#q").value.trim(), tk = tokenOf(raw), q = key(raw);
    let list = tk ? permits.filter(p => p.token === tk) : permits;
    if (q && !tk) list = list.filter(p => key([p.permit_no, p.title, p.company, p.area, ...(p.workers || []).map(w => w.name)].join(" ")).includes(q));
    list = list.slice().sort((a, b) => valid(b) - valid(a));
    let head = "";
    if (tk && !list.length) head = `<div class="no"><b>ไม่พบใบอนุญาตนี้ในรายการที่อนุมัติแล้ว</b><br>อาจยังไม่อนุมัติ ปิดงานแล้ว หรือเป็นของโรงพยาบาลอื่น ห้ามให้เข้าพื้นที่ และโทรแจ้งงานวิศวกรรม</div>`;
    else if (q && !list.length) head = `<div class="no"><b>ไม่พบชื่อหรือใบอนุญาตที่ค้นหา</b><br>ผู้ที่ไม่มีชื่อใน Work Permit ห้ามให้เข้าพื้นที่ ให้โทรแจ้งงานวิศวกรรมเพื่อเพิ่มชื่อก่อน</div>`;
    else if (!list.length) head = `<div class="empty">วันนี้ยังไม่มี Work Permit ที่อนุมัติให้เข้าพื้นที่</div>`;
    $("#pl").innerHTML = head + list.slice(0, 40).map(p => {
      const ok = valid(p), inside = open.filter(g => g.permit_id === p.id);
      const ws = (p.workers || []).filter(w => w && w.name);
      return `<div class="pc" data-p="${p.id}">
        <h3>${esc(p.permit_no)} · ${esc(p.title)}</h3>
        <div class="meta"><b>${esc(p.company)}</b>${p.contact_name ? ` · ผู้ติดต่อ ${esc(p.contact_name)} ${esc(p.contact_phone || "")}` : ""}</div>
        <div class="meta">พื้นที่ ${esc(p.area || "-")} · วันที่ ${be(p.start_date)} ถึง ${be(p.end_date)}${p.work_hours ? ` · เวลา ${esc(p.work_hours)}` : ""} · ${esc(WP.ST[p.status] || p.status)}</div>
        ${(p.hazards || []).length ? `<div>${p.hazards.map(h => `<span class="hz">${esc(haz(h))}</span>`).join("")}</div>` : ""}
        ${ok ? "" : `<div class="no" style="margin:8px 0 0">ใบอนุญาตนี้${p.start_date && p.start_date > TD() ? `เริ่มวันที่ ${be(p.start_date)}` : "หมดอายุแล้ว"} วันนี้ยังเข้าไม่ได้</div>`}
        ${ws.length ? ws.map(w => { const g = inside.find(x => key(x.worker) === key(w.name)) || open.find(x => key(x.worker) === key(w.name));
          return `<div class="wk"><b>${esc(w.name)}${w.duty ? ` <span class="meta">(${esc(w.duty)})</span>` : ""}</b>${g ? `<span class="in">อยู่ในพื้นที่ · บัตร ${esc(g.badge || "-")} · เข้า ${hm(g.in_at)}${g.permit_id !== p.id ? ` (ใบ ${esc(pOf(g).permit_no || "อื่น")})` : ""}</span>`
            : ok ? `<input data-badge placeholder="เลขบัตรที่แลก" maxlength="40" aria-label="เลขบัตรของ ${esc(w.name)}"><button class="btn primary" type="button" data-in="${esc(w.name)}">เช็คอิน</button>` : ""}</div>`; }).join("")
          : `<div class="no" style="margin:8px 0 0">ใบอนุญาตนี้ยังไม่มีรายชื่อคนงาน ให้ผู้รับเหมาเพิ่มรายชื่อก่อนเข้า</div>`}
      </div>`; }).join("") + (list.length > 40 ? `<p class="meta">แสดง 40 ใบแรก พิมพ์ค้นหาให้แคบลง</p>` : "");
  }
  $("#q").oninput = () => renderIn();
  $("#pl").addEventListener("click", guard(async ev => {
    const b = ev.target.closest("[data-in]"); if (!b) return;
    const row = b.closest(".wk"), badge = row.querySelector("[data-badge]").value.trim(), pid = b.closest("[data-p]").dataset.p;
    if (!badge) { row.querySelector("[data-badge]").focus(); return toast("ใส่เลขบัตรที่แลกให้ก่อน", true); }
    await rpc("wp_gate_checkin", { p_permit: pid, p_worker: b.dataset.in, p_badge: badge });
    toast(`เช็คอิน ${b.dataset.in} · บัตร ${badge} แล้ว`); await load(); renderIn();
  }));
  $("#pl").addEventListener("keydown", ev => { if (ev.key === "Enter" && ev.target.matches("[data-badge]")) ev.target.closest(".wk").querySelector("[data-in]").click(); });

  // QR: the permit's QR is its contractor link (permit.html?t=<token>)
  $("#scan").onclick = async () => {
    if (stream) return stopCam();
    if (!("BarcodeDetector" in window)) return toast("เครื่องนี้สแกนในหน้าเว็บไม่ได้ ใช้แอปกล้องสแกน QR แล้วคัดลอกลิงก์มาวางในช่องค้นหา", true);
    try {
      const det = new BarcodeDetector({ formats: ["qr_code"] }), v = $("#cam");
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      v.srcObject = stream; v.hidden = false; await v.play(); $("#scan").textContent = "ปิดกล้อง";
      const tick = async () => { if (!stream) return; try { const c = await det.detect(v); const t = c.map(x => tokenOf(x.rawValue)).find(Boolean); if (t) { $("#q").value = t; stopCam(); renderIn(); return; } } catch {} requestAnimationFrame(tick); };
      tick();
    } catch (e) { stopCam(); toast("เปิดกล้องไม่ได้: " + errText(e), true); }
  };
  function stopCam() { if (stream) stream.getTracks().forEach(t => t.stop()); stream = null; const v = $("#cam"); v.hidden = true; v.srcObject = null; $("#scan").textContent = "สแกน QR ใบอนุญาต"; }

  // ---------- inside now ----------
  function renderNow() {
    const rows = open.slice().sort((a, b) => (a.work_date < TD()) === (b.work_date < TD()) ? a.in_at.localeCompare(b.in_at) : a.work_date < TD() ? -1 : 1);
    $("#tNow").innerHTML = rows.map(g => { const p = pOf(g), late = g.work_date < TD();
      return `<div class="pc nowc${late ? " late" : ""}"><div><b>${esc(g.worker)}</b> · บัตร <b>${esc(g.badge || "-")}</b>${late ? ` <span class="st late">ค้างข้ามวัน</span>` : ""}
        <div class="meta">${esc(p.company || "")} · ${esc(p.permit_no || "")} · ${esc(p.area || p.title || "")}</div>
        <div class="meta">เข้า ${late ? be(g.work_date) + " " : ""}${hm(g.in_at)} · อยู่มาแล้ว ${since(g.in_at)}</div></div>
        <button class="btn" type="button" data-out="${g.id}" data-w="${esc(g.worker)}" data-b="${esc(g.badge || "")}">เช็คเอาต์ / รับบัตรคืน</button></div>`; }).join("") || `<div class="empty">ไม่มีผู้รับเหมาอยู่ในพื้นที่</div>`;
  }
  $("#tNow").addEventListener("click", guard(async ev => {
    const b = ev.target.closest("[data-out]"); if (!b) return;
    await rpc("wp_gate_out", { p_gate: b.dataset.out });
    toast(`เช็คเอาต์ ${b.dataset.w} · รับบัตร ${b.dataset.b || "-"} คืนแล้ว`); await load(); renderNow();
  }));

  // ---------- history ----------
  function logRows() { const q = key($("#lq").value); return log.filter(g => !q || key([g.worker, g.badge, pOf(g).company, pOf(g).permit_no].join(" ")).includes(q)); }
  function renderLog() {
    const rows = logRows();
    $("#tLog").innerHTML = `<tr><th>ชื่อ</th><th>บัตร</th><th>บริษัท</th><th>ใบอนุญาต</th><th>เข้า</th><th>ออก</th><th>สถานะ</th></tr>` +
      (rows.map(g => { const p = pOf(g); return `<tr><td>${esc(g.worker)}</td><td>${esc(g.badge || "-")}</td><td>${esc(p.company || "")}</td><td>${esc(p.permit_no || "")}</td><td>${hm(g.in_at)}</td><td>${g.out_at ? fmt(g.out_at) : "-"}</td>
        <td><span class="st ${g.out_at ? "out" : g.work_date < TD() ? "late" : ""}">${g.out_at ? "ออกแล้ว" : g.work_date < TD() ? "ค้างข้ามวัน" : "อยู่ในพื้นที่"}</span></td></tr>`; }).join("") || none(7, "ไม่มีการเข้า-ออกในวันที่เลือก"));
  }
  $("#d").onchange = guard(async () => { await load(); renderLog(); });
  $("#lq").oninput = () => renderLog();
  $("#x").onclick = () => {
    const rows = logRows(), d = $("#d").value, co = new Set(rows.map(g => pOf(g).company)), still = rows.filter(g => !g.out_at).length;
    Office.table(`ป้อมรปภ_ผู้รับเหมาเข้าออก_${me.hospitals.code}_${be(d).replace(/\//g, "-")}`, ["ชื่อ", "เลขบัตร", "บริษัท", "เลขใบอนุญาต", "ชื่องาน", "พื้นที่", "เวลาเข้า", "เวลาออก", "สถานะ"],
      rows.map(g => { const p = pOf(g); return [g.worker, g.badge || "", p.company || "", p.permit_no || "", p.title || "", p.area || "", fmt(g.in_at), g.out_at ? fmt(g.out_at) : "", g.out_at ? "ออกแล้ว" : "ยังไม่ออก"]; }),
      { title: "บันทึกผู้รับเหมาเข้า-ออก ป้อม รปภ.", org: me.hospitals.name, period: "วันที่ " + be(d),
        findings: [`เข้าพื้นที่ ${n(rows.length)} ครั้ง จาก ${n(co.size)} บริษัท`, still ? `ยังไม่เช็คเอาต์ ${n(still)} คน ต้องตามบัตรคืน` : "ทุกคนเช็คเอาต์และคืนบัตรแล้ว"] });
  };
})();
