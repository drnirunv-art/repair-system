(() => {
  const { sb, $, esc, fmt, fmtDate, pill, statusLabel, errText, opts, uploadMedia, isVideo, signed } = RS;
  const params = new URLSearchParams(location.search);
  let deptLoc = null, H = null, locs = [], equip = [], S = { max_photos: 6, require_photo: false }, wantLoc = params.get("loc");

  if (/\bLine\//i.test(navigator.userAgent)) $("#lineWarn").hidden = false;

  function tab(name) {
    document.querySelectorAll("nav button").forEach(x => x.setAttribute("aria-selected", x.dataset.tab === name));
    document.querySelectorAll("main>section").forEach(s => s.hidden = s.id !== "tab-" + name);
  }
  document.querySelectorAll("nav button").forEach(b => b.onclick = () => { tab(b.dataset.tab); if (b.dataset.tab === "dept") dept(); });

  async function loadHospitals() {
    const { data, error } = await sb.from("hospitals").select("id,code,name").order("code");
    if (error) return showErr(error);
    const want = RS.hospitalCode();
    opts($("#hospital"), data.map(h => [h.code, h.name]));
    if (want && data.some(h => h.code === want)) $("#hospital").value = want;
    $("#hospital").hidden = data.length < 2 && !!want;
    H = data.find(h => h.code === $("#hospital").value) || null;
    $("#staffLink").href = "staff.html" + (H ? "?h=" + encodeURIComponent(H.code) : "");
    await loadRefs();
  }
  $("#hospital").onchange = () => { const u = new URL(location); u.searchParams.set("h", $("#hospital").value); u.searchParams.delete("loc"); wantLoc = null; history.replaceState(null, "", u); loadHospitals(); };

  async function loadRefs() {
    if (!H) return;
    const [l, t, e, st] = await Promise.all([
      sb.from("locations").select("id,building,floor,department").eq("hospital_id", H.id).order("sort").order("building").order("floor"),
      sb.from("job_types").select("id,name").eq("hospital_id", H.id).order("name"),
      sb.from("equipment").select("id,name,location_id").eq("hospital_id", H.id).order("name"),
      sb.from("hospital_settings").select("max_photos,require_photo").eq("hospital_id", H.id).maybeSingle()]);
    if (l.error || t.error) { $("#rMsg").innerHTML = `<div class="note bad">โหลดรายชื่ออาคาร/ชั้น/แผนกไม่สำเร็จ กด “โหลดข้อมูลตำแหน่งใหม่”</div>`; return; }
    locs = l.data; equip = e.data || []; if (st.data) S = st.data;
    $("#rPhotoLabel").textContent = `รูปภาพ / วิดีโอ (${S.require_photo ? "ต้องแนบอย่างน้อย 1 ไฟล์" : "ไม่บังคับ"} สูงสุด ${S.max_photos} ไฟล์)`;
    $("#rPhoto").required = !!S.require_photo;
    opts($("#rType"), [["", "— ไม่ระบุ —"], ...t.data.map(x => [x.id, x.name])]);
    // department QR: the link carries the location, so the form fills it in
    const pre = wantLoc && locs.find(x => x.id === wantLoc);
    if (pre) {
      cascade(); $("#rBuilding").value = pre.building; cascade(); $("#rFloor").value = pre.floor; cascade(); $("#rDept").value = pre.id;
      $("#locNote").hidden = false; $("#locNote").innerHTML = `ตำแหน่งจาก QR: ${esc(pre.building)} · ${esc(pre.floor)} · ${esc(pre.department)} (เปลี่ยนได้ถ้าไม่ถูก) · <a href="#" id="locSeeJobs">ดูงานซ่อมของแผนกนี้</a>`;
      deptLoc = pre; $("#deptTabBtn").hidden = false;
      $("#dTitle").textContent = `งานซ่อมของ ${pre.department} (${pre.building} · ${pre.floor})`;
      $("#locSeeJobs").onclick = e => { e.preventDefault(); tab("dept"); dept(); };
    }
    cascade();
  }
  function cascade() {
    opts($("#rBuilding"), [...new Set(locs.map(l => l.building))].map(b => [b, b]));
    const fl = locs.filter(l => l.building === $("#rBuilding").value);
    opts($("#rFloor"), [...new Set(fl.map(l => l.floor))].map(f => [f, f]));
    const dp = fl.filter(l => l.floor === $("#rFloor").value);
    opts($("#rDept"), [...dp.map(l => [l.id, l.department]), ["__new", "+ แผนกอื่น (พิมพ์ชื่อเอง)"]]);
    const isNew = $("#rDept").value === "__new";
    $("#rDeptNewWrap").hidden = !isNew; $("#rDeptNew").required = isNew;
    $("#equipList").innerHTML = equip.filter(x => !x.location_id || x.location_id === $("#rDept").value).map(x => `<option value="${esc(x.name)}">`).join("");
  }
  ["#rBuilding", "#rFloor", "#rDept"].forEach(s => $(s).onchange = cascade);
  $("#rReload").onclick = loadRefs;

  $("#fReport").onsubmit = async e => {
    e.preventDefault(); if (!H) return;
    const btn = $("#rSubmit"); btn.disabled = true; btn.textContent = "กำลังส่ง…"; $("#rMsg").innerHTML = "";
    try {
      const files = [...$("#rPhoto").files];
      if (files.length > S.max_photos) throw new Error(`แนบได้สูงสุด ${S.max_photos} ไฟล์`);
      if (S.require_photo && !files.length) throw new Error("โรงพยาบาลนี้ต้องแนบรูปอย่างน้อย 1 รูป");
      const photos = files.length ? await uploadMedia(files, H.code, "report") : [];
      const eq = equip.find(x => x.name === $("#rEquip").value.trim());
      const common = { p_hospital_code: H.code, p_detail: $("#rDetail").value,
        p_reporter_name: $("#rName").value, p_reporter_phone: $("#rPhone").value,
        p_equipment_id: eq ? eq.id : null, p_equipment_text: eq ? null : $("#rEquip").value,
        p_job_type_id: $("#rType").value || null, p_photo_paths: photos };
      const newDept = $("#rDept").value === "__new";
      const where = newDept ? [$("#rBuilding").value, $("#rFloor").value, $("#rDeptNew").value.trim()] : [$("#rBuilding").value, $("#rFloor").value, $("#rDept").selectedOptions[0].text];
      const detail = $("#rDetail").value.trim();
      const { data, error } = newDept
        ? await sb.rpc("submit_job_new_dept", { ...common, p_building: $("#rBuilding").value, p_floor: $("#rFloor").value, p_department: $("#rDeptNew").value })
        : await sb.rpc("submit_job", { ...common, p_location_id: $("#rDept").value });
      if (error) throw error;
      const no = data[0].job_no;
      $("#rMsg").innerHTML = `<div class="note ok">ส่งเรื่องแล้ว เลขใบงาน <b class="mono">${esc(no)}</b> บันทึกใบรับแจ้งด้านล่างไว้ติดตามสถานะ</div>`;
      await receipt(no, where, detail, $("#rName").value.trim());
      $("#rDetail").value = ""; $("#rEquip").value = ""; $("#rPhoto").value = "";
      if (newDept) { const d = $("#rDeptNew").value.trim(); $("#rDeptNew").value = ""; await loadRefs(); const o = [...$("#rDept").options].find(x => x.text === d); if (o) { $("#rDept").value = o.value; cascade(); } }
    } catch (err) { $("#rMsg").innerHTML = `<div class="note bad">ส่งไม่สำเร็จ: ${esc(errText(err))}</div>`; }
    btn.disabled = false; btn.textContent = "ส่งเรื่องแจ้งซ่อม";
  };

  /* ---------- receipt image with QR ---------- */
  const trackUrl = no => `${location.origin}${location.pathname}?h=${encodeURIComponent(H.code)}&q=${encodeURIComponent(no)}`;
  function wrap(ctx, text, max) {
    const out = []; let line = "";
    for (const ch of [...text]) { if (ctx.measureText(line + ch).width > max) { out.push(line); line = ch; } else line += ch; }
    if (line) out.push(line); return out;
  }
  async function receipt(no, where, detail, name) {
    try { await document.fonts.ready; } catch {}
    const W = 720, c = document.createElement("canvas"), ctx = c.getContext("2d"), font = '"IBM Plex Sans Thai", sans-serif';
    ctx.font = `24px ${font}`;
    const lines = wrap(ctx, detail, W - 96).slice(0, 4);
    c.width = W; c.height = 900 + lines.length * 34;
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = "#d9620f"; ctx.fillRect(0, 0, W, 12);
    ctx.fillStyle = "#17212b"; ctx.textAlign = "center";
    ctx.font = `600 26px ${font}`; ctx.fillText(H.name, W / 2, 70);
    ctx.font = `22px ${font}`; ctx.fillStyle = "#5b6876"; ctx.fillText("ใบรับแจ้งซ่อม งานวิศวกรรมอาคาร", W / 2, 106);
    ctx.fillStyle = "#17212b"; ctx.font = `700 48px "IBM Plex Mono", monospace`; ctx.fillText(no, W / 2, 180);
    ctx.font = `22px ${font}`; ctx.fillStyle = "#5b6876";
    ctx.fillText(new Date().toLocaleString("th-TH", { timeZone: "Asia/Bangkok", dateStyle: "medium", timeStyle: "short" }) + " · ผู้แจ้ง " + name, W / 2, 222);
    ctx.textAlign = "left"; ctx.fillStyle = "#17212b"; ctx.font = `600 24px ${font}`;
    ctx.fillText(where.join(" · "), 48, 278);
    ctx.font = `24px ${font}`; lines.forEach((l, i) => ctx.fillText(l, 48, 318 + i * 34));
    const y0 = 340 + lines.length * 34;
    const q = qrcode(0, "M"); q.addData(trackUrl(no)); q.make();
    const n = q.getModuleCount(), cell = Math.floor(420 / (n + 8)), size = cell * (n + 8), x0 = (W - size) / 2;
    ctx.fillStyle = "#fff"; ctx.fillRect(x0, y0, size, size); ctx.fillStyle = "#000";
    for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (q.isDark(r, k)) ctx.fillRect(x0 + (k + 4) * cell, y0 + (r + 4) * cell, cell, cell);
    ctx.textAlign = "center"; ctx.fillStyle = "#5b6876"; ctx.font = `22px ${font}`;
    ctx.fillText("สแกน QR เพื่อดูสถานะงานซ่อม", W / 2, y0 + size + 40);
    ctx.fillText("หรือค้นด้วยเลขใบงาน / เบอร์โทร ในแท็บ ติดตามสถานะ", W / 2, y0 + size + 74);
    const box = $("#receipt"); box.hidden = false; box.innerHTML = "";
    box.appendChild(c);
    const row = document.createElement("div"); row.className = "row";
    row.innerHTML = `<button class="btn primary" type="button" id="rcSave">บันทึกรูปใบรับแจ้ง</button>${navigator.share ? `<button class="btn" type="button" id="rcShare">แชร์</button>` : ""}<button class="btn" type="button" id="rcTrack">ดูสถานะ</button>`;
    box.appendChild(row);
    const blob = await new Promise(r => c.toBlob(r, "image/png"));
    $("#rcSave").onclick = () => { const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `ใบรับแจ้ง-${no}.png` }); document.body.appendChild(a); a.click(); a.remove(); };
    if ($("#rcShare")) $("#rcShare").onclick = async () => {
      const file = new File([blob], `ใบรับแจ้ง-${no}.png`, { type: "image/png" });
      try { await navigator.share(navigator.canShare && navigator.canShare({ files: [file] }) ? { files: [file], title: "ใบรับแจ้งซ่อม " + no } : { title: "ใบรับแจ้งซ่อม " + no, url: trackUrl(no) }); } catch {}
    };
    $("#rcTrack").onclick = () => { $("#tQ").value = no; tab("track"); track(); };
    box.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /* ---------- tracking ---------- */
  async function track() {
    if (!H) return;
    const q = $("#tQ").value.trim();
    if (q.length < 3) { $("#tList").innerHTML = `<div class="empty">พิมพ์อย่างน้อย 3 ตัวอักษร</div>`; return; }
    const { data, error } = await sb.rpc("track_jobs_v2", { p_hospital_code: H.code, p_query: q });
    if (error) { $("#tList").innerHTML = `<div class="note bad">${esc(errText(error))}</div>`; return; }
    const urls = await signed([...new Set(data.flatMap(j => [...(j.photo_paths || []), ...(j.before_photo_paths || []), ...(j.after_photo_paths || [])]))]);
    const thumbs = (label, arr) => arr && arr.length ? `<div class="meta">${label}</div><div class="thumbs">${arr.filter(p => urls[p]).map(p => isVideo(p)
      ? `<video src="${esc(urls[p])}" controls preload="metadata"></video>` : `<a href="${esc(urls[p])}" target="_blank" rel="noopener"><img src="${esc(urls[p])}" alt="${label}" loading="lazy"></a>`).join("")}</div>` : "";
    $("#tList").innerHTML = data.length ? data.map(j => `<article class="job">
      <div><div class="meta"><span class="mono">${esc(j.job_no)}</span><span>${fmt(j.created_at)}</span><span>ผู้แจ้ง ${esc(j.reporter_masked)} ${esc(j.phone_masked)}</span></div>
        <h4>${esc(j.detail)}</h4><div class="meta"><span>${[j.building, j.floor, j.department].map(esc).join(" · ")}</span>${j.technician ? `<span>ช่าง ${esc(j.technician)}</span>` : ""}</div>
        ${j.status === "on_hold" ? `<div class="meta">พักงาน: ${esc(j.hold_category || "")}${j.hold_reason ? " · " + esc(j.hold_reason) : ""} · นัด ${fmtDate(j.hold_until)}</div>` : ""}
        ${j.appointment_at && !j.closed_at ? `<div class="meta">นัดเข้าทำงาน ${fmt(j.appointment_at)}</div>` : ""}
        ${j.summary ? `<div class="meta">สรุปการซ่อม: ${esc(j.summary)}</div>` : ""}
        ${thumbs("รูปที่แจ้ง", j.photo_paths)}${thumbs("ก่อนซ่อม", j.before_photo_paths)}${thumbs("หลังซ่อม", j.after_photo_paths)}
        ${j.rating ? `<div class="meta">คุณให้คะแนน ${"★".repeat(j.rating)}${"☆".repeat(5 - j.rating)} ขอบคุณครับ</div>` : ""}
        ${j.can_rate ? rateForm(j.job_no) : ""}</div>
      <div class="side">${pill(j.status, statusLabel(j))}${j.cleared_at ? `<span class="meta">ซ่อมเสร็จ ${fmt(j.cleared_at)}</span>` : ""}${j.closed_at ? `<span class="meta">ปิด ${fmt(j.closed_at)}</span>` : ""}</div></article>`).join("")
      : `<div class="empty">ไม่พบใบงานที่ตรงกับคำค้น</div>`;
  }
  const rateForm = no => `<form class="rate" data-no="${esc(no)}" style="margin-top:10px"><div class="meta"><b>ประเมินความพึงพอใจ</b></div>
    <div class="stars">${[1, 2, 3, 4, 5].map(n => `<button type="button" data-star="${n}" aria-label="${n} ดาว">★</button>`).join("")}</div>
    <div class="grid" style="margin-top:8px"><label>เบอร์โทรที่ใช้แจ้ง *<input name="phone" required inputmode="tel"></label><label class="span2">ความคิดเห็น<input name="comment" placeholder="ไม่บังคับ"></label></div>
    <div class="row" style="margin-top:8px"><button class="btn primary small">ส่งการประเมิน</button></div><div class="rmsg"></div></form>`;
  document.addEventListener("click", e => {
    const s = e.target.closest("[data-star]"); if (!s) return;
    const f = s.closest("form"); f.dataset.score = s.dataset.star;
    f.querySelectorAll("[data-star]").forEach(b => b.classList.toggle("on", +b.dataset.star <= +s.dataset.star));
  });
  document.addEventListener("submit", async e => {
    const f = e.target.closest("form.rate"); if (!f) return; e.preventDefault();
    if (!f.dataset.score) { f.querySelector(".rmsg").innerHTML = `<div class="note bad">กดเลือกดาว 1 ถึง 5</div>`; return; }
    const { error } = await sb.rpc("rate_job", { p_job_no: f.dataset.no, p_phone: f.phone.value, p_score: +f.dataset.score, p_comment: f.comment.value });
    if (error) { f.querySelector(".rmsg").innerHTML = `<div class="note bad">${esc(errText(error))}</div>`; return; }
    track();
  });
  $("#fTrack").onsubmit = e => { e.preventDefault(); track(); };

  /* ---------- department status (from the department QR) ---------- */
  const OPEN_ST = ["register", "assign", "work_on", "on_hold", "clear"];
  async function dept() {
    if (!H || !deptLoc) return;
    $("#dList").innerHTML = `<div class="empty">กำลังโหลด…</div>`;
    const { data, error } = await sb.rpc("track_location_jobs", { p_hospital_code: H.code, p_location_id: deptLoc.id });
    if (error) { $("#dList").innerHTML = `<div class="note bad">${esc(errText(error))}</div>`; return; }
    const open = data.filter(j => OPEN_ST.includes(j.status));
    const cnt = s => data.filter(j => j.status === s).length;
    $("#dSummary").textContent = `ยังไม่ปิด ${open.length} งาน (รอช่าง ${cnt("register") + cnt("assign")} · กำลังซ่อม ${cnt("work_on")} · พักงาน ${cnt("on_hold")} · ซ่อมเสร็จรอตรวจ ${cnt("clear")}) · ปิดแล้วใน 60 วัน ${cnt("close") + cnt("evaluated")} งาน`;
    const list = $("#dFilter").value === "open" ? open : data;
    $("#dList").innerHTML = list.length ? list.map(j => `<article class="job">
      <div><div class="meta"><span class="mono">${esc(j.job_no)}</span><span>${fmt(j.created_at)}</span><span>ผู้แจ้ง ${esc(j.reporter_masked)}</span></div>
        <h4>${esc(j.detail)}</h4><div class="meta">${j.technician ? `<span>ช่าง ${esc(j.technician)}</span>` : "<span>ยังไม่มีช่างรับงาน</span>"}</div>
        ${j.status === "on_hold" ? `<div class="meta">พักงาน: ${esc(j.hold_category || "")}${j.hold_until ? " · นัด " + fmtDate(j.hold_until) : ""}</div>` : ""}
        ${j.appointment_at && !j.closed_at ? `<div class="meta">นัดเข้าทำงาน ${fmt(j.appointment_at)}</div>` : ""}
        ${j.rating ? `<div class="meta">คะแนน ${"★".repeat(j.rating)}${"☆".repeat(5 - j.rating)}</div>` : ""}
        <div class="row" style="margin-top:6px"><button class="btn small" type="button" data-detail="${esc(j.job_no)}">ดูรายละเอียด${j.can_rate ? " / ให้คะแนน" : ""}</button></div></div>
      <div class="side">${pill(j.status, statusLabel(j))}${j.cleared_at ? `<span class="meta">ซ่อมเสร็จ ${fmt(j.cleared_at)}</span>` : ""}${j.closed_at ? `<span class="meta">ปิด ${fmt(j.closed_at)}</span>` : ""}</div></article>`).join("")
      : `<div class="empty">${$("#dFilter").value === "open" ? "ไม่มีงานค้างของแผนกนี้" : "ยังไม่มีงานในช่วง 60 วัน"}</div>`;
  }
  $("#dFilter").onchange = dept; $("#dRefresh").onclick = dept;
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-detail]"); if (!b) return;
    $("#tQ").value = b.dataset.detail; tab("track"); track();
  });

  function showErr(e) { $("#rMsg").innerHTML = `<div class="note bad">${esc(errText(e))}</div>`; }
  loadHospitals().then(() => {
    if (params.get("q")) { $("#tQ").value = params.get("q"); tab("track"); track(); }
    else if (params.get("view") === "dept" && deptLoc) { tab("dept"); dept(); }
  });
})();
