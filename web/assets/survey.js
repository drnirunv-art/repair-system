// Repair-system survey: public form (link or QR, no login) and a summary for the hospital's staff (survey.html?view=1).
(() => {
  const { sb, $, esc, fmt, errText, opts } = RS;
  const ROLE = [["reporter", "ผู้แจ้งซ่อม (ผู้ใช้ทั่วไป)"], ["technician", "ช่างผู้รับงานซ่อม"], ["chief", "หัวหน้างาน / Chief Engineer"], ["executive", "ผู้บริหาร"], ["other", "อื่น ๆ"]];
  const FREQ = [["daily", "ทุกวัน"], ["weekly", "สัปดาห์ละ 2–3 ครั้ง"], ["monthly", "เดือนละไม่กี่ครั้ง"], ["rarely", "นาน ๆ ครั้ง"]];
  const TOPIC = ["ความง่ายในการแจ้งซ่อม (กรอกข้อมูล แนบรูป)", "ความเร็วในการรับเรื่องและเข้าซ่อม", "การติดตามสถานะงานซ่อม", "การแจ้งเตือน (รับเรื่อง / งานเสร็จ)", "รายงานและสรุปผลงานซ่อม", "ความเสถียรและความเร็วของระบบ", "ความพึงพอใจโดยรวม"];
  const PROB = [["no_taker", "แจ้งแล้วไม่มีผู้รับงาน หรือรับงานช้า"], ["status", "สถานะงานไม่อัปเดตตามจริง"], ["search", "ค้นหางานเก่า / ประวัติซ่อมยาก"], ["attach", "แนบรูปหรือไฟล์ลำบาก"], ["mobile", "ใช้งานบนมือถือไม่สะดวก"], ["no_alert", "ไม่มีแจ้งเตือนเมื่องานเสร็จ"], ["data", "ข้อมูลสถานที่ / อุปกรณ์ไม่ครบ"], ["other", "อื่น ๆ (ระบุด้านล่าง)"]];
  const FEAT = [["qr", "สแกน QR Code ที่จุดติดตั้งเพื่อแจ้งซ่อม"], ["line", "แจ้งซ่อม / รับแจ้งเตือนผ่าน LINE"], ["auto_alert", "แจ้งเตือนอัตโนมัติเมื่อสถานะเปลี่ยน"], ["dashboard", "Dashboard สรุปสำหรับหัวหน้างาน / ผู้บริหาร"], ["rating", "ประเมินความพึงพอใจหลังปิดงานซ่อม"], ["history", "ประวัติซ่อมรายเครื่อง + แผน PM"], ["other", "อื่น ๆ (ระบุด้านล่าง)"]];
  const q0 = new URLSearchParams(location.search), label = (list, k) => (list.find(x => x[0] === k) || [k, k])[1];
  const day = d => new Date(d).toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
  let hospitals = [], rows = [], me = null;

  const pick = (id, list, type) => $("#" + id).innerHTML = list.map(([v, l]) => `<label><input type="${type}" name="${id}" value="${v}"> ${esc(l)}</label>`).join("");
  pick("role", ROLE, "radio"); pick("frequency", FREQ, "radio"); pick("problems", PROB, "checkbox"); pick("features", FEAT, "checkbox");
  $("#scores").innerHTML = TOPIC.map((t, i) => `<div class="sc"><div>${i + 1}. ${esc(t)}</div><div class="n" role="radiogroup" aria-label="${esc(t)}">${[5, 4, 3, 2, 1].map(n => `<label><input type="radio" name="s${i + 1}" value="${n}">${n}</label>`).join("")}</div></div>`).join("");
  $("#role").onchange = () => $("#roleOtherWrap").hidden = $("#f").elements.role.value !== "other";
  const code = () => $("#hospital").value;
  const formUrl = () => { const u = new URL("survey.html", location.href); u.search = "?h=" + code(); return u.toString(); };

  (async () => {
    const { data } = await sb.from("hospitals").select("id,code,name").order("code"); hospitals = data || [];
    opts($("#hospital"), hospitals.map(h => [h.code, h.name]), false);
    const want = RS.hospitalCode(); if (hospitals.some(h => h.code === want)) $("#hospital").value = want;
    const { data: s } = await sb.auth.getSession();
    if (s?.session) {
      const p = await sb.from("profiles").select("id,role,hospital_id,hospitals(code)").eq("id", s.session.user.id).maybeSingle(); me = p.data;
      if (me?.hospitals && me.role !== "observer") {
        const a = $("#viewLink"); a.hidden = false;
        if (q0.get("view")) { $("#hospital").value = me.hospitals.code; $("#hospital").disabled = true; a.textContent = "← หน้าเจ้าหน้าที่"; a.href = "staff.html"; return showView(); }
        a.textContent = "ดูสรุปผล"; a.href = "survey.html?view=1";
      }
    }
    if (q0.get("view")) $("#msg").innerHTML = `<div class="note bad">ต้องเข้าสู่ระบบที่หน้าเจ้าหน้าที่ก่อน จึงจะดูสรุปผลได้</div>`;
  })();

  $("#f").onsubmit = async e => {
    e.preventDefault(); const el = e.target.elements, scores = {};
    TOPIC.forEach((_, i) => { const v = el["s" + (i + 1)].value; if (v) scores[i + 1] = +v; });
    const checked = n => [...document.querySelectorAll(`input[name="${n}"]:checked`)].map(x => x.value);
    const bad = !el.role.value ? "เลือกบทบาทการใช้งานระบบ" : el.role.value === "other" && !$("#role_other").value.trim() ? "ระบุบทบาทอื่น ๆ" : !el.frequency.value ? "เลือกความถี่ในการใช้งาน" : !Object.keys(scores).length ? "ให้คะแนนอย่างน้อย 1 หัวข้อ" : "";
    if (bad) return $("#msg").innerHTML = `<div class="note bad">${bad}</div>`;
    $("#send").disabled = true;
    const p = { role: el.role.value, frequency: el.frequency.value, scores, problems: checked("problems"), features: checked("features") };
    ["respondent", "unit", "role_other", "problem_detail", "first_fix", "suggestion"].forEach(k => p[k] = $("#" + k).value);
    const { error } = await sb.rpc("survey_submit", { p_hospital: code(), p });
    $("#send").disabled = false;
    if (error) return $("#msg").innerHTML = `<div class="note bad">${esc(errText(error))}</div>`;
    e.target.reset(); $("#roleOtherWrap").hidden = true; $("#msg").innerHTML = ""; $("#form").hidden = true; $("#thanks").hidden = false; scrollTo(0, 0);
  };
  $("#again").onclick = () => { $("#thanks").hidden = true; $("#form").hidden = false; };

  /* ---------- summary for staff ---------- */
  async function showView() {
    $("#form").hidden = true; $("#view").hidden = false; $("#title").textContent = "สรุปผลแบบสอบถามระบบแจ้งซ่อม";
    if (!$("#vTo").value) { $("#vTo").value = day(Date.now()); $("#vFrom").value = day(Date.now() - 90 * 864e5); }
    const r = await sb.from("survey_responses").select("*").eq("hospital_id", me.hospital_id).gte("created_at", $("#vFrom").value + "T00:00:00+07:00").lte("created_at", $("#vTo").value + "T23:59:59+07:00").order("created_at", { ascending: false }).limit(5000);
    rows = r.data || [];
    const avg = i => { const v = rows.map(x => x.scores?.[i]).filter(Boolean); return v.length ? [v.reduce((a, b) => a + b, 0) / v.length, v.length] : [null, 0]; };
    const all = avg(7);
    $("#vKpi").innerHTML = [["ผู้ตอบ", rows.length], ["พึงพอใจโดยรวม", all[0] ? all[0].toFixed(2) : "-"], ["ให้ 4–5 คะแนน", all[1] ? Math.round(rows.filter(x => x.scores?.[7] >= 4).length / all[1] * 100) + "%" : "-"], ["ให้ 1–2 คะแนน", rows.filter(x => x.scores?.[7] <= 2).length]].map(([a, b]) => `<div class="kpi"><b>${b}</b><span>${a}</span></div>`).join("");
    $("#vScores").innerHTML = TOPIC.map((t, i) => { const [a, n] = avg(i + 1); return `<div class="barrow"><div>${i + 1}. ${esc(t)} <small style="color:var(--muted)">(${n} คน)</small></div><div class="t"><i style="width:${a ? a / 5 * 100 : 0}%;${a && a < 3 ? "background:var(--bad)" : ""}"></i></div><b>${a ? a.toFixed(2) : "-"}</b></div>`; }).join("");
    const count = (list, key) => list.map(([v, l]) => [l, rows.filter(x => (x[key] || []).includes(v)).length]).sort((a, b) => b[1] - a[1]).map(([l, n]) => `<div class="barrow"><div>${esc(l)}</div><div class="t"><i style="width:${rows.length ? n / rows.length * 100 : 0}%"></i></div><b>${n}</b></div>`).join("");
    $("#vProblems").innerHTML = count(PROB, "problems"); $("#vFeatures").innerHTML = count(FEAT, "features");
    $("#vWho").innerHTML = `<p>${ROLE.map(([v, l]) => `${esc(l)} <b>${rows.filter(x => x.role === v).length}</b>`).join(" · ")}</p><p>${FREQ.map(([v, l]) => `${esc(l)} <b>${rows.filter(x => x.frequency === v).length}</b>`).join(" · ")}</p>`;
    const tx = rows.filter(x => x.problem_detail || x.first_fix || x.suggestion);
    $("#vText").innerHTML = `<tr><th>วันที่</th><th>ผู้ตอบ</th><th>ปัญหาที่พบ</th><th>อยากให้แก้ก่อน</th><th>ข้อเสนอแนะ</th></tr>` + (tx.map(x => `<tr><td>${fmt(x.created_at)}</td><td>${esc([x.respondent, x.unit, x.role === "other" ? x.role_other : label(ROLE, x.role)].filter(Boolean).join(" · "))}</td><td>${esc(x.problem_detail || "")}</td><td>${esc(x.first_fix || "")}</td><td>${esc(x.suggestion || "")}</td></tr>`).join("") || `<tr><td colspan="5" class="empty">ยังไม่มีข้อความ</td></tr>`);
    const q = qrcode(0, "M"); q.addData(formUrl()); q.make();
    $("#vUrl").textContent = formUrl(); $("#vQr").innerHTML = `<img src="${q.createDataURL(6, 2)}" alt="QR แบบสอบถาม" style="width:200px;height:200px"><br><b>แบบสอบถามระบบแจ้งซ่อม</b><br>${esc(hospitals.find(h => h.code === code())?.name || "")}`;
  }
  $("#vFrom").onchange = $("#vTo").onchange = showView;
  $("#vPrint").onclick = () => { document.body.classList.add("qrp"); const d = () => { document.body.classList.remove("qrp"); removeEventListener("afterprint", d); }; addEventListener("afterprint", d); print(); };
  $("#vCsv").onclick = () => {
    const head = ["วันที่", "ชื่อ", "หน่วยงาน", "บทบาท", "ความถี่", ...TOPIC.map((t, i) => (i + 1) + ". " + t), "ปัญหาที่พบ", "รายละเอียดปัญหา", "ฟีเจอร์ที่อยากได้", "อยากให้แก้ก่อน", "ข้อเสนอแนะ"];
    const body = rows.map(x => [fmt(x.created_at), x.respondent, x.unit, x.role === "other" ? x.role_other : label(ROLE, x.role), label(FREQ, x.frequency), ...TOPIC.map((_, i) => x.scores?.[i + 1] ?? ""), (x.problems || []).map(k => label(PROB, k)).join("; "), x.problem_detail, (x.features || []).map(k => label(FEAT, k)).join("; "), x.first_fix, x.suggestion]);
    Office.table(`survey-${code()}`, head, body, { title: "ผลแบบสอบถามระบบแจ้งซ่อม", org: hospitals.find(h => h.code === code())?.name, period: [$("#vFrom").value, $("#vTo").value].filter(Boolean).join(" ถึง ") });
  };
})();
