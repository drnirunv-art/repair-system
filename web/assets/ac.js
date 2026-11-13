// Air-conditioning contractor: work forms AC-01..AC-13, unit register + history, repair calls with SLA, monthly acceptance.
(() => {
  const { sb, $, esc, fmt, fmtDate, errText, opts } = RS;
  const MANAGER = ["owner", "admin", "chief_engineer", "supervisor"];
  const TABS = ["work", "units", "calls", "month", "setup"];
  const TH_M = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
  const KINDS = ["Fan Coil Unit (FCU)", "Air Handling Unit (AHU)", "Pre-cool AHU", "Outside Air Unit (OAU)", "Condensing Unit (CDU)", "Split Type / Wall type",
    "Split Big Size / Ceiling / Cassette", "VRF (Indoor)", "Split Type อาคารหอพัก", "พัดลมขนาดเล็ก (Exhaust/Ventilation/Fresh Air)", "พัดลมขนาดใหญ่ / Duct type", "Pressurized Fan / SPF", "Curtain Air Fan (ม่านอากาศ)"];
  const FORMS = { "AC-01": "แบบตรวจบำรุงรักษา FCU", "AC-02": "แบบตรวจบำรุงรักษา AHU / Pre-cool AHU", "AC-03": "แบบตรวจบำรุงรักษา OAU / CDU", "AC-04": "แบบตรวจ Split / Ceiling / Cassette / VRF",
    "AC-05": "บันทึกล้างพัดลมขนาดเล็ก (20 เครื่อง/แผ่น)", "AC-06": "แบบตรวจพัดลมขนาดใหญ่ / Pressurized Fan", "AC-07": "แบบวัดประสิทธิภาพ + คุณภาพอากาศ (IAQ/ACH/EER)",
    "AC-08": "แผนงานรายวัน + ขออนุญาตเข้าพื้นที่", "AC-11": "ใบเบิกอะไหล่ / สารทำความเย็น / วัสดุ", "AC-13": "บันทึกการฝึกอบรม" };
  const ST = { draft: "ร่าง", returned: "ตีกลับ", submitted: "ส่งแล้ว รอตรวจรับ", accepted: "ตรวจรับแล้ว" };
  const WK = { minor: "ล้างย่อย", major: "ล้างใหญ่" };

  // checklists copied from the acceptance workbook. third value: need in a minor round + in a major round (R must, O if present, N not done)
  const PRE = [["ตรวจสภาพกายภาพและการทำงานของเครื่องก่อนล้าง บันทึกผล", "6.1.2", "RR"], ["พบชำรุดก่อนเริ่มงาน — แจ้งผู้ว่าจ้างแล้ว (ระบุในหมายเหตุ)", "6.1.2", "RR"],
    ["ป้องกันพื้นที่ (Protection) คลุมพื้น/เฟอร์นิเจอร์/อุปกรณ์การแพทย์ + ถ่ายภาพก่อน", "6.1.3", "RR"], ["พื้นที่ผู้ป่วย/IC: ประสานหน่วยงานและปฏิบัติตามข้อกำหนดควบคุมการติดเชื้อ", "6.1.4", "OO"]];
  const POST = [["ทดสอบการทำงานหลังล้าง เครื่องทำงานปกติ", "6.5.1", "RR"], ["ทำความสะอาดรอบ RAG/SAG/Grille รัศมี ≥ 30 ซม. + ช่องเซอร์วิส ไม่มีคราบ/รา/สีหลุดร่อน", "6.2.5", "RR"],
    ["เก็บกวาดพื้นที่ เก็บอุปกรณ์ ถ่ายภาพหลังเสร็จ", "6.5.2", "RR"], ["ไม่มีความเสียหายต่อฝ้า/พื้น/ทรัพย์สิน (ถ้ามี บันทึก AC-10)", "9.1", "RR"]];
  const A = "ก. ก่อนเริ่มงาน (TOR 6.1)", E = "จ. หลังเสร็จงาน (TOR 6.2.5, 6.5, 9)";
  const FLOW = ["ความเร็ว/ปริมาณลมด้าน Return", "m/s, CFM", "pct"], SUP = ["อุณหภูมิลมส่ง (Supply Air)", "°C"], RET = ["อุณหภูมิลมกลับ (Return Air)", "°C"], DT = ["ผลต่างอุณหภูมิ ΔT (ลมกลับ − ลมส่ง)", "°C", "dt"];
  const CHECK = {
    "AC-01": { tor: "6.1, 6.2.1, 6.3.1, 6.5, 7.1", sec: [[A, PRE], ["ข. งานบำรุงรักษา FCU (TOR 6.2.1 ล้างย่อย / 6.3.1 ล้างใหญ่)", [
      ["ตรวจรีโมท / แผงควบคุมอุณหภูมิ (Thermostat) แสดงผลและทำงานปกติ", "6.2.1", "RR"], ["ตรวจมอเตอร์พัดลมและวาล์วควบคุมน้ำเย็น", "6.2.1", "RR"], ["ล้างแผ่นกรองอากาศ (Air Filter)", "6.2.1", "RR"],
      ["เช็ดทำความสะอาดช่องลมกลับ (RAG) / ช่องจ่ายลม (SAG)", "6.2.1", "RR"], ["ดูดท่อน้ำทิ้ง / ล้างปั๊มน้ำทิ้ง (Pump Shoot)", "6.2.5", "OR"], ["ฉีดล้างแผงคอยล์เย็น (Evaporator Coil) ด้วยปั๊มน้ำแรงดันสูง", "6.3.1", "NR"],
      ["เช็ดทำความสะอาดตัวเครื่อง ล้างถาดน้ำทิ้งและท่อน้ำทิ้ง", "6.3.1", "NR"], ["ตรวจสภาพฉนวนท่อน้ำเย็นหลังวาล์วถึงเครื่อง", "6.3.1", "NR"], ["เปิดล้าง Y-Strainer", "6.3.1", "NR"], ["ล้างพัดลมดูดอากาศในห้อง (เฉพาะห้องผู้ป่วย)", "6.3.4", "NO"]]], [E, POST]],
      meas: [FLOW, SUP, RET, DT, ["อุณหภูมิห้อง (Room Temp)", "°C"], ["กระแสมอเตอร์พัดลม", "A"]] },
    "AC-02": { tor: "6.1, 6.2.2, 6.3.2, 6.3.6, 6.5, 7.1", sec: [[A, PRE], ["ข. งานบำรุงรักษา AHU / Pre-cool AHU (TOR 6.2.2 / 6.3.2)", [
      ["ล้างแผ่นกรองอากาศ (Air Filter)", "6.2.2", "RR"], ["เช็ด RAG / SAG ทุกหัวจ่ายที่ AHU ตัวนี้จ่ายลมให้", "6.2.2", "RR"], ["ตรวจสภาพและความตึงสายพาน", "6.2.2", "RR"],
      ["ตรวจสภาพทั่วไป ฝุ่นสะสม เชื้อรา คราบสกปรก จุดรั่วซึมท่อ/คอยล์ ฟังเสียงพัดลม", "6.3.2", "NR"], ["ล้างคอยล์เย็น (Cooling Coil) / คอยล์ Pre-cool", "6.3.2", "NR"], ["ทำความสะอาดพัดลมและมอเตอร์ ตรวจเสียงผิดปกติ", "6.3.2", "NR"],
      ["อัดจาระบีลูกปืนพัดลม / ปรับตั้งสายพาน (สึกหรอ → แจ้งเปลี่ยน)", "6.3.2", "NR"], ["ล้างถาดน้ำทิ้งและท่อระบายน้ำ ทดสอบการไหล", "6.3.2", "NR"], ["ตรวจ Fresh Air / Return Air Damper เปิด-ปิดปกติ", "6.3.2", "NR"],
      ["ตรวจเซ็นเซอร์อุณหภูมิ-ความชื้น และทดสอบระบบควบคุม", "6.3.2", "NR"], ["ตรวจ/ทำความสะอาดท่อลม (Duct) ถ้ามี", "6.3.2", "NO"], ["ตรวจระบบน้ำเย็น วาล์ว ฉนวน และล้าง Strainer", "6.3.2", "NR"],
      ["ตรวจโครงสร้าง Chamber รอบเครื่อง / เก็บขยะบนฝ้า / ล้างทะลวงท่อเมนน้ำทิ้ง", "6.3.6", "NO"]]], [E, POST]],
      meas: [FLOW, SUP, RET, DT, ["ความชื้นสัมพัทธ์ลมส่ง", "%RH"], ["กระแสมอเตอร์ (เฉลี่ย 3 เฟส)", "A"], ["แรงดันไฟฟ้า", "V"]] },
    "AC-03": { tor: "6.1, 6.2.3, 6.3.3, 6.3.5, 6.5", sec: [[A, PRE], ["ข. งานบำรุงรักษา OAU / CDU (TOR 6.2.3 / 6.3.3 / 6.3.5)", [
      ["OAU: ล้าง Filter และเช็ด RAG / SAG", "6.2.3", "RR"], ["CDU: ฉีดล้างแผง Condensing Unit", "6.2.3", "RR"], ["ล้างตัวเครื่องและแผงคอยล์ร้อน (Condenser Coil) ด้วยปั๊มน้ำแรงดันสูง", "6.3.3", "NR"],
      ["OAU: ล้างคอยล์ ทำความสะอาดพัดลม-มอเตอร์ ถาดและท่อน้ำทิ้ง", "6.3.3", "NR"], ["ตรวจมอเตอร์พัดลม (Fan Motor) และคาปาซิเตอร์ (Capacitor)", "6.3.3", "NR"], ["ตรวจคอมเพรสเซอร์ (Compressor) และแมกเนติกคอนแทคเตอร์", "6.3.3", "NR"],
      ["ตรวจสายไฟและขั้วต่อ (Wiring Terminal) ขันแน่น ไม่มีรอยไหม้", "6.3.3", "NR"], ["OAU: ตรวจ Fresh Air Damper / เซ็นเซอร์ / ระบบควบคุม", "6.3.3", "NR"], ["ตรวจเสียงและการสั่นสะเทือนผิดปกติ", "6.3.3", "NR"],
      ["ตรวจสภาพท่อน้ำยาและฉนวน (Piping & Insulator)", "6.3.5", "NR"]]], [E, POST]],
      meas: [["แรงดันไฟฟ้า", "V"], ["กระแสคอมเพรสเซอร์", "A"], ["กระแสมอเตอร์พัดลม", "A"], ["แรงดัน Discharge — วัดเมื่อไม่เย็น/มีปัญหาเท่านั้น", "psi"], ["แรงดัน Suction — วัดเมื่อไม่เย็น/มีปัญหาเท่านั้น", "psi"], ["ปริมาณลม (OAU)", "m/s, CFM", "pct"], ["อุณหภูมิลมส่ง (OAU)", "°C"]] },
    "AC-04": { tor: "6.1, 6.2.4, 6.3.4, 6.3.5, 6.5, 7.1", sec: [[A, PRE], ["ข. งานบำรุงรักษา Split / Ceiling / Cassette / VRF (TOR 6.2.4 / 6.3.4 / 6.3.5)", [
      ["ล้างแผ่นกรองอากาศ (Air Filter)", "6.2.4", "RR"], ["เช็ดทำความสะอาดชุดคอยล์เย็น (Indoor)", "6.2.4", "RR"], ["ฉีดล้างแผง Condensing Unit", "6.2.4", "RR"], ["ใช้น้ำยาล้างแผงคอยล์เย็น/ร้อน · ดูดท่อน้ำทิ้ง", "6.2.5", "OO"],
      ["ล้างคอยล์เย็น พัดลม/โบลเวอร์ ถาดและท่อน้ำทิ้ง / ปั๊มน้ำทิ้ง", "6.3.4", "NR"], ["ล้างคอยล์ร้อน ตรวจพัดลมและมอเตอร์ชุดคอยล์ร้อน", "6.3.4", "NR"],
      ["เครื่องไม่เย็น/มีปัญหาเท่านั้น: วัดแรงดันน้ำยา — ต่ำกว่าเกณฑ์ เบิกน้ำยาเติม (AC-11)", "6.3.5", "OO"], ["ตรวจสภาพท่อน้ำยาและฉนวน", "6.3.5", "NR"], ["ประกอบกลับ ทดสอบทำความเย็นเต็มประสิทธิภาพ", "6.3.4", "NR"], ["ล้างพัดลมดูดอากาศ (เฉพาะห้องผู้ป่วย)", "6.3.4", "NO"]]], [E, POST]],
      meas: [["แรงดันไฟฟ้า", "V"], ["กระแสไฟฟ้ารวม", "A"], ["แรงดันน้ำยา Suction — วัดเมื่อไม่เย็น/มีปัญหาเท่านั้น", "psi"], SUP, RET, DT, ["อุณหภูมิห้อง", "°C"]] },
    "AC-06": { tor: "6.1, 6.4.2, 6.4.3, 6.5", sec: [[A, PRE.slice(0, 3)], ["ข. งานบำรุงรักษาพัดลมขนาดใหญ่ / Pressurized Fan (TOR 6.4.2 / 6.4.3)", [
      ["เป่าลมและเช็ดทำความสะอาดใบพัดและตัวมอเตอร์", "6.4.2", "RR"], ["ตั้งสายพาน / ตรวจสึกหรอ", "6.4.2", "RR"], ["อัดจาระบีลูกปืน / แบริ่ง", "6.4.2", "RR"], ["ตรวจสายไฟและขั้วต่อ ไม่มีรอยไหม้หรือเสื่อมสภาพ", "6.4.3", "RR"],
      ["Pressurized: ล้างตัวกรองอากาศ ทำความสะอาดท่อลม", "6.4.3", "OO"], ["Pressurized: ตรวจ Damper เปิด-ปิด และ Pressure Sensor", "6.4.3", "OO"], ["ทดสอบการทำงาน ฟังเสียง ตรวจการสั่นสะเทือน", "6.4.2", "RR"]]], [E, POST.slice(2)]],
      meas: [["แรงดันไฟฟ้า", "V"], ["กระแสมอเตอร์", "A"], ["แรงดันลม (Pressurized Fan)", "Pa"], ["ความเร็ว/ปริมาณลม", "m/s, CFM", "pct"]] }
  };
  const IAQ = [["ปริมาณลมจ่ายรวม (Supply Air)", "CFM", ""], ["ปริมาณลมเติม (Fresh Air) / ลมดูดออก (Exhaust)", "CFM", ""], ["อัตราการเปลี่ยนอากาศ ACH = CFM × 1.699 ÷ ปริมาตร", "ครั้ง/ชม.", "≥", "ach"],
    ["อุณหภูมิห้อง", "°C", "≤"], ["ความชื้นสัมพัทธ์", "%RH", "≤"], ["ฝุ่น PM2.5", "µg/m³", "≤"], ["ก๊าซคาร์บอนไดออกไซด์ (CO2)", "ppm", "≤"], ["ระดับเสียง", "dB(A)", "≤"],
    ["ขีดความสามารถทำความเย็น (วัด/คำนวณ)", "BTU/h", ""], ["กำลังไฟฟ้าที่ใช้", "W", ""], ["EER = BTU/h ÷ W", "BTU/W·h", "≥", "eer"]];
  const HDR = {
    chk: [["t1", "เวลาเริ่ม", "time"], ["t2", "เวลาเสร็จ", "time"], ["round", "รอบที่ / ปี"]],
    "AC-05": [["where", "อาคาร / ชั้น"], ["team", "ทีม / หัวหน้าช่างเทคนิค"], ["round", "รอบที่ / ปี"]],
    "AC-07": [["where", "อาคาร / ชั้น / ห้อง"], ["area", "ประเภทพื้นที่"], ["d2", "วันที่วัด (หลัง)", "date"], ["by", "ผู้วัด"], ["w", "กว้าง (ม.)", "number"], ["l", "ยาว (ม.)", "number"], ["h", "สูง (ม.)", "number"]],
    "AC-08": [["shift", "ช่วงเวลา (วัน/คืน)"], ["lead", "หัวหน้าช่างเทคนิค"], ["tel", "เบอร์ติดต่อ"], ["n", "จำนวนช่าง (คน)", "number"], ["sent", "วันที่ส่งแผน", "date"], ["done", "ผลหลังปฏิบัติงาน: ทำจริง (เครื่อง)", "number"]],
    "AC-11": [["who", "ผู้เบิก (ผู้รับจ้าง)"]],
    "AC-13": [["topic", "หัวข้อการอบรม"], ["round", "ครั้งที่ / ปี"], ["time", "เวลา"], ["place", "สถานที่"], ["trainer", "วิทยากร"], ["tpos", "ตำแหน่ง / หน่วยงานวิทยากร"], ["other", "เนื้อหาอื่น ๆ"], ["score", "ผลประเมินความพึงพอใจ (เต็ม 5)", "number"]]
  };
  const ROWS = {
    "AC-05": [["code", "รหัสเครื่อง / ตำแหน่ง", "unit"], ["kind", "ประเภท", [KINDS[9], KINDS[12]]], ["clean", "ล้างหน้ากาก ใบพัด มอเตอร์", "ck"], ["oil", "หยอดน้ำมันหล่อลื่น", "ck"], ["amp", "กระแส (A)", "num"], ["sound", "เสียง Motor Blower", ["ปกติ", "ผิดปกติ"]], ["ok", "ทำงานปกติ", ["✓", "✗"]], ["note", "หมายเหตุ"]],
    "AC-07": [["code", "รหัสเครื่อง", "unit"], ["b", "ลมก่อน (CFM)", "num"], ["a", "ลมหลัง (CFM)", "num"], ["note", "หมายเหตุ"]],
    "AC-08": [["time", "เวลา"], ["where", "อาคาร / ชั้น"], ["room", "ห้อง / พื้นที่"], ["kind", "ประเภทอุปกรณ์", KINDS], ["n", "จำนวน (เครื่อง)", "num"], ["work", "ประเภทงาน", ["ล้างย่อย", "ล้างใหญ่", "ซ่อม", "วัดค่า"]], ["ic", "พื้นที่ผู้ป่วย / IC", ["ไม่ใช่", "ใช่"]], ["prot", "Protection + ภาพก่อน", "ck"], ["permit", "ผู้อนุญาต (หน่วยงาน)"], ["note", "หมายเหตุ"]],
    "AC-11": [["item", "รายการ / รายละเอียด"], ["type", "ประเภท", ["อะไหล่", "สารทำความเย็น", "วัสดุ"]], ["unit", "หน่วย"], ["qty", "จำนวน", "num"], ["rq", "เลขที่แจ้งซ่อม"], ["use", "ใช้กับเครื่อง / สถานที่"], ["note", "หมายเหตุ"]],
    "AC-13": [["name", "ชื่อ - สกุล"], ["dept", "หน่วยงาน"], ["note", "หมายเหตุ"]]
  };
  const ROWMAX = { "AC-05": 20, "AC-07": 10, "AC-08": 15, "AC-11": 16, "AC-13": 40 };
  const CHECKS = {
    "AC-08": ["สวมอุปกรณ์ป้องกันอันตรายส่วนบุคคล (PPE)", "กั้นพื้นที่และติดป้ายเตือน", "ตัดไฟและติดป้ายห้ามสับ (Lock-out / Tag-out)", "บันได / นั่งร้านมั่นคง", "กำหนดจุดระบายน้ำจากการล้าง", "แต่งเครื่องแบบและติดบัตรประจำตัว"],
    "AC-13": ["การใช้งานระบบปรับอากาศและระบายอากาศ", "การดูแลรักษาเบื้องต้น (ล้าง Filter, สังเกตอาการผิดปกติ)", "แนวทางปฏิบัติเมื่อเกิดเหตุขัดข้อง / ช่องทางแจ้งซ่อม"]
  };
  const SL5 = [["tech", "ช่างเทคนิค"], ["lead", "หัวหน้าช่างเทคนิค"], ["building", "ช่างอาคาร"], ["owner", "เจ้าของพื้นที่"], ["eng", "เจ้าหน้าที่แผนกวิศวกรรม"]];
  const SLOTS = { "AC-08": [["lead", "หัวหน้าช่างเทคนิค (ผู้รับจ้าง)"], ["owner", "เจ้าของพื้นที่ / หัวหน้าหน่วยงาน"], ["eng", "เจ้าหน้าที่แผนกวิศวกรรม"]],
    "AC-11": [["lead", "ผู้เบิก (ผู้รับจ้าง)"], ["eng", "ผู้อนุมัติ (ส่วนวิศวกรรม)"], ["building", "ผู้จ่าย (คลัง/วิศวกรรม)"]],
    "AC-13": [["owner", "วิทยากร"], ["lead", "ผู้จัด (ผู้รับจ้าง)"], ["eng", "ผู้รับรอง (โรงพยาบาล)"]] };
  const DOCS = [["รายงานรายเครื่อง AC-01 – AC-06 ครบตามจำนวนที่ทำจริง เรียงชั้น/เลขเครื่อง", "10.4"], ["ภาพถ่ายก่อน-ระหว่าง-หลัง แยกตามห้อง/พื้นที่", "10.5"], ["อัปเดตทะเบียนอิเล็กทรอนิกส์ / QR Code", "10.6"],
    ["แผนล้างเดือนถัดไป (ส่งล่วงหน้า ≥ 1 เดือน)", "10.2"], ["AC-08 แผนรายวัน / ใบอนุญาตเข้าพื้นที่ ครบทุกวันทำงาน", "6.1.1"], ["AC-09 ทะเบียนแจ้งซ่อม และ AC-10 ทะเบียนความเสียหาย (ถ้ามี)", "8.5, 9"],
    ["AC-11 ใบเบิกอะไหล่ / สารทำความเย็น (ถ้ามี)", "5.3.2"], ["AC-07 รายงานวัดประสิทธิภาพ / IAQ (เดือนที่ครบรอบล้างใหญ่)", "7.3"], ["AC-13 บันทึกการฝึกอบรม (เดือนที่จัดอบรม)", "11"],
    ["บันทึกประวัติเครื่องครบทุกงานของเดือน + ส่งไฟล์ข้อมูล (Excel/CSV)", "10.10, 10.12"], ["ทดสอบเรียกดูประวัติย้อนหลัง สุ่ม 1 เครื่อง — ได้ภายในเวลาที่กำหนด", "10.13"]];
  const UF = [["code", "รหัสเครื่อง / QR *"], ["kind", "ประเภทอุปกรณ์ *", KINDS], ["building", "อาคาร"], ["floor", "ชั้น"], ["room", "ห้อง / พื้นที่"], ["area_type", "ประเภทพื้นที่"], ["brand", "ยี่ห้อ"], ["model", "รุ่น"],
    ["capacity", "ขนาด (BTU/h หรือ CFM)"], ["refrigerant", "สารทำความเย็น"], ["install_year", "ปีที่ติดตั้ง (ค.ศ.)", "number"], ["condition", "ผลประเมินสภาพ", ["", "ดี", "พอใช้", "ควรปรับปรุง", "ควรเปลี่ยน"]], ["note", "หมายเหตุ"]];

  let me = null, H = null, side = null, units = [], contract = null, list = [], cur = null, tickets = [], damages = [], month = null, sum = null, plan = [], drawing = false;
  const store = { get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
  const isMgr = () => me && MANAGER.includes(me.role);
  const day = d => new Date(d).toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
  const today = () => day(Date.now());
  const nowLocal = () => new Date(Date.now() + 7 * 36e5).toISOString().slice(0, 16);
  const iso = v => v ? v + ":00+07:00" : null;
  const num = v => v === "" || v == null || isNaN(+v) ? null : +v;
  const money = v => (+v || 0).toLocaleString("th-TH", { maximumFractionDigits: 2 });
  const unitOf = id => units.find(u => u.id === id);
  const unitByCode = c => units.find(u => u.code.toUpperCase() === String(c || "").trim().toUpperCase());
  const where = u => u ? [u.building, u.floor && "ชั้น " + u.floor, u.room].filter(Boolean).join(" · ") : "";
  const hrs = (a, b) => (new Date(b || Date.now()) - new Date(a)) / 36e5;
  const penDays = (a, b, lim) => Math.max(0, Math.ceil((hrs(a, b) - lim) / 24));
  const penAmt = d => d * (+contract?.value || 0) * (+(contract?.penalty_rate ?? 0.001));
  const stPill = s => `<span class="st ${s}">${ST[s] || s}</span>`;
  function toast(m) { $("#toast").textContent = m; $("#toast").hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => $("#toast").hidden = true, 6000); }
  // every list export is a real .xlsx with an executive-summary sheet first (assets/office.js)
  const csv = (name, head, rows, opts) => Office.table(name, head, rows, { org: H && H.name, ...opts });
  const field = (id, label, type, val, ro) => Array.isArray(type)
    ? `<label>${esc(label)}<select data-k="${id}" ${ro ? "disabled" : ""}>${type.map(o => `<option ${o === (val ?? "") ? "selected" : ""}>${esc(o)}</option>`).join("")}</select></label>`
    : `<label>${esc(label)}<input data-k="${id}" type="${type || "text"}" ${type === "number" ? 'step="any"' : ""} value="${esc(val ?? "")}" ${ro ? "disabled" : ""}></label>`;
  const flat = form => { let n = 0; return CHECK[form].sec.flatMap(([title, items]) => items.map(([text, tor, need]) => ({ no: ++n, sec: title, text, tor, need }))); };
  const needOf = (it, kind) => it.need[kind === "major" ? 1 : 0];

  /* ---------- boot ---------- */
  const q0 = new URLSearchParams(location.search);
  sb.auth.onAuthStateChange((_e, session) => setTimeout(() => boot(session), 0));
  async function boot(session) {
    if (!session) { $("#gate").hidden = false; return; }
    const { data } = await sb.from("profiles").select("id,full_name,role,hospital_id,hospitals(id,code,name)").eq("id", session.user.id).maybeSingle();
    me = data;
    if (!me || !me.hospital_id) { $("#gate").hidden = false; return; }
    H = me.hospitals; $("#gate").hidden = true;
    const [s, c] = await Promise.all([sb.rpc("ac_side"), sb.from("ac_contracts").select("*").eq("hospital_id", H.id).maybeSingle()]);
    side = s.data || null; contract = c.data || null;
    $("#title").textContent = "งานผู้รับเหมาแอร์ · " + H.name;
    $("#who").textContent = (me.full_name || session.user.email) + (side === "lead" ? " (หัวหน้าช่างผู้รับเหมา)" : side === "tech" ? " (ช่างผู้รับเหมา)" : side ? "" : " (ดูอย่างเดียว)");
    document.querySelectorAll("[data-write]").forEach(b => b.hidden = !side);
    document.querySelectorAll("[data-manager]").forEach(b => b.hidden = !isMgr());
    document.querySelectorAll("[data-plan]").forEach(b => b.hidden = !(isMgr() || side === "lead"));
    opts($("#wForm"), [["", "ทุกแบบฟอร์ม"], ...Object.entries(FORMS).map(([k, v]) => [k, k + " · " + v])]);
    opts($("#wNew"), [["", "+ เลือกแบบฟอร์มที่จะสร้าง"], ...Object.entries(FORMS).map(([k, v]) => [k, k + " · " + v])]);
    opts($("#uKind"), [["", "ทุกประเภท"], ...KINDS.map(k => [k, k])]);
    $("#uForm").innerHTML = UF.map(([k, l, t]) => field(k, l, t, "")).join("");
    $("#wMonth").value = $("#mMonth").value = today().slice(0, 7); $("#pYear").value = today().slice(0, 4);
    await loadUnits();
    $("#tabs").hidden = false;
    if (q0.get("u")) { show("units"); return openUnit(q0.get("u")); }
    show(q0.get("tab") || store.get("rs-ac-tab", "work"));
  }
  async function loadUnits() {
    const r = await sb.from("ac_units").select("*").eq("hospital_id", H.id).eq("active", true).order("code").limit(5000);
    units = r.data || [];
    $("#unitCodes").innerHTML = units.map(u => `<option value="${esc(u.code)}">${esc(u.kind + " " + where(u))}</option>`).join("");
  }
  document.querySelectorAll("#tabs button").forEach(b => b.onclick = () => show(b.dataset.tab));
  function show(t) {
    if (!TABS.includes(t)) t = "work";
    document.querySelectorAll("#tabs button").forEach(b => b.setAttribute("aria-selected", b.dataset.tab === t));
    TABS.forEach(x => $("#tab-" + x).hidden = x !== t);
    store.set("rs-ac-tab", t);
    ({ work: renderWork, units: renderUnits, calls: renderCalls, month: renderMonth, setup: renderSetup })[t]();
  }

  /* ---------- work forms ---------- */
  async function renderWork() {
    $("#wHint").textContent = side === "hospital" ? "ฝั่งโรงพยาบาล: เปิดแบบฟอร์มที่ “ส่งแล้ว รอตรวจรับ” เพื่อลงนามตรวจรับ หรือตีกลับพร้อมเหตุผล"
      : side ? "ผู้รับเหมา: กรอกแบบฟอร์ม 1 ใบต่อ 1 เครื่องต่อครั้ง ถ่ายภาพก่อน-ระหว่าง-หลัง แล้วให้หัวหน้าช่างลงนามเพื่อส่งให้โรงพยาบาล" : "บัญชีนี้ดูได้อย่างเดียว";
    const m = $("#wMonth").value || today().slice(0, 7), [y, mo] = m.split("-").map(Number), end = day(Date.UTC(y, mo, 1, 5));
    let q = sb.from("ac_forms").select("*").eq("hospital_id", H.id).gte("work_date", m + "-01").lt("work_date", end).order("work_date", { ascending: false }).order("doc_no", { ascending: false }).limit(1000);
    if ($("#wForm").value) q = q.eq("form", $("#wForm").value);
    if ($("#wStatus").value) q = q.eq("status", $("#wStatus").value);
    const [r, n] = await Promise.all([q, sb.from("ac_forms").select("id", { count: "exact", head: true }).eq("hospital_id", H.id).eq("status", side === "hospital" ? "submitted" : "returned")]);
    list = r.data || [];
    $("#nWork").hidden = !n.count; $("#nWork").textContent = n.count || "";
    $("#wList").innerHTML = `<tr><th>เลขที่</th><th>วันที่</th><th>แบบฟอร์ม</th><th>เครื่อง / พื้นที่</th><th>งาน</th><th>สถานะ</th><th>ลงนาม</th></tr>` + (list.map(f => {
      const u = unitOf(f.unit_id);
      return `<tr data-open="${f.id}" style="cursor:pointer"><td class="mono">${esc(f.doc_no)}</td><td>${fmtDate(f.work_date)}</td><td>${f.form}</td><td>${esc(u ? u.code + " · " + where(u) : f.data?.h?.where || f.data?.h?.topic || "-")}</td>
        <td>${WK[f.work_kind] || "-"}</td><td>${stPill(f.status)}</td><td>${Object.keys(f.signs || {}).length}/${(SLOTS[f.form] || SL5).length}</td></tr>`;
    }).join("") || `<tr><td colspan="7" class="empty">ยังไม่มีแบบฟอร์มในเดือนนี้</td></tr>`);
  }
  ["wMonth", "wForm", "wStatus"].forEach(id => $("#" + id).onchange = renderWork);
  $("#wNew").onchange = e => { const form = e.target.value; e.target.value = ""; if (form) newForm(form); };
  function newForm(form, unit) {
    cur = { form, work_date: today(), unit_id: unit || null, work_kind: CHECK[form] || form === "AC-05" ? "minor" : null, data: {}, status: "draft", signs: {} };
    drawForm(); $("#wEdit").scrollIntoView({ behavior: "smooth" });
  }
  $("#wList").onclick = e => { const tr = e.target.closest("[data-open]"); if (tr) { cur = structuredClone(list.find(f => f.id === tr.dataset.open)); drawForm(); $("#wEdit").scrollIntoView({ behavior: "smooth" }); } };
  const editable = f => !!side && ["draft", "returned"].includes(f.status);

  function rowsTable(f, ro) {
    const cols = ROWS[f.form]; if (!cols) return "";
    const rows = f.data.rows || [], n = ro ? rows.length : Math.min(ROWMAX[f.form], Math.max(rows.length + 1, 5) + (f._extra || 0));
    const cell = (r, i, [k, , t]) => {
      const v = r[k] ?? "";
      if (ro) return esc(t === "ck" ? (v ? "✓" : "") : v);
      if (Array.isArray(t)) return `<select data-r="${i}" data-c="${k}"><option></option>${t.map(o => `<option ${o === v ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
      if (t === "ck") return `<input type="checkbox" data-r="${i}" data-c="${k}" ${v ? "checked" : ""} style="width:auto">`;
      return `<input data-r="${i}" data-c="${k}" ${t === "num" ? 'type="number" step="any"' : ""} ${t === "unit" ? 'list="unitCodes"' : ""} value="${esc(v)}">`;
    };
    return `<div class="scroll"><table class="rows"><tr><th>ที่</th>${cols.map(c => `<th>${esc(c[1])}</th>`).join("")}</tr>` +
      Array.from({ length: n }, (_, i) => `<tr><td>${i + 1}</td>${cols.map(c => `<td>${cell(rows[i] || {}, i, c)}</td>`).join("")}</tr>`).join("") + `</table></div>` +
      (ro || n >= ROWMAX[f.form] ? "" : `<button class="btn small" type="button" data-act="addrow">+ เพิ่มแถว</button>`);
  }
  function measTable(f, ro) {
    const def = CHECK[f.form]; if (!def) return "";
    const m = f.data.meas || {};
    return `<div class="sec">ค. ค่าที่ตรวจวัด (ล้างใหญ่ / วัดประสิทธิภาพ — TOR 6.3, 7.1)</div><div class="scroll"><table class="rows"><tr><th>รายการวัด</th><th>หน่วย</th><th>ก่อนล้าง</th><th>หลังล้าง</th><th>ผลต่าง</th></tr>` +
      def.meas.map(([label, unit, calc], i) => `<tr><td>${esc(label)}</td><td>${esc(unit)}</td>` + (calc === "dt"
        ? `<td data-dt="b${i}"></td><td data-dt="a${i}"></td><td></td>`
        : ["b", "a"].map(k => `<td>${ro ? esc(m[i]?.[k] ?? "") : `<input type="number" step="any" data-m="${i}" data-mk="${k}" value="${esc(m[i]?.[k] ?? "")}">`}</td>`).join("") + `<td ${calc === "pct" ? `data-pct="${i}"` : ""}></td>`) + `</tr>`).join("") + `</table></div>`;
  }
  function iaqTable(f, ro) {
    const q = f.data.q || {};
    return `<div class="sec">ข. ผลการตรวจวัด (ใส่เกณฑ์ตามมาตรฐานพื้นที่ที่โรงพยาบาลกำหนด ช่อง “ผล” คำนวณเอง)</div><div class="scroll"><table class="rows"><tr><th>รายการวัด</th><th>หน่วย</th><th>ก่อน</th><th>หลัง</th><th>เงื่อนไข</th><th>เกณฑ์</th><th>ผล (หลัง)</th></tr>` +
      IAQ.map(([label, unit, cond, calc], i) => `<tr><td>${esc(label)}</td><td>${esc(unit)}</td>` + (calc ? `<td data-q="b${i}"></td><td data-q="a${i}"></td>`
        : ["b", "a"].map(k => `<td>${ro ? esc(q[i]?.[k] ?? "") : `<input type="number" step="any" data-qi="${i}" data-qk="${k}" value="${esc(q[i]?.[k] ?? "")}">`}</td>`).join("")) +
        `<td>${ro ? esc(q[i]?.c || cond) : `<select data-qi="${i}" data-qk="c">${["", "≥", "≤"].map(o => `<option ${o === (q[i]?.c ?? cond) ? "selected" : ""}>${o}</option>`).join("")}</select>`}</td>
        <td>${ro ? esc(q[i]?.lim ?? "") : `<input type="number" step="any" data-qi="${i}" data-qk="lim" value="${esc(q[i]?.lim ?? "")}">`}</td><td data-qr="${i}"></td></tr>`).join("") +
      `</table></div><p class="sub">ปริมาตรห้อง <b id="fVol">-</b> ม³ · ACH ไม่ผ่านเกณฑ์ → ตรวจและแก้ไขระบบระบายอากาศ แล้ววัดซ้ำ (TOR 7.2)</p><div class="sec">ค. เครื่องปรับอากาศที่จ่ายลมให้พื้นที่นี้</div>`;
  }
  // numbers that the workbook calculates with formulas: ΔT, % change of air flow, ACH, EER, pass/fail
  function calc(d, form) {
    const out = { dt: {}, pct: {}, q: {}, qr: {}, vol: null }, m = d.meas || {}, f2 = v => v == null ? "" : (Math.round(v * 100) / 100).toString();
    (CHECK[form]?.meas || []).forEach(([, , c], i) => {
      if (c === "dt") ["b", "a"].forEach(k => { const s = num(m[i - 2]?.[k]), r = num(m[i - 1]?.[k]); out.dt[k + i] = s != null && r != null ? f2(r - s) : ""; });
      if (c === "pct") { const b = num(m[i]?.b), a = num(m[i]?.a); out.pct[i] = b && a != null ? (a >= b ? "+" : "") + f2((a - b) / b * 100) + "%" : ""; }
    });
    if (form === "AC-07") {
      const h = d.h || {}, q = d.q || {}, vol = (num(h.w) || 0) * (num(h.l) || 0) * (num(h.h) || 0); out.vol = vol || null;
      const val = (i, k) => IAQ[i][3] === "ach" ? (num(q[0]?.[k]) != null && vol > 0 ? num(q[0][k]) * 1.699 / vol : null) : IAQ[i][3] === "eer" ? (num(q[8]?.[k]) != null && num(q[9]?.[k]) > 0 ? num(q[8][k]) / num(q[9][k]) : null) : num(q[i]?.[k]);
      IAQ.forEach(([, , cond, c], i) => {
        if (c) { out.q["b" + i] = f2(val(i, "b")); out.q["a" + i] = f2(val(i, "a")); }
        const a = val(i, "a"), lim = num(q[i]?.lim), cc = q[i]?.c ?? cond;
        out.qr[i] = a == null || lim == null || !cc ? "" : (cc === "≥" ? a >= lim : a <= lim) ? "ผ่าน" : "ไม่ผ่าน";
      });
    }
    return out;
  }
  function recalc() {
    if (!cur) return; const box = $("#wEdit"); if (editable(cur)) collect();
    const c = calc(cur.data, cur.form);
    box.querySelectorAll("[data-dt]").forEach(td => td.textContent = c.dt[td.dataset.dt] ?? "");
    box.querySelectorAll("[data-pct]").forEach(td => td.textContent = c.pct[td.dataset.pct] ?? "");
    box.querySelectorAll("[data-q]").forEach(td => td.textContent = c.q[td.dataset.q] ?? "");
    box.querySelectorAll("[data-qr]").forEach(td => { td.textContent = c.qr[td.dataset.qr] ?? ""; td.style.color = td.textContent === "ไม่ผ่าน" ? "var(--bad)" : ""; });
    if ($("#fVol")) $("#fVol").textContent = c.vol ? Math.round(c.vol * 100) / 100 : "-";
  }
  async function drawForm() {
    const f = cur, ed = editable(f), ro = !ed, d = f.data, def = CHECK[f.form], u = unitOf(f.unit_id), hdr = def ? HDR.chk : HDR[f.form] || [];
    const kindSel = def && f.form !== "AC-06" ? `<label>ประเภทงาน<select id="fKind" ${ro ? "disabled" : ""}><option value="minor" ${f.work_kind === "minor" ? "selected" : ""}>ล้างย่อย</option><option value="major" ${f.work_kind === "major" ? "selected" : ""}>ล้างใหญ่</option></select></label>` : "";
    let body = "";
    if (def) {
      let sec = "";
      body = flat(f.form).filter(it => needOf(it, f.work_kind) !== "N").map(it => {
        const r = d.items?.[it.no] || {}, need = needOf(it, f.work_kind), head = it.sec !== sec ? `<div class="sec">${esc(sec = it.sec)}</div>` : "";
        return head + `<div class="it ${r.r === "bad" ? "bad" : ""}"><div>${it.no}. ${esc(it.text)} <small>(TOR ${it.tor}) ${need === "R" ? "● ต้องทำ" : "○ ถ้ามี"}</small></div>` + (ro
          ? `<div><b>${{ ok: "✓ ปกติ", bad: "✗ ผิดปกติ", na: "N/A" }[r.r] || "-"}</b></div><div class="v">${esc(r.v || "")}</div><div class="n">${esc(r.n || "")}</div>`
          : `<select data-i="${it.no}" data-ik="r"><option value="">ผล</option><option value="ok" ${r.r === "ok" ? "selected" : ""}>✓ ปกติ/ทำแล้ว</option><option value="bad" ${r.r === "bad" ? "selected" : ""}>✗ ผิดปกติ</option><option value="na" ${r.r === "na" ? "selected" : ""}>N/A ไม่มี</option></select>
             <input class="v" data-i="${it.no}" data-ik="v" placeholder="ค่าที่วัด" value="${esc(r.v || "")}"><input class="n" data-i="${it.no}" data-ik="n" placeholder="หมายเหตุ" value="${esc(r.n || "")}">`) + `</div>`;
      }).join("") + measTable(f, ro);
    } else if (f.form === "AC-07") body = iaqTable(f, ro);
    if (CHECKS[f.form]) body += `<div class="sec">${f.form === "AC-08" ? "ความปลอดภัยก่อนเริ่มงาน (TOR ข้อ 12)" : "เนื้อหาที่ครอบคลุม (TOR 11)"}</div>` +
      CHECKS[f.form].map((t, i) => `<label style="flex-direction:row;gap:8px;align-items:center"><input type="checkbox" data-ck="${i}" ${d.c?.[i] ? "checked" : ""} ${ro ? "disabled" : ""} style="width:auto"> ${esc(t)}</label>`).join("");
    body += rowsTable(f, ro);
    const photos = d.photos || [], urls = photos.length ? Object.fromEntries(((await sb.storage.from("docs").createSignedUrls(photos.map(p => p.p), 3600)).data || []).map(x => [x.path, x.signedUrl])) : {};
    if (cur !== f) return;
    const PS = [["before", "ก่อนทำงาน"], ["during", "ระหว่างทำงาน"], ["after", "หลังเสร็จงาน"]];
    const photoBox = def || f.form === "AC-05" ? `<div class="sec">หลักฐานภาพถ่าย (TOR 10.5)</div><div class="ph">${photos.map(p => `<figure>${urls[p.p] ? `<a href="${urls[p.p]}" target="_blank" rel="noopener"><img src="${urls[p.p]}" alt=""></a>` : ""}<figcaption>${PS.find(x => x[0] === p.s)?.[1] || ""}</figcaption></figure>`).join("") || `<span class="sub">ยังไม่มีภาพ</span>`}</div>` +
      (ed ? `<div class="hd">${PS.map(([k, l]) => `<label>เพิ่มภาพ${l}<input type="file" accept="image/*" multiple data-photo="${k}"></label>`).join("")}</div>` : "") : "";
    const slots = SLOTS[f.form] || SL5, canSign = s => side && f.status !== "accepted" && !f.signs[s] && ({ tech: side !== "hospital", lead: side === "lead", building: side === "hospital", eng: isMgr() && f.status === "submitted", owner: true })[s];
    const signs = `<div class="signs">` + slots.map(([s, label]) => { const g = f.signs[s];
      return `<div><b>${esc(label)}</b>` + (g ? `${esc(g.name)}<small>${fmt(g.at)}</small>` : canSign(s) ? (s === "owner" ? `<input id="fOwner" placeholder="พิมพ์ชื่อผู้ลงนาม">` : "") +
        `<button class="btn small ${s === "lead" || s === "eng" ? "primary" : ""}" type="button" data-sign="${s}">${s === "lead" ? "ลงนามและส่งให้ รพ." : s === "eng" ? "ลงนามตรวจรับ" : "ลงนาม"}</button>` : `<small>ยังไม่ลงนาม</small>`) + `</div>`; }).join("") + `</div>`;
    drawing = true; setTimeout(() => drawing = false, 0);   // replacing the form can fire a late "change" from the field that had focus
    $("#wEdit").innerHTML = `<div class="panel" style="margin-bottom:14px"><h3>${f.form} · ${esc(FORMS[f.form])} <span class="mono">${esc(f.doc_no || "(ใหม่)")}</span> ${stPill(f.status)}</h3>
      ${def ? `<p class="sub">อ้างอิง TOR ข้อ ${def.tor} · 1 ฉบับต่อเครื่องต่อครั้ง (ข้อ 10.4)</p>` : ""}
      ${f.status === "returned" ? `<div class="note bad">โรงพยาบาลตีกลับ: ${esc(f.return_note || "")}</div>` : ""}
      <div class="hd"><label>วันที่<input type="date" id="fDate" value="${f.work_date}" ${ro ? "disabled" : ""}></label>
        ${def ? `<label>รหัสเครื่อง / QR<input id="fUnit" list="unitCodes" value="${esc(u?.code || "")}" ${ro ? "disabled" : ""}></label>` : ""}${kindSel}
        ${hdr.map(([k, l, t]) => field("h." + k, l, t, d.h?.[k], ro)).join("")}</div>
      ${u ? `<p class="sub">${esc(u.kind)} · ${esc(where(u))} · ${esc([u.brand, u.model, u.capacity].filter(Boolean).join(" "))}</p>` : ""}
      ${body}
      <div class="sec">${f.form === "AC-07" ? "ง. ข้อเสนอแนะหลังบำรุงรักษา (TOR 7.3)" : def ? "ง. สิ่งผิดปกติที่พบ / ข้อเสนอแนะ / อะไหล่ที่ต้องเบิก (AC-11)" : "หมายเหตุ"}</div>
      <textarea id="fRemark" rows="2" style="width:100%" ${ro ? "disabled" : ""}>${esc(d.remark || "")}</textarea>
      ${photoBox}
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">${ed ? `<button class="btn primary" type="button" data-act="save">บันทึกร่าง</button>` : ""}
        ${f.id ? `<button class="btn" type="button" data-act="print">พิมพ์</button>` : ""}
        ${isMgr() && f.status === "submitted" ? `<input id="fBack" placeholder="เหตุผลที่ตีกลับ" style="flex:1;min-width:160px"><button class="btn" type="button" data-act="return">ตีกลับให้แก้</button>` : ""}
        <button class="btn" type="button" data-act="close">ปิด</button></div>
      ${f.id ? signs : `<p class="sub" style="margin-top:10px">บันทึกร่างก่อน จึงจะลงนามได้</p>`}</div>`;
    recalc();
  }
  function collect() {
    const box = $("#wEdit"), f = cur, d = f.data;
    if ($("#fDate")) f.work_date = $("#fDate").value;
    if ($("#fKind")) f.work_kind = $("#fKind").value;
    if ($("#fUnit")) f.unit_id = unitByCode($("#fUnit").value)?.id || null;
    d.h = d.h || {}; box.querySelectorAll("[data-k^='h.']").forEach(el => d.h[el.dataset.k.slice(2)] = el.value);
    box.querySelectorAll("[data-i]").forEach(el => { d.items = d.items || {}; (d.items[el.dataset.i] = d.items[el.dataset.i] || {})[el.dataset.ik] = el.value; });
    box.querySelectorAll("[data-m]").forEach(el => { d.meas = d.meas || {}; (d.meas[el.dataset.m] = d.meas[el.dataset.m] || {})[el.dataset.mk] = el.value; });
    box.querySelectorAll("[data-qi]").forEach(el => { d.q = d.q || {}; (d.q[el.dataset.qi] = d.q[el.dataset.qi] || {})[el.dataset.qk] = el.value; });
    box.querySelectorAll("[data-ck]").forEach(el => { d.c = d.c || {}; d.c[el.dataset.ck] = el.checked; });
    if (ROWS[f.form]) { const rows = []; box.querySelectorAll("[data-r]").forEach(el => { (rows[el.dataset.r] = rows[el.dataset.r] || {})[el.dataset.c] = el.type === "checkbox" ? el.checked : el.value; });
      d.rows = rows.filter(r => r && Object.values(r).some(v => v !== "" && v !== false)); }
    if ($("#fRemark")) d.remark = $("#fRemark").value.trim();
    if (CHECK[f.form]) d.measure_text = CHECK[f.form].meas.map(([l, un, c], i) => c !== "dt" && d.meas?.[i]?.a ? `${l.split(" — ")[0]} ${d.meas[i].a} ${un}` : "").filter(Boolean).join(" · ");
  }
  // what must be complete before the contractor's lead can send the form to the hospital
  function problems(f) {
    const d = f.data;
    if (CHECK[f.form]) {
      if (!f.unit_id) return "เลือกรหัสเครื่องจากทะเบียน";
      for (const it of flat(f.form)) { const need = needOf(it, f.work_kind), r = d.items?.[it.no] || {};
        if (need === "R" && !r.r) return `ข้อ ${it.no} ยังไม่ได้ใส่ผล`;
        if (r.r === "bad" && !(r.n || "").trim()) return `ข้อ ${it.no} ผิดปกติ ต้องใส่หมายเหตุ`; }
      const st = new Set((d.photos || []).map(p => p.s));
      if (!st.has("before") || !st.has("after")) return "ต้องมีภาพก่อนทำงานและหลังเสร็จงานอย่างน้อยอย่างละ 1 ภาพ (TOR 10.5)";
    } else if (ROWS[f.form] && !(d.rows || []).length) return "ยังไม่มีรายการในตาราง";
    if (f.form === "AC-05" && (d.rows || []).some(r => r.ok === "✗" && !(r.note || "").trim())) return "เครื่องที่ทำงานไม่ปกติ ต้องใส่หมายเหตุ";
    return "";
  }
  async function save() {
    collect(); const f = cur;
    const { data, error } = await sb.rpc("ac_form_save", { p_id: f.id || null, p_form: f.form, p_date: f.work_date || null, p_unit: f.unit_id, p_kind: f.work_kind, p_data: f.data });
    if (error) { toast(errText(error)); return false; }
    const r = await sb.from("ac_forms").select("*").eq("id", data).single();
    if (r.data) cur = r.data;
    return true;
  }
  $("#wEdit").addEventListener("input", e => { if (e.target.matches("[data-m],[data-qi],[data-k^='h.']")) recalc(); });
  $("#wEdit").addEventListener("change", async e => {
    const t = e.target; if (drawing) return;
    if (t.id === "fKind" || t.id === "fUnit") { collect(); return drawForm(); }
    if (t.dataset.ik === "r") t.closest(".it").classList.toggle("bad", t.value === "bad");
    if (t.dataset.photo && t.files.length) {
      collect(); t.disabled = true;
      try {
        for (const file of t.files) {
          if (file.size > 20 * 1024 * 1024) throw new Error("ไฟล์ใหญ่เกิน 20 MB");
          let blob = file, type = file.type || "image/jpeg";
          try { const img = await createImageBitmap(file), s = Math.min(1, 1600 / Math.max(img.width, img.height)), c = Object.assign(document.createElement("canvas"), { width: Math.round(img.width * s), height: Math.round(img.height * s) });
            c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); blob = await new Promise(r => c.toBlob(r, "image/jpeg", 0.82)); type = "image/jpeg"; } catch {}
          const path = `${H.code}/AC/${today()}/${t.dataset.photo}-${crypto.randomUUID()}.${type === "image/jpeg" ? "jpg" : (file.name.split(".").pop() || "jpg").toLowerCase()}`;
          const up = await sb.storage.from("docs").upload(path, blob, { contentType: type });
          if (up.error) throw up.error;
          (cur.data.photos = cur.data.photos || []).push({ s: t.dataset.photo, p: path });
        }
        if (await save()) toast("เพิ่มภาพและบันทึกร่างแล้ว");
      } catch (err) { toast(errText(err)); }
      drawForm();
    }
  });
  $("#wEdit").addEventListener("click", async e => {
    const b = e.target.closest("button"); if (!b || !cur) return;
    const act = b.dataset.act, slot = b.dataset.sign;
    if (act === "close") { cur = null; $("#wEdit").innerHTML = ""; return; }
    if (act === "addrow") { collect(); cur._extra = (cur._extra || 0) + 3; return drawForm(); }
    if (act === "print") return printDoc(formDoc(cur));
    b.disabled = true;
    if (act === "save") { if (await save()) { toast("บันทึกร่างแล้ว " + cur.doc_no); renderWork(); } return drawForm(); }
    if (act === "return") {
      const { error } = await sb.rpc("ac_form_return", { p_id: cur.id, p_note: $("#fBack").value });
      if (error) { b.disabled = false; return toast(errText(error)); }
      toast("ตีกลับแล้ว"); cur = null; $("#wEdit").innerHTML = ""; return renderWork();
    }
    if (slot) {
      const name = slot === "owner" ? $("#fOwner").value : null;
      if (editable(cur)) {
        collect();
        if (slot === "lead") { const p = problems(cur); if (p) { b.disabled = false; return toast("ยังส่งไม่ได้: " + p); } }
        if (!(await save())) { b.disabled = false; return; }
      }
      const { error } = await sb.rpc("ac_form_sign", { p_id: cur.id, p_slot: slot, p_name: name });
      if (error) { b.disabled = false; return toast(errText(error)); }
      const r = await sb.from("ac_forms").select("*").eq("id", cur.id).single(); cur = r.data;
      toast(slot === "lead" ? "ส่งให้โรงพยาบาลแล้ว" : slot === "eng" ? "ตรวจรับแล้ว" : "ลงนามแล้ว"); renderWork(); drawForm();
    }
  });

  /* ---------- printing ---------- */
  function printDoc(html) {
    $("#mDoc").innerHTML = html; document.body.classList.add("docprint");
    const done = () => { document.body.classList.remove("docprint"); window.removeEventListener("afterprint", done); };
    window.addEventListener("afterprint", done); window.print();
  }
  const signDoc = (slots, signs) => `<div class="signs">${slots.map(([s, l]) => `<div>${esc(signs?.[s]?.name || "")}<br>${signs?.[s] ? fmt(signs[s].at) : "&nbsp;"}<br><b>${esc(l)}</b></div>`).join("")}</div>`;
  function formDoc(f) {
    const d = f.data, def = CHECK[f.form], u = unitOf(f.unit_id), c = calc(d, f.form), hdr = def ? HDR.chk : HDR[f.form] || [];
    let h = `<div class="doc"><h2>${f.form} ${esc(FORMS[f.form])}</h2><p style="text-align:center;margin:0">${esc(H.name)} · เลขที่ ${esc(f.doc_no)} · ${ST[f.status]}${def ? " · อ้างอิง TOR ข้อ " + def.tor : ""}</p>
      <table><tr><th>วันที่</th><td>${fmtDate(f.work_date)}</td><th>ประเภทงาน</th><td>${WK[f.work_kind] || "-"}</td></tr>
      ${u ? `<tr><th>รหัสเครื่อง</th><td>${esc(u.code)}</td><th>ประเภท</th><td>${esc(u.kind)}</td></tr><tr><th>ตำแหน่ง</th><td>${esc(where(u))}</td><th>ยี่ห้อ / รุ่น / ขนาด</th><td>${esc([u.brand, u.model, u.capacity].filter(Boolean).join(" "))}</td></tr>` : ""}
      ${hdr.map(([k, l]) => `<tr><th>${esc(l)}</th><td colspan="3">${esc(d.h?.[k] ?? "")}</td></tr>`).join("")}</table>`;
    if (def) {
      h += `<table><tr><th>ที่</th><th>รายการตรวจ / งานที่ทำ</th><th>ข้อ TOR</th><th>ผล</th><th>ค่าที่วัด</th><th>หมายเหตุ</th></tr>` + flat(f.form).filter(it => needOf(it, f.work_kind) !== "N").map(it => { const r = d.items?.[it.no] || {};
        return `<tr><td>${it.no}</td><td>${esc(it.text)}</td><td>${it.tor}</td><td>${{ ok: "✓", bad: "✗", na: "N/A" }[r.r] || ""}</td><td>${esc(r.v || "")}</td><td>${esc(r.n || "")}</td></tr>`; }).join("") + `</table>
        <table><tr><th>รายการวัด</th><th>หน่วย</th><th>ก่อนล้าง</th><th>หลังล้าง</th><th>ผลต่าง</th></tr>` + def.meas.map(([l, un, k], i) =>
        `<tr><td>${esc(l)}</td><td>${esc(un)}</td><td>${esc(k === "dt" ? c.dt["b" + i] : d.meas?.[i]?.b ?? "")}</td><td>${esc(k === "dt" ? c.dt["a" + i] : d.meas?.[i]?.a ?? "")}</td><td>${esc(c.pct[i] || "")}</td></tr>`).join("") + `</table>`;
    }
    if (f.form === "AC-07") h += `<p>ปริมาตรห้อง ${c.vol ? Math.round(c.vol * 100) / 100 : "-"} ม³</p><table><tr><th>รายการวัด</th><th>หน่วย</th><th>ก่อน</th><th>หลัง</th><th>เกณฑ์</th><th>ผล</th></tr>` + IAQ.map(([l, un, cond, k], i) =>
      `<tr><td>${esc(l)}</td><td>${esc(un)}</td><td>${esc(k ? c.q["b" + i] : d.q?.[i]?.b ?? "")}</td><td>${esc(k ? c.q["a" + i] : d.q?.[i]?.a ?? "")}</td><td>${esc((d.q?.[i]?.c ?? cond) + " " + (d.q?.[i]?.lim ?? ""))}</td><td>${c.qr[i] || ""}</td></tr>`).join("") + `</table>`;
    if (CHECKS[f.form]) h += `<p>${CHECKS[f.form].map((t, i) => (d.c?.[i] ? "☑ " : "☐ ") + esc(t)).join(" &nbsp; ")}</p>`;
    if (ROWS[f.form]) h += rowsTable(f, true).replace(/<\/?div[^>]*>/g, "");
    h += `<p><b>หมายเหตุ / สิ่งผิดปกติ / ข้อเสนอแนะ:</b> ${esc(d.remark || "-")}</p>${def ? `<p>ภาพถ่าย: ก่อน ${(d.photos || []).filter(p => p.s === "before").length} · ระหว่าง ${(d.photos || []).filter(p => p.s === "during").length} · หลัง ${(d.photos || []).filter(p => p.s === "after").length} ภาพ (เก็บในระบบ)</p>` : ""}`;
    return h + signDoc(SLOTS[f.form] || SL5, f.signs) + `</div>`;
  }

  /* ---------- units + history ---------- */
  const uFiltered = () => { const q = $("#uQ").value.trim().toLowerCase(), k = $("#uKind").value;
    return units.filter(u => (!k || u.kind === k) && (!q || [u.code, u.room, u.brand, u.model, u.building].some(v => String(v || "").toLowerCase().includes(q)))); };
  function renderUnits() {
    $("#uView").innerHTML = ""; $("#uMain").hidden = false; $("#uQr").innerHTML = "";
    const l = uFiltered();
    $("#uList").innerHTML = `<tr><th>รหัสเครื่อง</th><th>ประเภท</th><th>ตำแหน่ง</th><th>ยี่ห้อ / รุ่น</th><th>ขนาด</th><th>อายุ (ปี)</th><th>สภาพ</th></tr>` + (l.slice(0, 500).map(u =>
      `<tr data-unit="${u.id}" style="cursor:pointer"><td class="mono">${esc(u.code)}</td><td>${esc(u.kind)}</td><td>${esc(where(u))}</td><td>${esc([u.brand, u.model].filter(Boolean).join(" "))}</td><td>${esc(u.capacity || "")}</td>
       <td>${u.install_year ? +today().slice(0, 4) - u.install_year : ""}</td><td>${esc(u.condition || "")}</td></tr>`).join("") || `<tr><td colspan="7" class="empty">ยังไม่มีเครื่องในทะเบียน${side ? " กด “เพิ่มเครื่อง” ด้านบน" : ""}</td></tr>`) +
      (l.length > 500 ? `<tr><td colspan="7" class="empty">แสดง 500 จาก ${l.length} เครื่อง พิมพ์คำค้นเพื่อกรอง</td></tr>` : "");
  }
  $("#uQ").oninput = $("#uKind").onchange = renderUnits;
  $("#uList").onclick = e => { const tr = e.target.closest("[data-unit]"); if (tr) openUnit(tr.dataset.unit); };
  $("#uCsv").onclick = () => csv(`ac-units-${H.code}`, UF.map(f => f[1].replace(" *", "")), uFiltered().map(u => UF.map(f => u[f[0]])));
  const unitUrl = u => { const x = new URL("ac.html", location.href); x.search = "?u=" + u.id; return x.toString(); };
  const qrImg = u => { const q = qrcode(0, "M"); q.addData(unitUrl(u)); q.make(); return q.createDataURL(4, 2); };
  $("#uQrBtn").onclick = () => {
    const l = uFiltered().slice(0, 200); if (!l.length) return toast("ไม่มีเครื่องให้พิมพ์");
    $("#uQr").innerHTML = l.map(u => `<div><img src="${qrImg(u)}" alt=""><b>${esc(u.code)}</b><small>${esc(u.kind)}</small><small>${esc(where(u))}</small></div>`).join("");
    document.body.classList.add("qrprint"); const done = () => { document.body.classList.remove("qrprint"); window.removeEventListener("afterprint", done); };
    window.addEventListener("afterprint", done); window.print();
  };
  const readUnit = get => { const o = {}; UF.forEach(([k, , t]) => { const v = (get(k) ?? "").toString().trim(); o[k] = v === "" ? null : t === "number" ? (+v || null) : v; }); return o; };
  $("#uAdd").onclick = async () => {
    const o = readUnit(k => $("#uForm").querySelector(`[data-k="${k}"]`).value);
    if (!o.code || !o.kind) return toast("ใส่รหัสเครื่องและประเภทอุปกรณ์");
    const { error } = await sb.from("ac_units").insert({ ...o, hospital_id: H.id });
    if (error) return toast(error.code === "23505" ? "รหัสเครื่องนี้มีในทะเบียนแล้ว" : errText(error));
    $("#uForm").querySelectorAll("input").forEach(i => i.value = ""); toast("เพิ่มเครื่องแล้ว"); await loadUnits(); renderUnits();
  };
  $("#uImport").onclick = async () => {
    const cols = UF.slice(0, 11).map(f => f[0]), have = new Set(units.map(u => u.code.toUpperCase())), rows = [], bad = [];
    $("#uPaste").value.split(/\r?\n/).map(l => l.split("\t")).filter(c => c.some(x => x.trim())).forEach((c, i) => {
      const o = readUnit(k => c[cols.indexOf(k)]);
      if (!o.code || !o.kind) return bad.push(`แถว ${i + 1}: ไม่มีรหัสหรือประเภท`);
      if (have.has(o.code.toUpperCase())) return bad.push(`แถว ${i + 1}: รหัส ${o.code} ซ้ำ`);
      have.add(o.code.toUpperCase()); rows.push({ ...o, hospital_id: H.id });
    });
    if (!rows.length) return $("#uNote").textContent = bad.join(" · ") || "ยังไม่ได้วางข้อมูล";
    const { error } = await sb.from("ac_units").insert(rows);
    if (error) return $("#uNote").textContent = errText(error);
    $("#uPaste").value = ""; $("#uNote").textContent = `นำเข้า ${rows.length} เครื่อง` + (bad.length ? ` · ข้าม ${bad.length} แถว (${bad.slice(0, 3).join(" · ")})` : ""); await loadUnits(); renderUnits();
  };
  async function openUnit(id) {
    const u = unitOf(id); if (!u) { toast("ไม่พบเครื่องนี้ในทะเบียน"); return renderUnits(); }
    $("#uMain").hidden = true;
    const { data, error } = await sb.rpc("ac_history", { p_unit: id }), hist = data || [];
    const last = k => { const r = hist.find(x => x.kind === k); return r ? fmtDate(day(r.at)) : "-"; };
    const formFor = { [KINDS[0]]: "AC-01", [KINDS[1]]: "AC-02", [KINDS[2]]: "AC-02", [KINDS[3]]: "AC-03", [KINDS[4]]: "AC-03", [KINDS[10]]: "AC-06", [KINDS[11]]: "AC-06" }[u.kind] || ([KINDS[9], KINDS[12]].includes(u.kind) ? "AC-05" : "AC-04");
    $("#uView").innerHTML = `<div class="panel"><div style="display:flex;gap:14px;flex-wrap:wrap;align-items:flex-start"><img src="${qrImg(u)}" alt="QR" style="width:110px;height:110px;background:#fff;border-radius:6px">
      <div style="flex:1;min-width:220px"><h3 class="mono" style="overflow-wrap:anywhere">${esc(u.code)}</h3><p class="sub" style="margin:0">${esc(u.kind)} · ${esc(where(u))}<br>${esc([u.brand, u.model, u.capacity, u.refrigerant].filter(Boolean).join(" · "))}
        ${u.install_year ? `<br>ติดตั้ง ${u.install_year} (อายุ ${+today().slice(0, 4) - u.install_year} ปี)` : ""}${u.condition ? " · สภาพ " + esc(u.condition) : ""}</p></div></div>
      <div class="kpis" style="margin-top:12px">${[["รายการทั้งหมด", hist.length], ["ล้างใหญ่ล่าสุด", last("ล้างใหญ่")], ["ล้างย่อยล่าสุด", last("ล้างย่อย")], ["แจ้งซ่อม (ครั้ง)", hist.filter(x => x.kind === "แจ้งซ่อม").length], ["ซ่อมล่าสุด", last("แจ้งซ่อม")], ["ความเสียหาย", hist.filter(x => x.kind === "ความเสียหาย").length]].map(([a, b]) => `<div class="kpi"><b>${b}</b><span>${a}</span></div>`).join("")}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" type="button" id="uBack">← กลับทะเบียน</button>${side ? `<button class="btn primary" type="button" id="uNew">กรอกแบบฟอร์ม ${formFor} ของเครื่องนี้</button>` : ""}
        <button class="btn" type="button" id="uHCsv">ประวัติ (Excel)</button>${side ? `<button class="btn" type="button" id="uOff">ปิดใช้งานเครื่องนี้</button>` : ""}</div>
      ${error ? `<div class="note bad">${esc(errText(error))}</div>` : ""}
      <div class="scroll" style="margin-top:10px"><table><tr><th>วันที่</th><th>ประเภทงาน</th><th>แบบฟอร์ม / เลขที่</th><th>รายละเอียด</th><th>ค่าวัด / การแก้ไข</th><th>ผู้ปฏิบัติ / ผู้ตรวจ</th><th>สถานะ</th></tr>
      ${hist.map(x => `<tr><td>${fmtDate(day(x.at))}</td><td>${esc(x.kind)}</td><td class="mono">${esc(x.ref)}</td><td>${esc(x.detail)}</td><td>${esc(x.measure)}</td><td>${esc(x.who)}</td><td>${stPill(x.status)}</td></tr>`).join("") || `<tr><td colspan="7" class="empty">ยังไม่มีประวัติ</td></tr>`}</table></div></div>`;
    $("#uBack").onclick = renderUnits;
    $("#uHCsv").onclick = () => csv(`ac-history-${u.code}`, ["วันที่", "ประเภทงาน", "เลขที่", "รายละเอียด", "ค่าวัด / การแก้ไข", "ผู้ปฏิบัติ", "สถานะ"], hist.map(x => [day(x.at), x.kind, x.ref, x.detail, x.measure, x.who, ST[x.status]]));
    if ($("#uNew")) $("#uNew").onclick = () => { show("work"); formFor === "AC-05" ? (newForm("AC-05"), cur.data.rows = [{ code: u.code, kind: u.kind }], drawForm()) : newForm(formFor, u.id); };
    if ($("#uOff")) $("#uOff").onclick = async e => {
      if (e.target.dataset.sure !== "1") { e.target.dataset.sure = "1"; e.target.textContent = "กดอีกครั้งเพื่อยืนยันปิดใช้งาน"; return; }
      const { error } = await sb.from("ac_units").update({ active: false }).eq("id", u.id);
      if (error) return toast(errText(error)); toast("ปิดใช้งานแล้ว (ประวัติยังอยู่)"); await loadUnits(); renderUnits();
    };
  }

  /* ---------- AC-09 repair calls, AC-10 damages ---------- */
  async function renderCalls() {
    const sla = +(contract?.sla_hours ?? 24), dmg = +(contract?.damage_hours ?? 48), dfc = +(contract?.defect_hours ?? 72);
    $("#cHint").textContent = `SLA เข้าตรวจ ${sla} ชม. · แก้ความเสียหาย ${dmg} ชม. · แก้อุปกรณ์ชำรุด ${dfc} ชม. · ค่าปรับ ${(+(contract?.penalty_rate ?? 0.001) * 100).toFixed(2)}% ของมูลค่าสัญญาต่อวัน (เศษของวันนับเป็น 1 วัน)` + (contract?.value > 0 ? "" : " · ยังไม่ได้ใส่มูลค่าสัญญา ค่าปรับจึงแสดงเป็น 0 บาท");
    if (!$("#tAt").value) $("#tAt").value = $("#dAt").value = nowLocal();
    const [t, d] = await Promise.all([sb.from("ac_tickets").select("*").eq("hospital_id", H.id).order("reported_at", { ascending: false }).limit(300), sb.from("ac_damages").select("*").eq("hospital_id", H.id).order("occurred_at", { ascending: false }).limit(300)]);
    tickets = t.data || []; damages = d.data || [];
    const open = tickets.filter(x => !x.inspected_at).length + damages.filter(x => !x.inspected_at).length; $("#nCalls").hidden = !open; $("#nCalls").textContent = open || "";
    const act = (x, kind) => x.inspected_at ? `ตรวจรับโดย ${esc(x.inspector_name || "")}` : !side ? "-"
      : kind === "t" && !x.visited_at ? `<input type="datetime-local" value="${nowLocal()}" data-at><button class="btn small" data-step="visit" data-id="${x.id}" data-kind="t">บันทึกเข้าตรวจ</button>`
      : !x.fixed_at ? `<input type="datetime-local" value="${nowLocal()}" data-at><input placeholder="การแก้ไข / อะไหล่ที่ใช้" data-note><button class="btn small" data-step="fix" data-id="${x.id}" data-kind="${kind}">บันทึกแก้เสร็จ</button>`
      : side === "hospital" ? `<button class="btn small primary" data-step="inspect" data-id="${x.id}" data-kind="${kind}">ตรวจรับ</button>` : "รอ รพ. ตรวจรับ";
    const res = (h, lim, running) => `<b style="color:${h > lim ? "var(--bad)" : "inherit"}">${h.toFixed(1)}</b> ${h > lim ? "เกิน" : running ? "กำลังนับ" : "ผ่าน"}`;
    $("#tList").innerHTML = `<tr><th>เลขที่แจ้ง</th><th>รับแจ้ง</th><th>ผู้แจ้ง / สถานที่ / เครื่อง</th><th>อาการ</th><th>เข้าตรวจ</th><th>ชม. / ผล SLA</th><th>วันปรับ</th><th>ค่าปรับ (บาท)</th><th>แก้เสร็จ / การแก้ไข</th><th>ดำเนินการ</th></tr>` + (tickets.map(x => {
      const h = hrs(x.reported_at, x.visited_at), pd = penDays(x.reported_at, x.visited_at, sla);
      return `<tr><td class="mono">${esc(x.ticket_no)}</td><td>${fmt(x.reported_at)}</td><td>${esc([x.reporter, x.place, unitOf(x.unit_id)?.code].filter(Boolean).join(" · "))}</td><td>${esc(x.symptom)}</td><td>${x.visited_at ? fmt(x.visited_at) : "-"}</td>
        <td>${res(h, sla, !x.visited_at)}</td><td>${pd}</td><td>${money(penAmt(pd))}</td><td>${x.fixed_at ? fmt(x.fixed_at) + "<br>" + esc(x.fix_note || "") : "-"}</td><td>${act(x, "t")}</td></tr>`;
    }).join("") || `<tr><td colspan="10" class="empty">ยังไม่มีรายการแจ้งซ่อม</td></tr>`);
    $("#dList").innerHTML = `<tr><th>เกิด / แจ้ง</th><th>สถานที่ / เครื่อง</th><th>ทรัพย์สินที่เสียหาย</th><th>สาเหตุ</th><th>เกณฑ์ (ชม.)</th><th>ชม. / ผล</th><th>วันปรับ</th><th>ค่าปรับ (บาท)</th><th>แก้เสร็จ</th><th>ดำเนินการ</th></tr>` + (damages.map(x => {
      const lim = x.criteria === "defect" ? dfc : dmg, h = hrs(x.occurred_at, x.fixed_at), pd = penDays(x.occurred_at, x.fixed_at, lim);
      return `<tr><td>${fmt(x.occurred_at)}</td><td>${esc([x.place, unitOf(x.unit_id)?.code].filter(Boolean).join(" · "))}</td><td>${esc(x.asset)}</td><td>${esc(x.cause || "")}</td><td>${x.criteria === "defect" ? "9.3 · " : "9.1 · "}${lim}</td>
        <td>${res(h, lim, !x.fixed_at)}</td><td>${pd}</td><td>${money(penAmt(pd))}</td><td>${x.fixed_at ? fmt(x.fixed_at) + "<br>" + esc(x.fix_note || "") : "-"}</td><td>${act(x, "d")}</td></tr>`;
    }).join("") || `<tr><td colspan="10" class="empty">ยังไม่มีรายการความเสียหาย</td></tr>`);
  }
  const unitArg = id => { const v = $(id).value.trim(); if (!v) return [null, true]; const u = unitByCode(v); return [u?.id || null, !!u]; };
  $("#tAdd").onclick = async () => {
    const [unit, ok] = unitArg("#tUnit"); if (!ok) return toast("ไม่พบรหัสเครื่องนี้ในทะเบียน (เว้นว่างได้)");
    const { data, error } = await sb.rpc("ac_ticket_open", { p_reported: iso($("#tAt").value), p_reporter: $("#tWho").value, p_place: $("#tPlace").value, p_unit: unit, p_symptom: $("#tSym").value });
    if (error) return toast(errText(error));
    ["tWho", "tPlace", "tUnit", "tSym"].forEach(i => $("#" + i).value = ""); $("#tAt").value = nowLocal(); toast("รับแจ้งแล้ว " + data); renderCalls();
  };
  $("#dAdd").onclick = async () => {
    const [unit, ok] = unitArg("#dUnit"); if (!ok) return toast("ไม่พบรหัสเครื่องนี้ในทะเบียน (เว้นว่างได้)");
    const { error } = await sb.rpc("ac_damage_open", { p_at: iso($("#dAt").value), p_place: $("#dPlace").value, p_unit: unit, p_asset: $("#dAsset").value, p_cause: $("#dCause").value, p_criteria: $("#dCrit").value });
    if (error) return toast(errText(error));
    ["dPlace", "dUnit", "dAsset", "dCause"].forEach(i => $("#" + i).value = ""); $("#dAt").value = nowLocal(); toast("บันทึกความเสียหายแล้ว"); renderCalls();
  };
  $("#tab-calls").addEventListener("click", async e => {
    const b = e.target.closest("[data-step]"); if (!b) return;
    const td = b.closest("td"), at = td.querySelector("[data-at]")?.value, note = td.querySelector("[data-note]")?.value;
    b.disabled = true;
    const { error } = await sb.rpc(b.dataset.kind === "t" ? "ac_ticket_step" : "ac_damage_step", { p_id: b.dataset.id, p_step: b.dataset.step, p_at: at ? iso(at) : null, p_note: note || null });
    if (error) { b.disabled = false; return toast(errText(error)); }
    toast("บันทึกแล้ว"); renderCalls();
  });
  $("#cCsv").onclick = () => {
    const sla = +(contract?.sla_hours ?? 24);
    csv(`AC-09-${H.code}`, ["เลขที่แจ้ง", "รับแจ้ง", "ผู้แจ้ง", "สถานที่", "รหัสเครื่อง", "อาการ", "เข้าตรวจ", "ชม.ที่ใช้", "วันปรับ", "ค่าปรับ", "แก้เสร็จ", "การแก้ไข", "ผู้ตรวจรับ"],
      tickets.map(x => { const pd = penDays(x.reported_at, x.visited_at, sla); return [x.ticket_no, fmt(x.reported_at), x.reporter, x.place, unitOf(x.unit_id)?.code, x.symptom, x.visited_at ? fmt(x.visited_at) : "", hrs(x.reported_at, x.visited_at).toFixed(1), pd, penAmt(pd), x.fixed_at ? fmt(x.fixed_at) : "", x.fix_note, x.inspector_name]; }));
    csv(`AC-10-${H.code}`, ["เกิด/แจ้ง", "สถานที่", "รหัสเครื่อง", "ทรัพย์สิน", "สาเหตุ", "เกณฑ์", "แก้เสร็จ", "ชม.ที่ใช้", "วันปรับ", "ค่าปรับ", "ผู้ตรวจรับ"],
      damages.map(x => { const lim = x.criteria === "defect" ? +(contract?.defect_hours ?? 72) : +(contract?.damage_hours ?? 48), pd = penDays(x.occurred_at, x.fixed_at, lim); return [fmt(x.occurred_at), x.place, unitOf(x.unit_id)?.code, x.asset, x.cause, x.criteria === "defect" ? "9.3" : "9.1-9.2", x.fixed_at ? fmt(x.fixed_at) : "", hrs(x.occurred_at, x.fixed_at).toFixed(1), pd, penAmt(pd), x.inspector_name]; }));
  };

  /* ---------- AC-12 monthly summary ---------- */
  const MS = [["contractor", "ผู้รับจ้าง (ผู้ส่งงาน)"], ["supervisor", "เจ้าหน้าที่ผู้ควบคุมงาน (โรงพยาบาล)"], ["manager", "ผู้จัดการแผนกวิศวกรรม (ผู้ตรวจรับ)"]];
  async function renderMonth() {
    const m = ($("#mMonth").value || today().slice(0, 7)) + "-01";
    const [a, b] = await Promise.all([sb.from("ac_monthly").select("*").eq("hospital_id", H.id).eq("month", m).maybeSingle(), sb.rpc("ac_month_summary", { p_month: m })]);
    month = a.data || { month: m, docs: {}, status: "draft", signs: {}, deduct: 0 };
    sum = month.status === "accepted" && month.summary ? month.summary : b.data;
    if (!sum) return $("#mBody").innerHTML = `<div class="note bad">${esc(errText(b.error))}</div>`;
    const ed = month.status !== "accepted" && (isMgr() || (side === "lead" && month.status === "draft")), ro = ed ? "" : "disabled";
    const tot = sum.rows.reduce((s, r) => ({ u: s.u + r.units, pm: s.pm + r.plan_minor, dm: s.dm + r.done_minor, pM: s.pM + r.plan_major, dM: s.dM + r.done_major }), { u: 0, pm: 0, dm: 0, pM: 0, dM: 0 });
    const pct = (d, p) => p ? Math.round(d / p * 100) + "%" : "-";
    const dvals = Object.values(month.docs || {}), dstat = dvals.length < DOCS.length ? "ยังกรอกไม่ครบ" : dvals.includes("no") ? "ไม่ครบ" : "ครบ";
    const canSign = s => !month.signs[s] && month.status !== "accepted" && ({ contractor: side === "lead" && month.status === "draft", supervisor: side === "hospital" && month.status === "submitted", manager: isMgr() && month.status === "submitted" })[s];
    $("#mBody").innerHTML = `<div class="panel"><h3>AC-12 สรุปผลงานประจำเดือน ${TH_M[+m.slice(5, 7) - 1]} ${+m.slice(0, 4) + 543} ${stPill(month.status)}</h3>
      <div class="sec">ก. ผลงานเทียบแผน (จำนวนเครื่อง) — TOR 5.1, 10.2 · นับจากแบบฟอร์มที่ส่งแล้ว</div>
      <div class="scroll"><table><tr><th>ประเภทอุปกรณ์</th><th>จำนวนเครื่อง</th><th>แผนย่อย</th><th>ทำจริงย่อย</th><th>แผนใหญ่</th><th>ทำจริงใหญ่</th><th>% สำเร็จ</th><th>ค้าง</th></tr>
      ${sum.rows.map(r => `<tr><td>${esc(r.kind)}</td><td>${r.units}</td><td>${r.plan_minor}</td><td>${r.done_minor}</td><td>${r.plan_major}</td><td>${r.done_major}</td><td>${pct(r.done_minor + r.done_major, r.plan_minor + r.plan_major)}</td><td>${Math.max(0, r.plan_minor + r.plan_major - r.done_minor - r.done_major)}</td></tr>`).join("") || `<tr><td colspan="8" class="empty">ยังไม่มีเครื่อง แผน หรือผลงานของเดือนนี้</td></tr>`}
      <tr><th>รวม</th><th>${tot.u}</th><th>${tot.pm}</th><th>${tot.dm}</th><th>${tot.pM}</th><th>${tot.dM}</th><th>${pct(tot.dm + tot.dM, tot.pm + tot.pM)}</th><th>${Math.max(0, tot.pm + tot.pM - tot.dm - tot.dM)}</th></tr></table></div>
      <div class="sec">ข. เอกสารประกอบการตรวจรับ (ต้องครบก่อนวางบิล) — สถานะ: ${dstat}</div>
      ${DOCS.map(([t, tor], i) => `<div class="it" style="grid-template-columns:minmax(0,1fr) 130px"><div>${i + 1}. ${esc(t)} <small>(TOR ${tor})</small></div><select data-doc="${i + 1}" ${ro}>${[["", "-"], ["ok", "✓ ครบ"], ["no", "✗ ไม่ครบ"], ["na", "N/A ไม่มีในเดือนนี้"]].map(([v, l]) => `<option value="${v}" ${month.docs?.[i + 1] === v ? "selected" : ""}>${l}</option>`).join("")}</select></div>`).join("")}
      <div class="sec">ค. บทปรับและยอดจ่ายงวดนี้ — TOR 13, 15</div>
      <table><tr><td>ค่าจ้างงวดนี้</td><td style="text-align:right">${money(sum.fee)}</td></tr>
      <tr><td>ค่าปรับ SLA เข้าแก้ไข (AC-09) · แจ้ง ${sum.tickets} ครั้ง · ${sum.pen9_days} วัน</td><td style="text-align:right">− ${money(sum.pen9)}</td></tr>
      <tr><td>ค่าปรับแก้ความเสียหายเกินกำหนด (AC-10) · ${sum.damages} รายการ · ${sum.pen10_days} วัน</td><td style="text-align:right">− ${money(sum.pen10)}</td></tr>
      <tr><td>หักกรณีล้างไม่ครบแผน (ผู้จัดการฝั่ง รพ. ใส่เอง)</td><td style="text-align:right">${isMgr() && ed ? `<input type="number" step="any" id="mDeduct" value="${+month.deduct || 0}" style="width:130px;text-align:right">` : "− " + money(sum.deduct)}</td></tr>
      <tr><th>ยอดจ่ายสุทธิงวดนี้ (บาท)</th><th style="text-align:right">${money(sum.net)}</th></tr></table>
      <div class="hd" style="margin-top:10px"><label>งวดที่<input type="number" id="mInst" value="${month.installment_no ?? ""}" ${ro}></label><label style="grid-column:span 2">หมายเหตุ<input id="mNote" value="${esc(month.note || "")}" ${ro}></label></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">${ed ? `<button class="btn primary" type="button" id="mSave">บันทึกสรุปเดือน</button>` : ""}${isMgr() && month.status === "submitted" ? `<button class="btn" type="button" id="mBack">ตีกลับให้ผู้รับเหมาแก้</button>` : ""}</div>
      <div class="signs">${MS.map(([s, l]) => { const g = month.signs[s]; return `<div><b>${l}</b>` + (g ? `${esc(g.name)}<small>${fmt(g.at)}</small>` : canSign(s) ? `<button class="btn small primary" type="button" data-msign="${s}">${s === "contractor" ? "ลงนามส่งงานเดือนนี้" : s === "manager" ? "ลงนามตรวจรับ" : "ลงนาม"}</button>` : `<small>ยังไม่ลงนาม</small>`) + `</div>`; }).join("")}</div></div>`;
  }
  $("#mMonth").onchange = renderMonth;
  async function saveMonth() {
    const docs = {}; $("#mBody").querySelectorAll("[data-doc]").forEach(s => { if (s.value) docs[s.dataset.doc] = s.value; });
    const { error } = await sb.rpc("ac_month_save", { p_month: month.month, p_installment: num($("#mInst").value), p_docs: docs, p_note: $("#mNote").value, p_deduct: $("#mDeduct") ? num($("#mDeduct").value) ?? 0 : null });
    if (error) { toast(errText(error)); return false; } return true;
  }
  $("#mBody").addEventListener("click", async e => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.id === "mSave") { b.disabled = true; if (await saveMonth()) toast("บันทึกแล้ว"); return renderMonth(); }
    if (b.id === "mBack") { const { error } = await sb.rpc("ac_month_return", { p_month: month.month }); if (error) return toast(errText(error)); toast("ตีกลับแล้ว"); return renderMonth(); }
    if (b.dataset.msign) {
      b.disabled = true;
      if (!$("#mInst").disabled && !(await saveMonth())) return b.disabled = false;
      const { error } = await sb.rpc("ac_month_sign", { p_month: month.month, p_slot: b.dataset.msign });
      if (error) { b.disabled = false; return toast(errText(error)); }
      toast(b.dataset.msign === "manager" ? "ตรวจรับงานเดือนนี้แล้ว" : "ลงนามแล้ว"); renderMonth();
    }
  });
  $("#mPrint").onclick = () => {
    if (!sum) return; const m = month.month, pct = (d, p) => p ? Math.round(d / p * 100) + "%" : "-";
    printDoc(`<div class="doc"><h2>AC-12 สรุปผลงานประจำเดือนและใบตรวจรับงาน</h2><p style="text-align:center;margin:0">${esc(H.name)} · เดือน ${TH_M[+m.slice(5, 7) - 1]} ${+m.slice(0, 4) + 543} · งวดที่ ${month.installment_no ?? "-"} · ${ST[month.status]}${contract?.contractor ? " · ผู้รับจ้าง " + esc(contract.contractor) : ""}</p>
      <table><tr><th>ประเภทอุปกรณ์</th><th>จำนวนเครื่อง</th><th>แผนย่อย</th><th>ทำจริงย่อย</th><th>แผนใหญ่</th><th>ทำจริงใหญ่</th><th>% สำเร็จ</th><th>ค้าง</th></tr>${sum.rows.map(r => `<tr><td>${esc(r.kind)}</td><td>${r.units}</td><td>${r.plan_minor}</td><td>${r.done_minor}</td><td>${r.plan_major}</td><td>${r.done_major}</td><td>${pct(r.done_minor + r.done_major, r.plan_minor + r.plan_major)}</td><td>${Math.max(0, r.plan_minor + r.plan_major - r.done_minor - r.done_major)}</td></tr>`).join("")}</table>
      <table><tr><th>ที่</th><th>เอกสารประกอบการตรวจรับ</th><th>ข้อ TOR</th><th>ผล</th></tr>${DOCS.map(([t, tor], i) => `<tr><td>${i + 1}</td><td>${esc(t)}</td><td>${tor}</td><td>${{ ok: "✓", no: "✗", na: "N/A" }[month.docs?.[i + 1]] || ""}</td></tr>`).join("")}</table>
      <table><tr><td>ค่าจ้างงวดนี้ (บาท)</td><td>${money(sum.fee)}</td></tr><tr><td>ค่าปรับ SLA เข้าแก้ไข (AC-09) ${sum.pen9_days} วัน</td><td>${money(sum.pen9)}</td></tr><tr><td>ค่าปรับแก้ความเสียหายเกินกำหนด (AC-10) ${sum.pen10_days} วัน</td><td>${money(sum.pen10)}</td></tr>
      <tr><td>หักกรณีล้างไม่ครบแผน</td><td>${money(sum.deduct)}</td></tr><tr><th>ยอดจ่ายสุทธิงวดนี้ (บาท)</th><th>${money(sum.net)}</th></tr></table><p>หมายเหตุ: ${esc(month.note || "-")}</p>${signDoc(MS, month.signs)}</div>`);
  };

  /* ---------- setup: contract, yearly plan, contractor team ---------- */
  const CF = [["contractor", "ชื่อผู้รับจ้าง"], ["contract_no", "เลขที่สัญญา"], ["start_date", "วันเริ่มสัญญา", "date"], ["end_date", "วันสิ้นสุดสัญญา", "date"], ["value", "มูลค่าสัญญา (บาท)", "number"], ["installments", "จำนวนงวดจ่าย", "number"],
    ["sla_hours", "SLA เข้าตรวจ/แก้ไขเบื้องต้น (ชม.) ข้อ 8.5", "number"], ["damage_hours", "เกณฑ์แก้ความเสียหาย (ชม.) ข้อ 9.1", "number"], ["defect_hours", "เกณฑ์แก้อุปกรณ์ชำรุด (ชม.) ข้อ 9.3", "number"], ["penalty_rate", "อัตราค่าปรับต่อวัน (0.001 = 0.1%) ข้อ 13", "number"]];
  const CDEF = { installments: 12, sla_hours: 24, damage_hours: 48, defect_hours: 72, penalty_rate: 0.001, value: 0 };
  async function renderSetup() {
    const c = contract || CDEF;
    $("#sContract").innerHTML = CF.map(([k, l, t]) => field(k, l, t, c[k], !isMgr())).join("");
    await renderPlan();
    if (!isMgr()) return;
    const [p, m] = await Promise.all([sb.from("profiles").select("id,full_name,role,active").eq("hospital_id", H.id).eq("role", "observer").order("full_name"), sb.from("ac_members").select("*").eq("hospital_id", H.id)]);
    const pos = Object.fromEntries((m.data || []).map(x => [x.profile_id, x.position]));
    $("#sTeam").innerHTML = `<tr><th>ชื่อ (บัญชี Observer ของโรงนี้)</th><th>ตำแหน่งในทีมผู้รับเหมา</th></tr>` + ((p.data || []).filter(x => x.active !== false).map(x =>
      `<tr><td>${esc(x.full_name || "(ยังไม่ตั้งชื่อ)")}</td><td><select data-member="${x.id}">${[["", "ไม่ใช่ผู้รับเหมา (ดูอย่างเดียว)"], ["tech", "ช่างเทคนิค"], ["lead", "หัวหน้าช่างเทคนิค"]].map(([v, l]) => `<option value="${v}" ${(pos[x.id] || "") === v ? "selected" : ""}>${l}</option>`).join("")}</select></td></tr>`).join("")
      || `<tr><td colspan="2" class="empty">ยังไม่มีบัญชีที่มีสิทธิ์ Observer ในโรงนี้</td></tr>`);
  }
  $("#sSave").onclick = async () => {
    const o = { hospital_id: H.id, updated_at: new Date().toISOString() };
    CF.forEach(([k, , t]) => { const v = $("#sContract").querySelector(`[data-k="${k}"]`).value.trim(); o[k] = v === "" ? (k in CDEF ? CDEF[k] : null) : t === "number" ? +v : v; });
    const { data, error } = await sb.from("ac_contracts").upsert(o).select().single();
    if (error) return toast(errText(error)); contract = data; toast("บันทึกข้อมูลสัญญาแล้ว");
  };
  $("#sTeam").addEventListener("change", async e => {
    const s = e.target.closest("[data-member]"); if (!s) return;
    const { error } = await sb.rpc("ac_member_set", { p_profile: s.dataset.member, p_position: s.value || null });
    toast(error ? errText(error) : "บันทึกทีมผู้รับเหมาแล้ว"); if (error) renderSetup();
  });
  async function renderPlan() {
    const y = +$("#pYear").value || +today().slice(0, 4), ro = isMgr() || side === "lead" ? "" : "disabled";
    const r = await sb.from("ac_plan").select("*").eq("hospital_id", H.id).eq("year", y); plan = r.data || [];
    const cnt = k => units.filter(u => u.kind === k).length, z = () => Array(12).fill(0);
    $("#pTable").innerHTML = `<tr><th>ประเภทอุปกรณ์</th><th>เครื่อง</th><th>ย่อย/ปี</th><th>ใหญ่/ปี</th>${TH_M.map(m => `<th>${m}<br>ย · ญ</th>`).join("")}<th>รวมแผน</th><th>ตรวจแผน</th></tr>` + KINDS.map((k, i) => {
      const p = plan.find(x => x.kind === k) || { minor_per_year: i >= 9 ? 4 : i === 8 ? 0 : 4, major_per_year: i >= 9 ? 0 : i === 8 ? 1 : 2, minor_m: z(), major_m: z() };
      const need = cnt(k) * (p.minor_per_year + p.major_per_year), got = [...p.minor_m, ...p.major_m].reduce((a, b) => a + b, 0);
      return `<tr data-pk="${i}"><td>${esc(k)}</td><td>${cnt(k)}</td><td><input type="number" min="0" data-p="mi" value="${p.minor_per_year}" ${ro}></td><td><input type="number" min="0" data-p="ma" value="${p.major_per_year}" ${ro}></td>` +
        TH_M.map((_, j) => `<td><input type="number" min="0" data-p="m${j}" value="${p.minor_m[j] || ""}" ${ro}><input type="number" min="0" data-p="M${j}" value="${p.major_m[j] || ""}" ${ro}></td>`).join("") +
        `<td>${got}</td><td>${!need ? "" : got === need ? "ครบ" : "ต่าง " + (got - need > 0 ? "+" : "") + (got - need)}</td></tr>`;
    }).join("");
  }
  $("#pYear").onchange = renderPlan;
  $("#pSave").onclick = async () => {
    const y = +$("#pYear").value, rows = [...$("#pTable").querySelectorAll("[data-pk]")].map(tr => {
      const v = k => +(tr.querySelector(`[data-p="${k}"]`).value) || 0;
      return { hospital_id: H.id, year: y, kind: KINDS[+tr.dataset.pk], minor_per_year: v("mi"), major_per_year: v("ma"), minor_m: TH_M.map((_, j) => v("m" + j)), major_m: TH_M.map((_, j) => v("M" + j)), updated_at: new Date().toISOString() };
    });
    const { error } = await sb.from("ac_plan").upsert(rows);
    $("#pNote").textContent = error ? errText(error) : "บันทึกแผนปี " + y + " แล้ว"; if (!error) renderPlan();
  };
})();
