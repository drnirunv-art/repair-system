// Work permit, hospital side: open a permit, hand the contractor its private link, check documents, sign, check each day's
// report, log badges at the security desk, inspect and close.
(() => {
  const { sb, $, esc, fmt, fmtDate, errText, opts } = RS, { ST, DST, HAZ } = WP;
  const MANAGER = ["owner", "admin", "chief_engineer", "supervisor"];
  const TODO = ["submitted", "docs_ok", "finished", "accepted"]; // waiting on the hospital
  let me = null, H = null, rows = [], daily = [], gate = [], cur = null, urls = {}, busy = false;
  const toast = (m, bad) => { const t = $("#toast"); t.textContent = m; t.hidden = false; t.style.background = bad ? "var(--bad)" : ""; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, bad ? 6000 : 3000); };
  const val = id => ($("#" + id)?.value || "").trim();
  const isMgr = () => MANAGER.includes(me.role);
  const rpc = async (name, args) => { const { data, error } = await sb.rpc(name, args); if (error) throw error; return data; };
  const guard = fn => async ev => { if (busy) return; busy = true; try { await fn(ev); } catch (e) { toast(errText(e), true); } finally { busy = false; } };
  const link = p => { const u = new URL("permit.html", location.href); u.search = "?t=" + p.token; u.hash = ""; return u.toString(); };
  const qr = text => { const q = qrcode(0, "M"); q.addData(text); q.make(); return q.createDataURL(4, 2); };

  sb.auth.onAuthStateChange((_e, session) => setTimeout(() => boot(session), 0));
  async function boot(session) {
    if (!session) { $("#gate").hidden = false; $("#list").hidden = true; return; }
    if (me) return;
    const { data } = await sb.from("profiles").select("id,full_name,role,hospital_id,hospitals(id,code,name)").eq("id", session.user.id).maybeSingle();
    if (!data || !data.hospital_id || data.role === "observer") { $("#gate").hidden = false; return; }
    me = data; H = me.hospitals; $("#gate").hidden = true; $("#who").textContent = `${me.full_name || ""} · ${H.name}`;
    $("#newBox").hidden = !isMgr();
    opts($("#fStatus"), [["open", "ที่ยังไม่ปิด"], ["todo", "รอโรงพยาบาลดำเนินการ"], ["", "ทั้งหมด"], ...Object.entries(ST)], false);
    await reload();
    const want = new URLSearchParams(location.search).get("p"); if (want && rows.some(r => r.id === want)) open(want);
  }
  async function reload() {
    const { data, error } = await sb.from("wp_permits").select("*").eq("hospital_id", H.id).order("created_at", { ascending: false }).limit(500);
    if (error) return toast(errText(error), true);
    rows = data || [];
    const open = rows.filter(r => ["approved", "working", "fix"].includes(r.status)).map(r => r.id);
    const d = open.length ? await sb.from("wp_daily").select("id,permit_id,work_date,status").in("permit_id", open).eq("status", "sent") : { data: [] };
    const wait = new Set((d.data || []).map(x => x.permit_id)); rows.forEach(r => r._wait = wait.has(r.id));
    if (cur) return open_(cur.id);
    drawList();
  }
  function drawList() {
    $("#list").hidden = false; $("#detail").hidden = true; cur = null;
    const f = $("#fStatus").value, q = val("fQ").toLowerCase();
    const list = rows.filter(r => (f === "open" ? !["closed", "cancelled"].includes(r.status) : f === "todo" ? TODO.includes(r.status) || r._wait : !f || r.status === f)
      && (!q || [r.permit_no, r.title, r.company, r.area].join(" ").toLowerCase().includes(q)));
    $("#tList").innerHTML = `<thead><tr><th>เลขที่</th><th>งาน / ผู้รับเหมา</th><th>พื้นที่</th><th>ช่วงวัน</th><th>สถานะ</th><th></th></tr></thead><tbody>` + (list.map(r => `<tr>
      <td class="mono">${esc(r.permit_no)}</td><td><b>${esc(r.title)}</b><br><small>${esc(r.company)}</small></td><td>${esc(r.area || "-")}</td>
      <td>${r.start_date ? fmtDate(r.start_date) + " – " + fmtDate(r.end_date) : "-"}</td>
      <td><span class="st ${r.status}">${esc(ST[r.status])}</span>${r._wait ? ` <span class="st sent">มีรายงานเช้ารอตรวจ</span>` : ""}</td>
      <td><button class="btn small" type="button" data-open="${r.id}">เปิด</button></td></tr>`).join("") || `<tr><td colspan="6" class="sub">ไม่มีรายการ</td></tr>`) + "</tbody>";
  }
  $("#fStatus").onchange = drawList; $("#fQ").oninput = drawList; $("#fReload").onclick = guard(reload);
  $("#tList").onclick = ev => { const id = ev.target.dataset.open; if (id) open(id); };
  $("#nAdd").onclick = guard(async () => {
    const id = await rpc("wp_open", { p_title: val("nTitle"), p_company: val("nCompany"), p_contact: val("nContact"), p_phone: val("nPhone"), p_email: val("nEmail"), p_area: val("nArea") });
    ["nTitle", "nCompany", "nContact", "nPhone", "nEmail", "nArea"].forEach(i => $("#" + i).value = ""); $("#newBox").open = false;
    toast("เปิดใบแล้ว คัดลอกลิงก์ส่งให้ผู้รับเหมาได้เลย"); await reload(); await open_(id);
  });

  const open = id => guard(() => open_(id))();
  async function open_(id) {
    cur = rows.find(r => r.id === id); if (!cur) return drawList();
    const [d, g] = await Promise.all([sb.from("wp_daily").select("*").eq("permit_id", id).order("work_date", { ascending: false }), sb.from("wp_gate").select("*").eq("permit_id", id).order("in_at", { ascending: false }).limit(300)]);
    daily = d.data || []; gate = g.data || [];
    const paths = [...(cur.files || []), ...daily.flatMap(x => [...(x.photos_before || []), ...(x.photos_after || [])])].map(f => f.path);
    urls = paths.length ? Object.fromEntries(((await sb.storage.from("docs").createSignedUrls(paths, 3600)).data || []).filter(x => x.signedUrl).map(x => [x.path, x.signedUrl])) : {};
    drawDetail();
  }
  const sign = (k, label, hint) => { const s = (cur.signs || {})[k]; return `<div><b>${label}</b>${s ? `${esc(s.name)}<small>${fmt(s.at)}</small>` : `<small>${hint || "ยังไม่ลงนาม"}</small>`}</div>`; };
  const pics = list => (list || []).length ? `<div class="ph">${list.map(f => urls[f.path] ? `<a href="${esc(urls[f.path])}" target="_blank" rel="noopener"><img src="${esc(urls[f.path])}" alt="${esc(f.name)}" loading="lazy"></a>` : "").join("")}</div>` : "";
  function drawDetail() {
    const p = cur, s = p.status, m = isMgr(), u = link(p), hz = (p.hazards || []).map(k => (HAZ.find(h => h[0] === k) || [k, k])[1]);
    $("#list").hidden = true; $("#detail").hidden = false;
    $("#workers").innerHTML = (p.workers || []).map(w => `<option value="${esc(w.name)}">`).join("");
    let a = ""; // what the hospital must do now
    if (s === "draft" || s === "returned") a = `<p class="sub" style="margin:0">รอผู้รับเหมากรอกคำขอผ่านลิงก์ด้านล่าง${s === "returned" ? " (ตีกลับแล้ว: " + esc(p.return_note) + ")" : ""}</p>`;
    if (s === "submitted" && m) a = `<p style="margin:0"><b>ตรวจเอกสาร (Kick off ครั้งที่ 1)</b> ตรวจหนังสือขอเข้าพื้นที่ แผนงาน รายชื่อ และเอกสารแนบด้านล่าง</p>
      <div class="act"><button class="btn primary" type="button" data-step="docs_ok">เอกสารครบ ผ่าน</button><label>เหตุผลที่ตีกลับ<input id="aNote" maxlength="500"></label><button class="btn" type="button" data-step="return" data-need="1">ตีกลับให้แก้ไข</button></div>`;
    if (s === "docs_ok") a = `<p style="margin:0"><b>ลงนามอนุมัติ (Kick off ครั้งที่ 2)</b> อนุมัติเมื่อวิศวกรรมและ จป. ลงนามครบ · รปภ. ลงชื่อรับทราบได้</p><div class="signs">
      <div><b>แผนกวิศวกรรม</b>${p.signs?.eng ? esc(p.signs.eng.name) + `<small>${fmt(p.signs.eng.at)}</small>` : m ? `<button class="btn small primary" type="button" data-step="eng">ลงนามอนุมัติ</button>` : "<small>รอผู้จัดการ</small>"}</div>
      <div><b>จป. (Safety Officer)</b>${p.signs?.safety ? esc(p.signs.safety.name) + `<small>${fmt(p.signs.safety.at)}</small>` : m || me.role === "safety_officer" ? `<button class="btn small primary" type="button" data-step="safety">ลงนามอนุมัติ</button>` : "<small>รอ จป.</small>"}</div>
      <div><b>รปภ. รับทราบ</b>${p.signs?.security ? esc(p.signs.security.name) + `<small>${fmt(p.signs.security.at)}</small>` : `<input id="secName" placeholder="พิมพ์ชื่อ รปภ." maxlength="120" aria-label="ชื่อ รปภ."><button class="btn small" type="button" data-step="security" data-from="secName">บันทึกรับทราบ</button>`}</div></div>
      ${m ? `<div class="act"><label>เหตุผลที่ตีกลับ<input id="aNote" maxlength="500"></label><button class="btn" type="button" data-step="return" data-need="1">ตีกลับให้แก้ไข</button></div>` : ""}`;
    if (s === "finished" && m) a = `<p style="margin:0"><b>ตรวจรับงาน</b> ผู้รับเหมาแจ้งงานเสร็จ${p.finish_note ? ": " + esc(p.finish_note) : ""} · ตรวจเทียบ TOR / ใบเสนอราคา</p>
      <div class="act"><button class="btn primary" type="button" data-step="inspect_ok">ตรวจรับผ่าน</button><label>รายการที่ต้องแก้ไข<input id="aNote" maxlength="1000"></label><button class="btn" type="button" data-step="inspect_fix" data-need="1">ให้แก้ไขงาน</button></div>`;
    if (s === "accepted" && m) a = `<p style="margin:0"><b>ส่งมอบและปิดงาน</b> รับรายงานส่งมอบงานจากผู้รับเหมาแล้วจึงปิด</p>
      <div class="act"><label>หมายเหตุการส่งมอบ (ไม่บังคับ)<input id="aNote" maxlength="1000"></label><button class="btn primary" type="button" data-step="close">รับมอบและปิดงาน</button></div>`;
    if (s === "fix") a = `<p class="sub" style="margin:0">รอผู้รับเหมาแก้ไขงาน: ${esc(p.return_note)}</p>`;
    const td = WP.today(), gToday = gate.filter(g => g.work_date === td), canGate = ["approved", "working", "finished", "fix"].includes(s);
    $("#detail").innerHTML = `<p class="noprint"><button class="btn small" type="button" id="back">← กลับรายการ</button> <button class="btn small" type="button" id="print">พิมพ์ใบอนุญาต</button>
        ${m && !["closed", "cancelled"].includes(s) ? `<button class="btn small" type="button" data-step="cancel" style="float:right">ยกเลิกใบนี้</button>` : ""}</p>
      <div class="panel"><p class="mono" style="margin:0">${esc(p.permit_no)} · ${esc(H.name)}</p><h2 style="margin:2px 0">${esc(p.title)}</h2><p class="sub" style="margin:0">ผู้รับเหมา: ${esc(p.company)}</p>
        <p style="margin:10px 0 0">สถานะ: <span class="st ${s}">${esc(ST[s])}</span></p>${WP.steps(s)}</div>
      ${a ? `<div class="panel noprint" style="margin-top:14px;border-color:var(--accent)">${a}</div>` : ""}
      ${["closed", "cancelled"].includes(s) ? "" : `<div class="panel noprint" style="margin-top:14px"><h3 style="margin-top:0">ลิงก์สำหรับผู้รับเหมา</h3><div class="linkbox"><div><p class="sub" style="margin:0 0 6px">ส่งลิงก์นี้ (หรือให้สแกน QR) ให้ผู้ควบคุมงานของผู้รับเหมาเท่านั้น ผู้รับเหมาไม่ต้องสมัครบัญชี ใครมีลิงก์นี้จะกรอกและส่งรายงานของงานนี้ได้</p>
        <p class="mono" id="url">${esc(u)}</p><button class="btn small" type="button" id="copy">คัดลอกลิงก์</button></div><img src="${qr(u)}" alt="QR ลิงก์ผู้รับเหมา"></div></div>`}
      <div class="panel" style="margin-top:14px"><h3 style="margin-top:0">รายละเอียดคำขอ</h3><dl class="kv">
        <dt>ผู้ควบคุมงาน</dt><dd>${esc(p.contact_name || "-")} ${esc(p.contact_phone || "")} ${esc(p.contact_email || "")}</dd><dt>พื้นที่ปฏิบัติงาน</dt><dd>${esc(p.area || "-")}</dd>
        <dt>ช่วงวันทำงาน</dt><dd>${p.start_date ? fmtDate(p.start_date) + " ถึง " + fmtDate(p.end_date) : "-"} ${esc(p.work_hours || "")}</dd><dt>งานที่มีความเสี่ยง</dt><dd>${esc(hz.join("\n") || "-")}</dd>
        <dt>มาตรการป้องกัน</dt><dd>${esc(p.hazard_note || "-")}</dd><dt>แผนดำเนินการ</dt><dd>${esc(p.schedule || "-")}</dd><dt>เครื่องมือ</dt><dd>${esc(p.tools || "-")}</dd>
        <dt>ผู้ปฏิบัติงาน (${(p.workers || []).length} คน)</dt><dd>${esc((p.workers || []).map((w, i) => `${i + 1}. ${w.name}${w.duty ? " (" + w.duty + ")" : ""}`).join("\n") || "-")}</dd>
        <dt>เอกสารแนบ</dt><dd>${(p.files || []).map(f => urls[f.path] ? `<a href="${esc(urls[f.path])}" target="_blank" rel="noopener">${esc(f.name)}</a>` : esc(f.name)).join("\n") || "-"}</dd></dl>
        <div class="signs">${sign("docs", "ตรวจเอกสาร (Kick off 1)")}${sign("eng", "วิศวกรรมอนุมัติ")}${sign("safety", "จป. อนุมัติ")}${sign("security", "รปภ. รับทราบ")}${sign("inspect", "ตรวจรับงาน")}${sign("handover", "รับมอบ / ปิดงาน")}</div>
        ${p.handover_note ? `<p>หมายเหตุการส่งมอบ: ${esc(p.handover_note)}</p>` : ""}</div>
      ${canGate || gate.length ? `<div class="panel" style="margin-top:14px"><h3 style="margin-top:0">ป้อม รปภ.: แลกบัตรเข้า–ออก วันนี้</h3>
        ${canGate ? `<div class="act noprint"><label>ชื่อผู้เข้าพื้นที่<input id="gName" list="workers" maxlength="120"></label><label>เลขบัตรผู้รับเหมา<input id="gBadge" maxlength="40"></label><button class="btn primary" type="button" id="gIn">บันทึกเข้า</button></div>` : ""}
        <div class="scroll"><table><thead><tr><th>วันที่</th><th>ชื่อ</th><th>บัตร</th><th>เข้า</th><th>ออก</th></tr></thead><tbody>${[...gToday, ...gate.filter(g => g.work_date !== td)].map(g => `<tr><td>${fmtDate(g.work_date)}</td><td>${esc(g.worker)}</td><td class="mono">${esc(g.badge || "-")}</td><td>${fmt(g.in_at)}</td>
          <td>${g.out_at ? fmt(g.out_at) : `<button class="btn small noprint" type="button" data-out="${g.id}">คืนบัตร / ออก</button>`}</td></tr>`).join("") || `<tr><td colspan="5" class="sub">ยังไม่มีรายการ</td></tr>`}</tbody></table></div></div>` : ""}
      ${daily.length ? `<div class="panel" style="margin-top:14px"><h3 style="margin-top:0">รายงานประจำวันของผู้รับเหมา</h3>${daily.map(d => `<div class="dayc"><h4>${fmtDate(d.work_date)} <span class="st ${d.status}">${esc(DST[d.status])}</span></h4>
        <dl class="kv"><dt>จำนวนคน</dt><dd>${esc(d.headcount)} คน</dd><dt>แผนงาน</dt><dd>${esc(d.plan)}</dd>${d.tools ? `<dt>เครื่องมือ</dt><dd>${esc(d.tools)}</dd>` : ""}
          ${d.checked_name ? `<dt>ผู้ตรวจ</dt><dd>${esc(d.checked_name)} · ${fmt(d.checked_at)}${d.check_note ? " · " + esc(d.check_note) : ""}</dd>` : ""}
          ${d.progress ? `<dt>ผลงานสิ้นวัน</dt><dd>${esc(d.progress)}</dd>` : ""}${d.next_plan ? `<dt>แผนวันถัดไป</dt><dd>${esc(d.next_plan)}</dd>` : ""}</dl>
        ${pics(d.photos_before)}${pics(d.photos_after)}
        ${["sent", "fix"].includes(d.status) ? `<div class="act noprint"><button class="btn primary" type="button" data-chk="${d.id}" data-ok="1">ตรวจผ่าน ให้เริ่มงาน</button><label>สิ่งที่ต้องแก้ไข<input id="c_${d.id}" maxlength="500"></label><button class="btn" type="button" data-chk="${d.id}">ให้แก้ไขก่อน</button></div>` : ""}</div>`).join("")}</div>` : ""}`;
    scrollTo(0, 0);
  }
  $("#detail").addEventListener("click", guard(async ev => {
    const t = ev.target, d = t.dataset;
    if (t.id === "back") { cur = null; return drawList(); }
    if (t.id === "print") { document.body.classList.add("wpprint"); window.print(); return document.body.classList.remove("wpprint"); }
    if (t.id === "copy") { try { await navigator.clipboard.writeText(link(cur)); toast("คัดลอกลิงก์แล้ว"); } catch { toast("คัดลอกไม่ได้ ให้กดค้างที่ลิงก์แล้วเลือกคัดลอก", true); } return; }
    if (d.step) {
      const note = val(d.from || "aNote");
      if (d.need && !note) return toast("กรอกเหตุผลในช่องข้างปุ่มก่อน", true);
      if (d.step === "cancel" && !confirm("ยกเลิก Work Permit ใบนี้? ลิงก์ของผู้รับเหมาจะใช้ส่งงานต่อไม่ได้")) return;
      const st = await rpc("wp_step", { p_id: cur.id, p_step: d.step, p_note: ["docs_ok", "eng", "safety", "inspect_ok", "cancel"].includes(d.step) ? null : note || null });
      toast("บันทึกแล้ว: " + ST[st]); return reload();
    }
    if (d.chk) {
      const note = val("c_" + d.chk); if (!d.ok && !note) return toast("กรอกสิ่งที่ต้องแก้ไขก่อน", true);
      await rpc("wp_daily_check", { p_daily: d.chk, p_ok: !!d.ok, p_note: d.ok ? null : note }); toast(d.ok ? "ตรวจผ่าน ผู้รับเหมาเริ่มงานได้" : "แจ้งให้แก้ไขแล้ว"); return reload();
    }
    if (t.id === "gIn") { await rpc("wp_gate_in", { p_permit: cur.id, p_worker: val("gName"), p_badge: val("gBadge") }); toast("บันทึกเข้าแล้ว"); return reload(); }
    if (d.out) { await rpc("wp_gate_out", { p_gate: d.out }); toast("บันทึกออกแล้ว"); return reload(); }
  }));
})();
