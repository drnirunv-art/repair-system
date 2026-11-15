// PM Board: one tile per machine planned this month, grouped by building and coloured by state
//   green = PM done and normal · light red = PM done with abnormal items (send to the repair queue) ·
//   yellow = not done yet · dark red = not done and more than 75% of the month has passed.
// Building readiness: chief / supervisor / admin / owner confirm the 8 standard systems of each building (ready / not ready + why).
(() => {
  const { sb, $, esc, fmt, errText } = RS;
  const MGR = ["owner", "admin", "chief_engineer", "supervisor"], DONE = ["submitted", "head_signed", "approved"];
  const SYS = [["electric", "ไฟฟ้า"], ["comm", "สื่อสาร"], ["special", "ระบบพิเศษ"], ["hvac", "ปรับอากาศ"], ["lift", "ลิฟต์"], ["fire", "ป้องกันอัคคีภัย"], ["sanitary", "สุขาภิบาล"], ["civil", "โยธา / อาคาร"]];
  const COL = { ok: ["c-ok", "PM เสร็จ ปกติ"], bad: ["c-bad", "PM เสร็จ พบผิดปกติ"], todo: ["c-todo", "ยังไม่ทำ"], late: ["c-late", "ยังไม่ทำ เลย 75% ของเดือน"] };
  const ST = { todo: "ยังไม่ทำ", returned: "ตีกลับให้แก้", submitted: "ช่างส่งแล้ว", head_signed: "หัวหน้าลงนามแล้ว", approved: "วิศวกรอนุมัติแล้ว" };
  let me = null, eq = [], tasks = [], ready = [], cur = "board", pick = "", busy = false;
  const toast = (m, bad) => { const t = $("#toast"); t.textContent = m; t.hidden = false; t.style.background = bad ? "var(--bad)" : ""; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, bad ? 6000 : 3000); };
  const rpc = async (name, args) => { const { data, error } = await sb.rpc(name, args); if (error) throw error; return data; };
  const guard = fn => async ev => { if (busy) return; busy = true; try { await fn(ev); } catch (e) { toast(errText(e), true); } finally { busy = false; } };
  const n = v => (+v || 0).toLocaleString("th-TH"), pct = (a, b) => b ? Math.round(a * 1000 / b) / 10 : 0;
  const mgr = () => MGR.includes(me.role);
  const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
  const ym = () => ($("#m").value || today().slice(0, 7)).split("-").map(Number);
  const mName = () => { const [y, m] = ym(); return new Date(y, m - 1, 1).toLocaleDateString("th-TH", { month: "long", year: "numeric" }); };
  const bldOf = e => (e && (e.building || "").trim()) || "ไม่ระบุอาคาร";
  const dlg = h => { $("#dlgIn").innerHTML = h; $("#dlg").showModal(); };
  $("#dlg").addEventListener("click", ev => { if (ev.target.closest("[data-close]") || ev.target === $("#dlg")) $("#dlg").close(); });
  // share of the selected month that has passed (1 for past months, 0 for future ones)
  function elapsed() {
    const [y, m] = ym(), t = today(), [ty, tm, td] = t.split("-").map(Number);
    if (y * 12 + m < ty * 12 + tm) return 1; if (y * 12 + m > ty * 12 + tm) return 0;
    return td / new Date(y, m, 0).getDate();
  }
  const state = t => DONE.includes(t.status) ? (t.abnormal > 0 ? "bad" : "ok") : elapsed() > 0.75 ? "late" : "todo";

  sb.auth.onAuthStateChange((_e, session) => setTimeout(() => boot(session), 0));
  async function boot(session) {
    if (me) return;
    if (!session) { $("#gate").hidden = false; return; }
    const { data } = await sb.from("profiles").select("id,full_name,role,hospital_id,hospitals(id,code,name)").eq("id", session.user.id).maybeSingle();
    if (!data || !data.hospital_id) { $("#gate").hidden = false; return; }
    me = data; $("#who").textContent = `${me.full_name || ""} · ${me.hospitals.name}`;
    $("#m").value = today().slice(0, 7); $("#body").hidden = false; $("#tabs").hidden = false;
    const q = new URLSearchParams(location.search); if (["TW", "MA"].includes((q.get("by") || "").toUpperCase())) $("#by").value = q.get("by").toUpperCase();
    await Promise.all([loadEq(), loadTasks(), loadReady()]);
    show(q.get("tab") || "board");
  }
  async function pages(build) { const out = []; for (let f = 0; ; f += 1000) { const r = await build().range(f, f + 999); if (r.error) throw r.error; out.push(...(r.data || [])); if ((r.data || []).length < 1000) break; } return out; }
  async function loadEq() { eq = await pages(() => sb.from("equipment").select("id,tag,name,eq_type,building,floor,place,pm_by,pm_by_raw,pm_vendor").eq("hospital_id", me.hospital_id).eq("active", true).order("id")); }
  async function loadTasks() { const [y, m] = ym(); tasks = (await pages(() => sb.from("pm_tasks").select("id,equipment_id,year,month,week,kind,status,abnormal,score,submitted_at,job_id").eq("hospital_id", me.hospital_id).eq("year", y).eq("month", m).order("id"))).filter(t => t.year === y && t.month === m); }
  async function loadReady() { ready = ((await sb.from("building_ready").select("*").eq("hospital_id", me.hospital_id)).data || []).filter(r => r.hospital_id === me.hospital_id); }

  document.querySelectorAll("#tabs button").forEach(b => b.onclick = () => show(b.dataset.tab));
  function show(t) {
    cur = t === "ready" ? "ready" : "board";
    document.querySelectorAll("#tabs button").forEach(b => b.setAttribute("aria-selected", b.dataset.tab === cur));
    $("#tab-board").hidden = cur !== "board"; $("#tab-ready").hidden = cur !== "ready";
    cur === "board" ? board() : readyView();
  }

  // ---------- board ----------
  const eqMap = () => Object.fromEntries(eq.map(e => [e.id, e]));
  const inBy = e => !$("#by").value || ($("#by").value === "MA" ? e.pm_by === "MA" || /MA/i.test(e.pm_by_raw || "") : e.pm_by !== "MA" || /TW/i.test(e.pm_by_raw || ""));
  function rows() {
    const E = eqMap(), q = $("#q").value.trim().toLowerCase();
    return tasks.map(t => ({ t, e: E[t.equipment_id], s: state(t) })).filter(x => x.e && inBy(x.e) && (!q || `${x.e.tag} ${x.e.name} ${x.e.eq_type}`.toLowerCase().includes(q)));
  }
  function board() {
    const all = rows(), c = s => all.filter(x => x.s === s).length, done = c("ok") + c("bad");
    $("#k").innerHTML = [["เครื่องที่มีแผนเดือนนี้", n(all.length)], ["ทำแล้ว", `${n(done)} (${pct(done, all.length)}%)`], ["พบผิดปกติ", n(c("bad")), 1], ["ยังไม่ทำ", n(c("todo") + c("late"))], ["เลย 75% ของเดือนแล้วยังไม่ทำ", n(c("late")), 1]]
      .map(([k, v, bad]) => `<div class="kpi"><b style="${bad && parseInt(v) ? "color:var(--bad)" : ""}">${esc(v)}</b><span>${esc(k)}</span></div>`).join("");
    $("#lg").innerHTML = `<button type="button" data-s="" aria-pressed="${!pick}">ทั้งหมด ${n(all.length)}</button>` + Object.entries(COL).map(([s, [cl, l]]) => `<button type="button" data-s="${s}" aria-pressed="${pick === s}"><span class="sw ${cl}"></span>${l} ${n(c(s))}</button>`).join("");
    const e = elapsed();
    $("#note").textContent = `${mName()} · ผ่านไปแล้ว ${Math.round(e * 100)}% ของเดือน${e > 0.75 && e < 1 ? " · เครื่องที่ยังไม่ทำเป็นสีแดงเข้ม" : ""} · แตะช่องเพื่อดูรายละเอียด`;
    const list = all.filter(x => !pick || x.s === pick), g = new Map();
    list.sort((a, b) => (a.e.tag || a.e.name || "").localeCompare(b.e.tag || b.e.name || "", "th")).forEach(x => { const b = bldOf(x.e); if (!g.has(b)) g.set(b, []); g.get(b).push(x); });
    $("#board").innerHTML = [...g.entries()].sort((a, b) => a[0].localeCompare(b[0], "th")).map(([b, xs]) => { const d = xs.filter(x => x.s === "ok" || x.s === "bad").length;
      return `<div class="bld"><h3>${esc(b)} <small>${n(xs.length)} เครื่อง · ทำแล้ว ${pct(d, xs.length)}%${xs.some(x => x.s === "bad") ? ` · ผิดปกติ ${n(xs.filter(x => x.s === "bad").length)}` : ""}</small></h3>
        <div class="tiles">${xs.map(x => `<button type="button" class="tile ${COL[x.s][0]}" data-t="${x.t.id}" title="${esc(`${x.e.tag || ""} ${x.e.name || ""} · ${COL[x.s][1]}`)}">${esc(x.e.tag || x.e.name || "-")}</button>`).join("")}</div></div>`; }).join("")
      || `<div class="empty">${tasks.length ? "ไม่มีเครื่องตามตัวกรอง" : `${mName()} ยังไม่มีงาน PM (ระบบสร้างงานให้อัตโนมัติวันที่ 1 ของทุกเดือน)`}</div>`;
  }
  $("#lg").onclick = ev => { const b = ev.target.closest("[data-s]"); if (b) { pick = b.dataset.s; board(); } };
  $("#q").oninput = () => board();
  $("#by").onchange = () => board();
  $("#m").onchange = guard(async () => { await loadTasks(); board(); });
  $("#board").addEventListener("click", ev => {
    const b = ev.target.closest("[data-t]"); if (!b) return;
    const t = tasks.find(x => x.id === b.dataset.t), e = eqMap()[t.equipment_id], s = state(t);
    dlg(`<h3><span class="sw ${COL[s][0]}"></span> ${esc(e.tag || "")} · ${esc(e.name || "")}</h3>
      <div class="kv"><span>ชนิด</span><b>${esc(e.eq_type || "-")}</b><span>ที่ตั้ง</span><b>${esc([e.building, e.floor, e.place].filter(Boolean).join(" · ") || "-")}</b>
        <span>ผู้ทำ PM</span><b>${esc(e.pm_by_raw || e.pm_by || "-")}${e.pm_vendor ? " · " + esc(e.pm_vendor) : ""}</b><span>แผน</span><b>${esc(mName())} สัปดาห์ที่ ${t.week}${t.kind ? " · " + esc(t.kind) : ""}</b>
        <span>สถานะ</span><b>${esc(ST[t.status] || t.status)} · ${COL[s][1]}</b>${t.submitted_at ? `<span>ส่งผลเมื่อ</span><b>${fmt(t.submitted_at)}${t.score != null ? ` · คะแนน ${t.score}` : ""}</b>` : ""}
        ${t.abnormal ? `<span>ผิดปกติ</span><b style="color:var(--bad)">${n(t.abnormal)} ข้อ${t.job_id ? " · เปิดใบแจ้งซ่อมแล้ว" : ""}</b>` : ""}</div>
      <div class="row"><a class="btn" href="pm.html?tag=${encodeURIComponent(e.tag || "")}${e.pm_by === "MA" ? "&by=MA" : ""}">เปิดใบ PM ของเครื่องนี้</a>
        ${s === "bad" ? `<button class="btn primary" type="button" id="oj">${t.job_id ? "ดูเลขใบแจ้งซ่อม" : "ส่งเข้าใบแจ้งซ่อม"}</button>` : ""}<button class="btn" type="button" data-close>ปิด</button></div>`);
    if (s === "bad") $("#oj").onclick = guard(async () => { const no = await rpc("pm_open_job", { p_task: t.id }); toast(`ใบแจ้งซ่อม ${no}`); if (!t.job_id) t.job_id = "x"; $("#dlg").close(); board(); });
  });
  $("#x").onclick = () => {
    const all = rows(), c = s => all.filter(x => x.s === s).length, done = c("ok") + c("bad");
    Office.table(`PM_Board_${me.hospitals.code}_${$("#m").value}`, ["อาคาร", "TAG", "ชื่อเครื่อง", "ชนิด", "ผู้ทำ PM", "สัปดาห์", "รอบ", "สถานะใบ", "สี", "ข้อผิดปกติ", "ส่งผลเมื่อ"],
      all.map(({ t, e, s }) => [bldOf(e), e.tag || "", e.name || "", e.eq_type || "", e.pm_by_raw || e.pm_by || "", t.week, t.kind || "", ST[t.status] || t.status, COL[s][1], t.abnormal || 0, t.submitted_at ? fmt(t.submitted_at) : ""]),
      { title: "PM Board รายเครื่อง", org: me.hospitals.name, period: mName(),
        findings: [`มีแผน ${n(all.length)} เครื่อง ทำแล้ว ${n(done)} (${pct(done, all.length)}%)`, `พบผิดปกติ ${n(c("bad"))} เครื่อง · ยังไม่ทำ ${n(c("todo") + c("late"))} เครื่อง${c("late") ? ` (เลย 75% ของเดือนแล้ว ${n(c("late"))})` : ""}`] });
  };

  // ---------- building readiness ----------
  const buildings = () => [...new Set([...eq.map(bldOf), ...ready.map(r => r.building)])].filter(b => b !== "ไม่ระบุอาคาร").sort((a, b) => a.localeCompare(b, "th"));
  const cell = (b, s) => ready.find(r => r.building === b && r.system === s);
  function readyView() {
    const bs = buildings(), okB = bs.filter(b => SYS.every(([s]) => (cell(b, s) || {}).state === "ok")), badN = ready.filter(r => r.state === "bad").length, setN = ready.length;
    $("#rk").innerHTML = [["อาคารพร้อมใช้ครบ 8 ระบบ", `${n(okB.length)}/${n(bs.length)}`], ["ระบบที่ไม่พร้อม", n(badN), 1], ["ยังไม่ยืนยัน", n(bs.length * SYS.length - setN)]]
      .map(([k, v, bad]) => `<div class="kpi"><b style="${bad && parseInt(v) ? "color:var(--bad)" : ""}">${esc(v)}</b><span>${esc(k)}</span></div>`).join("");
    const pmBad = b => tasks.filter(t => state(t) === "bad" && bldOf(eqMap()[t.equipment_id]) === b).length;
    $("#rt").innerHTML = bs.map(b => { const ok = okB.includes(b), pb = pmBad(b), nOk = SYS.filter(([s]) => (cell(b, s) || {}).state === "ok").length;
      return `<div class="rb${ok ? " allok" : ""}"><h3>${esc(b)} <small>${ok ? "✓ พร้อมใช้ครบ 8 ระบบ" : `พร้อม ${nOk}/8`}${pb ? ` · <b style="color:var(--bad)">PM ผิดปกติเดือนนี้ ${n(pb)} เครื่อง</b>` : ""}</small></h3>
        <div class="rg">${SYS.map(([s, l]) => { const r = cell(b, s);
          return `<button type="button" class="rc ${r ? r.state : ""}" data-b="${esc(b)}" data-s="${s}" title="${esc(r ? `${r.by_name || ""} ${fmt(r.at)}` : "ยังไม่ยืนยัน")}" ${mgr() ? "" : "disabled"}><span>${esc(l)}</span><b>${r ? (r.state === "ok" ? "พร้อม" : "ไม่พร้อม") : "ยังไม่ยืนยัน"}</b>${r && r.state === "bad" ? `<span class="meta">${esc((r.notes || []).join(", "))}</span>` : ""}</button>`; }).join("")}</div></div>`; }).join("")
      || `<div class="empty">ยังไม่มีอาคารในทะเบียนเครื่อง (ใส่ชื่ออาคารที่หน้า PM แท็บทะเบียนเครื่อง)</div>`;
  }
  $("#rt").addEventListener("click", ev => {
    const b = ev.target.closest("[data-s]"); if (!b || b.disabled) return;
    const bl = b.dataset.b, s = b.dataset.s, l = SYS.find(x => x[0] === s)[1], r = cell(bl, s);
    dlg(`<h3>${esc(bl)} · ${esc(l)}</h3><p class="meta">${r ? `ยืนยันล่าสุด: ${r.state === "ok" ? "พร้อม" : "ไม่พร้อม"} โดย ${esc(r.by_name || "")} ${fmt(r.at)}` : "ยังไม่เคยยืนยัน"}</p>
      <label>เหตุผลที่ไม่พร้อม (บังคับเมื่อเลือก "ไม่พร้อม" แยกบรรทัดละเรื่อง)<textarea id="rn" rows="3">${esc((r && r.notes || []).join("\n"))}</textarea></label>
      <div class="row" style="margin-top:10px"><button class="btn primary" type="button" data-r="ok">พร้อม</button><button class="btn" type="button" data-r="bad" style="border-color:var(--bad);color:var(--bad)">ไม่พร้อม</button>
        ${r ? `<button class="btn" type="button" data-r="">ล้างสถานะ</button>` : ""}<button class="btn" type="button" data-close>ยกเลิก</button></div>`);
    $("#dlgIn").querySelectorAll("[data-r]").forEach(x => x.onclick = guard(async () => {
      const st = x.dataset.r || null, notes = $("#rn").value.split("\n").map(v => v.trim()).filter(Boolean);
      if (st === "bad" && !notes.length) { $("#rn").focus(); return toast("ใส่เหตุผลที่ไม่พร้อม", true); }
      await rpc("ready_set", { p_building: bl, p_system: s, p_state: st, p_notes: notes });
      $("#dlg").close(); await loadReady(); readyView(); toast("บันทึกแล้ว");
    }));
  });
  $("#rx").onclick = () => {
    const bs = buildings(), okB = bs.filter(b => SYS.every(([s]) => (cell(b, s) || {}).state === "ok"));
    const lab = r => r ? (r.state === "ok" ? "พร้อม" : "ไม่พร้อม: " + (r.notes || []).join(", ")) : "ยังไม่ยืนยัน";
    Office.table(`ความพร้อมอาคาร_${me.hospitals.code}_${today()}`, ["อาคาร", ...SYS.map(x => x[1]), "พร้อมครบ 8 ระบบ"],
      bs.map(b => [b, ...SYS.map(([s]) => lab(cell(b, s))), okB.includes(b) ? "ใช่" : "ไม่"]),
      { title: "ความพร้อมอาคาร 8 ระบบ", org: me.hospitals.name, period: "ข้อมูล ณ " + fmt(new Date().toISOString()),
        findings: [`อาคารพร้อมใช้ครบ 8 ระบบ ${n(okB.length)} จาก ${n(bs.length)} อาคาร`, ...ready.filter(r => r.state === "bad").slice(0, 10).map(r => `${r.building} · ${SYS.find(x => x[0] === r.system)[1]} ไม่พร้อม: ${(r.notes || []).join(", ")}`)] });
  };
})();
