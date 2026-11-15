const RS = (() => {
  const cfg = window.RS_CONFIG;
  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey);
  const $ = s => document.querySelector(s);
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const STATUS = {register:"รอรับงาน",assign:"มอบหมายแล้ว",work_on:"กำลังซ่อม",on_hold:"พักงาน",clear:"ซ่อมเสร็จ รอตรวจ",evaluated:"ประเมินแล้ว",close:"ปิดงาน",cancel:"ยกเลิก"};
  const OPEN = ["register","assign","work_on","on_hold","clear"];
  const fmt = iso => iso ? new Date(iso).toLocaleString("th-TH",{timeZone:"Asia/Bangkok",day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"}) : "-";
  const fmtDate = d => d ? new Date(d + (String(d).length === 10 ? "T00:00:00+07:00" : "")).toLocaleDateString("th-TH",{timeZone:"Asia/Bangkok",day:"numeric",month:"short",year:"2-digit"}) : "-";
  const mins = (a,b) => Math.round(((b ? new Date(b) : new Date()) - new Date(a)) / 60000);
  const dur = m => m < 60 ? m + " นาที" : m < 1440 ? (m/60).toFixed(1) + " ชม." : (m/1440).toFixed(1) + " วัน";
  const hospitalCode = () => new URLSearchParams(location.search).get("h") || cfg.defaultHospital || "";
  const statusLabel = j => j.status === "assign" && j.accepted_at ? "รับงานแล้ว" : STATUS[j.status] || j.status;
  const pill = (s, label) => `<span class="pill" style="color:var(--s-${s})">${esc(label || STATUS[s] || s)}</span>`;
  const errText = e => (e && (e.message || e.error_description)) || "เกิดข้อผิดพลาด ลองใหม่อีกครั้ง";
  const opts = (sel, items, keep=true) => { const v = sel.value; sel.innerHTML = items.map(([val,label]) => `<option value="${esc(val)}">${esc(label)}</option>`).join(""); if (keep && items.some(i => String(i[0]) === v)) sel.value = v; };
  // working minutes: elapsed time minus time spent on hold (SLA pauses during hold)
  const workMins = (j, until) => {
    const end = until || j.cleared_at || j.closed_at;
    let m = mins(j.created_at, end) - (j.hold_minutes || 0);
    if (!end && j.status === "on_hold" && j.hold_started_at) m -= mins(j.hold_started_at);
    return Math.max(0, m);
  };
  // photos are shrunk before upload so they send fast on weak signal; videos and unreadable files (some HEIC) go as-is
  async function shrink(file) {
    if (!file.type.startsWith("image/")) return { blob: file, ext: (file.name.split(".").pop() || "mp4").toLowerCase(), type: file.type || "video/mp4" };
    try {
      const img = await createImageBitmap(file); const s = Math.min(1, 1600 / Math.max(img.width, img.height));
      const c = Object.assign(document.createElement("canvas"), { width: Math.round(img.width * s), height: Math.round(img.height * s) });
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      const blob = await new Promise(r => c.toBlob(r, "image/jpeg", 0.82));
      return { blob, ext: "jpg", type: "image/jpeg" };
    } catch { return { blob: file, ext: (file.name.split(".").pop() || "jpg").toLowerCase(), type: file.type || "image/heic" }; }
  }
  async function uploadMedia(files, hospitalCode, kind) {
    const out = [];
    for (const f of files) {
      if (f.size > 50 * 1024 * 1024) throw new Error(`ไฟล์ ${f.name} ใหญ่เกิน 50 MB`);
      const m = await shrink(f);
      const path = `${hospitalCode}/${new Date().toISOString().slice(0,10)}/${kind}-${crypto.randomUUID()}.${m.ext}`;
      const up = await sb.storage.from("job-photos").upload(path, m.blob, { contentType: m.type });
      if (up.error) throw up.error;
      out.push(path);
    }
    return out;
  }
  const isVideo = p => /\.(mp4|mov|webm|m4v)$/i.test(p);
  async function signed(paths) {
    if (!paths.length) return {};
    const { data } = await sb.storage.from("job-photos").createSignedUrls(paths, 3600);
    return Object.fromEntries((data || []).filter(x => x.signedUrl).map(x => [x.path, x.signedUrl]));
  }
  return { sb, $, esc, STATUS, OPEN, fmt, fmtDate, mins, dur, hospitalCode, pill, statusLabel, errText, opts, workMins, uploadMedia, isVideo, signed };
})();

// Sign-in box on the "ต้องเข้าสู่ระบบก่อน" screen of every staff page, so nobody has to go back to staff.html first.
(() => {
  const add = async () => {
    const box = document.querySelector("#gate .panel");
    if (!box || box.querySelector(".gLogin")) return;
    try { const { data } = await RS.sb.auth.getSession(); if (!data || data.session) return; } catch (e) { return; }
    const f = document.createElement("form");
    f.className = "gLogin"; f.style.cssText = "display:flex;flex-direction:column;gap:10px;max-width:420px;margin-top:12px";
    f.innerHTML = `<b>หรือเข้าสู่ระบบที่นี่ได้เลย</b><label>อีเมล<input name="e" type="email" required autocomplete="username" style="width:100%"></label>
      <label>รหัสผ่าน<input name="p" type="password" required autocomplete="current-password" style="width:100%"></label>
      <div class="row" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center"><button class="btn primary">เข้าสู่ระบบ</button>
        <a href="staff.html">ลืมรหัสผ่าน / สมัครบัญชี</a></div><div class="meta" role="status"></div>`;
    f.addEventListener("submit", async ev => {
      ev.preventDefault(); const b = f.querySelector("button"), m = f.querySelector("[role=status]");
      b.disabled = true; m.textContent = "กำลังเข้าสู่ระบบ…";
      const { error } = await RS.sb.auth.signInWithPassword({ email: f.e.value.trim(), password: f.p.value });
      if (error) { b.disabled = false; m.textContent = /invalid/i.test(error.message) ? "อีเมลหรือรหัสผ่านไม่ถูกต้อง" : /confirm/i.test(error.message) ? "ยังไม่ได้ยืนยันอีเมล เปิดลิงก์ยืนยันในอีเมลก่อน" : RS.errText(error); return; }
      m.textContent = "เข้าสู่ระบบแล้ว กำลังเปิดหน้า…"; location.reload();
    });
    box.appendChild(f);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", add); else add();
})();

// Walk-round lock (FMS Round / Tracer, gate desk): a head locks the staff main menu on this phone with a separate
// lock password they make up. staff.html then asks for that password; every other page stays open.
// It is a deterrent on one shared phone, not account security: the head's own account password also unlocks it.
(() => {
  const PAGES = { "fms.html": "FMS Round / Tracer", "gate.html": "ป้อม รปภ." }, KEY = "rs-lock";
  const here = (location.pathname.split("/").pop() || "index.html").toLowerCase();
  const get = () => { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { return null; } };
  const set = v => { try { v ? localStorage.setItem(KEY, JSON.stringify(v)) : localStorage.removeItem(KEY); } catch (e) {} };
  const hash = async (salt, pw) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(salt + "|" + pw)))].map(b => b.toString(16).padStart(2, "0")).join("");
  const esc = RS.esc;
  const box = (title, sub, fields, okText, onOk, extra = "") => {
    const o = document.createElement("div");
    o.className = "rsLock"; o.style.cssText = "position:fixed;inset:0;z-index:9999;background:rgba(10,20,30,.55);display:flex;align-items:center;justify-content:center;padding:16px";
    o.innerHTML = `<form style="background:var(--surface,#fff);border-radius:14px;padding:18px 20px;width:min(420px,100%);display:flex;flex-direction:column;gap:10px;box-shadow:0 20px 60px rgba(0,0,0,.3)">
      <h2 style="margin:0;font-size:18px">${title}</h2><p class="sub" style="margin:0">${sub}</p>${fields}
      <div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn primary">${okText}</button>${extra}</div><div class="meta" role="status"></div></form>`;
    const f = o.querySelector("form"), m = f.querySelector("[role=status]"), b = f.querySelector("button.primary");
    f.addEventListener("submit", async ev => {
      ev.preventDefault(); b.disabled = true;
      try { const msg = await onOk(f); if (msg) { m.textContent = msg; b.disabled = false; return; } o.remove(); }
      catch (e) { m.textContent = RS.errText(e); b.disabled = false; }
    });
    o.addEventListener("click", ev => { if (ev.target.closest("[data-x]")) o.remove(); });
    document.body.appendChild(o); setTimeout(() => { const i = f.querySelector("input"); if (i) i.focus(); }, 50);
  };
  const pwField = (n, l, ac = "off") => `<label>${l}<input name="${n}" type="password" required autocomplete="${ac}" style="width:100%"></label>`;
  const unlock = L => async f => {
    const pw = f.p.value;
    if (L.salt && L.hash && await hash(L.salt, pw) === L.hash) { set(null); location.reload(); return; }
    if (L.email) { const { error } = await RS.sb.auth.signInWithPassword({ email: L.email, password: pw }); if (!error) { set(null); location.reload(); return; } }
    f.p.value = ""; return "รหัสไม่ถูกต้อง";
  };
  const run = async () => {
    const L = get();
    if (L && here === "staff.html") {
      return box("เมนูเจ้าหน้าที่ล็อกอยู่", `เครื่องนี้ล็อกไว้สำหรับเดินตรวจ · ใส่รหัสล็อกที่หัวหน้า (${esc(L.name || L.email || "")}) ตั้งไว้`,
        pwField("p", "รหัสล็อก"), "ปลดล็อก", unlock(L), `<a class="btn" href="${esc(L.page)}">กลับไปหน้า ${esc(PAGES[L.page] || L.page)}</a>`);
    }
    if (!PAGES[here]) return;
    const who = document.querySelector(".who"); if (!who) return;
    const b = document.createElement("button"); b.type = "button"; b.className = "btn small";
    if (L) {
      b.textContent = "🔒 ล็อกอยู่ · ปลดล็อก";
      b.onclick = () => box("ปลดล็อกเมนูเจ้าหน้าที่", "ใส่รหัสล็อกที่ตั้งไว้ตอนกดล็อก", pwField("p", "รหัสล็อก"), "ปลดล็อก", unlock(L), `<button class="btn" type="button" data-x>ยกเลิก</button>`);
      return who.appendChild(b);
    }
    let s = null; try { s = (await RS.sb.auth.getSession()).data.session; } catch (e) {}
    if (!s || !s.user) return;
    b.textContent = "🔒 ล็อกเมนูเจ้าหน้าที่"; b.title = "ตั้งรหัสล็อกแยก คนที่ใช้เครื่องนี้จะเข้าเมนูเจ้าหน้าที่ไม่ได้ แต่ใช้หน้านี้และหน้าอื่นได้";
    b.onclick = () => box("ล็อกเมนูเจ้าหน้าที่บนเครื่องนี้", `ตั้งรหัสล็อก (อย่างน้อย 4 ตัว) ไม่ต้องเป็นรหัสบัญชี คนที่ใช้เครื่องนี้ยังใช้หน้า ${PAGES[here]} และหน้าอื่นได้ แต่จะเข้าเมนูเจ้าหน้าที่ไม่ได้จนกว่าจะใส่รหัสนี้`,
      pwField("a", "รหัสล็อก", "new-password") + pwField("c", "พิมพ์รหัสล็อกอีกครั้ง", "new-password"), "ล็อก", async f => {
        if (f.a.value.length < 4) return "รหัสล็อกต้องมีอย่างน้อย 4 ตัว";
        if (f.a.value !== f.c.value) return "รหัสสองช่องไม่ตรงกัน";
        const salt = crypto.getRandomValues(new Uint32Array(2)).join("-"), nm = ((document.querySelector("#who") || {}).textContent || "").split("·")[0].trim();
        set({ page: here, salt, hash: await hash(salt, f.a.value), email: s.user.email || "", name: nm, at: Date.now() }); location.reload();
      }, `<button class="btn" type="button" data-x>ยกเลิก</button>`);
    who.appendChild(b);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run); else run();
})();
