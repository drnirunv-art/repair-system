// Work permit: labels shared by the staff page (wp.html) and the contractor page (permit.html).
window.WP = {
  ST: { draft: "รอผู้รับเหมากรอกคำขอ", submitted: "ส่งคำขอแล้ว รอตรวจเอกสาร", returned: "ตีกลับให้แก้ไขคำขอ", docs_ok: "เอกสารผ่าน รอลงนามอนุมัติ", approved: "อนุมัติเข้าพื้นที่แล้ว",
    working: "กำลังปฏิบัติงาน", finished: "แจ้งงานเสร็จ รอตรวจรับ", fix: "ตรวจแล้ว ให้แก้ไขงาน", accepted: "ตรวจรับแล้ว รอส่งมอบ", closed: "ปิดงานแล้ว", cancelled: "ยกเลิก" },
  DST: { sent: "ส่งแล้ว รอวิศวกรรมตรวจ", fix: "ให้แก้ไขก่อนเริ่มงาน", ok: "ตรวจผ่าน เริ่มงานได้", done: "ส่งสรุปสิ้นวันแล้ว" },
  HAZ: [["hot", "งานที่มีความร้อน / ประกายไฟ (เชื่อม ตัด เจียร)"], ["height", "งานบนที่สูง (เกิน 2 เมตร)"], ["confined", "งานในที่อับอากาศ"], ["electric", "งานระบบไฟฟ้า"],
    ["demolish", "งานรื้อถอน / เจาะ สกัด (ฝุ่น เสียงดัง)"], ["chemical", "งานที่ใช้สารเคมี / สี / ทินเนอร์"], ["lifting", "งานยกของหนัก / ใช้เครน รอก"],
    ["shutdown", "งานที่ต้องตัดระบบ (น้ำ ไฟ แก๊ส แอร์ ดับเพลิง)"], ["ceiling", "งานเปิดฝ้าเพดาน / เหนือฝ้า"], ["patient", "งานในพื้นที่ผู้ป่วย / พื้นที่ควบคุมการติดเชื้อ"]],
  STEPS: [["กรอกคำขอ", ["draft", "returned"]], ["ตรวจเอกสาร", ["submitted"]], ["อนุมัติ", ["docs_ok"]], ["ปฏิบัติงาน", ["approved", "working", "fix"]], ["ตรวจรับ", ["finished", "accepted"]], ["ปิดงาน", ["closed"]]],
  today: () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" }),
  steps(status) {
    const at = WP.STEPS.findIndex(s => s[1].includes(status));
    return `<ol class="steps">${WP.STEPS.map((s, i) => `<li class="${status === "cancelled" ? "" : i < at || status === "closed" ? "ok" : i === at ? "now" : ""}">${s[0]}</li>`).join("")}</ol>`;
  }
};
