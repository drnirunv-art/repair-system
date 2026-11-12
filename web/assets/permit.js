// Contractor side of a work permit. No login: the page works only with the permit's private link (permit.html?t=<token>).
(() => {
  const { sb, $, esc, fmt, fmtDate, errText } = RS, { ST, DST, HAZ } = WP;
  const token = new URLSearchParams(location.search).get("t") || "";
  let P = null, files = [], nWorkers = 5, busy = false;
  const toast = (m, bad) => { const t = $("#toast"); t.textContent = m; t.hidden = false; t.style.background = bad ? "var(--bad)" : ""; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, bad ? 6000 : 3000); };
  const val = id => ($("#" + id)?.value || "").trim();
  const rpc = async (name, args) => { const { data, error } = await sb.rpc(name, args); if (error) throw error; return data; };

  // photos are shrunk in the browser; documents (PDF / Excel) go as they are. Files land in the permit's own private folder.
  async function upload(list) {
    const out = [];
    for (const f of list) {
      if (f.size > 20 * 1024 * 1024) throw new Error(`ไฟล์ ${f.name} ใหญ่เกิน 20 MB`);
      let blob = f, ext = (f.name.split(".").pop() || "").toLowerCase().replace(/[^a-z0-9]/g, "") || "bin", type = f.type || "application/octet-stream";
      if (f.type.startsWith("image/")) try {
        const img = await createImageBitmap(f), s = Math.min(1, 1600 / Math.max(img.width, img.height));
        const c = Object.assign(document.createElement("canvas"), { width: Math.round(img.width * s), height: Math.round(img.height * s) });
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        blob = await new Promise(r => c.toBlob(r, "image/jpeg", 0.82)); ext = "jpg"; type = "image/jpeg";
      } catch { /* unreadable image (some HEIC): send as-is */ }
      const path = `WP/${token}/${crypto.randomUUID()}.${ext}`;
      const up = await sb.storage.from("docs").upload(path, blob, { contentType: type });
      if (up.error) throw new Error(`ส่งไฟล์ ${f.name} ไม่สำเร็จ (รับเฉพาะ PDF, รูปภาพ, Excel ขนาดไม่เกิน 20 MB)`);
      out.push({ name: f.name, path });
    }
    return out;
  }
  const guard = fn => async ev => {
    if (ev?.type === "submit") ev.preventDefault(); if (busy) return; busy = true; document.body.style.cursor = "progress";
    try { await fn(ev); } catch (e) { toast(errText(e), true); } finally { busy = false; document.body.style.cursor = ""; }
  };

  async function load() {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) return $("#bad").hidden = false;
    const { data, error } = await sb.rpc("wp_get", { p_token: token });
    if (error || !data) return $("#bad").hidden = false;
    P = data; draw();
  }

  function draw() {
    $("#main").hidden = false; $("#no").textContent = P.permit_no;
    $("#info").innerHTML = `<h2 style="margin:0 0 4px">${esc(P.title)}</h2><p class="sub" style="margin:0">${esc(P.hospital)} · ผู้รับเหมา: ${esc(P.company)}</p>
      <p style="margin:10px 0 0">สถานะ: <span class="st ${P.status}">${esc(ST[P.status])}</span></p>${WP.steps(P.status)}`;
    const a = [];
    if (P.status === "returned") a.push(`<div class="note"><b>แผนกวิศวกรรมตีกลับให้แก้ไขคำขอ:</b>\n${esc(P.return_note)}</div>`);
    if (P.status === "fix") a.push(`<div class="note"><b>ผลตรวจรับ: มีรายการที่ต้องแก้ไข</b>\n${esc(P.return_note)}</div>`);
    if (P.status === "submitted") a.push(`<div class="note good">ส่งคำขอแล้ว รอแผนกวิศวกรรมตรวจเอกสาร (Kick off ครั้งที่ 1) ยังเข้าพื้นที่ไม่ได้จนกว่าจะได้รับอนุมัติ</div>`);
    if (P.status === "docs_ok") a.push(`<div class="note good">เอกสารผ่านแล้ว รอวิศวกรรมและ จป. ลงนามอนุมัติ (Kick off ครั้งที่ 2)</div>`);
    if (P.status === "approved") a.push(`<div class="note good">ได้รับอนุมัติเข้าพื้นที่แล้ว ทุกวันก่อนเริ่มงานให้ส่ง “รายงานก่อนเริ่มงาน” ด้านล่าง และแลกบัตรที่ป้อม รปภ.</div>`);
    if (P.status === "finished") a.push(`<div class="note good">แจ้งงานเสร็จแล้ว รอแผนกวิศวกรรมตรวจรับงาน</div>`);
    if (P.status === "accepted") a.push(`<div class="note good">ตรวจรับงานผ่านแล้ว รอส่งมอบเอกสารและปิดงาน</div>`);
    if (P.status === "closed") a.push(`<div class="note good">ปิดงานเรียบร้อย ขอบคุณครับ</div>`);
    if (P.status === "cancelled") a.push(`<div class="note"><b>ใบอนุญาตนี้ถูกยกเลิก</b>${P.return_note ? "\n" + esc(P.return_note) : ""}</div>`);
    $("#alert").innerHTML = a.join("");
    const edit = ["draft", "returned"].includes(P.status), work = ["approved", "working", "fix"].includes(P.status);
    $("#req").hidden = !edit; $("#sum").hidden = edit; $("#day").hidden = !work; $("#fin").hidden = !["working", "fix"].includes(P.status);
    if (edit) drawReq(); else drawSum();
    if (work) drawDay();
    if (!$("#fin").hidden) drawFin();
    drawHist();
  }

  // 1) entry request -------------------------------------------------------------------------------------------------
  const workerRows = list => Array.from({ length: nWorkers }, (_, i) => `<tr><td>${i + 1}</td><td><input class="wn" maxlength="120" value="${esc(list[i]?.name || "")}" aria-label="ชื่อผู้ปฏิบัติงานคนที่ ${i + 1}"></td>
    <td><input class="wd" maxlength="120" value="${esc(list[i]?.duty || "")}" aria-label="หน้าที่"></td></tr>`).join("");
  const readWorkers = () => [...document.querySelectorAll("#wk tbody tr")].map(tr => ({ name: tr.querySelector(".wn").value.trim(), duty: tr.querySelector(".wd").value.trim() }));
  const drawFiles = () => $("#fl").innerHTML = files.length ? files.map((f, i) => `<li><span>${esc(f.name)}</span><button class="btn small" type="button" data-rm="${i}">ลบ</button></li>`).join("") : `<li><span class="sub" style="margin:0">ยังไม่มีไฟล์แนบ</span></li>`;
  function drawReq() {
    files = [...(P.files || [])]; nWorkers = Math.max(5, (P.workers || []).length + 1);
    $("#req").innerHTML = `<h3 style="margin-top:0">1. หนังสือขออนุญาตเข้าพื้นที่ปฏิบัติงาน</h3>
      <div class="hd"><label>ผู้ควบคุมงาน (ชื่อ–สกุล) *<input id="contact_name" maxlength="120" value="${esc(P.contact_name)}"></label><label>เบอร์โทร *<input id="contact_phone" maxlength="40" inputmode="tel" value="${esc(P.contact_phone)}"></label>
        <label>อีเมล<input id="contact_email" type="email" maxlength="120" value="${esc(P.contact_email)}"></label><label class="wide">พื้นที่ปฏิบัติงาน (อาคาร / ชั้น / ห้อง) *<input id="area" maxlength="300" value="${esc(P.area)}"></label>
        <label>วันเริ่มงาน *<input id="start_date" type="date" value="${esc(P.start_date)}"></label><label>วันสิ้นสุดงาน *<input id="end_date" type="date" value="${esc(P.end_date)}"></label>
        <label>ช่วงเวลาทำงาน<input id="work_hours" maxlength="80" placeholder="เช่น 08:00–17:00" value="${esc(P.work_hours)}"></label></div>
      <h3>2. ลักษณะงานที่มีความเสี่ยง</h3><p class="sub" style="margin:0 0 8px">เลือกทุกข้อที่เกี่ยวข้อง เพื่อให้ จป. เตรียมมาตรการความปลอดภัย</p>
      <div class="pick">${HAZ.map(([k, l]) => `<label><input type="checkbox" name="hz" value="${k}" ${(P.hazards || []).includes(k) ? "checked" : ""}> ${esc(l)}</label>`).join("")}</div>
      <div class="hd"><label class="wide">มาตรการป้องกัน / อุปกรณ์ความปลอดภัย (PPE) ที่จะใช้<textarea id="hazard_note" rows="2" maxlength="1000">${esc(P.hazard_note)}</textarea></label></div>
      <h3>3. แผนดำเนินการ (Schedule) และเครื่องมือ</h3>
      <div class="hd"><label class="wide">แผนดำเนินการ: ทำอะไร วันไหน *<textarea id="schedule" rows="4" maxlength="4000" placeholder="วันที่ 1: รื้อฝ้าเดิม&#10;วันที่ 2–3: เดินท่อ ...">${esc(P.schedule)}</textarea></label>
        <label class="wide">เครื่องมือ / อุปกรณ์ที่นำเข้า<textarea id="tools" rows="2" maxlength="2000">${esc(P.tools)}</textarea></label></div>
      <h3>4. รายชื่อผู้ปฏิบัติงาน *</h3>
      <table class="wk" id="wk"><thead><tr><th></th><th>ชื่อ–สกุล</th><th>หน้าที่</th></tr></thead><tbody>${workerRows(P.workers || [])}</tbody></table>
      <p><button class="btn small" type="button" id="wAdd">+ เพิ่มแถว</button></p>
      <h3>5. เอกสารแนบ</h3><p class="sub" style="margin:0 0 6px">เช่น สำเนาบัตรประชาชนผู้ปฏิบัติงาน ใบรับรองการอบรม แบบ/Shop drawing ใบเสนอราคา (PDF รูปภาพ หรือ Excel ไฟล์ละไม่เกิน 20 MB)</p>
      <input type="file" id="fAdd" multiple accept=".pdf,image/*,.xlsx,.xls,.csv" aria-label="เลือกไฟล์แนบ"><ul class="flist" id="fl"></ul>
      <div class="act"><button class="btn" type="button" id="save">บันทึกร่างไว้ก่อน</button><button class="btn primary" type="submit" id="send">ส่งคำขอให้แผนกวิศวกรรม</button></div>`;
    drawFiles();
  }
  const collect = () => ({ contact_name: val("contact_name"), contact_phone: val("contact_phone"), contact_email: val("contact_email"), area: val("area"), start_date: val("start_date"), end_date: val("end_date"),
    work_hours: val("work_hours"), hazards: [...document.querySelectorAll("input[name=hz]:checked")].map(x => x.value), hazard_note: val("hazard_note"), schedule: val("schedule"), tools: val("tools"), workers: readWorkers(), files });
  $("#req").addEventListener("click", guard(async ev => {
    const t = ev.target;
    if (t.id === "wAdd") { const w = readWorkers(); nWorkers += 3; $("#wk tbody").innerHTML = workerRows(w); }
    else if (t.dataset.rm) { files.splice(+t.dataset.rm, 1); drawFiles(); }
    else if (t.id === "save") { await rpc("wp_submit", { p_token: token, p: collect(), p_send: false }); toast("บันทึกร่างแล้ว ยังไม่ได้ส่ง"); }
  }));
  $("#req").addEventListener("change", guard(async ev => {
    if (ev.target.id !== "fAdd" || !ev.target.files.length) return;
    toast("กำลังส่งไฟล์…"); files.push(...await upload([...ev.target.files])); ev.target.value = ""; drawFiles(); toast("แนบไฟล์แล้ว");
  }));
  $("#req").addEventListener("submit", guard(async () => {
    if (!confirm("ส่งคำขอให้แผนกวิศวกรรมตรวจ? หลังส่งแล้วจะแก้ไขไม่ได้จนกว่าจะถูกตีกลับ")) return;
    await rpc("wp_submit", { p_token: token, p: collect(), p_send: true }); toast("ส่งคำขอแล้ว"); await load(); scrollTo(0, 0);
  }));

  function drawSum() {
    const hz = (P.hazards || []).map(k => (HAZ.find(h => h[0] === k) || [k, k])[1]);
    $("#sum").innerHTML = `<h3 style="margin-top:0">รายละเอียดคำขอ</h3><dl class="kv">
      <dt>ผู้ควบคุมงาน</dt><dd>${esc(P.contact_name || "-")} ${esc(P.contact_phone || "")}</dd><dt>พื้นที่ปฏิบัติงาน</dt><dd>${esc(P.area || "-")}</dd>
      <dt>ช่วงวันทำงาน</dt><dd>${fmtDate(P.start_date)} ถึง ${fmtDate(P.end_date)} ${esc(P.work_hours || "")}</dd><dt>งานที่มีความเสี่ยง</dt><dd>${esc(hz.join("\n") || "-")}</dd>
      <dt>มาตรการป้องกัน</dt><dd>${esc(P.hazard_note || "-")}</dd><dt>แผนดำเนินการ</dt><dd>${esc(P.schedule || "-")}</dd><dt>เครื่องมือ</dt><dd>${esc(P.tools || "-")}</dd>
      <dt>ผู้ปฏิบัติงาน (${(P.workers || []).length} คน)</dt><dd>${esc((P.workers || []).map((w, i) => `${i + 1}. ${w.name}${w.duty ? " (" + w.duty + ")" : ""}`).join("\n") || "-")}</dd>
      <dt>เอกสารแนบ</dt><dd>${esc((P.files || []).map(f => f.name).join("\n") || "-")}</dd></dl>`;
  }

  // 2) every working day: morning report, then end-of-day update -------------------------------------------------------
  function drawDay() {
    const d = (P.daily || []).find(x => x.work_date === WP.today()), checked = d && ["ok", "done"].includes(d.status);
    let h = `<h3 style="margin-top:0">งานวันนี้ (${fmtDate(WP.today())}) ${d ? `<span class="st ${d.status}">${esc(DST[d.status])}</span>` : ""}</h3>`;
    if (d?.status === "fix") h += `<div class="note" style="margin:0 0 10px"><b>วิศวกรรมให้แก้ไขก่อนเริ่มงาน:</b>\n${esc(d.check_note)}</div>`;
    if (!checked) h += `<p class="sub" style="margin:0">ส่งทุกเช้าก่อนเริ่มงาน แล้วรอวิศวกรรมตรวจ (จำนวนคน เครื่องมือ เอกสาร) จึงเริ่มงานได้</p>
      <div class="hd"><label>จำนวนคนวันนี้ *<input id="m_head" type="number" min="1" max="500" inputmode="numeric" value="${esc(d?.headcount ?? "")}"></label>
        <label class="wide">แผนงานวันนี้ *<textarea id="m_plan" rows="3" maxlength="2000">${esc(d?.plan)}</textarea></label>
        <label class="wide">เครื่องมือ / อุปกรณ์ที่ใช้วันนี้<textarea id="m_tools" rows="2" maxlength="2000">${esc(d?.tools)}</textarea></label>
        <label class="wide">รูปก่อนเริ่มงาน / รูปพื้นที่ ${d?.photos_before?.length ? `(แนบไว้แล้ว ${d.photos_before.length} รูป เลือกใหม่เพื่อแทนที่)` : ""}<input id="m_ph" type="file" accept="image/*" multiple></label></div>
      <button class="btn primary" type="button" id="m_send">${d ? "ส่งรายงานก่อนเริ่มงานอีกครั้ง" : "ส่งรายงานก่อนเริ่มงาน"}</button>`;
    else h += `<dl class="kv"><dt>จำนวนคน</dt><dd>${esc(d.headcount)} คน</dd><dt>แผนงานวันนี้</dt><dd>${esc(d.plan)}</dd><dt>ตรวจโดย</dt><dd>${esc(d.checked_name || "-")} · ${fmt(d.checked_at)}</dd></dl>
      <h3>สรุปสิ้นวัน (Daily Update)</h3><p class="sub" style="margin:0">ส่งก่อนออกจากพื้นที่ทุกวัน พร้อมคืนบัตรที่ป้อม รปภ.</p>
      <div class="hd"><label class="wide">ผลงานที่ทำได้วันนี้ *<textarea id="e_prog" rows="3" maxlength="2000">${esc(d.progress)}</textarea></label>
        <label class="wide">แผนงานวันถัดไป<textarea id="e_next" rows="2" maxlength="2000">${esc(d.next_plan)}</textarea></label>
        <label class="wide">รูปหลังทำงาน / ความสะอาดพื้นที่ ${d.photos_after?.length ? `(แนบไว้แล้ว ${d.photos_after.length} รูป เลือกใหม่เพื่อแทนที่)` : ""}<input id="e_ph" type="file" accept="image/*" multiple></label></div>
      <button class="btn primary" type="button" id="e_send">${d.status === "done" ? "ส่งสรุปสิ้นวันอีกครั้ง" : "ส่งสรุปสิ้นวัน"}</button>`;
    $("#day").innerHTML = h;
  }
  $("#day").addEventListener("click", guard(async ev => {
    const d = (P.daily || []).find(x => x.work_date === WP.today());
    if (ev.target.id === "m_send") {
      const f = [...$("#m_ph").files]; if (f.length) toast("กำลังส่งรูป…");
      await rpc("wp_daily_send", { p_token: token, p: { headcount: val("m_head") || 0, plan: val("m_plan"), tools: val("m_tools"), photos: f.length ? await upload(f) : d?.photos_before || [] } });
      toast("ส่งรายงานก่อนเริ่มงานแล้ว รอวิศวกรรมตรวจ"); await load();
    } else if (ev.target.id === "e_send") {
      const f = [...$("#e_ph").files]; if (f.length) toast("กำลังส่งรูป…");
      await rpc("wp_daily_done", { p_token: token, p: { progress: val("e_prog"), next_plan: val("e_next"), photos: f.length ? await upload(f) : d?.photos_after || [] } });
      toast("ส่งสรุปสิ้นวันแล้ว"); await load();
    }
  }));

  // 3) whole job finished -------------------------------------------------------------------------------------------
  function drawFin() {
    $("#fin").innerHTML = `<h3 style="margin-top:0">${P.status === "fix" ? "แก้ไขงานเสร็จแล้ว" : "งานเสร็จทั้งหมดแล้ว"}</h3><p class="sub" style="margin:0">กดเมื่องานตามสัญญา / ใบเสนอราคาเสร็จครบ เพื่อให้แผนกวิศวกรรมเข้าตรวจรับ</p>
      <div class="act"><label>หมายเหตุถึงผู้ตรวจรับ<input id="f_note" maxlength="2000"></label><button class="btn" type="button" id="f_send">แจ้งงานเสร็จ ขอให้ตรวจรับ</button></div>`;
  }
  $("#fin").addEventListener("click", guard(async ev => {
    if (ev.target.id !== "f_send" || !confirm("แจ้งว่างานเสร็จและขอให้ตรวจรับ?")) return;
    await rpc("wp_finish", { p_token: token, p_note: val("f_note") }); toast("แจ้งงานเสร็จแล้ว"); await load(); scrollTo(0, 0);
  }));

  function drawHist() {
    const list = (P.daily || []).filter(x => x.work_date !== WP.today() || !["approved", "working", "fix"].includes(P.status));
    $("#hist").hidden = !list.length;
    $("#hist").innerHTML = `<h3 style="margin-top:0">ประวัติรายวัน</h3>` + list.map(d => `<div class="dayc"><h4>${fmtDate(d.work_date)} <span class="st ${d.status}">${esc(DST[d.status])}</span></h4>
      <dl class="kv"><dt>จำนวนคน / แผนงาน</dt><dd>${esc(d.headcount)} คน · ${esc(d.plan)}</dd>${d.progress ? `<dt>ผลงาน</dt><dd>${esc(d.progress)}</dd>` : ""}${d.next_plan ? `<dt>แผนวันถัดไป</dt><dd>${esc(d.next_plan)}</dd>` : ""}</dl></div>`).join("");
  }
  load();
})();
