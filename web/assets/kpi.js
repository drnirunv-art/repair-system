// KPI ตามสัญญา (เอกสารแนบ 4): 100 points a month per hospital, pass at 90.
// Two scoring sets come from the 12 contracts: most use pass/fail thresholds; PTP, PLR and PLS use step scales.
// PLK counts repeat jobs within 7 days (2.2) and allows at most 5 occurrences level 0-3 (2.4), like PTP, PLR and PLS.
// Values the system can count (PM, repair jobs, response time, repeats, backlog, aging, ratings) come from kpi_auto;
// the rest are typed by a head. Saved in kpi_monthly (one row per item).
(() => {
  const { sb, $, esc, errText } = RS;
  const STEP = ["PTP", "PLR", "PLS"], DISC = ["PT1", "PT2", "PT3", "PTN", "PTW", "PTS"], MGR = ["owner", "admin", "chief_engineer", "supervisor"];
  let me = null, exec = false, hosps = [], vals = {}, auto = null, saved = [], cur = "month", busy = false;
  const toast = (m, bad) => { const t = $("#toast"); t.textContent = m; t.hidden = false; t.style.background = bad ? "var(--bad)" : ""; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, bad ? 6000 : 3000); };
  const guard = fn => async ev => { if (busy) return; busy = true; try { await fn(ev); } catch (e) { toast(errText(e), true); } finally { busy = false; } };
  const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
  const ym = () => ($("#m").value || today().slice(0, 7)).split("-").map(Number);
  const mName = (y, m) => new Date(y, m - 1, 1).toLocaleDateString("th-TH", { month: "long", year: "numeric" });
  const hosp = () => hosps.find(h => h.id === $("#h").value) || {};
  const step = () => STEP.includes(hosp().code);
  const occMax = () => step() || hosp().code === "PLK" ? 5 : 10;
  const r1 = v => Math.round(v * 10) / 10;
  const pc = (a, b) => b > 0 ? r1(a * 100 / b) : null;
  const ge = (v, list) => { for (const [t, s] of list) if (v >= t) return s; return 0; };   // first threshold reached wins
  const le = (v, list) => { for (const [t, s] of list) if (v <= t) return s; return 0; };

  // item list: code, title, max points, input kind (pass | pct | count), target text, score(value), auto(value from kpi_auto)
  const CAT = { "1": "1. งานบำรุงรักษาเชิงป้องกัน (PM) 20 คะแนน", "2": "2. คุณภาพงาน PM และงานแจ้งซ่อม (CM) 20 คะแนน", "3": "3. งานแจ้งซ่อม (CM) 10 คะแนน", "4": "4. รายงานประจำเดือน 9 คะแนน",
    "5": "5–7. ESG · ซ้อม Code · ฝึกอบรม 6 คะแนน", "8": "8. CEG Score card และ KPI Engineering 35 คะแนน" };
  const pass = max => v => v === "pass" ? max : 0;
  const ITEMS = () => { const S = step(), o = occMax(), A = auto || {};
    const ontime = pc(A.ontime_ok, A.ontime_n);
    return [
      ["1.1", "แผนงาน PM ประจำปี และแผนปรับปรุงเมื่อไม่เป็นไปตามแผน (ส่งศุกร์แรกของเดือนถัดไป)", 5, "pass", "ส่งครบ 100%", pass(5), null],
      ["1.2", "ผลงานของ PM เทียบกับแผน", 10, "pct", "≥ 95%", v => S ? ge(v, [[95, 10], [90, 7], [80, 5], [70, 2]]) : (v >= 95 ? 10 : 0),
        A.pm_planned > 0 ? pc(A.pm_done + A.pm_waiting, A.pm_planned) : null, A.pm_planned > 0 ? `ทำแล้ว ${A.pm_done + A.pm_waiting} จากแผน ${A.pm_planned} เครื่อง (รอลงนาม ${A.pm_waiting})` : "ยังไม่มีแผน PM เดือนนี้ในระบบ"],
      ["1.3", "งาน PM คงค้างที่ต้องทำต่อเดือนถัดไป (% ของแผน)", 5, "pct", "≤ 5%", v => S ? (v <= 5 ? 5 : v < 10 ? 2 : 0) : (v <= 5 ? 5 : 0),
        A.pm_planned > 0 ? pc(A.pm_planned - A.pm_done - A.pm_waiting, A.pm_planned) : null, A.pm_planned > 0 ? `ค้าง ${A.pm_planned - A.pm_done - A.pm_waiting} เครื่อง` : ""],
      ["2.1", "งานซ่อมเสร็จตามวันที่กำหนด ใช้งานได้ปกติ (ผู้ว่าจ้างสุ่มตรวจ 10% ต่อวัน)", 3, "pct", "≥ 95%", v => S ? ge(v, [[95, 3], [80, 1]]) : (v >= 95 ? 3 : 0),
        ontime, A.ontime_n ? `ตรงเวลา ${A.ontime_ok} จาก ${A.ontime_n} งานที่เสร็จในเดือน` : "ยังไม่มีงานที่เสร็จและมีกำหนดเสร็จ"],
      ["2.2", `งานไม่ซ่อมซ้ำภายใน ${A.repeat_days || (hosp().code === "PLK" ? 7 : 30)} วัน (เครื่องเดียวกัน หรือที่เดียวกันหมวดเดียวกัน)`, 2, "pct", "≥ 95%", v => v >= 95 ? 2 : 0,
        A.repeat_n ? r1(100 - A.repeat_dup * 100 / A.repeat_n) : null, A.repeat_n ? `ซ้ำ ${A.repeat_dup} จาก ${A.repeat_n} งาน` : ""],
      ["2.3", "Response time ตาม FM Lean (Critical 5 นาที · Priority 15 นาที · Non-priority 45 นาที)", 5, "pct", "≥ 95%", v => S ? ge(v, [[95, 5], [90, 3], [80, 1]]) : (v >= 95 ? 5 : 0),
        pc(A.resp_ok, A.resp_n), A.resp_n ? `รับงานทันเวลา ${A.resp_ok} จาก ${A.resp_n} งาน` : ""],
      ["2.4.1", `Occurrence Report จากงานช่าง ระดับ 0–3 (จำนวนครั้ง)`, 5, "count", `≤ ${o} ครั้ง`, v => v <= o ? 5 : 0, null, "กรอกจากรายงาน Occurrence ของโรงพยาบาล"],
      ["2.4.2", "Occurrence Report จากงานช่าง ระดับ 4–5 (จำนวนครั้ง)", 5, "count", "0 ครั้ง", v => v <= 0 ? 5 : 0, null, "กรอกจากรายงาน Occurrence ของโรงพยาบาล"],
      ["3.1", "งานแจ้งซ่อมคงค้างสิ้นเดือน (ไม่นับงานหยุดที่โรงพยาบาลอนุมัติ เช่น รออะไหล่สั่งพิเศษ เข้าพื้นที่ไม่ได้)", 5, "pct", "≤ 5%", v => S ? (v <= 5 ? 5 : v < 10 ? 2 : v <= 15 ? 1 : 0) : (v <= 5 ? 5 : 0),
        A.jobs ? pc(A.open_end - A.open_excl, A.jobs) : null, A.jobs ? `ค้าง ${A.open_end - A.open_excl} งาน (ไม่นับงานหยุดที่อนุมัติ ${A.open_excl}) จากงานแจ้งใหม่ ${A.jobs} งาน` : "ยังไม่มีงานแจ้งในเดือนนี้"],
      ["3.2", "งานคงค้างอายุเกิน 60 วัน (จำนวนงาน)", 5, "count", "0 งาน (100% ไม่เกิน 60 วัน)", v => v <= 0 ? 5 : 0, auto ? A.aging_over60 : null, auto ? `งานค้างสิ้นเดือนทั้งหมด ${A.open_end} งาน` : ""],
      ["4.1.1", "รายงานมิเตอร์น้ำ ไฟ แก๊ส ร้านค้าเช่า (วันที่ 15 และ 25)", 1, "pass", "ส่งครบตรงเวลา", pass(1), null],
      ["4.1.2", "รายงาน CEG2 · สินค้าคงคลัง · รายงานประจำวัน · ตารางเวร ส่งครบตรงเวลา (% ของจำนวนรายงาน)", 8, "pct", "100% (คิดตามสัดส่วน)", v => r1(8 * Math.max(0, Math.min(100, v)) / 100), null],
      ["5", "ประสานงานและนำส่ง ESG DATA ครบทุกหมวด", 2, "pass", "100%", pass(2), null],
      ["6", "ร่วมซ้อม Code 0–9 ที่เกี่ยวข้อง", 2, "pass", "100%", pass(2), null],
      ["7", "พนักงานเข้าร่วมฝึกอบรมรับเหตุฉุกเฉิน (ลิฟต์ ไฟฟ้าขัดข้อง อัคคีภัย)", 2, "pass", "100%", pass(2), null],
      ["8.1.1", "ประสิทธิภาพการใช้ไฟฟ้าต่อพื้นที่ต่อวัน", 5, "pct", "≥ 90%", v => S ? ge(v, [[90, 5], [80, 3], [70, 1]]) : (v >= 90 ? 5 : 0), null],
      ["8.1.2", "ประสิทธิภาพการใช้น้ำต่อผู้ใช้", 5, "pct", "≥ 90%", v => S ? ge(v, [[90, 5], [80, 3], [70, 1]]) : (v >= 90 ? 5 : 0), null],
      ["8.1.3", "ประสิทธิภาพการใช้ไฟฟ้าต่อหัวผู้ป่วย", 5, "pct", "≥ 90%", v => S ? ge(v, [[90, 5], [80, 3], [70, 1]]) : (v >= 90 ? 5 : 0), null],
      ["8.2.1", "Int KPI: อัตราระยะเวลาการให้บริการด้านวิศวกรรม", 2, "pct", "≥ 90%", v => v >= 90 ? 2 : 0, ontime, "ใช้ตัวเลขเดียวกับข้อ 2.1"],
      ["8.2.2", "Int KPI: อัตราความพร้อมใช้ของเครื่องมือ เครื่องจักร", 2, "pct", "≥ 95%", v => v >= 95 ? 2 : 0, null],
      ["8.2.3", "Int KPI: อัตราเวลาสะสมที่เครื่องจักรชำรุด (Downtime)", 2, "pct", "≤ 0.5%", v => v <= 0.5 ? 2 : 0, null],
      ["8.2.4", "Int KPI: อัตราการปนเปื้อนเชื้อโรคในน้ำใช้", 2, "pct", "0%", v => v <= 0 ? 2 : 0, null],
      ["8.2.5", "Int KPI: อัตราการตรวจพบเชื้อ Legionella ใน Cooling Tower", 2, "pct", "0%", v => v <= 0 ? 2 : 0, null],
      ["8.3.1", "Ext KPI: อัตราการส่งมอบงาน (ซ่อมเสร็จภายในเวลาที่กำหนด)", 2, "pct", "≥ 95%", v => v >= 95 ? 2 : 0, ontime, "ใช้ตัวเลขเดียวกับข้อ 2.1"],
      ["8.3.2", "Ext KPI: ความพึงพอใจของผู้รับบริการ", 2, "pct", "≥ 80%", v => v >= 80 ? 2 : 0, A.eval_n ? r1(A.eval_avg * 20) : null, A.eval_n ? `คะแนนประเมินเฉลี่ย ${A.eval_avg} จาก 5 (${A.eval_n} งาน)` : "ยังไม่มีผู้แจ้งให้คะแนนในเดือนนี้"],
      ["8.3.3", "Ext KPI: อัตราการซ่อมซ้ำภายใน 7 วันหลังส่งมอบงาน", 1, "pct", "≤ 0.5%", v => v <= 0.5 ? 1 : 0, A.repeat_n ? pc(A.repeat7_dup, A.repeat_n) : null, A.repeat_n ? `ซ้ำ ${A.repeat7_dup} จาก ${A.repeat_n} งาน` : ""],
      ["8.3.4", "Ext KPI: ประสิทธิภาพการบำบัดน้ำเสีย (ค่าพารามิเตอร์ผ่าน)", 3, "pct", "100%", v => v >= 100 ? 3 : 0, null],
      ["8.3.5", "Ext KPI: อัตราความพร้อมใช้ของระบบสาธารณูปโภค", 2, "pct", "100%", v => v >= 100 ? 2 : 0, null]
    ].map(([code, title, max, kind, target, score, sys, sysNote]) => ({ code, title, max, kind, target, score, sys, sysNote: sysNote || "" })); };
  // suggested corrective steps for an item that lost points (the head edits them to fit the site)
  const SUG = {
    "1.1": ["ส่งแผน PM ประจำปีก่อนเริ่มปีสัญญา และส่งแผนปรับปรุงทุกวันศุกร์แรกของเดือนถัดไป", "ตั้งเตือนในปฏิทินและกำหนดผู้ส่งหลักกับผู้ส่งสำรอง", "หัวหน้าตรวจและลงนามก่อนส่งทุกครั้ง เก็บหลักฐานการส่ง"],
    "1.2": ["ทำรายชื่อเครื่องที่ยังไม่ทำ PM แล้วจัดทีมทำให้เสร็จภายในสัปดาห์แรกของเดือนถัดไป", "กด \"สร้างงานเดือนนี้\" ตั้งแต่วันแรกของเดือน และแบ่งงาน PM เป็นรายสัปดาห์ (สัปดาห์ 1–4)", "หัวหน้าลงนามใบ PM ที่ค้างรอลงนามภายใน 3 วัน", "ติดตามความคืบหน้าทุกวันศุกร์ใน PM Board"],
    "1.3": ["ทำรายการเครื่อง PM ที่ค้าง พร้อมวันที่จะทำ แจ้งในแผนปรับปรุงต่อผู้ว่าจ้างวันศุกร์แรก", "จัดคนเพิ่มหรือขอ OT เฉพาะช่วงที่งาน PM ค้าง", "หาสาเหตุที่ทำไม่ได้ (เข้าพื้นที่ไม่ได้ ไม่มีอะไหล่ เครื่องใช้งานอยู่) แล้วนัดวันกับหน่วยงาน"],
    "2.1": ["กำหนดวันเสร็จทุกงานตั้งแต่ตอนมอบหมาย และใส่วันเสร็จตามแผนสำหรับงานที่ต้องรอ", "หัวหน้ากะตรวจงานใกล้ครบกำหนดทุกเช้า", "Quality Supervisor สุ่มตรวจงานซ่อม 10% ต่อวัน และแก้ทันทีเมื่อพบงานไม่เรียบร้อย"],
    "2.2": ["ดึงรายการงานซ่อมซ้ำ แล้ววิเคราะห์สาเหตุราก (RCA) รายเครื่อง", "เปลี่ยนอะไหล่ที่เสื่อมแบบถาวร หรือเพิ่มรายการตรวจในแผน PM ของเครื่องนั้น", "หัวหน้าตรวจผลก่อนปิดงานซ่อมของเครื่องที่ซ่อมซ้ำ"],
    "2.3": ["เปิดเสียงเตือนงานที่ยังไม่มีคนรับในหน้าเจ้าหน้าที่ทุกกะ", "จัดคนรับงานประจำกะและคนสำรองช่วงพักหรือประชุม", "ทบทวนงานที่รับช้าทุกสัปดาห์ แยกตาม Critical / Priority / Non-priority"],
    "2.4.1": ["ทบทวน Occurrence ทุกเรื่องกับหน่วยงาน หาสาเหตุราก", "อบรมช่างในเรื่องที่เกิดซ้ำ และทำ One point lesson", "คุมผู้รับเหมาด้วย Work Permit และตรวจหน้างานทุกครั้ง"],
    "2.4.2": ["รายงานผู้บริหารภายใน 24 ชั่วโมง และทำ RCA เต็มรูปแบบ", "กำหนดมาตรการป้องกันไม่ให้เกิดซ้ำ พร้อมผู้รับผิดชอบ", "ติดตามผลมาตรการในการประชุมประจำเดือน"],
    "3.1": ["ไล่ปิดงานค้างทุกวัน เริ่มจากงานที่เก่าที่สุด", "งานที่ต้องรอ (อะไหล่สั่งพิเศษ เข้าพื้นที่ไม่ได้ รอผู้รับเหมา) ขออนุมัติหยุดงานให้ครบในระบบ", "เร่งเปิดใบขอซื้ออะไหล่และติดตามกับจัดซื้อทุกสัปดาห์"],
    "3.2": ["ทำรายการงานที่ค้างเกิน 60 วัน และกำหนดวันเสร็จทุกงาน", "งานที่ติดงบหรือผู้รับเหมา ทำ Memo ขออนุมัติกับผู้บริหารโรงพยาบาล", "รายงานความคืบหน้าให้ผู้บริหารทุกสัปดาห์จนเป็นศูนย์"],
    "4.1.1": ["ทำปฏิทินจดมิเตอร์วันที่ 15 และ 25 พร้อมผู้รับผิดชอบหลักและสำรอง", "ส่งก่อนเที่ยงของวันที่กำหนด"],
    "4.1.2": ["ทำปฏิทินกำหนดส่งรายงานทุกฉบับ (CEG2 วันที่ 10, คลังวันจันทร์, รายงานประจำวัน, ตารางเวรสัปดาห์แรก)", "กำหนดผู้รับผิดชอบหลักและสำรองต่อรายงาน", "ส่งก่อนเที่ยง ถ้าตรงวันหยุดให้ส่งวันทำงานถัดไป และเก็บหลักฐานการส่ง"],
    "5": ["ทำ Checklist ข้อมูล ESG ทุกหมวด และส่งตามกำหนด", "ประสานหน่วยงานที่เกี่ยวข้องล่วงหน้า 1 สัปดาห์"],
    "6": ["วางตารางซ้อม Code ร่วมกับโรงพยาบาลล่วงหน้าทั้งปี", "ส่งรายชื่อผู้เข้าร่วมและเก็บใบลงชื่อเป็นหลักฐาน"],
    "7": ["ทำแผนอบรมรายเดือน (ลิฟต์ ไฟฟ้าขัดข้อง อัคคีภัย)", "จัดอบรมซ้ำให้คนที่ขาด และเก็บใบลงชื่อ"],
    "8.1.1": ["ตรวจการใช้ไฟฟ้าที่ผิดปกติ ปิดเครื่องที่ไม่ใช้ ตั้งเวลาเปิดปิด", "ปรับค่าตั้ง Chiller และระบบปรับอากาศให้เหมาะกับภาระ", "เทียบค่าเดือนก่อนและปีก่อน หาพื้นที่ที่ใช้เพิ่ม"],
    "8.1.2": ["ตรวจหาจุดรั่วของท่อและสุขภัณฑ์", "เทียบมิเตอร์ย่อยหาพื้นที่ที่ใช้น้ำเพิ่ม", "รณรงค์และติดตั้งอุปกรณ์ประหยัดน้ำ"],
    "8.1.3": ["วิเคราะห์การใช้ไฟต่อหัวผู้ป่วยตามพื้นที่", "ปรับตารางเดินเครื่องตามจำนวนผู้ป่วยจริง"],
    "8.2.1": ["ติดตามงานใกล้ครบกำหนดทุกวัน", "จัดลำดับงานตามความเร่งด่วน"],
    "8.2.2": ["เร่งซ่อมเครื่องหลักที่หยุด และสำรองอะไหล่วิกฤต", "ทำ PM ตามแผนให้ครบ"],
    "8.2.3": ["วิเคราะห์เครื่องที่หยุดนานที่สุด หาสาเหตุ", "สำรองอะไหล่วิกฤตและทำสัญญาซ่อมด่วนกับผู้ขาย"],
    "8.2.4": ["ล้างฆ่าเชื้อถังเก็บน้ำและท่อ ปรับคลอรีนอิสระให้อยู่ในเกณฑ์", "เก็บตัวอย่างตรวจซ้ำ และบันทึกผลใน Water management plan"],
    "8.2.5": ["ล้างและฆ่าเชื้อ Cooling Tower ทันที", "ตรวจเชื้อ Legionella ซ้ำ และปรับโปรแกรมเคมีบำบัดน้ำ"],
    "8.3.1": ["ติดตามงานใกล้ครบกำหนดทุกวัน", "งานที่ต้องรอ ใส่วันเสร็จตามแผนและแจ้งผู้แจ้งล่วงหน้า"],
    "8.3.2": ["โทรหรือแจ้งผู้แจ้งเมื่องานเสร็จ และขอให้ประเมิน", "อ่านความเห็นที่ได้คะแนนต่ำแล้วแก้ไข", "อบรมช่างเรื่องการสื่อสารและความเรียบร้อยหลังงาน"],
    "8.3.3": ["วิเคราะห์งานซ่อมซ้ำภายใน 7 วันทุกงาน", "หัวหน้าตรวจผลก่อนปิดงาน"],
    "8.3.4": ["ตรวจค่าน้ำทิ้งรายวัน ปรับการเติมอากาศและเคมี", "ล้างระบบและซ่อมอุปกรณ์บำบัดที่ชำรุด", "ส่งตรวจซ้ำกับห้องปฏิบัติการ"],
    "8.3.5": ["ซ่อมระบบที่หยุดให้กลับมาใช้งาน และมีแผนสำรองระหว่างซ่อม", "เพิ่มการตรวจประจำวันของระบบสาธารณูปโภคหลัก"]
  };
  const sugText = c => (SUG[c] || ["ระบุวิธีแก้ไข"]).map((t, i) => `${i + 1}. ${t}`).join("\n");
  const thd = d => d ? new Date(d + "T00:00:00").toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" }) : "-";
  const catOf = c => ["5", "6", "7"].includes(c) ? "5" : c[0];
  const has = v => v !== undefined && v !== null && v !== "";
  const scoreOf = (it, v) => has(v) ? it.score(it.kind === "pass" ? v : +v) : null;
  const total = () => ITEMS().reduce((s, it) => s + (scoreOf(it, vals[it.code] && vals[it.code].v) || 0), 0);
  const disc = t => t >= 90 ? 0 : t >= 80 ? 3 : t >= 70 ? 5 : t >= 60 ? 7 : 10;
  const cls = t => t >= 90 ? "ok" : t >= 80 ? "mid" : "bad";
  const canWrite = () => exec || (MGR.includes(me.role) && $("#h").value === me.hospital_id);

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
    const q = new URLSearchParams(location.search);
    const last = new Date(); last.setDate(1); last.setMonth(last.getMonth() - 1);   // most months are scored after they end
    $("#m").value = /^\d{4}-\d{2}$/.test(q.get("m") || "") ? q.get("m") : last.toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" }).slice(0, 7);
    const ty = +today().slice(0, 4); $("#y").innerHTML = [ty + 1, ty, ty - 1].map(y => `<option value="${y}">${y + 543}</option>`).join(""); $("#y").value = ty;
    $("#tYear").hidden = !exec; $("#body").hidden = false; $("#tabs").hidden = false;
    show(exec && q.get("tab") === "year" ? "year" : "month");
  }
  document.querySelectorAll("#tabs button").forEach(b => b.onclick = () => show(b.dataset.tab));
  function show(t) {
    cur = t === "year" && exec ? "year" : "month";
    document.querySelectorAll("#tabs button").forEach(b => b.setAttribute("aria-selected", b.dataset.tab === cur));
    $("#tab-month").hidden = cur !== "month"; $("#tab-year").hidden = cur !== "year";
    (cur === "month" ? loadMonth : loadYear)().catch(e => toast(errText(e), true));
  }

  // ---------- one hospital, one month ----------
  $("#h").onchange = () => loadMonth().catch(e => toast(errText(e), true));
  $("#m").onchange = () => loadMonth().catch(e => toast(errText(e), true));
  async function loadMonth() {
    const [y, m] = ym(), h = $("#h").value, first = `${y}-${String(m).padStart(2, "0")}-01`;
    const [a, s] = await Promise.all([sb.rpc("kpi_auto", { p_hospital: h, p_year: y, p_month: m }), sb.from("kpi_monthly").select("*").eq("hospital_id", h).eq("month", first)]);
    if (a.error) throw a.error; if (s.error) throw s.error;
    auto = a.data || {}; saved = (s.data || []).filter(r => r.hospital_id === h && r.month === first);
    vals = {}; saved.forEach(r => vals[r.item] = { v: r.note && r.note.startsWith("pass:") ? r.note.slice(5, 9) === "pass" ? "pass" : "fail" : has(r.actual) ? +r.actual : "", n: (r.note || "").replace(/^pass:(pass|fail) ?/, ""), src: r.source, cause: r.ap_cause || "", act: r.ap_action || "", owner: r.ap_owner || "", due: r.ap_due || "" });
    if (!saved.length) fillAuto(false);
    draw();
  }
  function fillAuto(over) { ITEMS().forEach(it => { if (it.sys == null) return; if (!over && vals[it.code] && has(vals[it.code].v)) return; vals[it.code] = { v: it.sys, n: (vals[it.code] || {}).n || "", src: "auto" }; }); }
  $("#auto").onclick = () => { fillAuto(true); draw(); toast("ใส่ค่าจากระบบแล้ว ตรวจทานแล้วกด บันทึก"); };
  function draw() {
    const [y, m] = ym(), H = hosp(), list = ITEMS(), w = canWrite();
    $("#rule").textContent = `เกณฑ์ของสัญญา ${H.name || ""}: ${step() ? "คะแนนแบบขั้นบันได" : "ผ่าน / ไม่ผ่าน ตามเป้าหมาย"} · Occurrence ระดับ 0–3 ไม่เกิน ${occMax()} ครั้ง · งานซ่อมซ้ำนับภายใน ${hosp().code === "PLK" ? 7 : 30} วัน` +
      (w ? "" : " · บัญชีนี้ดูได้อย่างเดียว (บันทึกได้เฉพาะหัวหน้าของโรง หรือผู้บริหาร 12 โรง)");
    $("#save").hidden = $("#auto").hidden = !w;
    let html = `<thead><tr><th>ข้อ</th><th>ตัวชี้วัด</th><th>เป้าหมาย</th><th>ค่าจริง</th><th>ค่าจากระบบ</th><th>คะแนน</th><th>หมายเหตุ</th></tr></thead><tbody>`, lastCat = "";
    list.forEach(it => { const c = catOf(it.code), v = (vals[it.code] || {}).v, sc = scoreOf(it, v);
      if (c !== lastCat) { lastCat = c; html += `<tr class="cat"><td colspan="7">${esc(CAT[c])}</td></tr>`; }
      const inp = it.kind === "pass" ? `<select data-c="${it.code}" ${w ? "" : "disabled"}><option value="">–</option><option value="pass" ${v === "pass" ? "selected" : ""}>ผ่าน</option><option value="fail" ${v === "fail" ? "selected" : ""}>ไม่ผ่าน</option></select>`
        : `<input type="number" step="0.1" min="0" inputmode="decimal" data-c="${it.code}" value="${has(v) ? esc(v) : ""}" ${w ? "" : "disabled"} aria-label="ค่าจริง ข้อ ${it.code}">${it.kind === "pct" ? " %" : ""}`;
      const sys = it.sys != null ? `<b>${it.sys}${it.kind === "pct" ? "%" : ""}</b><br>${esc(it.sysNote)}` : esc(it.sysNote || "กรอกเอง");
      html += `<tr><td class="code">${it.code}</td><td class="t">${esc(it.title)}</td><td>${esc(it.target)}</td><td class="v">${inp}</td><td class="sys">${sys}</td>` +
        `<td class="sc ${sc == null ? "" : sc >= it.max ? "ok" : sc > 0 ? "mid" : "bad"}" data-s="${it.code}">${sc == null ? "–" : sc} / ${it.max}</td>` +
        `<td><input class="nt" data-n="${it.code}" value="${esc((vals[it.code] || {}).n || "")}" ${w ? "" : "disabled"} placeholder="หลักฐาน / เหตุผล" aria-label="หมายเหตุ ข้อ ${it.code}"></td></tr>`; });
    $("#kt").innerHTML = html + "</tbody>";
    $("#kt").querySelectorAll("[data-c]").forEach(el => el.oninput = el.onchange = () => { const c = el.dataset.c; vals[c] = Object.assign(vals[c] || {}, { v: el.value === "" ? "" : el.tagName === "SELECT" ? el.value : +el.value, src: "manual" }); totals(); });
    $("#kt").querySelectorAll("[data-n]").forEach(el => el.oninput = () => { const c = el.dataset.n; vals[c] = Object.assign(vals[c] || { v: "" }, { n: el.value }); });
    $("#saved").textContent = saved.length ? `บันทึกไว้แล้ว ${saved.length} ข้อ ล่าสุด ${new Date(Math.max(...saved.map(r => +new Date(r.updated_at)))).toLocaleString("th-TH")}` : `ยังไม่ได้บันทึก KPI เดือน ${mName(y, m)}`;
    totals();
  }
  function totals() {
    const list = ITEMS(), t = r1(total()), filled = list.filter(it => has((vals[it.code] || {}).v)).length, H = hosp();
    list.forEach(it => { const c = $(`[data-s="${it.code}"]`); if (!c) return; const sc = scoreOf(it, (vals[it.code] || {}).v);
      c.textContent = `${sc == null ? "–" : sc} / ${it.max}`; c.className = "sc " + (sc == null ? "" : sc >= it.max ? "ok" : sc > 0 ? "mid" : "bad"); });
    const d = DISC.includes(H.code) ? `${disc(t)}%` : "ไม่มีในสัญญา";
    $("#tot").innerHTML = `<div class="kpi"><b class="${cls(t)}">${t}</b><span>คะแนนรวม จาก 100</span></div>` +
      `<div class="kpi"><b class="${t >= 90 ? "ok" : "bad"}">${t >= 90 ? "ผ่าน" : "ไม่ผ่าน"}</b><span>เกณฑ์ผ่าน 90 คะแนน</span></div>` +
      `<div class="kpi"><b>${d}</b><span>ส่วนลดค่าบริการตามผล KPI</span></div>` +
      `<div class="kpi"><b>${filled}/${list.length}</b><span>ข้อที่มีค่าแล้ว</span></div>`;
    drawAp();
  }
  // ---------- action plan for every item that lost points ----------
  const defDue = () => { const [y, m] = ym(); const d = new Date(Date.UTC(y, m + 1, 0)); return d.toISOString().slice(0, 10); };   // end of the month after
  const failed = () => ITEMS().map(it => ({ it, sc: scoreOf(it, (vals[it.code] || {}).v) })).filter(x => x.sc != null && x.sc < x.it.max);
  const shown = x => { const v = (vals[x.it.code] || {}).v; return x.it.kind === "pass" ? (v === "pass" ? "ผ่าน" : "ไม่ผ่าน") : v + (x.it.kind === "pct" ? "%" : x.it.kind === "count" ? " " : ""); };
  const apOf = c => { const x = vals[c] || {}; return { cause: x.cause || "", act: x.act || sugText(c), owner: x.owner || "หัวหน้างานวิศวกรรม (Chief Engineer)", due: x.due || defDue() }; };
  let apSig = "";
  function drawAp() {
    const F = failed(), w = canWrite(), sig = F.map(x => x.it.code).join(",") + "|" + $("#h").value + $("#m").value;
    if (sig === apSig && $("#ap").childElementCount) return; apSig = sig;   // keep what is being typed while scores change
    if (!F.length) { $("#ap").innerHTML = `<div class="apok">ไม่มีข้อที่ตกในข้อที่มีค่าแล้ว ยังไม่ต้องทำ Action plan</div>`; return; }
    $("#ap").innerHTML = F.map(x => { const a = apOf(x.it.code), c = x.it.code, dis = w ? "" : "disabled";
      return `<div class="apc"><h3>ข้อ ${c} ${esc(x.it.title)} <small>ได้ ${x.sc}/${x.it.max} · ค่าจริง ${esc(shown(x))} · เป้าหมาย ${esc(x.it.target)}</small></h3><div class="apg">` +
        `<div><label for="apc-${c}">สาเหตุที่ตก</label><textarea id="apc-${c}" data-ap="cause" data-k="${c}" ${dis} placeholder="เช่น ช่างลาป่วย 2 คน งานเข้าพื้นที่ไม่ได้">${esc(a.cause)}</textarea></div>` +
        `<div style="grid-column:span 2"><label for="apa-${c}">วิธีแก้ไข (ระบบเสนอให้ ปรับได้)</label><textarea id="apa-${c}" data-ap="act" data-k="${c}" ${dis}>${esc(a.act)}</textarea></div>` +
        `<div><label for="apo-${c}">ผู้รับผิดชอบ</label><input id="apo-${c}" data-ap="owner" data-k="${c}" ${dis} value="${esc(a.owner)}"><label for="apd-${c}" style="margin-top:6px">กำหนดเสร็จ</label><input type="date" id="apd-${c}" data-ap="due" data-k="${c}" ${dis} value="${esc(a.due)}"></div>` +
        `</div></div>`; }).join("");
    $("#ap").querySelectorAll("[data-ap]").forEach(el => el.oninput = () => { const c = el.dataset.k; vals[c] = Object.assign(vals[c] || { v: "" }, { [el.dataset.ap]: el.value }); });
  }
  $("#save").onclick = guard(async () => {
    if (!canWrite()) return toast("บัญชีนี้บันทึก KPI ของโรงนี้ไม่ได้", true);
    const [y, m] = ym(), h = $("#h").value, first = `${y}-${String(m).padStart(2, "0")}-01`;
    const rows = ITEMS().filter(it => has((vals[it.code] || {}).v) || (vals[it.code] || {}).n).map(it => { const x = vals[it.code] || {}, sc = scoreOf(it, x.v);
      return { hospital_id: h, month: first, item: it.code, target: it.target, actual: it.kind === "pass" || !has(x.v) ? null : +x.v, score: sc, max_score: it.max,
        note: (it.kind === "pass" && has(x.v) ? `pass:${x.v} ` : "") + (x.n || "").trim(), source: x.src || "manual", updated_by: me.id, updated_at: new Date().toISOString(),
        ...(sc != null && sc < it.max ? (a => ({ ap_cause: a.cause.trim() || null, ap_action: a.act.trim() || null, ap_owner: a.owner.trim() || null, ap_due: a.due || null }))(apOf(it.code)) : { ap_cause: null, ap_action: null, ap_owner: null, ap_due: null }) }; });
    if (!rows.length) return toast("ยังไม่มีค่าให้บันทึก", true);
    const { error } = await sb.from("kpi_monthly").upsert(rows, { onConflict: "hospital_id,month,item" }); if (error) throw error;
    toast(`บันทึก KPI ${rows.length} ข้อแล้ว`); await loadMonth();
  });

  // ---------- exports (month) ----------
  function monthDeck() {
    const [y, m] = ym(), H = hosp(), list = ITEMS(), t = r1(total());
    const lost = list.map(it => ({ it, sc: scoreOf(it, (vals[it.code] || {}).v) })).filter(x => x.sc != null && x.sc < x.it.max).sort((a, b) => (b.it.max - b.sc) - (a.it.max - a.sc));
    const blank = list.filter(it => !has((vals[it.code] || {}).v));
    const cats = Object.keys(CAT).map(c => { const its = list.filter(it => catOf(it.code) === c); return [CAT[c].replace(/ \d+ คะแนน$/, ""), r1(its.reduce((s, it) => s + (scoreOf(it, (vals[it.code] || {}).v) || 0), 0)), its.reduce((s, it) => s + it.max, 0)]; });
    const findings = [`คะแนน KPI ตามสัญญา ${H.name} เดือน ${mName(y, m)} ได้ ${t} จาก 100 ${t >= 90 ? "ผ่านเกณฑ์ 90" : `ไม่ผ่านเกณฑ์ 90 (ขาด ${r1(90 - t)} คะแนน)`}`,
      DISC.includes(H.code) ? (t >= 90 ? "ไม่มีส่วนลดค่าบริการ" : `ตามสัญญา ผลนี้ทำให้มีส่วนลดค่าบริการ ${disc(t)}%`) : "สัญญาของโรงนี้ไม่มีข้อส่วนลดค่าบริการตามผล KPI",
      lost.length ? `เสียคะแนน ${lost.length} ข้อ มากที่สุดคือ ${lost.slice(0, 3).map(x => `${x.it.code} (${r1(x.it.max - x.sc)} คะแนน)`).join(", ")}` : "ไม่เสียคะแนนในข้อที่กรอกแล้ว"];
    if (blank.length) findings.push(`ยังไม่มีค่า ${blank.length} ข้อ: ${blank.map(it => it.code).join(", ")} คะแนนรวมยังไม่ครบ`);
    const analysis = lost.slice(0, 8).map(x => `${x.it.code} ${x.it.title}: ได้ ${x.sc}/${x.it.max} ค่าจริง ${x.it.kind === "pass" ? (vals[x.it.code].v === "pass" ? "ผ่าน" : "ไม่ผ่าน") : vals[x.it.code].v + (x.it.kind === "pct" ? "%" : "")} เป้าหมาย ${x.it.target}`);
    const notes = lost.slice(0, 5).map(x => { const a = apOf(x.it.code); return `ข้อ ${x.it.code}: ${a.act.split("\n")[0].replace(/^1\. /, "")} (ผู้รับผิดชอบ ${a.owner} เสร็จ ${thd(a.due)}) ดูรายละเอียดใน Action plan`; });
    if (auto && auto.aging_over60 > 0) notes.push(`มีงานค้างเกิน 60 วัน ${auto.aging_over60} งาน ต้องปิดหรือกำหนดวันเสร็จ`);
    return { title: `KPI ตามสัญญา (แนบ 4) ${H.code}`, org: H.name, period: mName(y, m), findings,
      kpis: [["คะแนนรวม", t], ["ผลประเมิน", t >= 90 ? "ผ่าน" : "ไม่ผ่าน"], ["ส่วนลด", DISC.includes(H.code) ? disc(t) + "%" : "-"], ["ข้อที่เสียคะแนน", lost.length], ["ข้อที่ยังไม่มีค่า", blank.length]],
      analysis: analysis.length ? analysis : ["ทุกข้อที่กรอกได้คะแนนเต็ม"], notes,
      sections: [{ title: "คะแนนรายหมวด", head: ["หมวด", "ได้", "เต็ม"], rows: cats }, { title: "ข้อที่เสียคะแนน", head: ["ข้อ", "ได้", "เต็ม"], rows: lost.map(x => [x.it.code + " " + x.it.title.slice(0, 40), x.sc, x.it.max]), chart: false }] };
  }
  $("#kX").onclick = () => { const d = monthDeck(), [y, m] = ym();
    const rows = [["ข้อ", "ตัวชี้วัด", "เป้าหมาย", "ค่าจริง", "ค่าจากระบบ", "คะแนน", "เต็ม", "หมายเหตุ"]];
    ITEMS().forEach(it => { const x = vals[it.code] || {}; rows.push([it.code, it.title, it.target, it.kind === "pass" ? (x.v === "pass" ? "ผ่าน" : x.v === "fail" ? "ไม่ผ่าน" : "") : has(x.v) ? x.v : "", it.sys == null ? "" : it.sys, scoreOf(it, x.v) ?? "", it.max, x.n || ""]); });
    rows.push(["", "รวม", "", "", "", r1(total()), 100, ""]);
    Office.xlsx(`KPI_${hosp().code}_${y + 543}-${String(m).padStart(2, "0")}`, [Office.summarySheet({ title: d.title, org: d.org, period: d.period, findings: d.findings, notes: d.notes, figures: d.kpis,
      groups: [{ title: "คะแนนรายหมวด", head: ["ได้", "เต็ม"], rows: d.sections[0].rows }] }), { name: "KPI รายข้อ", rows, header: 0 },
      { name: "Action plan", rows: [["ข้อ", "ได้", "เต็ม", "สาเหตุ", "วิธีแก้ไข", "ผู้รับผิดชอบ", "กำหนดเสร็จ"], ...failed().map(x => { const a = apOf(x.it.code); return [x.it.code, x.sc, x.it.max, a.cause, a.act, a.owner, thd(a.due)]; })], header: 0 }]); };
  $("#kP").onclick = () => { const [y, m] = ym(); return Office.pptx(`KPI_${hosp().code}_${y + 543}-${String(m).padStart(2, "0")}_บทสรุปผู้บริหาร`, monthDeck()).catch(e => toast(errText(e), true)); };

  function apDeck() {
    const [y, m] = ym(), H = hosp(), F = failed().sort((a, b) => (b.it.max - b.sc) - (a.it.max - a.sc)), t = r1(total());
    const lostPts = r1(F.reduce((s, x) => s + x.it.max - x.sc, 0));
    const findings = F.length ? [`KPI ${H.name} เดือน ${mName(y, m)} ได้ ${t} คะแนน มีข้อที่ตก ${F.length} ข้อ เสียรวม ${lostPts} คะแนน`,
        t >= 90 ? "ยังผ่านเกณฑ์ 90 แต่ต้องแก้ข้อที่ตกเพื่อไม่ให้คะแนนลดลงเดือนถัดไป" : `ไม่ผ่านเกณฑ์ 90 ต้องได้เพิ่มอีก ${r1(90 - t)} คะแนน${DISC.includes(H.code) ? ` (ส่วนลดค่าบริการเดือนนี้ ${disc(t)}%)` : ""}`,
        `ลำดับความสำคัญ: ${F.slice(0, 4).map(x => `${x.it.code} (เสีย ${r1(x.it.max - x.sc)})`).join(", ")}`,
        `ทุกข้อมีผู้รับผิดชอบและกำหนดเสร็จ ติดตามผลในการประชุมประจำเดือนและใน KPI เดือนถัดไป`] : ["ไม่มีข้อที่ตก ยังไม่ต้องทำ Action plan"];
    const sections = F.map(x => { const a = apOf(x.it.code);
      return { title: `ข้อ ${x.it.code} ${x.it.title}`.slice(0, 70), head: ["หัวข้อ", "รายละเอียด"], chart: false, left: true, colW: [2.3, 10.0], fs: 15,
        rows: [["ผลเดือนนี้", `ได้ ${x.sc}/${x.it.max} ค่าจริง ${shown(x)} เป้าหมาย ${x.it.target}`], ["สาเหตุ", a.cause || "(ยังไม่ระบุ)"], ...a.act.split("\n").filter(Boolean).map((s, i) => [i ? "" : "วิธีแก้ไข", s]),
          ["ผู้รับผิดชอบ", a.owner], ["กำหนดเสร็จ", thd(a.due)], ["วัดผล", `KPI ข้อ ${x.it.code} เดือนถัดไปต้องได้ ${x.it.max}/${x.it.max} (${x.it.target})`]] }; });
    return { title: `Action plan แก้ไข KPI ${H.code}`, org: H.name, period: mName(y, m), findings,
      kpis: [["คะแนนรวม", t], ["ข้อที่ตก", F.length], ["คะแนนที่เสีย", lostPts], ["เป้าหมาย", "≥ 90"]],
      analysis: F.map(x => `${x.it.code}: ${apOf(x.it.code).cause || "ยังไม่ระบุสาเหตุ"}`).slice(0, 9),
      sections: [{ title: "แผนแก้ไขสรุป", head: ["ข้อ", "เสีย", "ผู้รับผิดชอบ", "กำหนดเสร็จ"], chart: false, left: true, colW: [4.3, 1.5, 4.0, 2.5], fs: 15, rows: F.map(x => [x.it.code, r1(x.it.max - x.sc), apOf(x.it.code).owner, thd(apOf(x.it.code).due)]) }, ...sections],
      notes: F.length ? ["หัวหน้าติดตามความคืบหน้าทุกสัปดาห์ และรายงานผลในการประชุมประจำเดือนกับโรงพยาบาล", "ถ้าข้อใดแก้ไม่ทันกำหนด ให้แจ้งเหตุผลและวันที่ใหม่ล่วงหน้า"] : [] };
  }
  const apName = () => { const [y, m] = ym(); return `ActionPlan_KPI_${hosp().code}_${y + 543}-${String(m).padStart(2, "0")}`; };
  $("#kA").onclick = () => { if (!failed().length) return toast("ยังไม่มีข้อที่ตก จึงไม่มี Action plan", true); return Office.pptx(apName(), apDeck()).catch(e => toast(errText(e), true)); };
  $("#kAW").onclick = () => { if (!failed().length) return toast("ยังไม่มีข้อที่ตก จึงไม่มี Action plan", true); try { Office.docx(apName(), apDeck()); } catch (e) { toast(errText(e), true); } };
  $("#kAF").onclick = () => { if (!failed().length) return toast("ยังไม่มีข้อที่ตก จึงไม่มี Action plan", true); return Promise.resolve(Office.pdf(apName(), apDeck())).catch(e => toast(errText(e), true)); };
  $("#kAX").onclick = () => { if (!failed().length) return toast("ยังไม่มีข้อที่ตก จึงไม่มี Action plan", true); const d = apDeck();
    const rows = [["ข้อ", "ตัวชี้วัด", "ค่าจริง", "เป้าหมาย", "ได้", "เต็ม", "สาเหตุ", "วิธีแก้ไข", "ผู้รับผิดชอบ", "กำหนดเสร็จ", "สถานะ"]];
    failed().forEach(x => { const a = apOf(x.it.code); rows.push([x.it.code, x.it.title, shown(x), x.it.target, x.sc, x.it.max, a.cause, a.act, a.owner, thd(a.due), "กำลังแก้ไข"]); });
    Office.xlsx(apName(), [Office.summarySheet({ title: d.title, org: d.org, period: d.period, findings: d.findings, notes: d.notes, figures: d.kpis }), { name: "Action plan", rows, header: 0 }]); };

  // ---------- AI 3 roles: AI 1 proposes, AI 2 analyses and reviews, AI 3 checks, fixes and writes the report ----------
  let aiRep = null;
  const ROLES = '<div class="who3"><span>🤖 AI 1 ผู้เสนอวิธีแก้</span><span>🤖 AI 2 ผู้วิเคราะห์ ทบทวน</span><span>🤖 AI 3 ผู้ตรวจสอบ แก้ไข และนำเสนอ</span></div>';
  $("#kAI").onclick = guard(async () => {
    const F = failed(); if (!F.length) return toast("ยังไม่มีข้อที่ตก จึงไม่ต้องทำ Action plan", true);
    const [y, m] = ym(), H = hosp(), t = r1(total()), box = $("#aiBox"); box.hidden = false;
    box.innerHTML = `<h2>รายงาน Action plan โดย AI 3 คน</h2>${ROLES}<p>กำลังทำงานต่อกัน 3 ขั้น ใช้เวลาประมาณ 1–3 นาที อย่าเพิ่งปิดหน้านี้…</p>`;
    box.scrollIntoView({ behavior: "smooth", block: "start" });
    const body = { hospital_id: H.id, year: y, month: m, hospital: H.name, month_name: mName(y, m), total: t, discount: DISC.includes(H.code) ? disc(t) + "%" : "ไม่มีในสัญญา",
      failed: F.map(x => { const a = apOf(x.it.code); return { code: x.it.code, title: x.it.title, target: x.it.target, actual: shown(x), score: x.sc, max: x.it.max, system_note: x.it.sysNote, cause: a.cause, draft_action: a.act, owner: a.owner, due: a.due }; }) };
    const { data, error } = await sb.functions.invoke("kpi-ai", { body });
    let msg = error ? (error.context && typeof error.context.json === "function" ? ((await error.context.json().catch(() => ({}))).error || error.message) : error.message) : data && data.error;
    if (msg) { box.innerHTML = `<h2>รายงาน Action plan โดย AI 3 คน</h2><p class="note bad">ทำไม่สำเร็จ: ${esc(msg)}</p>`; return; }
    aiRep = data.report; drawAi();
  });
  function drawAi() {
    const R = aiRep, w = canWrite();
    $("#aiBox").innerHTML = `<h2>รายงาน Action plan โดย AI 3 คน</h2>${ROLES}<p class="meta">AI 1 เสนอ → AI 2 วิเคราะห์ทบทวน → AI 3 ตรวจสอบแก้ไขแล้วเรียบเรียง ตรวจทานก่อนนำเสนอทุกครั้ง</p>` +
      `<h3>บทสรุปผู้บริหาร</h3><p>${esc(R.summary)}</p><h3>บทวิเคราะห์</h3><ul>${R.analysis.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` +
      R.items.map(it => `<h3>ข้อ ${esc(it.code)} ${esc(it.title)}</h3><p><b>สาเหตุราก:</b> ${esc(it.root_cause)}</p><div class="tw"><table><thead><tr><th>วิธีการ / ขั้นตอน</th><th>ผู้รับผิดชอบ</th><th>กำหนดเสร็จ</th><th>วัดผล</th></tr></thead><tbody>` +
        it.actions.map(a => `<tr><td>${esc(a.step)}</td><td>${esc(a.owner)}</td><td>${esc(a.due)}</td><td>${esc(a.measure)}</td></tr>`).join("") + `</tbody></table></div><p><b>ผลที่คาดหวัง:</b> ${esc(it.expected_result)}</p>`).join("") +
      `<h3>แผนเวลา</h3><div class="tw"><table><thead><tr><th>ช่วงเวลา</th><th>กิจกรรม</th></tr></thead><tbody>${R.timeline.map(x => `<tr><td>${esc(x.when)}</td><td>${esc(x.activity)}</td></tr>`).join("")}</tbody></table></div>` +
      `<h3>ความเสี่ยงของแผน</h3><ul>${R.risks.map(x => `<li>${esc(x)}</li>`).join("")}</ul><h3>สิ่งที่ AI 2 ทบทวนและ AI 3 แก้แล้ว</h3><ul>${R.review_notes.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` +
      `<h3>การติดตามผล</h3><ul>${R.follow_up.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` +
      `<div class="hsel"><button class="btn" type="button" id="aiP">รายงาน AI (PPT)</button><button class="btn" type="button" id="aiW">รายงาน AI (Word)</button><button class="btn" type="button" id="aiF">รายงาน AI (PDF)</button><button class="btn" type="button" id="aiX">รายงาน AI (Excel)</button>` +
      (w ? `<button class="btn" type="button" id="aiUse">ใส่แผนของ AI ลงในช่อง Action plan</button>` : "") + `</div>`;
    $("#aiP").onclick = () => Office.pptx(aiName(), aiDeck()).catch(e => toast(errText(e), true));
    $("#aiW").onclick = () => { try { Office.docx(aiName(), aiDeck()); } catch (e) { toast(errText(e), true); } };
    $("#aiF").onclick = () => Promise.resolve(Office.pdf(aiName(), aiDeck())).catch(e => toast(errText(e), true));
    $("#aiX").onclick = () => { const d = aiDeck(), rows = [["ข้อ", "ตัวชี้วัด", "สาเหตุราก", "วิธีการ / ขั้นตอน", "ผู้รับผิดชอบ", "กำหนดเสร็จ", "วัดผล", "ผลที่คาดหวัง"]];
      aiRep.items.forEach(it => it.actions.forEach((a, i) => rows.push([i ? "" : it.code, i ? "" : it.title, i ? "" : it.root_cause, a.step, a.owner, a.due, a.measure, i ? "" : it.expected_result])));
      Office.xlsx(aiName(), [Office.summarySheet({ title: d.title, org: d.org, period: d.period, findings: d.findings, notes: d.notes }), { name: "Action plan", rows, header: 0 },
        { name: "แผนเวลา", rows: [["ช่วงเวลา", "กิจกรรม"], ...aiRep.timeline.map(x => [x.when, x.activity])], header: 0 }, { name: "บทวิเคราะห์", rows: [["บทวิเคราะห์"], ...aiRep.analysis.map(x => [x]), [], ["ความเสี่ยง"], ...aiRep.risks.map(x => [x]), [], ["AI 2 ทบทวน / AI 3 แก้แล้ว"], ...aiRep.review_notes.map(x => [x])], header: 0 }]); };
    if ($("#aiUse")) $("#aiUse").onclick = () => { aiRep.items.forEach(it => { const c = it.code; if (!vals[c]) return;
        vals[c].act = it.actions.map((a, i) => `${i + 1}. ${a.step} (${a.owner} · ${a.due} · วัดผล: ${a.measure})`).join("\n"); if (!vals[c].cause) vals[c].cause = it.root_cause; });
      apSig = ""; drawAp(); toast("ใส่แผนของ AI แล้ว ตรวจทานแล้วกด บันทึก"); $("#ap").scrollIntoView({ behavior: "smooth" }); };
  }
  const aiName = () => { const [y, m] = ym(); return `ActionPlan_AI_KPI_${hosp().code}_${y + 543}-${String(m).padStart(2, "0")}`; };
  function aiDeck() { const [y, m] = ym(), H = hosp(), R = aiRep;
    return { title: `รายงาน Action plan แก้ไข KPI ${H.code}`, org: H.name, period: mName(y, m) + " · จัดทำโดย AI 3 คน (เสนอ · วิเคราะห์ทบทวน · ตรวจสอบแก้ไข)",
      findings: [R.summary], kpis: [["คะแนนรวม", r1(total())], ["ข้อที่ตก", R.items.length], ["ขั้นตอนแก้ไขทั้งหมด", R.items.reduce((s, it) => s + it.actions.length, 0)]],
      analysis: R.analysis.slice(0, 9),
      sections: [...R.items.map(it => ({ title: `ข้อ ${it.code} ${it.title}`.slice(0, 70), head: ["วิธีการ / ขั้นตอน", "ผู้รับผิดชอบ", "กำหนดเสร็จ", "วัดผล"], chart: false, left: true, colW: [5.6, 2.4, 1.7, 2.6], fs: 12,
          rows: [["สาเหตุราก: " + it.root_cause, "", "", ""], ...it.actions.map(a => [a.step, a.owner, a.due, a.measure]), ["ผลที่คาดหวัง: " + it.expected_result, "", "", ""]] })),
        { title: "แผนเวลา", head: ["ช่วงเวลา", "กิจกรรม"], chart: false, left: true, colW: [2.8, 9.5], fs: 13, rows: R.timeline.map(x => [x.when, x.activity]) },
        { title: "ความเสี่ยงและการทบทวน", head: ["หัวข้อ", "รายละเอียด"], chart: false, left: true, colW: [2.8, 9.5], fs: 12, rows: [...R.risks.map((x, i) => [i ? "" : "ความเสี่ยง", x]), ...R.review_notes.map((x, i) => [i ? "" : "AI 2 ทบทวน / AI 3 แก้", x])] }],
      notes: R.follow_up.slice(0, 9) }; }

  // ---------- 12 hospitals, one year ----------
  let year = [];
  $("#y").onchange = () => loadYear().catch(e => toast(errText(e), true));
  async function loadYear() { const { data, error } = await sb.rpc("kpi_year_all", { p_year: +$("#y").value }); if (error) throw error; year = data || []; drawYear(); }
  const cell = v => v == null ? "" : v >= 90 ? "g" : v >= 80 ? "m" : v >= 60 ? "w" : "b";
  function yearRows() { const all = hosps.length ? hosps : [];
    return all.map(h => { const ms = Array.from({ length: 12 }, (_, i) => { const r = year.find(x => x.code === h.code && x.month === i + 1); return r ? r1(+r.score) : null; });
      const got = ms.filter(v => v != null); return { h, ms, avg: got.length ? r1(got.reduce((s, v) => s + v, 0) / got.length) : null, fail: got.filter(v => v < 90).length }; }); }
  function drawYear() {
    const Y = +$("#y").value, R = yearRows(), mh = Array.from({ length: 12 }, (_, i) => new Date(Y, i, 1).toLocaleDateString("th-TH", { month: "short" }));
    $("#yt").innerHTML = `<thead><tr><th>โรงพยาบาล</th>${mh.map(x => `<th>${x}</th>`).join("")}<th>เฉลี่ย</th><th>เดือนไม่ผ่าน</th></tr></thead><tbody>` +
      R.map(r => `<tr><td>${esc(r.h.code)} · ${esc(r.h.name)}</td>${r.ms.map((v, i) => `<td class="${cell(v)}"><a href="?m=${Y}-${String(i + 1).padStart(2, "0")}" data-h="${r.h.id}" data-mm="${Y}-${String(i + 1).padStart(2, "0")}">${v == null ? "–" : v}</a></td>`).join("")}<td class="${cell(r.avg)}"><b>${r.avg ?? "–"}</b></td><td>${r.fail}</td></tr>`).join("") + "</tbody>";
    $("#yt").querySelectorAll("a[data-h]").forEach(a => a.onclick = e => { e.preventDefault(); $("#h").value = a.dataset.h; $("#m").value = a.dataset.mm; show("month"); });
    const got = R.filter(r => r.avg != null), all = R.flatMap(r => r.ms.filter(v => v != null));
    $("#ytot").innerHTML = `<div class="kpi"><b>${got.length}/${R.length}</b><span>โรงที่มีผล KPI แล้ว</span></div><div class="kpi"><b>${all.length ? r1(all.reduce((s, v) => s + v, 0) / all.length) : "–"}</b><span>คะแนนเฉลี่ยทุกโรงทุกเดือน</span></div>` +
      `<div class="kpi"><b class="${all.some(v => v < 90) ? "bad" : "ok"}">${all.filter(v => v < 90).length}</b><span>โรง-เดือนที่ไม่ผ่าน 90</span></div>`;
  }
  function yearDeck() {
    const Y = +$("#y").value, R = yearRows(), got = R.filter(r => r.avg != null).sort((a, b) => b.avg - a.avg), all = R.flatMap(r => r.ms.filter(v => v != null));
    const fails = R.flatMap(r => r.ms.map((v, i) => v != null && v < 90 ? `${r.h.code} ${new Date(Y, i, 1).toLocaleDateString("th-TH", { month: "short" })} (${v})` : null).filter(Boolean));
    const findings = [`ปี ${Y + 543} มีผล KPI แล้ว ${got.length} จาก ${R.length} โรง รวม ${all.length} โรง-เดือน`, all.length ? `คะแนนเฉลี่ย ${r1(all.reduce((s, v) => s + v, 0) / all.length)} จาก 100` : "ยังไม่มีคะแนนที่บันทึก",
      fails.length ? `ไม่ผ่านเกณฑ์ 90 จำนวน ${fails.length} โรง-เดือน: ${fails.slice(0, 8).join(", ")}${fails.length > 8 ? " …" : ""}` : "ทุกโรงทุกเดือนที่บันทึกผ่านเกณฑ์ 90"];
    const disc6 = fails.filter(f => DISC.includes(f.split(" ")[0]));
    if (disc6.length) findings.push(`มีผลต่อส่วนลดค่าบริการ ${disc6.length} โรง-เดือน (เฉพาะ 6 โรงที่สัญญามีข้อส่วนลด)`);
    return { title: "KPI ตามสัญญา (แนบ 4) 12 โรงพยาบาล", org: "งานบริหารวิศวกรรมอาคาร", period: `ปี พ.ศ. ${Y + 543}`, findings,
      kpis: got.slice(0, 12).map(r => [r.h.code, r.avg]),
      analysis: got.length ? [`คะแนนเฉลี่ยสูงสุด ${got[0].h.code} (${got[0].avg}) ต่ำสุด ${got[got.length - 1].h.code} (${got[got.length - 1].avg})`, ...R.filter(r => r.avg == null).slice(0, 1).map(() => `ยังไม่มีผล: ${R.filter(r => r.avg == null).map(r => r.h.code).join(", ")}`)] : ["ยังไม่มีคะแนนให้วิเคราะห์"],
      notes: fails.length ? ["ให้หัวหน้าแต่ละโรงระบุสาเหตุและแผนแก้ไขในช่องหมายเหตุของข้อที่เสียคะแนน"] : [],
      sections: [{ title: "คะแนนเฉลี่ยรายโรง", head: ["โรงพยาบาล", "คะแนนเฉลี่ย", "เดือนไม่ผ่าน"], rows: got.map(r => [r.h.code, r.avg, r.fail]) }] };
  }
  $("#yX").onclick = () => { const d = yearDeck(), Y = +$("#y").value, mh = Array.from({ length: 12 }, (_, i) => new Date(Y, i, 1).toLocaleDateString("th-TH", { month: "short", year: "2-digit" }));
    Office.xlsx(`KPI_12โรง_${Y + 543}`, [Office.summarySheet({ title: d.title, period: d.period, findings: d.findings, notes: d.notes, figures: d.kpis }),
      { name: "คะแนนรายเดือน", rows: [["รหัส", "โรงพยาบาล", ...mh, "เฉลี่ย", "เดือนไม่ผ่าน"], ...yearRows().map(r => [r.h.code, r.h.name, ...r.ms.map(v => v ?? ""), r.avg ?? "", r.fail])], header: 0 }]); };
  $("#yP").onclick = () => Office.pptx(`KPI_12โรง_${+$("#y").value + 543}_บทสรุปผู้บริหาร`, yearDeck()).catch(e => toast(errText(e), true));
})();
