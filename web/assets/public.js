(() => {
  const { sb, $, esc, fmt, pill, errText, opts } = RS;
  let H = null, locs = [], equip = [];

  document.querySelectorAll("nav button").forEach(b => b.onclick = () => {
    document.querySelectorAll("nav button").forEach(x => x.setAttribute("aria-selected", x === b));
    document.querySelectorAll("main>section").forEach(s => s.hidden = s.id !== "tab-" + b.dataset.tab);
  });

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
  $("#hospital").onchange = () => { const u = new URL(location); u.searchParams.set("h", $("#hospital").value); history.replaceState(null, "", u); loadHospitals(); };

  async function loadRefs() {
    if (!H) return;
    const [l, t, e] = await Promise.all([
      sb.from("locations").select("id,building,floor,department").eq("hospital_id", H.id).order("sort").order("building").order("floor"),
      sb.from("job_types").select("id,name").eq("hospital_id", H.id).order("name"),
      sb.from("equipment").select("id,name,location_id").eq("hospital_id", H.id).order("name")]);
    if (l.error || t.error) { $("#rMsg").innerHTML = `<div class="note bad">โหลดรายชื่ออาคาร/ชั้น/แผนกไม่สำเร็จ กด “โหลดข้อมูลตำแหน่งใหม่”</div>`; return; }
    locs = l.data; equip = e.data || [];
    opts($("#rType"), [["", "— ไม่ระบุ —"], ...t.data.map(x => [x.id, x.name])]);
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

  async function resizePhoto(file) {
    const img = await createImageBitmap(file); const s = Math.min(1, 1600 / Math.max(img.width, img.height));
    const c = Object.assign(document.createElement("canvas"), { width: Math.round(img.width * s), height: Math.round(img.height * s) });
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return new Promise(r => c.toBlob(r, "image/jpeg", 0.82));
  }

  $("#fReport").onsubmit = async e => {
    e.preventDefault(); if (!H) return;
    const btn = $("#rSubmit"); btn.disabled = true; $("#rMsg").innerHTML = "";
    try {
      let photos = [];
      const f = $("#rPhoto").files[0];
      if (f) {
        const path = `${H.code}/${new Date().toISOString().slice(0,10)}/${crypto.randomUUID()}.jpg`;
        const up = await sb.storage.from("job-photos").upload(path, await resizePhoto(f), { contentType: "image/jpeg" });
        if (up.error) throw up.error; photos = [path];
      }
      const eq = equip.find(x => x.name === $("#rEquip").value.trim());
      const common = { p_hospital_code: H.code, p_detail: $("#rDetail").value,
        p_reporter_name: $("#rName").value, p_reporter_phone: $("#rPhone").value,
        p_equipment_id: eq ? eq.id : null, p_equipment_text: eq ? null : $("#rEquip").value,
        p_job_type_id: $("#rType").value || null, p_photo_paths: photos };
      const newDept = $("#rDept").value === "__new";
      const { data, error } = newDept
        ? await sb.rpc("submit_job_new_dept", { ...common, p_building: $("#rBuilding").value, p_floor: $("#rFloor").value, p_department: $("#rDeptNew").value })
        : await sb.rpc("submit_job", { ...common, p_location_id: $("#rDept").value });
      if (error) throw error;
      const no = data[0].job_no;
      $("#rMsg").innerHTML = `<div class="note ok">ส่งเรื่องแล้ว เลขใบงาน <b class="mono">${esc(no)}</b> เก็บเลขนี้ไว้ติดตามสถานะ</div>`;
      $("#rDetail").value = ""; $("#rEquip").value = ""; $("#rPhoto").value = "";
      if (newDept) { const d = $("#rDeptNew").value.trim(); $("#rDeptNew").value = ""; await loadRefs(); const o = [...$("#rDept").options].find(x => x.text === d); if (o) { $("#rDept").value = o.value; cascade(); } }
    } catch (err) { $("#rMsg").innerHTML = `<div class="note bad">ส่งไม่สำเร็จ: ${esc(errText(err))}</div>`; }
    btn.disabled = false;
  };

  $("#fTrack").onsubmit = async e => {
    e.preventDefault(); if (!H) return;
    const q = $("#tQ").value.trim();
    if (q.length < 3) { $("#tList").innerHTML = `<div class="empty">พิมพ์อย่างน้อย 3 ตัวอักษร</div>`; return; }
    const { data, error } = await sb.rpc("track_jobs", { p_hospital_code: H.code, p_query: q });
    if (error) { $("#tList").innerHTML = `<div class="note bad">${esc(errText(error))}</div>`; return; }
    $("#tList").innerHTML = data.length ? data.map(j => `<article class="job">
      <div><div class="meta"><span class="mono">${esc(j.job_no)}</span><span>${fmt(j.created_at)}</span></div>
        <h4>${esc(j.detail)}</h4><div class="meta"><span>${[j.building, j.floor, j.department].map(esc).join(" · ")}</span>${j.technician ? `<span>ช่าง ${esc(j.technician)}</span>` : ""}</div>
        ${j.status === "on_hold" ? `<div class="meta">พักงาน: ${esc(j.hold_reason)} · นัด ${esc(j.hold_until)}</div>` : ""}</div>
      <div class="side">${pill(j.status)}${j.closed_at ? `<span class="meta">ปิด ${fmt(j.closed_at)}</span>` : ""}</div></article>`).join("")
      : `<div class="empty">ไม่พบใบงานที่ตรงกับคำค้น</div>`;
  };

  function showErr(e) { $("#rMsg").innerHTML = `<div class="note bad">${esc(errText(e))}</div>`; }
  loadHospitals();
})();
