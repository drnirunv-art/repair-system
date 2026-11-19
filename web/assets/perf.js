// ประชุม Bi-Weekly Performance (Chief Engineer Weekly Submission Template, 13 sections): the Chief of each hospital sends
// by Saturday 10:00, QC checks 10:00-12:00, meeting with GM 14:00-16:00. Data period = the 14 days ending Friday 23:59 before the meeting.
// Saved in perf_weekly (data = sections, backlog = uploaded open-job list, ai = Action plan by AI 3 roles with RCA fishbone 4M + 5 Why).
// "ดึงตัวเลขจากระบบ RS" fills only empty cells, from jobs, kpi_monthly, kpi_auto, qc_daily and energy_monthly.
(() => {
  const { sb, $, esc, errText } = RS;
  const MGR = ["owner", "admin", "chief_engineer", "supervisor"];
  const DAYS = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"];
  const AGE = [["≤ 1 วัน (24 ชม.)", 0, 1], ["> 1–7 วัน", 1, 7], ["> 7–30 วัน", 7, 30], ["> 30–60 วัน", 30, 60], ["> 60 วัน (Backlog วิกฤต)", 60, 1e9]];
  const GRP = [["tw", "TW แก้เอง"], ["con", "รอผู้รับเหมา"], ["parts", "รออะไหล่"], ["appr", "รออนุมัติ/พื้นที่"]];
  const M4 = [["man", "คน (Man)"], ["machine", "เครื่องจักร (Machine)"], ["method", "วิธีการ (Method)"], ["material", "วัสดุ/อะไหล่ (Material)"]];
  let me = null, exec = false, hosps = [], canWrite = false, cur = "rep", busy = false, row = null, D = {}, BL = { rows: [] }, AI = {};
  const toast = (m, bad) => { const t = $("#toast"); t.textContent = m; t.hidden = false; t.style.background = bad ? "var(--bad)" : ""; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, bad ? 6000 : 3000); };
  const guard = fn => async ev => { if (ev && ev.preventDefault) ev.preventDefault(); if (busy) return; busy = true; try { await fn(ev); } catch (e) { toast(errText(e), true); } finally { busy = false; } };
  const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
  const hosp = () => hosps.find(h => h.id === $("#h").value) || {};
  const dAdd = (iso, n) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const dow = iso => new Date(iso + "T00:00:00Z").getUTCDay();
  const thd = (iso, o = { day: "numeric", month: "short", year: "numeric" }) => iso ? new Date(iso + "T00:00:00").toLocaleDateString("th-TH", o) : "-";
  const nf = (v, d = 0) => v == null || v === "" || !isFinite(v) ? "" : (+v).toLocaleString("th-TH", { maximumFractionDigits: d });
  const meet = () => $("#md").value;
  const period = () => [dAdd(meet(), -14), dAdd(meet(), -1)];          // Saturday two weeks before .. Friday before the meeting
  const dueAt = () => new Date(meet() + "T10:00:00+07:00");
  const bkk = iso => new Date(iso + "T00:00:00+07:00").toISOString();

  // ---------- the 13 sections of the template; fixed rows keep their first-column labels ----------
  const SEC = [
    { k: "sum", t: "1. Executive Summary & TOR Scorecard", cols: ["ตัวชี้วัดสำคัญ", "เป้าหมาย / เกณฑ์", "ผลรอบก่อน", "ผลรอบนี้ (Actual)", "ปัญหา / Action ด่วน"],
      fixed: [["คะแนน TOR รวม (100 คะแนน)", "≥ 90 คะแนน"], ["CM ดำเนินการภายใน 24 ชม. (%)", "100%"], ["งานค้างตั้งต้นทั้งหมด (ใบ)", "0 ภายในสิ้น ธ.ค."], ["งานค้าง > 60 วัน (ใบ)", "0 ภายในสิ้น ธ.ค."], ["PM ทำเองตรงแผน (%)", "≥ 95%"], ["MA ติดตามสัญญา (%)", "100%"]] },
    { k: "tor", t: "2. TOR Scorecard 8 หมวด (ป้องกันคะแนนตก)", cols: ["หมวด TOR ตามสัญญา", "คะแนนเต็ม", "ลงนามล่าสุด", "Forecast เดือนนี้", "ข้อเสี่ยงถูกหักคะแนนสูงสุด", "รหัส Action"],
      fixed: [["1. PM (บำรุงรักษาเชิงป้องกัน)", "20"], ["2. คุณภาพงาน (Quality)", "20"], ["3. CM (งานแจ้งซ่อมและค้าง)", "10"], ["4. รายงานประจำเดือน (Report)", "9"], ["5. ESG", "2"], ["6. การซ้อม Code", "2"], ["7. การฝึกอบรม (Training)", "2"], ["8. CEG / KPI Engineering", "35"], ["รวมคะแนนทั้งสิ้น", "100"]] },
    { k: "cm", t: "3. CM Daily Performance & Workload", cols: ["วัน", "คนจริง/สัญญา", "ชม. CM", "ค้างต้นวัน", "รับใหม่", "เปิดซ้ำ", "ปิดจริง", "ค้างปลายวัน"], days: true },
    { k: "k24", t: "4. KPI ดำเนินการ CM ภายใน 24 ชั่วโมง", sub: "A = งานครบกำหนด 24 ชม. ในวันนั้น · B = งานใน A ที่ปิดซ่อมเสร็จจริงภายใน 24 ชม. · C = งานใน A ที่ส่ง PR / ขออนุมัติครบถึง Owner ภายใน 24 ชม. · ผ่าน = (B+C) ÷ A × 100 เป้าหมาย 100% ทุกวัน",
      cols: ["วัน", "A ครบกำหนด", "B ปิดจริงทัน", "C ส่ง PR/ขออนุมัติทัน", "% ผ่าน", "หมายเหตุ"], days: true, calc: true },
    { k: "aging", t: "5. Backlog Aging & Root Cause Analysis", sub: "ระบบเติมจากไฟล์ Backlog ที่อัปโหลดในแท็บ Backlog · Action plan AI", cols: ["ช่วงอายุงานค้าง", ...GRP.map(g => g[1]), "รวมทั้งหมด", "ความเสี่ยงสำคัญ"],
      fixed: [...AGE.map(a => [a[0]]), ["รวมงานค้างทั้งหมด"]] },
    { k: "bap", t: "6. Backlog Action Plan (เร่งรัดงานค้าง)", cols: ["รหัส Ticket / รายการซ่อม", "อายุ (วัน)", "สาเหตุที่ค้าง", "เลขที่ PR / วันที่ส่ง", "Owner ผู้รับเรื่อง", "กำหนดเสร็จจริง", "เรื่องขอ GM ช่วย"], n: 3 },
    { k: "pm", t: "7. PM ทำเอง (Preventive Maintenance)", cols: ["ระบบงานวิศวกรรม", "แผนงวดนี้", "เสร็จจริง", "% ตรงแผน", "ค้างยกมา/ปิดแล้ว", "ค้างปลายงวด"],
      fixed: [["HVAC (ปรับอากาศ)"], ["Electrical (ไฟฟ้า)"], ["Sanitary (สุขาภิบาล)"], ["Fire Protection (ระบบอัคคีภัย)"], ["Elevator/Building (ลิฟต์/อาคาร)"], ["รวมทุกระบบ PM"]] },
    { k: "ma", t: "8. MA Tracking (ติดตามสัญญาผู้รับเหมา)", cols: ["ผู้รับเหมา / ระบบ MA", "สัญญาต้องตาม", "รอบบริการต้องตาม", "% ติดตามครบ", "ทำจริงตรงเวลา", "เหตุผล / แผนแก้"], n: 2 },
    { k: "en", t: "9. Energy & Water Management", cols: ["ตัวชี้วัดพลังงานและน้ำ", "หน่วยนับ", "งวดก่อน", "งวดนี้", "เป้าหมาย", "แนวทางแก้ไข / หมายเหตุ"],
      fixed: [["การใช้ไฟฟ้าอาคารรวม", "kWh"], ["ค่าไฟฟ้าสะสม MTD", "บาท"], ["การใช้น้ำประปารวม", "m³"], ["ค่าน้ำประปาสะสม MTD", "บาท"], ["ไฟฟ้าต่อพื้นที่ปรับอากาศ", "kWh/m²/day"], ["น้ำประปาต่อเตียงวัน", "m³/Bed"]] },
    { k: "enap", t: "10. Energy Action Plan (มาตรการประหยัด)", cols: ["มาตรการประหยัดพลังงาน/น้ำ", "ระบบ", "งบลงทุน", "ผลประหยัดต่อปี", "ผู้รับผิดชอบ/วันเสร็จ", "สถานะผลจริง"], n: 2 },
    { k: "qc", t: "11. QC, Quality & Risk Management", cols: ["หัวข้อการตรวจสอบ (QC / TOR)", "เป้าหมาย TOR", "ผลรอบนี้", "ข้อบกพร่องที่พบ", "แผนแก้ไข / วันเสร็จ"],
      fixed: [["QC Coverage ตรวจงานซ่อม", "≥ 80% ต่อวัน (สัญญาข้อ 3.20)"], ["Response Time ตาม SLA", "≥ 95%"], ["Occurrence Report", "≤ 5 ครั้ง/ด."], ["ซ้อม Code และอบรม", "100% ตามแผน"], ["รายงานประจำเดือน (Meter)", "ตรงเวลาทุกรายการ"]] },
    { k: "dec", t: "12. Decision Request (ขอ GM ตัดสินใจ)", sub: "ทุกปัญหาต้องมีทางเลือกและข้อเสนอของ Chief เสมอ", cols: ["ประเด็นปัญหาที่ขอ GM ตัดสินใจ", "ผลกระทบถ้าไม่ตัดสินใจ", "ทางเลือก / ข้อเสนอ Chief", "ผู้มีอำนาจ", "ต้องการภายใน", "มติที่ประชุม"], n: 2 },
    { k: "next", t: "13. Next Commitment (คำมั่นรอบหน้า)", cols: ["Action ID / สิ่งที่จะสำเร็จ", "ผลเป้าหมาย", "Owner", "วันเสร็จ", "หลักฐานตรวจรับ", "เชื่อมแผน GM"], n: 3 },
  ];
  const dayRows = () => { const [a] = period(); return [...Array(14)].map((_, i) => { const d = dAdd(a, i); return `${DAYS[dow(d)]} ${thd(d, { day: "numeric", month: "short" })}`; }); };
  function blank(s) {
    if (s.fixed) return s.fixed.map(f => s.cols.map((_, i) => f[i] || ""));
    if (s.days) return [...dayRows().map(l => s.cols.map((_, i) => i ? "" : l)), s.cols.map((_, i) => i ? "" : "รวม / เฉลี่ย")];
    return [...Array(s.n || 2)].map((_, r) => s.cols.map((_, i) => s.k === "next" && !i ? `ACT-${String(r + 1).padStart(2, "0")} / ` : ""));
  }
  const tbl = k => { if (!D.t) D.t = {}; const s = SEC.find(x => x.k === k); if (!D.t[k] || (s.days && D.t[k].length !== 15)) D.t[k] = blank(s); return D.t[k]; };
  const lockedCell = (s, r, c) => (s.fixed && (c === 0 || (c === 1 && s.fixed[r] && s.fixed[r][1] != null))) || (s.days && c === 0) || (s.calc && c === 4);

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
    $("#h").value = hosps.some(h => h.id === me.hospital_id) ? me.hospital_id : hosps[0].id; $("#h").disabled = hosps.length < 2;
    // Saturdays: the coming one (or today) and the 12 before it
    let s = today(); while (dow(s) !== 6) s = dAdd(s, 1);
    $("#md").innerHTML = [...Array(13)].map((_, i) => { const d = dAdd(s, -7 * i); return `<option value="${d}">${thd(d, { weekday: "short", day: "numeric", month: "short", year: "numeric" })}</option>`; }).join("");
    $("#tAll").hidden = !exec; $("#body").hidden = false; $("#tabs").hidden = false;
    $("#h").onchange = guard(async () => { await load(); show(cur); }); $("#md").onchange = $("#h").onchange;
    await load(); show(new URLSearchParams(location.search).get("tab") || "rep");
  }
  document.querySelectorAll("#tabs button").forEach(b => b.onclick = () => show(b.dataset.tab));
  function show(t) {
    cur = t === "all" && exec ? "all" : t === "bl" ? "bl" : "rep";
    document.querySelectorAll("#tabs button").forEach(b => b.setAttribute("aria-selected", b.dataset.tab === cur));
    ["rep", "bl", "all"].forEach(k => $("#tab-" + k).hidden = k !== cur);
    ({ rep: drawRep, bl: drawBl, all: () => drawAll().catch(e => toast(errText(e), true)) })[cur]();
  }
  async function load() {
    const h = $("#h").value;
    canWrite = exec || (MGR.includes(me.role) && hosps.some(x => x.id === h));
    $("#ro").textContent = canWrite ? "" : "ดูได้อย่างเดียว (บันทึกได้เฉพาะหัวหน้าของโรงนี้)";
    ["#fill", "#save", "#send", "#blSys"].forEach(k => $(k).hidden = !canWrite); $("#blFile").disabled = !canWrite;
    const r = await sb.from("perf_weekly").select("*").eq("hospital_id", h).eq("meet_date", meet()).maybeSingle(); if (r.error) throw r.error;
    row = r.data; D = JSON.parse(JSON.stringify((row && row.data) || {})); BL = (row && row.backlog && row.backlog.rows) ? row.backlog : { rows: [] }; AI = (row && row.ai) || {};
    if (!D.site) D.site = { hospital: hosp().name, chief: canWrite ? me.full_name || "" : "", qc: "" };
    const [a, b] = period(); $("#per").textContent = `· รอบนี้ ${thd(a, { day: "numeric", month: "short" })} – ${thd(b)}`;
    status();
  }
  function status() {
    const s = row && row.submitted_at ? (new Date(row.submitted_at) <= dueAt() ? ["ok", "ส่งแล้ว ตรงเวลา"] : ["late", "ส่งแล้ว เลยเวลา"]) : row ? ["draft", "ร่าง ยังไม่ส่ง"] : ["none", "ยังไม่มีรายงาน"];
    $("#stat").innerHTML = `<span class="st ${s[0]}">${s[1]}</span>` + (row && row.submitted_at ? ` <span class="sub">${new Date(row.submitted_at).toLocaleString("th-TH", { timeZone: "Asia/Bangkok", dateStyle: "medium", timeStyle: "short" })}</span>` : "");
  }

  // ---------- report: 13 editable tables ----------
  function k24calc() { const T = tbl("k24"); let A = 0, B = 0, C = 0;
    T.slice(0, 14).forEach(r => { const a = +r[1], b = +r[2] || 0, c = +r[3] || 0; r[4] = r[1] !== "" && a > 0 ? Math.round((b + c) * 1000 / a) / 10 + "%" : ""; if (a > 0) { A += a; B += b; C += c; } });
    const L = T[14]; L[1] = A || ""; L[2] = A ? B : ""; L[3] = A ? C : ""; L[4] = A ? Math.round((B + C) * 1000 / A) / 10 + "%" : ""; }
  function drawRep() {
    k24calc();
    const si = D.site, ro = canWrite ? "" : " readonly";
    let h = `<div class="sec"><h2>ข้อมูลไซต์และผู้รายงาน</h2><div class="site">
      <label>โรงพยาบาล<input value="${esc(hosp().name || "")}" readonly></label>
      <label>ผู้รายงาน (Chief Engineer)<input data-site="chief" value="${esc(si.chief || "")}"${ro}></label>
      <label>กลุ่ม QC ผู้ตรวจสอบ<input data-site="qc" value="${esc(si.qc || "")}" placeholder="QC กลุ่ม 1 / 2 / 3"${ro}></label>
      <label>ประชุมวันที่<input value="${esc(thd(meet()))} 14:00–16:00 น." readonly></label></div></div>`;
    SEC.forEach(s => { const T = tbl(s.k);
      h += `<div class="sec"><h2>${esc(s.t)}</h2>${s.sub ? `<p class="sub">${esc(s.sub)}</p>` : ""}<div class="tw"><table class="pt"><thead><tr>${s.cols.map(c => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>` +
        T.map((r, ri) => `<tr${(s.fixed && ri === T.length - 1 && /รวม/.test(r[0])) || (s.days && ri === 14) ? ' class="sum"' : ""}>${r.map((v, ci) => lockedCell(s, ri, ci) || (s.days && ri === 14 && s.calc) ? `<td class="${ci ? "num" : "lab"}">${esc(v)}</td>`
          : `<td>${ci === s.cols.length - 1 || /ปัญหา|ความเสี่ยง|แผน|เหตุผล|ทางเลือก|ผลกระทบ|ประเด็น|มาตรการ|ข้อเสี่ยง|สิ่งที่จะ|หลักฐาน|สาเหตุ|ข้อบกพร่อง/.test(s.cols[ci]) ? `<textarea data-k="${s.k}" data-r="${ri}" data-c="${ci}"${ro}>${esc(v)}</textarea>` : `<input data-k="${s.k}" data-r="${ri}" data-c="${ci}" value="${esc(v)}"${ro}>`}</td>`).join("")}</tr>`).join("") +
        `</tbody></table></div>${canWrite && !s.fixed && !s.days ? `<div class="acts"><button class="btn small" type="button" data-add="${s.k}">+ เพิ่มแถว</button></div>` : ""}${s.k === "pm" ? pmBox() : ""}</div>`; });
    $("#secs").innerHTML = h;
    if ($("#pmFile")) $("#pmFile").onchange = guard(pmUpload);
    $("#secs").querySelectorAll("[data-k]").forEach(i => i.oninput = () => { tbl(i.dataset.k)[+i.dataset.r][+i.dataset.c] = i.value; if (i.dataset.k === "k24") { k24calc(); const T = tbl("k24");
      $("#secs").querySelectorAll('td.num').forEach(() => {}); const s = SEC.find(x => x.k === "k24"), body = i.closest("tbody"); [...body.rows].forEach((tr, ri) => { tr.cells[4].textContent = T[ri][4]; if (ri === 14) [1, 2, 3].forEach(c => tr.cells[c].textContent = T[ri][c]); }); void s; } });
    $("#secs").querySelectorAll("[data-site]").forEach(i => i.oninput = () => D.site[i.dataset.site] = i.value);
    $("#secs").querySelectorAll("[data-add]").forEach(b => b.onclick = () => { const s = SEC.find(x => x.k === b.dataset.add), T = tbl(s.k); T.push(s.cols.map((_, i) => s.k === "next" && !i ? `ACT-${String(T.length + 1).padStart(2, "0")} / ` : "")); drawRep(); });
  }
  const setIf = (k, r, c, v) => { const T = tbl(k); if (v == null || v === "" || (typeof v === "number" && !isFinite(v))) return 0; if (String(T[r][c]).trim() === "" || (k === "k24" && c === 4)) { T[r][c] = String(v); return 1; } return 0; };

  // ---------- fill from the system (only empty cells) ----------
  $("#fill").onclick = guard(async () => {
    const H = hosp(), [a, b] = period(), s0 = bkk(a), e0 = bkk(dAdd(b, 1)); let n = 0;
    // jobs of the hospital touching the period
    const J = await sb.from("jobs").select("id,created_at,cleared_at,status").eq("hospital_id", H.id).lt("created_at", e0).neq("status", "cancel").or(`cleared_at.is.null,cleared_at.gte.${s0}`).limit(5000);
    if (J.error) throw J.error;
    const jobs = J.data || [], ids = jobs.map(j => j.id);
    let docs = [];
    if (ids.length) { const [pr, mm] = await Promise.all([sb.from("purchase_requests").select("job_id,created_at").in("job_id", ids.slice(0, 900)), sb.from("memos").select("job_id,created_at").in("job_id", ids.slice(0, 900))]); docs = [...(pr.data || []), ...(mm.data || [])]; }
    const doc = j => docs.filter(d => d.job_id === j.id).map(d => d.created_at).sort()[0];
    let tR = 0, tC = 0;
    for (let i = 0; i < 14; i++) {
      const ds = bkk(dAdd(a, i)), de = bkk(dAdd(a, i + 1));
      const open = t => jobs.filter(j => j.created_at < t && (!j.cleared_at || j.cleared_at >= t)).length;
      const recv = jobs.filter(j => j.created_at >= ds && j.created_at < de), clo = jobs.filter(j => j.cleared_at && j.cleared_at >= ds && j.cleared_at < de);
      tR += recv.length; tC += clo.length;
      n += setIf("cm", i, 3, open(ds)) + setIf("cm", i, 4, recv.length) + setIf("cm", i, 6, clo.length) + setIf("cm", i, 7, open(de));
      // 24 h: jobs reported the day before fall due on this day
      const ps = bkk(dAdd(a, i - 1)), A = jobs.filter(j => j.created_at >= ps && j.created_at < ds), lim = j => new Date(new Date(j.created_at).getTime() + 864e5).toISOString();
      const B = A.filter(j => j.cleared_at && j.cleared_at <= lim(j)), C = A.filter(j => !(j.cleared_at && j.cleared_at <= lim(j)) && doc(j) && doc(j) <= lim(j));
      if (A.length) n += setIf("k24", i, 1, A.length) + setIf("k24", i, 2, B.length) + setIf("k24", i, 3, C.length);
    }
    n += setIf("cm", 14, 4, tR) + setIf("cm", 14, 6, tC);
    // TOR: last saved month (ลงนามล่าสุด) and this month's system figures
    const m0 = meet().slice(0, 8) + "01", lm = dAdd(m0, -1).slice(0, 8) + "01";
    const K = await sb.from("kpi_monthly").select("item,score,max_score,month").eq("hospital_id", H.id).in("month", [lm, m0]);
    const cat = it => ["5", "6", "7"].includes(it[0]) ? +it[0] - 1 + 1 : +it[0];
    [lm].forEach(m => { const L = (K.data || []).filter(x => x.month === m); if (!L.length) return; let tot = 0;
      for (let c = 1; c <= 8; c++) { const s = L.filter(x => cat(x.item) === c).reduce((t, x) => t + (+x.score || 0), 0); tot += s; n += setIf("tor", c - 1, 2, Math.round(s * 10) / 10); }
      n += setIf("tor", 8, 2, Math.round(tot * 10) / 10); n += setIf("sum", 0, 2, Math.round(tot * 10) / 10); });
    const y = +meet().slice(0, 4), mo = +meet().slice(5, 7), au = await sb.rpc("kpi_auto", { p_hospital: H.id, p_year: y, p_month: mo }), A = au.data || {};
    if (A.pm_planned) { n += setIf("pm", 5, 1, A.pm_planned) + setIf("pm", 5, 2, A.pm_done) + setIf("pm", 5, 3, Math.round(A.pm_done * 1000 / A.pm_planned) / 10 + "%"); n += setIf("sum", 4, 3, Math.round(A.pm_done * 1000 / A.pm_planned) / 10 + "%"); }
    if (A.resp_n) n += setIf("qc", 1, 2, Math.round(A.resp_ok * 1000 / A.resp_n) / 10 + "% (" + A.resp_ok + "/" + A.resp_n + ")");
    const q = await sb.rpc("qc_daily", { p_hospital: H.id, p_from: a, p_to: b });
    if (!q.error && q.data && q.data.length) { const f = q.data.reduce((t, x) => t + (x.finished || 0), 0), c = q.data.reduce((t, x) => t + (x.checked || 0), 0); if (f) n += setIf("qc", 0, 2, Math.round(c * 1000 / f) / 10 + "% (" + c + "/" + f + " ใบ)"); }
    k24calc(); const k = tbl("k24")[14]; if (k[4]) n += setIf("sum", 1, 3, k[4]);
    // energy: the two latest monthly bills
    const E = await sb.from("energy_monthly").select("month,elec_kwh,elec_cost,water_m3,water_cost").eq("hospital_id", H.id).lte("month", m0).order("month", { ascending: false }).limit(2);
    const e = E.data || []; if (e[0]) { n += setIf("en", 0, 3, nf(e[0].elec_kwh)) + setIf("en", 1, 3, nf(e[0].elec_cost)) + setIf("en", 2, 3, nf(e[0].water_m3)) + setIf("en", 3, 3, nf(e[0].water_cost)); }
    if (e[1]) { n += setIf("en", 0, 2, nf(e[1].elec_kwh)) + setIf("en", 1, 2, nf(e[1].elec_cost)) + setIf("en", 2, 2, nf(e[1].water_m3)) + setIf("en", 3, 2, nf(e[1].water_cost)); }
    if (e[0]) { const lab = `บิล ${thd(e[0].month, { month: "short", year: "numeric" })}${e[1] ? " เทียบ " + thd(e[1].month, { month: "short", year: "numeric" }) : ""} (หน้า Energy)`; n += setIf("en", 0, 5, lab); }
    n += fillFromBacklog();
    drawRep(); toast(n ? `เติมตัวเลขจากระบบ ${n} ช่อง (ช่องที่กรอกไว้แล้วไม่ถูกแก้) ตรวจทานก่อนส่ง` : "ไม่มีตัวเลขใหม่จากระบบสำหรับรอบนี้");
  });

  // ---------- Weekly PM report (Excel the Chief fills each week) -> section 7 ----------
  // Each week block: a range "14/10/69-20/10/69" with Plan/Actual per building, then per building a daily table
  // (equipment columns ... ยอดรวม, ไม่พร้อมใช้, พร้อมใช้, หมายเหตุ), an optional defect list (วัน/เดือน/ปี | ชำรุด)
  // and a summary row (Actual, เสีย, ยกเลิกใช้งาน, พร้อมใช้งาน, พร้อมใช้งาน%). Years are Thai (69 = 2569).
  const SYS = [[/AHU|FCU|chiller|แอร์|ปรับอากาศ|cooling|CT\b|VRF|split|พัดลม/i, 0], [/FHC|fire|jockey|ดับเพลิง|sprinkler|smoke|FA\b|alarm|หัวฉีด|ถังดับ/i, 3],
    [/ปั๊มน้ำ|สุขา|sanitary|บำบัด|น้ำ|ท่อ|booster|sump/i, 2], [/ลิฟต์|lift|elevator|อาคาร|ประตู|building/i, 4], [/EML|EXL|CEML|GEN|ไฟ|MDB|UPS|ATS|electric|หลอด|ปลั๊ก/i, 1]];
  const sysOf = name => { for (const [re, i] of SYS) if (re.test(name)) return i; return 5; };
  const ce = (d, m, y) => { y = +y; y = y < 100 ? y + 2500 - 543 : y > 2400 ? y - 543 : y; return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`; };
  const num = v => { const t = String(v ?? "").replace(/,/g, "").trim(); return t === "" || t === "-" || !isFinite(+t) ? 0 : +t; };
  function parseWeeklyPM(wb) {
    const weeks = [];
    Object.entries(wb).forEach(([sheet, rows]) => { let W = null, bi = -1, bname = "";
      for (let i = 0; i < rows.length; i++) { const r = rows[i] || [], cells = r.map(c => String(c ?? "").trim());
        const rg = cells.map(c => c.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s*-\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)).find(Boolean);
        if (rg) { const nx = (rows[i + 1] || []).map(c => String(c ?? "").trim());
          W = { sheet, range: rg[0], start: ce(rg[1], rg[2], rg[3]), end: ce(rg[4], rg[5], rg[6]), plans: [], blocks: [], defects: [], summary: null }; weeks.push(W); bi = -1;
          cells.forEach((c, j) => { if (/^plan/i.test(c)) { const a = cells.findIndex((x, k) => k > j && /^actual/i.test(x)); W.plans.push({ label: c.replace(/^plan\s*/i, ""), plan: num(nx[j]), actual: a > 0 ? num(nx[a]) : 0 }); } });
          continue; }
        if (!W) continue;
        if (cells.some(c => /^โรงพยาบาล/.test(c))) { bname = cells.find(c => /^โรงพยาบาล/.test(c)); continue; }
        const dc = cells.findIndex(c => /วัน\/เดือน\/ปี/.test(c));
        if (dc >= 0 && cells.some(c => /ยอดรวม/.test(c))) { bi++;
          const tc = cells.findIndex(c => /ยอดรวม/.test(c)), nr = cells.findIndex(c => /ไม่พร้อม/.test(c)), rd = cells.findIndex((c, k) => /^พร้อมใช้/.test(c) && k !== nr), rm = cells.findIndex(c => /หมายเหตุ/.test(c));
          const eq = cells.slice(dc + 1, tc).map((name, k) => ({ name, col: dc + 1 + k })).filter(e => e.name);
          const B = { building: (W.plans[bi] && W.plans[bi].label) || bname || `อาคาร ${bi + 1}`, eq: Object.fromEntries(eq.map(e => [e.name, 0])), total: 0, notReady: 0, ready: 0, remarks: [] };
          for (i++; i < rows.length; i++) { const x = (rows[i] || []).map(c => String(c ?? "").trim()); if (!x[dc] || /รวม/.test(x[dc])) break;
            eq.forEach(e => B.eq[e.name] += num(x[e.col])); B.total += num(x[tc]); if (nr >= 0) B.notReady += num(x[nr]); if (rd >= 0) B.ready += num(x[rd]); if (rm >= 0 && x[rm]) B.remarks.push(x[rm]); }
          i--; W.blocks.push(B); continue; }
        if (dc >= 0 && cells.some(c => /ชำรุด/.test(c))) { const cc = cells.findIndex(c => /ชำรุด/.test(c));
          for (i++; i < rows.length; i++) { const x = (rows[i] || []).map(c => String(c ?? "").trim()); if (!x[cc]) break; W.defects.push(x[cc]); } i--; continue; }
        const sc = cells.findIndex(c => /พร้อมใช้งาน%/.test(c));
        if (sc >= 0) { const nx = (rows[i + 1] || []).map(c => String(c ?? "").trim()), at = k => { const j = cells.findIndex(c => k.test(c)); return j >= 0 ? num(nx[j]) : null; };
          W.summary = { actual: at(/^actual/i), broken: at(/^เสีย/), retired: at(/ยกเลิก/), ready: at(/^พร้อมใช้งาน$/), pct: at(/พร้อมใช้งาน%/) }; }
      } });
    return weeks.filter(w => w.plans.length || w.blocks.length);
  }
  function pmBox() {
    const P = D.pm, [a, b] = period();
    let h = `<div class="drop"><b>ข้อมูลจากไฟล์ Weekly PM Report (.xlsx)</b><div class="sub">อัปโหลดไฟล์ WEEKLY PM REPORT ที่กรอกทุกสัปดาห์ ระบบใช้สัปดาห์ที่อยู่ในรอบ ${thd(a, { day: "numeric", month: "short" })} – ${thd(b)} แล้วเติมตารางข้อ 7 (แผน / เสร็จจริง / % ตรงแผน / ค้าง) และรายการชำรุดให้</div>` +
      (canWrite ? `<input type="file" id="pmFile" accept=".xlsx">` : "") + `</div>`;
    if (!P || !P.weeks || !P.weeks.length) return h;
    const W = P.weeks;
    h += `<p class="sub">ที่มา: ${esc(P.file)} · ใช้ ${W.length} สัปดาห์: ${esc(W.map(w => w.range).join(", "))}${P.note ? " · " + esc(P.note) : ""}</p>`;
    h += `<div class="tw"><table class="pt"><thead><tr><th>สัปดาห์</th><th>อาคาร / ส่วน</th><th>แผน</th><th>ทำจริง</th><th>% ตรงแผน</th><th>ไม่พร้อมใช้</th><th>พร้อมใช้</th></tr></thead><tbody>` +
      W.flatMap(w => w.plans.map((p, i) => { const B = w.blocks[i] || {}; const pc = p.plan ? Math.round(p.actual * 1000 / p.plan) / 10 : null;
        return `<tr><td>${esc(w.range)}</td><td>${esc(p.label)}</td><td class="num">${p.plan}</td><td class="num">${p.actual}</td><td class="num ${pc == null ? "" : pc >= 95 ? "c-ok" : pc >= 80 ? "c-mid" : "c-bad"}">${pc == null ? "-" : pc + "%"}</td><td class="num">${B.notReady ?? "-"}</td><td class="num">${B.ready ?? "-"}</td></tr>`; })).join("") + `</tbody></table></div>`;
    const eq = {}; W.forEach(w => w.blocks.forEach(B => Object.entries(B.eq).forEach(([k, v]) => eq[k] = (eq[k] || 0) + v)));
    h += `<div class="tw"><table class="pt"><thead><tr><th>อุปกรณ์ที่ตรวจ</th>${Object.keys(eq).map(k => `<th>${esc(k)}</th>`).join("")}</tr></thead><tbody><tr><td class="lab">จำนวนที่ตรวจ</td>${Object.values(eq).map(v => `<td class="num">${v}</td>`).join("")}</tr></tbody></table></div>`;
    const S = W.filter(w => w.summary).map(w => `${w.range}: ตรวจ ${w.summary.actual} เสีย ${w.summary.broken} พร้อมใช้ ${w.summary.ready} (${nf((w.summary.pct || 0) * 100, 1)}%)`);
    if (S.length) h += `<p><b>ความพร้อมใช้:</b> ${esc(S.join(" · "))}</p>`;
    const def = W.flatMap(w => [...w.defects, ...w.blocks.flatMap(B => B.remarks)]);
    if (def.length) h += `<details><summary><b>รายการชำรุด / หมายเหตุ ${def.length} รายการ</b></summary><ul>${def.map(x => `<li>${esc(x)}</li>`).join("")}</ul></details>`;
    return h;
  }
  async function pmUpload() {
    const f = $("#pmFile").files[0]; if (!f) return;
    let wb; try { wb = await Office.readXlsx(f); } catch (e) { return toast("อ่านไฟล์ไม่ได้ (ต้องเป็น .xlsx): " + (e.message || e), true); }
    const all = parseWeeklyPM(wb); if (!all.length) return toast("ไม่พบตาราง WEEKLY PM REPORT ในไฟล์ (ต้องมีช่วงวันที่ เช่น 14/10/69-20/10/69 และหัว Plan / Actual)", true);
    const [a, b] = period(); let weeks = all.filter(w => w.end >= a && w.start <= b), note = "";
    if (!weeks.length) { weeks = all; note = `ไม่มีสัปดาห์ใดอยู่ในรอบ ${thd(a)} – ${thd(b)} จึงแสดงทุกสัปดาห์ในไฟล์ ตรวจว่าเลือกวันประชุมถูก`; }
    D.pm = { file: f.name, at: new Date().toISOString(), weeks, note };
    // section 7: equipment columns grouped by system; plan/actual from the Plan/Actual header (whole hospital)
    const T = tbl("pm"), done = [0, 0, 0, 0, 0, 0], bad = [0, 0, 0, 0, 0, 0];
    weeks.forEach(w => w.blocks.forEach(B => Object.entries(B.eq).forEach(([k, v]) => done[sysOf(k)] += v)));
    const plan = weeks.reduce((s, w) => s + w.plans.reduce((t, p) => t + p.plan, 0), 0), act = weeks.reduce((s, w) => s + w.plans.reduce((t, p) => t + p.actual, 0), 0);
    const nr = weeks.reduce((s, w) => s + w.blocks.reduce((t, B) => t + B.notReady, 0), 0);
    // the uploaded Weekly PM file is the source of record for section 7: its figures replace what was there
    let n = 0; void bad; const put = (k, r, c, v) => { tbl(k)[r][c] = String(v); n++; };
    for (let i = 0; i < 5; i++) if (done[i]) put("pm", i, 2, done[i]);
    if (plan) { const pc = Math.round(act * 1000 / plan) / 10 + "%"; put("pm", 5, 1, plan); put("pm", 5, 2, act); put("pm", 5, 3, pc); put("pm", 5, 5, Math.max(0, plan - act)); put("sum", 4, 3, pc); }
    if (nr) put("pm", 5, 4, `พบไม่พร้อมใช้ ${nr} จุด (ดูรายการชำรุด)`);
    if (done[5]) T[5][4] = T[5][4] || `อื่น ๆ ${done[5]} รายการ`;
    drawRep(); toast(`อ่าน Weekly PM ${weeks.length} สัปดาห์ ใส่ตัวเลขข้อ 7 จากไฟล์ ${n} ช่อง (ไฟล์นี้เป็นข้อมูลหลักของข้อ 7)`); if (canWrite) await persist(false);
  }

  // ---------- backlog ----------
  const grpOf = r => { const t = `${r.status || ""} ${r.reason || ""}`;
    if (/ผู้รับเหมา|contractor|vendor|MA\b/i.test(t)) return "con";
    if (/อะไหล่|วัสดุ|parts|จัดซื้อ|PR\b|PO\b/i.test(t)) return "parts";
    if (/อนุมัติ|พื้นที่|approv|access|area|เข้า(ไม่|พื้นที่)|นัด|ผู้ใช้/i.test(t)) return "appr";
    return "tw"; };
  const ageBin = a => AGE.findIndex(([, lo, hi], i) => i === 0 ? a <= hi : a > lo && a <= hi);
  function blMatrix() { const M = AGE.map(() => Object.fromEntries(GRP.map(g => [g[0], 0])));
    BL.rows.forEach(r => { const b = ageBin(+r.age || 0); if (b >= 0) M[b][grpOf(r)]++; }); return M; }
  function fillFromBacklog() {
    if (!BL.rows.length) return 0; let n = 0; const M = blMatrix(), T = tbl("aging");
    // the aging table always shows the uploaded list (it is the source of record for this section)
    AGE.forEach((_, i) => { GRP.forEach((g, c) => { T[i][c + 1] = String(M[i][g[0]]); }); T[i][5] = String(GRP.reduce((s, g) => s + M[i][g[0]], 0)); n++; });
    GRP.forEach((g, c) => T[5][c + 1] = String(M.reduce((s, r) => s + r[g[0]], 0))); T[5][5] = String(BL.rows.length); if (!T[5][6]) T[5][6] = "ต้องเคลียร์เป็น 0 ภายใน ธ.ค.";
    const over = BL.rows.filter(r => +r.age > 60).length;
    n += setIf("sum", 2, 3, BL.rows.length) + setIf("sum", 3, 3, over);
    const B = tbl("bap"), empty = B.every(r => r.every(v => !String(v).trim()));
    if (empty) { const top = [...BL.rows].sort((x, y) => (+y.age || 0) - (+x.age || 0)).slice(0, 10);
      D.t.bap = top.map(r => [`${r.no} ${String(r.detail || "").slice(0, 60)}`, String(r.age || ""), [r.status, r.reason].filter(Boolean).join(" · "), "", "", "", ""]); n += top.length; }
    return n;
  }
  const HDR = { no: /เลขใบงาน|เลขที่ใบงาน|ticket|job/i, date: /วันที่แจ้ง|วันที่/i, type: /ประเภท|หมวด/i, loc: /สถานที่/i, detail: /รายละเอียด|อาการ/i, owner: /ผู้รับผิดชอบ|ช่าง/i, status: /สถานะ/i, reason: /เหตุผล|สาเหตุ/i, age: /อายุ/i, stale: /ไม่อัปเดต/i };
  function parseSheet(rows) {
    const hi = rows.findIndex(r => r.some(c => HDR.no.test(String(c || ""))) && r.some(c => HDR.age.test(String(c || ""))));
    if (hi < 0) return null;
    const head = rows[hi].map(c => String(c || "").trim()), idx = {};
    Object.entries(HDR).forEach(([k, re]) => { const i = head.findIndex((h, j) => re.test(h) && !Object.values(idx).includes(j)); if (i >= 0) idx[k] = i; });
    return rows.slice(hi + 1).map(r => Object.fromEntries(Object.entries(idx).map(([k, i]) => [k, r[i] == null ? "" : String(r[i]).trim()]))).filter(r => r.no && /\d/.test(r.no))
      .map(r => ({ ...r, age: r.age === "" ? null : Math.round(+String(r.age).replace(/[^\d.]/g, "")) }));
  }
  $("#blFile").onchange = guard(async () => {
    const f = $("#blFile").files[0]; if (!f) return;
    let wb; try { wb = await Office.readXlsx(f); } catch (e) { $("#blMsg").innerHTML = `<p class="note bad">อ่านไฟล์ไม่ได้ (ต้องเป็น .xlsx): ${esc(e.message || e)}</p>`; return; }
    const H = hosp(), names = Object.keys(wb), short = H.name.replace(/^โรงพยาบาล/, "").replace(/\s+/g, "");
    const pick = names.find(n => n.replace(/^โรงพยาบาล/, "").replace(/\s+/g, "") === short) || names.find(n => n.replace(/\s+/g, "").includes(short)) || names.find(n => /รายการงานค้าง/.test(n)) || names.find(n => parseSheet(wb[n]));
    const rows = pick ? parseSheet(wb[pick]) : null;
    if (!rows) { $("#blMsg").innerHTML = `<p class="note bad">ไม่พบตารางงานค้างในไฟล์ (ต้องมีหัวตาราง เลขใบงาน และ อายุ (วัน)) แผ่นงานในไฟล์: ${esc(names.join(", "))}</p>`; return; }
    const other = names.filter(n => /^โรงพยาบาล/.test(n)).length > 1 && !names.includes(pick) ? "" : "";
    BL = { rows, file: f.name, sheet: pick, at: new Date().toISOString(), src: "upload" };
    $("#blMsg").innerHTML = `<p class="note ok">อ่านแล้ว ${rows.length} ใบ จากแผ่นงาน "${esc(pick)}" ของไฟล์ ${esc(f.name)}${other} กด บันทึกร่าง ในแท็บรายงาน หรือให้ AI วิเคราะห์ต่อได้เลย</p>`;
    fillFromBacklog(); drawBl(); if (canWrite) await persist(false);
  });
  $("#blSys").onclick = guard(async () => {
    const H = hosp(), J = await sb.from("jobs").select("job_no,created_at,detail,status,hold_reason,job_types(name),locations(name)").eq("hospital_id", H.id).not("status", "in", "(clear,evaluated,close,cancel)").order("created_at").limit(5000);
    if (J.error) throw J.error;
    const now = Date.now(), ST = { register: "รอรับงาน", assign: "มอบหมายแล้ว", work_on: "กำลังทำ", on_hold: "หยุดรอ" };
    const rows = (J.data || []).map(j => ({ no: j.job_no, date: j.created_at.slice(0, 10), type: (j.job_types && j.job_types.name) || "", loc: (j.locations && j.locations.name) || "", detail: j.detail, status: ST[j.status] || j.status, reason: j.hold_reason || "", age: Math.floor((now - new Date(j.created_at)) / 864e5) }));
    BL = { rows, file: "ระบบ RS", sheet: "", at: new Date().toISOString(), src: "system" };
    $("#blMsg").innerHTML = `<p class="note ok">ใช้งานค้างในระบบ RS ${rows.length} ใบ</p>`; fillFromBacklog(); drawBl(); if (canWrite) await persist(false);
  });
  function drawBl() {
    const R = BL.rows;
    if (!R.length) { $("#blSum").innerHTML = `<p class="note">ยังไม่มีข้อมูลงานค้างของรอบนี้ อัปโหลดไฟล์ Backlog ด้านบน</p>`; $("#blList").innerHTML = ""; drawAi(); return; }
    const M = blMatrix(), tot = g => M.reduce((s, r) => s + r[g], 0), over = R.filter(r => +r.age > 60).length;
    const reasons = {}; R.forEach(r => { const k = r.reason || r.status || "ไม่ระบุ"; reasons[k] = (reasons[k] || 0) + 1; });
    $("#blSum").innerHTML = `<p class="sub">ที่มา: ${esc(BL.file || "")}${BL.sheet ? ` (แผ่นงาน ${esc(BL.sheet)})` : ""} · อ่านเมื่อ ${new Date(BL.at).toLocaleString("th-TH", { timeZone: "Asia/Bangkok", dateStyle: "medium", timeStyle: "short" })}</p>
      <div class="kpis"><div class="kpi"><span>งานค้างทั้งหมด</span><b>${R.length}</b></div><div class="kpi"><span>ค้างเกิน 60 วัน</span><b class="${over ? "bad" : "ok"}">${over}</b></div>
      <div class="kpi"><span>อายุเฉลี่ย (วัน)</span><b>${nf(R.reduce((s, r) => s + (+r.age || 0), 0) / R.length, 1)}</b></div><div class="kpi"><span>เก่าสุด (วัน)</span><b>${Math.max(...R.map(r => +r.age || 0))}</b></div></div>
      <div class="tw"><table class="pt"><thead><tr><th>ช่วงอายุงานค้าง</th>${GRP.map(g => `<th>${g[1]}</th>`).join("")}<th>รวม</th></tr></thead><tbody>${AGE.map((a, i) => `<tr><td class="lab">${esc(a[0])}</td>${GRP.map(g => `<td class="num">${M[i][g[0]]}</td>`).join("")}<td class="num"><b>${GRP.reduce((s, g) => s + M[i][g[0]], 0)}</b></td></tr>`).join("")}
      <tr class="sum"><td>รวม</td>${GRP.map(g => `<td class="num">${tot(g[0])}</td>`).join("")}<td class="num">${R.length}</td></tr></tbody></table></div>
      <h3>เหตุผลที่ค้าง</h3><div class="tw"><table class="pt"><thead><tr><th>เหตุผล / สถานะค้าง</th><th>ใบ</th><th>%</th></tr></thead><tbody>${Object.entries(reasons).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${v}</td><td class="num">${nf(v * 100 / R.length, 1)}%</td></tr>`).join("")}</tbody></table></div>`;
    const list = [...R].sort((a, b) => (+b.age || 0) - (+a.age || 0));
    $("#blList").innerHTML = `<h2>รายการงานค้าง (เรียงจากค้างนานสุด)</h2><div class="tw"><table class="pt bl"><thead><tr><th>เลขใบงาน</th><th>อายุ (วัน)</th><th>กลุ่ม</th><th>ประเภท</th><th>สถานที่</th><th>รายละเอียด</th><th>สถานะค้าง</th><th>เหตุผล</th><th>ผู้รับผิดชอบ</th></tr></thead><tbody>` +
      list.map(r => `<tr><td>${esc(r.no)}</td><td class="num ${+r.age > 60 ? "c-bad" : +r.age > 30 ? "c-mid" : ""}">${esc(r.age ?? "")}</td><td>${esc(GRP.find(g => g[0] === grpOf(r))[1])}</td><td>${esc(r.type || "")}</td><td>${esc(r.loc || "")}</td><td class="d">${esc(r.detail || "")}</td><td>${esc(r.status || "")}</td><td>${esc(r.reason || "")}</td><td>${esc(r.owner || "")}</td></tr>`).join("") + `</tbody></table></div>`;
    drawAi();
  }

  // ---------- save / send ----------
  async function persist(send) {
    const H = hosp(), rec = { hospital_id: H.id, meet_date: meet(), data: D, backlog: BL, ai: AI, updated_by: me.id, updated_at: new Date().toISOString() };
    if (send) { rec.submitted_at = new Date().toISOString(); rec.submitted_by = me.id; }
    const { data, error } = await sb.from("perf_weekly").upsert(rec, { onConflict: "hospital_id,meet_date" }).select().maybeSingle(); if (error) throw error;
    row = data; status();
  }
  $("#save").onclick = guard(async () => { await persist(false); toast("บันทึกร่างแล้ว"); });
  $("#send").onclick = guard(async () => { await persist(true); toast(new Date() <= dueAt() ? "ส่งรายงานแล้ว ทันก่อนเสาร์ 10:00 น." : "ส่งรายงานแล้ว (เลยเวลาเสาร์ 10:00 น.)"); });

  // ---------- AI 3 roles (perf-ai): RCA fishbone 4M + 5 Why for each problem group ----------
  const AI_MAX = 4;
  const ROLES = '<div class="who3"><span>🤖 AI 1 ผู้เสนอวิธีแก้</span><span>🤖 AI 2 ผู้วิเคราะห์ ทบทวน</span><span>🤖 AI 3 ผู้ตรวจสอบ แก้ไข และนำเสนอ</span></div>';
  const logRows = () => (AI.log || []).map(h => [`รอบ ${h.round}`, h.approved ? "ผ่าน" : "สั่งแก้", h.approved ? (h.summary || "ไม่มีสิ่งที่ต้องแก้") : h.issues.join("\n")]);
  function aiInput() {
    const H = hosp(), [a, b] = period(), R = BL.rows, M = blMatrix(), pick = k => tbl(k).filter(r => r.slice(1).some(v => String(v).trim()));
    const reasons = {}; R.forEach(r => { const k = r.reason || r.status || "ไม่ระบุ"; reasons[k] = (reasons[k] || 0) + 1; });
    return { hospital_id: H.id, hospital: H.name, meeting: thd(meet()) + " 14:00–16:00 น.", period: `${thd(a)} – ${thd(b)}`,
      figures: { summary: pick("sum"), tor: pick("tor"), cm_24h: tbl("k24")[14], pm: pick("pm"), ma: pick("ma"), qc: pick("qc"), energy: pick("en") },
      backlog: { total: R.length, over_60_days: R.filter(r => +r.age > 60).length, aging_by_group: AGE.map((x, i) => ({ age: x[0], ...Object.fromEntries(GRP.map(g => [g[1], M[i][g[0]]])) })), reasons,
        oldest: [...R].sort((x, y) => (+y.age || 0) - (+x.age || 0)).slice(0, 40).map(r => ({ no: r.no, age: r.age, type: r.type, place: String(r.loc || "").slice(0, 40), detail: String(r.detail || "").slice(0, 90), status: r.status, reason: r.reason })) },
      notes: { decisions: pick("dec"), backlog_plan: tbl("bap").filter(r => r.some(v => String(v).trim())).map(r => [r[0], r[1], r[2], r[3], r[5], r[6]]) } };
  }
  $("#aiGo").onclick = guard(async () => {
    if (!BL.rows.length && !tbl("sum").some(r => String(r[3]).trim())) return toast("อัปโหลดไฟล์ Backlog หรือกรอกรายงานก่อน แล้วค่อยให้ AI วิเคราะห์", true);
    const box = $("#aiBox"); box.hidden = false;
    box.innerHTML = `<h3>Action plan โดย AI 3 คน</h3>${ROLES}<p>อาจใช้เวลาหลายนาที อย่าเพิ่งปิดหน้านี้</p><ol id="aiSteps"></ol>`;
    const body = aiInput();
    const call = async (extra, label) => { const li = document.createElement("li"); li.textContent = label + " …"; $("#aiSteps").appendChild(li);
      let data, error, msg;
      for (let t = 0; t < 4; t++) {
        ({ data, error } = await sb.functions.invoke("perf-ai", { body: { ...body, ...extra } }));
        const st = error && error.context && error.context.status, j = error && error.context && typeof error.context.json === "function" ? await error.context.json().catch(() => ({})) : {};
        msg = error ? (j.error || (st === 546 || st === 504 ? "AI ใช้เวลานานเกินที่เซิร์ฟเวอร์อนุญาต (150 วินาที)" : j.message || error.message)) + (st ? ` (รหัส ${st})` : "") : data && data.error;
        if (!msg || /โควตา|limit: 0/.test(msg) || !(st === 546 || st === 504 || /ช้าเกิน|503|429|high demand|overload|UNAVAILABLE|RESOURCE_EXHAUSTED/i.test(msg)) || t === 3) break;
        li.textContent = `${label} … AI ไม่ว่างหรือช้า กำลังลองใหม่อัตโนมัติ (ครั้งที่ ${t + 1}/3)`;
        await new Promise(ok => setTimeout(ok, 10000 * (t + 1)));
      }
      if (msg) { li.innerHTML = `${esc(label)} <b class="bad">ไม่สำเร็จ: ${esc(msg)}</b>`; throw Object.assign(new Error(msg), { shown: 1 }); }
      li.textContent = label + " ✓"; return { data, li }; };
    try {
      let p1 = "", p2 = "", issues = []; const log = [];
      for (let r = 1; r <= AI_MAX; r++) {
        p1 = (await call({ step: "propose", p1, p2, issues }, r === 1 ? "รอบ 1: AI 1 เสนอ RCA และวิธีแก้" : `รอบ ${r}: AI 1 แก้ตามที่ AI 3 สั่ง`)).data.text;
        p2 = (await call({ step: "review", p1, issues }, `รอบ ${r}: AI 2 วิเคราะห์ ทบทวน`)).data.text;
        const { data, li } = await call({ step: "check", p1, p2, history: log }, `รอบ ${r}: AI 3 ตรวจสอบ`), c = data.check;
        log.push({ round: r, approved: c.approved, issues: c.issues || [], summary: c.summary || "" });
        li.innerHTML = `รอบ ${r}: AI 3 ตรวจสอบ ✓ <b class="${c.approved ? "ok" : "bad"}">${c.approved ? "ผ่าน" : `สั่งแก้ ${c.issues.length} เรื่อง`}</b>` + (c.approved ? "" : `<ul>${c.issues.map(x => `<li>${esc(x)}</li>`).join("")}</ul>`);
        if (c.approved) break; issues = c.issues;
      }
      const res = (await call({ step: "report", p1, p2, history: log }, "AI 3 เรียบเรียงรายงานฉบับสุดท้าย")).data;
      AI = { report: res.report, log, model: res.model, at: new Date().toISOString() }; drawAi();
      if (canWrite) { await persist(false); toast("เก็บ Action plan ของ AI ไว้กับรายงานรอบนี้แล้ว (บันทึกร่าง)"); }
    } catch (e) { if (!e.shown) box.insertAdjacentHTML("beforeend", `<p class="note bad">ทำไม่สำเร็จ: ${esc(errText(e))}</p>`); }
  });
  // fishbone (Ishikawa) picture: 4M bones, the problem group in the head
  const vis = t => t.replace(/[ัิ-ฺ็-๎]/g, "").length;
  const cut = (t, n) => { t = String(t || ""); if (vis(t) <= n) return t; let k = t.length; while (k > 0 && vis(t.slice(0, k)) > n - 1) k--; return t.slice(0, k) + "…"; };
  const wrap = (t, n) => { const out = []; let rest = String(t || ""); while (rest.length > n && out.length < 2) { let k = rest.lastIndexOf(" ", n); if (k < n / 2) k = n; out.push(rest.slice(0, k).trim()); rest = rest.slice(k).trim(); } out.push(cut(rest, n)); return out; };
  function fishSvg(c, title, m4) {
    const W = 1400, H = 600, Y = 300, x = v => esc(v);
    let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="Tahoma, 'IBM Plex Sans Thai', sans-serif"><rect width="${W}" height="${H}" fill="#ffffff"/>` +
      `<line x1="30" y1="${Y}" x2="1132" y2="${Y}" stroke="#1F2A37" stroke-width="6"/><polygon points="1126,${Y - 24} 1150,${Y} 1126,${Y + 24}" fill="#1F2A37"/>` +
      `<rect x="1152" y="${Y - 92}" width="236" height="184" rx="14" fill="#FDE8E6" stroke="#B42318" stroke-width="3"/>` +
      `<text x="1270" y="${Y - 52}" text-anchor="middle" font-size="22" font-weight="bold" fill="#9B1C13">ปัญหา ${x(c)}</text>` +
      wrap(title, 17).map((t, i) => `<text x="1270" y="${Y - 14 + i * 30}" text-anchor="middle" font-size="18" fill="#1F2A37">${x(t)}</text>`).join("");
    M4.forEach(([k, lab], i) => { const J = i % 2 ? 1040 : 560, top = i < 2, ex = J - 220, ey = top ? 70 : 530;
      s += `<line x1="${ex}" y1="${ey}" x2="${J}" y2="${Y}" stroke="#0B5CAD" stroke-width="4"/>` +
        `<rect x="${ex - 125}" y="${top ? ey - 52 : ey + 6}" width="250" height="46" rx="9" fill="#0B5CAD"/><text x="${ex}" y="${top ? ey - 21 : ey + 37}" text-anchor="middle" fill="#ffffff" font-size="19" font-weight="bold">${lab}</text>`;
      ((m4 && m4[k]) || []).slice(0, 4).forEach((t, j) => { const yy = top ? 112 + 44 * j : 352 + 44 * j, bx = top ? ex + 220 * (yy - 70) / 230 : ex + 220 * (530 - yy) / 230;
        s += `<line x1="${bx - 24}" y1="${yy}" x2="${bx}" y2="${yy}" stroke="#0B5CAD" stroke-width="2"/><text x="${bx - 30}" y="${yy + 6}" text-anchor="end" font-size="16" fill="#1F2A37">${x(cut(t, 28))}</text>`; }); });
    return s + "</svg>";
  }
  const toPng = (svg, w, h) => new Promise(ok => { const img = new Image();
    img.onload = () => { const cv = document.createElement("canvas"); cv.width = w; cv.height = h; cv.getContext("2d").drawImage(img, 0, 0); try { ok(cv.toDataURL("image/png")); } catch (e) { ok(null); } };
    img.onerror = () => ok(null); img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg); });
  function drawAi() {
    const box = $("#aiBox"), R = AI.report; if (!R) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = `<h3>Action plan โดย AI 3 คน</h3>${ROLES}<p class="sub">ทำเมื่อ ${new Date(AI.at).toLocaleString("th-TH", { timeZone: "Asia/Bangkok", dateStyle: "medium", timeStyle: "short" })} · AI 3 ตรวจวน ${(AI.log || []).length} รอบ · ตรวจทานก่อนนำเสนอทุกครั้ง</p>` +
      `<h3>บทสรุปผู้บริหาร</h3><p>${esc(R.summary)}</p><h3>บทวิเคราะห์</h3><ul>${R.analysis.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` +
      R.items.map(it => `<h3>${esc(it.code)} ${esc(it.title)}</h3>${(it.tickets || []).length ? `<p class="sub">ใบงาน: ${esc(it.tickets.join(", "))}</p>` : ""}<div class="fish">${fishSvg(it.code, it.title, it.m4)}</div>` +
        `<p><b>5 Why:</b></p><ol>${(it.why5 || []).map(x => `<li>${esc(x)}</li>`).join("")}</ol><p><b>สาเหตุราก:</b> ${esc(it.root_cause)}</p>` +
        `<p><b>โครงการแก้ไข:</b> ${esc(it.project.name)} · <b>เป้าหมาย:</b> ${esc(it.project.goal)} · <b>งบประมาณ:</b> ${esc(it.project.budget)}</p><div class="tw"><table><thead><tr><th>วิธีการ / ขั้นตอน</th><th>ผู้รับผิดชอบ</th><th>กำหนดเสร็จ</th><th>วัดผล</th></tr></thead><tbody>` +
        it.actions.map(a => `<tr><td>${esc(a.step)}</td><td>${esc(a.owner)}</td><td>${esc(a.due)}</td><td>${esc(a.measure)}</td></tr>`).join("") + `</tbody></table></div><p><b>ผลที่คาดหวัง:</b> ${esc(it.expected_result)}</p>`).join("") +
      `<h3>แผนเวลา</h3><div class="tw"><table><thead><tr><th>ช่วงเวลา</th><th>กิจกรรม</th></tr></thead><tbody>${R.timeline.map(x => `<tr><td>${esc(x.when)}</td><td>${esc(x.activity)}</td></tr>`).join("")}</tbody></table></div>` +
      `<h3>ความเสี่ยงของแผน</h3><ul>${R.risks.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` +
      `<h3>การตรวจวนของ AI 3</h3><div class="tw"><table><thead><tr><th>รอบ</th><th>ผลตรวจ</th><th>สิ่งที่สั่งแก้ / สรุป</th></tr></thead><tbody>${logRows().map(r => `<tr><td>${esc(r[0])}</td><td><b class="${r[1] === "ผ่าน" ? "ok" : "bad"}">${esc(r[1])}</b></td><td>${esc(r[2]).replace(/\n/g, "<br>")}</td></tr>`).join("")}</tbody></table></div>` +
      `<h3>สิ่งที่ AI 2 ทบทวน และ AI 3 แก้แล้ว</h3><ul>${R.review_notes.map(x => `<li>${esc(x)}</li>`).join("")}</ul><h3>การติดตามผลครั้งถัดไป</h3><ul>${R.follow_up.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` +
      `<div class="acts"><button class="btn" type="button" id="aiP">Action plan AI (PPT)</button><button class="btn" type="button" id="aiW">Word</button><button class="btn" type="button" id="aiF">PDF</button><button class="btn" type="button" id="aiX">Excel</button>` +
      (canWrite ? `<button class="btn" type="button" id="aiUse">ใส่แผนของ AI ลงข้อ 13 คำมั่นรอบหน้า</button>` : "") + `</div>`;
    const run = fn => () => aiDeck().then(fn).catch(e => toast(errText(e), true));
    $("#aiP").onclick = run(d => Office.pptx(fname("ActionPlanAI"), d)); $("#aiW").onclick = run(d => Office.docx(fname("ActionPlanAI"), d)); $("#aiF").onclick = run(d => Office.pdf(fname("ActionPlanAI"), d));
    $("#aiX").onclick = run(d => Office.xlsx(fname("ActionPlanAI"), [Office.summarySheet({ title: d.title, org: d.org, period: d.period, findings: d.findings, notes: d.notes }), ...aiSheets()]));
    if ($("#aiUse")) $("#aiUse").onclick = () => { const T = tbl("next"); let k = T.filter(r => r.slice(1).some(v => String(v).trim())).length;
      const keep = T.filter(r => r.slice(1).some(v => String(v).trim()));
      R.items.forEach(it => it.actions.forEach(a => { k++; keep.push([`ACT-${String(k).padStart(2, "0")} / ${it.code} ${a.step}`, a.measure, a.owner, a.due, "", it.project.name]); }));
      D.t.next = keep; toast("ใส่แผนของ AI ลงข้อ 13 แล้ว ตรวจทานในแท็บรายงานแล้วกด บันทึกร่าง"); };
  }
  function aiSheets() { const R = AI.report, rows = [["กลุ่ม", "ปัญหา", "ใบงาน", "สาเหตุราก", "วิธีการ / ขั้นตอน", "ผู้รับผิดชอบ", "กำหนดเสร็จ", "วัดผล", "ผลที่คาดหวัง"]];
    R.items.forEach(it => it.actions.forEach((a, i) => rows.push([i ? "" : it.code, i ? "" : it.title, i ? "" : (it.tickets || []).join(", "), i ? "" : it.root_cause, a.step, a.owner, a.due, a.measure, i ? "" : it.expected_result])));
    return [{ name: "Action plan AI", rows, header: 0 },
      { name: "RCA ก้างปลา 4M", rows: [["กลุ่ม", "ปัญหา", ...M4.map(m => m[1]), "5 Why", "สาเหตุราก", "ชื่อโครงการ", "เป้าหมาย", "งบประมาณ"], ...R.items.map(it => [it.code, it.title, ...M4.map(m => ((it.m4 || {})[m[0]] || []).join("\n")), (it.why5 || []).join("\n"), it.root_cause, it.project.name, it.project.goal, it.project.budget])], header: 0 },
      { name: "แผนเวลา", rows: [["ช่วงเวลา", "กิจกรรม"], ...R.timeline.map(x => [x.when, x.activity])], header: 0 },
      { name: "การตรวจวน AI 3", rows: [["รอบ", "ผลตรวจ", "สิ่งที่สั่งแก้ / สรุป"], ...logRows()], header: 0 }]; }
  async function aiSlides() { const R = AI.report; if (!R) return [];
    const pics = await Promise.all(R.items.map(it => toPng(fishSvg(it.code, it.title, it.m4), 1400, 600)));
    return [{ title: "Action plan โดย AI 3 คน: บทสรุป", head: ["หัวข้อ", "รายละเอียด"], chart: false, left: true, colW: [2.3, 10.0], fs: 13, rows: [["บทสรุปผู้บริหาร", R.summary], ...R.analysis.slice(0, 6).map((x, i) => [i ? "" : "บทวิเคราะห์", x])] },
      ...R.items.flatMap((it, k) => [...(pics[k] ? [{ title: `RCA ก้างปลา 4M · ${it.code} ${it.title}`.slice(0, 80), img: pics[k], note: "สาเหตุราก: " + it.root_cause }] : []),
        { title: `5 Why และโครงการแก้ไข · ${it.code}`, head: ["หัวข้อ", "รายละเอียด"], chart: false, left: true, colW: [2.3, 10.0], fs: 13,
          rows: [...(it.why5 || []).slice(0, 5).map((x, i) => [i ? "" : "5 Why", x]), ["สาเหตุราก", it.root_cause], ["โครงการ", it.project.name], ["เป้าหมาย", it.project.goal], ["งบประมาณ", it.project.budget], ...((it.tickets || []).length ? [["ใบงาน", it.tickets.join(", ")]] : [])] },
        { title: `Action plan · ${it.code} ${it.title}`.slice(0, 80), head: ["วิธีการ / ขั้นตอน", "ผู้รับผิดชอบ", "กำหนดเสร็จ", "วัดผล"], chart: false, left: true, colW: [5.6, 2.4, 1.7, 2.6], fs: 12,
          rows: [...it.actions.map(a => [a.step, a.owner, a.due, a.measure]), ["ผลที่คาดหวัง: " + it.expected_result, "", "", ""]] }]),
      { title: "แผนเวลาถึงสิ้นเดือนธันวาคม", head: ["ช่วงเวลา", "กิจกรรม"], chart: false, left: true, colW: [2.8, 9.5], fs: 13, rows: R.timeline.map(x => [x.when, x.activity]) },
      { title: "การตรวจวนของ AI 3 และความเสี่ยง", head: ["หัวข้อ", "รายละเอียด"], chart: false, left: true, colW: [2.3, 10.0], fs: 12, rows: [...logRows().map(r => [r[0] + " " + r[1], r[2]]), ...R.risks.map((x, i) => [i ? "" : "ความเสี่ยง", x])] }]; }
  async function aiDeck() { const H = hosp(), R = AI.report;
    return { title: `Action plan แก้ปัญหา (RCA 4M + 5 Why) ${H.code}`, org: H.name, period: `ประชุม Bi-Weekly Performance ${thd(meet())} · จัดทำโดย AI 3 คน (เสนอ · วิเคราะห์ทบทวน · ตรวจสอบแก้ไข)`,
      findings: [R.summary], kpis: [["งานค้างทั้งหมด", BL.rows.length], ["ค้างเกิน 60 วัน", BL.rows.filter(r => +r.age > 60).length], ["กลุ่มปัญหา", R.items.length], ["ขั้นตอนแก้ไข", R.items.reduce((s, it) => s + it.actions.length, 0)]],
      analysis: R.analysis.slice(0, 9), sections: await aiSlides(), notes: R.follow_up.slice(0, 9) }; }

  // ---------- exports of the Chief report (template order) ----------
  const fname = p => `${p}_${hosp().code}_${meet().replace(/^(\d{4})/, y => +y + 543)}`;
  const filled = T => T.map(r => r.map(v => String(v ?? "")));
  async function repDeck() {
    k24calc(); const H = hosp(), S = tbl("sum"), [a, b] = period();
    const find = S.filter(r => String(r[3]).trim()).map(r => `${r[0]}: ${r[3]} (เป้าหมาย ${r[1]})${String(r[4]).trim() ? " · " + r[4] : ""}`);
    if (BL.rows.length) find.push(`งานค้าง ${BL.rows.length} ใบ เกิน 60 วัน ${BL.rows.filter(r => +r.age > 60).length} ใบ (จาก ${BL.file})`);
    const dec = tbl("dec").filter(r => String(r[0]).trim()).map(r => `ขอ GM ตัดสินใจ: ${r[0]}${r[2] ? " · ข้อเสนอ: " + r[2] : ""}`);
    return { title: `Chief Engineer Bi-Weekly Performance ${H.code}`, org: H.name, period: `ประชุม ${thd(meet())} 14:00–16:00 น. · ข้อมูล ${thd(a)} – ${thd(b)} · ผู้รายงาน ${D.site.chief || "-"}${D.site.qc ? " · " + D.site.qc : ""}`,
      findings: find.length ? find.slice(0, 8) : ["ยังไม่ได้กรอกผลรอบนี้"], kpis: [["งานค้าง (ใบ)", BL.rows.length || S[2][3] || "-"], ["ค้าง > 60 วัน", BL.rows.length ? BL.rows.filter(r => +r.age > 60).length : S[3][3] || "-"], ["CM 24 ชม.", tbl("k24")[14][4] || "-"], ["TOR", S[0][3] || S[0][2] || "-"]],
      analysis: dec.slice(0, 6),
      sections: [...SEC.map(s => ({ title: s.t, head: s.cols, rows: filled(tbl(s.k)), chart: false, left: true, fs: s.days ? 9 : 11 })), ...(await aiSlides())],
      notes: ["รายงานนี้ต้องมีทางเลือกและข้อเสนอของ Chief ทุกปัญหา", "ตัวเลข PR / ขออนุมัติภายใน 24 ชม. นับผ่าน KPI แต่ใบงานยังอยู่ใน Backlog จนปิดจริง"] }; }
  const repRun = fn => () => repDeck().then(fn).catch(e => toast(errText(e), true));
  $("#xP").onclick = repRun(d => Office.pptx(fname("BiWeekly"), d));
  $("#xW").onclick = repRun(d => Office.docx(fname("BiWeekly"), d));
  $("#xF").onclick = repRun(d => Office.pdf(fname("BiWeekly"), d));
  $("#xX").onclick = repRun(d => Office.xlsx(fname("BiWeekly"), [Office.summarySheet({ title: d.title, org: d.org, period: d.period, findings: d.findings, notes: d.notes, figures: d.kpis }),
    ...SEC.map(s => ({ name: s.t.replace(/^(\d+)\.\s*/, "$1 ").slice(0, 31), rows: [s.cols, ...filled(tbl(s.k))], header: 0 })),
    ...(BL.rows.length ? [{ name: "Backlog ที่อัปโหลด", rows: [["เลขใบงาน", "วันที่แจ้ง", "ประเภท", "สถานที่", "รายละเอียด", "ผู้รับผิดชอบ", "สถานะค้าง", "เหตุผล", "อายุ (วัน)", "กลุ่ม"], ...BL.rows.map(r => [r.no, r.date, r.type, r.loc, r.detail, r.owner, r.status, r.reason, r.age, GRP.find(g => g[0] === grpOf(r))[1]])], header: 0 }] : []),
    ...(AI.report ? aiSheets() : [])]));

  // ---------- 12 hospitals ----------
  let allRows = [];
  async function drawAll() {
    const [r, H] = await Promise.all([sb.from("perf_weekly").select("hospital_id,submitted_at,updated_at,data,backlog,ai").eq("meet_date", meet()), sb.from("hospitals").select("id,code,name").order("code")]);
    if (r.error) throw r.error;
    const ORDER = ["PT1", "PT2", "PT3", "PTN", "PTW", "PTS", "PTP", "PLD", "PLR", "PLS", "PLK", "PLC"], hs = (H.data || []).sort((a, b) => ORDER.indexOf(a.code) - ORDER.indexOf(b.code));
    allRows = hs.map(h => { const x = (r.data || []).find(v => v.hospital_id === h.id), d = (x && x.data) || {}, t = d.t || {}, bl = (x && x.backlog && x.backlog.rows) || [];
      const st = !x ? "ยังไม่มีรายงาน" : !x.submitted_at ? "ร่าง ยังไม่ส่ง" : new Date(x.submitted_at) <= dueAt() ? "ส่งตรงเวลา" : "ส่งเลยเวลา";
      const g = (k, r0, c) => t[k] && t[k][r0] ? t[k][r0][c] || "" : "";
      return [h.code, h.name, st, x && x.submitted_at ? new Date(x.submitted_at).toLocaleString("th-TH", { timeZone: "Asia/Bangkok", dateStyle: "short", timeStyle: "short" }) : "-",
        bl.length || g("sum", 2, 3) || "-", bl.length ? bl.filter(v => +v.age > 60).length : g("sum", 3, 3) || "-", g("k24", 14, 4) || g("sum", 1, 3) || "-", g("sum", 0, 3) || g("tor", 8, 3) || "-", g("sum", 4, 3) || "-",
        x && x.ai && x.ai.report ? `ทำแล้ว ${x.ai.report.items.length} กลุ่มปัญหา` : "-", (t.dec || []).filter(v => String(v[0] || "").trim()).length || "-"]; });
    const head = ["รหัส", "โรงพยาบาล", "สถานะ", "ส่งเมื่อ", "งานค้าง", "> 60 วัน", "CM 24 ชม.", "TOR", "PM ตรงแผน", "Action plan AI", "ขอ GM ตัดสินใจ"];
    const cls = v => v === "ส่งตรงเวลา" ? "c-ok" : v === "ส่งเลยเวลา" ? "c-bad" : v === "ร่าง ยังไม่ส่ง" ? "c-mid" : "";
    $("#aTable").innerHTML = `<thead><tr>${head.map(h => `<th>${h}</th>`).join("")}</tr></thead><tbody>${allRows.map(r => `<tr>${r.map((v, i) => `<td class="${i === 2 ? cls(v) : i > 3 ? "num" : ""}">${esc(v)}</td>`).join("")}</tr>`).join("")}</tbody>`;
    allDeck.head = head;
  }
  function allDeck() { const n = s => allRows.filter(r => r[2] === s).length, bl = allRows.reduce((s, r) => s + (+r[4] || 0), 0), o = allRows.reduce((s, r) => s + (+r[5] || 0), 0);
    return { title: "ประชุม Bi-Weekly Performance 12 โรงพยาบาล", org: "งานบริหารวิศวกรรมอาคาร", period: `ประชุม ${thd(meet())} 14:00–16:00 น.`,
      findings: [`ส่งตรงเวลา ${n("ส่งตรงเวลา")} โรง · ส่งเลยเวลา ${n("ส่งเลยเวลา")} โรง · ร่าง ${n("ร่าง ยังไม่ส่ง")} โรง · ยังไม่มีรายงาน ${n("ยังไม่มีรายงาน")} โรง`, `งานค้างรวม ${bl} ใบ เกิน 60 วัน ${o} ใบ (เฉพาะโรงที่อัปโหลด Backlog)`],
      kpis: [["ส่งตรงเวลา", n("ส่งตรงเวลา")], ["งานค้างรวม", bl], ["เกิน 60 วัน", o]], analysis: allRows.filter(r => r[2] !== "ส่งตรงเวลา").map(r => `${r[0]} ${r[2]}`).slice(0, 9),
      sections: [{ title: "สถานะการส่งรายงาน 12 โรง", head: allDeck.head, rows: allRows.map(r => r.map(String)), chart: false, left: true, fs: 10 }], notes: ["Chief ส่งภายในเสาร์ 10:00 น. QC ตรวจ 10:00–12:00 น. ประชุม 14:00–16:00 น."] }; }
  const fA = () => `BiWeekly_12รพ_${+meet().slice(0, 4) + 543}${meet().slice(4)}`;
  $("#aP").onclick = () => Office.pptx(fA(), allDeck()); $("#aW").onclick = () => Office.docx(fA(), allDeck()); $("#aF").onclick = () => Office.pdf(fA(), allDeck());
  $("#aX").onclick = () => { const d = allDeck(); Office.xlsx(fA(), [Office.summarySheet({ title: d.title, org: d.org, period: d.period, findings: d.findings, notes: d.notes, figures: d.kpis }), { name: "12 โรง", rows: [allDeck.head, ...allRows], header: 0 }]); };
})();
