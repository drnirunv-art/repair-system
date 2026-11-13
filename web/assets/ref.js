// Reference page: internal phone book and area information (hours, need for air-conditioning, impact when cooling is cut).
// Read-only lists with search; rows are loaded per hospital and visible to that hospital's signed-in staff only.
(() => {
  const { sb, $, esc, errText } = RS;
  const KIND = { internal: "เบอร์ต่อภายใน", emergency: "ฉุกเฉิน (Analog)", direct: "Fax / เบอร์ตรง" };
  let me = null, H = null, phones = [], areas = [];
  const fnum = f => { const m = /(\d+)/.exec(f || ""); return m ? +m[1] : 999; };
  const opt = (el, first, list) => { $(el).innerHTML = `<option value="">${first}</option>` + list.map(v => `<option>${esc(v)}</option>`).join(""); };
  const hit = (q, ...v) => !q || v.some(x => (x || "").toLowerCase().includes(q));
  sb.auth.onAuthStateChange((_e, session) => setTimeout(() => boot(session), 0));
  async function boot(session) {
    if (!session) { $("#gate").hidden = false; return; }
    const { data } = await sb.from("profiles").select("id,full_name,role,hospital_id,hospitals(id,code,name)").eq("id", session.user.id).maybeSingle();
    me = data; if (!me || !me.hospital_id) { $("#gate").hidden = false; return; }
    H = me.hospitals; $("#gate").hidden = true; $("#title").textContent = "ข้อมูลพื้นที่และเบอร์ภายใน · " + H.name; $("#who").textContent = me.full_name || session.user.email;
    const [p, a] = await Promise.all([sb.from("phone_book").select("*").eq("hospital_id", H.id).eq("active", true).order("sort").range(0, 1999), sb.from("area_info").select("*").eq("hospital_id", H.id).eq("active", true).order("sort").range(0, 1999)]);
    if (p.error || a.error) { $("#tab-phone").hidden = false; $("#pT").innerHTML = `<tr><td><div class="note bad">${esc(errText(p.error || a.error))}</div></td></tr>`; return; }
    phones = p.data || []; areas = a.data || [];
    opt("#pB", "ทุกอาคาร", [...new Set(phones.map(x => x.building).filter(Boolean))].sort()); opt("#aB", "ทุกอาคาร", [...new Set(areas.map(x => x.building))].sort());
    $("#tabs").hidden = false; show(new URLSearchParams(location.search).get("tab") === "area" ? "area" : "phone");
  }
  document.querySelectorAll("#tabs button").forEach(b => b.onclick = () => show(b.dataset.tab));
  function show(t) { document.querySelectorAll("#tabs button").forEach(b => b.setAttribute("aria-selected", b.dataset.tab === t)); $("#tab-phone").hidden = t !== "phone"; $("#tab-area").hidden = t !== "area"; (t === "phone" ? drawPhone : drawArea)(); }
  const none = (n, what) => `<tr><td colspan="${n}"><div class="empty">${what}</div></td></tr>`;

  const pRows = () => { const q = $("#pQ").value.trim().toLowerCase(), k = $("#pK").value, b = $("#pB").value; return phones.filter(x => (!k || x.kind === k) && (!b || x.building === b) && hit(q, x.unit, x.numbers, x.note, x.building, x.floor)); };
  function drawPhone() {
    const l = pRows(); $("#pN").textContent = phones.length ? `แสดง ${l.length} จาก ${phones.length} รายการ` : "";
    $("#pT").innerHTML = `<tr><th>อาคาร</th><th>ชั้น</th><th>หน่วยงาน</th><th>เบอร์</th><th>ประเภท</th><th>หมายเหตุ</th></tr>` + (l.map(x => `<tr><td data-l="อาคาร">${esc(x.building || "")}</td><td data-l="ชั้น">${esc(x.floor || "")}</td><td><b>${esc(x.unit)}</b></td><td class="nums">${esc(x.numbers)}</td><td data-l="ประเภท">${KIND[x.kind] || ""}</td><td data-l="หมายเหตุ">${esc(x.note || "")}</td></tr>`).join("")
      || none(6, phones.length ? "ไม่พบรายการที่ค้นหา" : "โรงพยาบาลนี้ยังไม่ได้นำเข้าสมุดเบอร์ภายใน"));
  }
  ["#pQ", "#pK", "#pB"].forEach(s => $(s).addEventListener(s === "#pQ" ? "input" : "change", drawPhone));
  $("#pX").onclick = () => Office.table(`เบอร์ภายใน-${H.code}`, ["อาคาร", "ชั้น", "หน่วยงาน", "เบอร์", "ประเภท", "หมายเหตุ"], pRows().map(x => [x.building, x.floor, x.unit, x.numbers, KIND[x.kind], x.note]), { title: "สมุดเบอร์ภายใน", org: H.name });

  const need = v => v === true ? '<span class="need y">จำเป็น</span>' : v === false ? '<span class="need n">ปิดได้</span>' : '<span class="need u">ยังไม่ประเมิน</span>';
  const aRows = () => { const q = $("#aQ").value.trim().toLowerCase(), b = $("#aB").value, n = $("#aN").value, g = $("#aG").value;
    return areas.filter(x => (!b || x.building === b) && (!g || x.work_group === g) && (!n || (n === "y" ? x.ac_required === true : x.ac_required === false)) && hit(q, x.unit, x.division, x.ac_off_area, x.ac_off_risk, x.floor)).sort((x, y) => x.building.localeCompare(y.building) || fnum(x.floor) - fnum(y.floor) || x.sort - y.sort); };
  function drawArea() {
    const l = aRows(), c = f => areas.filter(f).length;
    $("#aK").innerHTML = areas.length ? [["หน่วยงานทั้งหมด", areas.length], ["จำเป็นต้องเปิดแอร์", c(x => x.ac_required === true)], ["ปิดแอร์ได้", c(x => x.ac_required === false)], ["ทำงาน 24 ชั่วโมง", c(x => /24/.test(x.hours || ""))], ["มีมาตรการบรรเทา", c(x => x.ac_mitigation)]].map(([a, b]) => `<div class="kpi"><b>${b}</b><span>${a}</span></div>`).join("") : "";
    $("#aN2").textContent = areas.length ? `แสดง ${l.length} จาก ${areas.length} หน่วยงาน` : "";
    $("#aT").innerHTML = `<tr><th>อาคาร</th><th>ชั้น</th><th>หน่วยงาน</th><th>ฝ่าย</th><th>กลุ่มงาน</th><th>เวลาปฏิบัติงาน</th><th>ระบบปรับอากาศ</th><th>พื้นที่ที่กระทบเมื่อปิดแอร์</th><th>ความเสียหายที่อาจเกิด</th><th>การบรรเทา</th></tr>` + (l.map(x => `<tr><td data-l="อาคาร">${esc(x.building)}</td><td data-l="ชั้น">${esc(x.floor)}</td><td><b>${esc(x.unit)}</b></td><td data-l="ฝ่าย">${esc(x.division || "")}</td><td data-l="กลุ่มงาน">${esc(x.work_group || "")}</td><td data-l="เวลา">${esc(x.hours || "")}</td><td>${need(x.ac_required)}</td><td data-l="พื้นที่กระทบ">${esc(x.ac_off_area || "")}</td><td data-l="ความเสียหาย">${esc(x.ac_off_risk || "")}</td><td data-l="การบรรเทา">${esc(x.ac_mitigation || "")}</td></tr>`).join("")
      || none(10, areas.length ? "ไม่พบรายการที่ค้นหา" : "โรงพยาบาลนี้ยังไม่ได้นำเข้าข้อมูลพื้นที่"));
  }
  ["#aQ", "#aB", "#aN", "#aG"].forEach(s => $(s).addEventListener(s === "#aQ" ? "input" : "change", drawArea));
  $("#aX").onclick = () => { const l = aRows(), y = l.filter(x => x.ac_required === true).length;
    Office.table(`ข้อมูลพื้นที่-${H.code}`, ["อาคาร", "ชั้น", "หน่วยงาน", "ฝ่าย", "กลุ่มงาน", "เวลาปฏิบัติงาน", "ระบบปรับอากาศ", "พื้นที่ที่กระทบเมื่อปิดแอร์", "ความเสียหายที่อาจเกิด", "การบรรเทา"],
      l.map(x => [x.building, x.floor, x.unit, x.division, x.work_group, x.hours, x.ac_required === true ? "จำเป็น" : x.ac_required === false ? "ปิดได้" : "ยังไม่ประเมิน", x.ac_off_area, x.ac_off_risk, x.ac_mitigation]),
      { title: "ข้อมูลพื้นที่และผลกระทบเมื่อปิดแอร์เพื่อลดโหลด Chiller", org: H.name, findings: [`จาก ${l.length} หน่วยงาน มี ${y} หน่วยงานที่จำเป็นต้องเปิดแอร์ และ ${l.filter(x => x.ac_required === false).length} หน่วยงานที่ปิดแอร์ได้`] }); };
})();
