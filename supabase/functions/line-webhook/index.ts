// LINE webhook: records the groups the bot is invited to (public.line_groups) and answers two words typed in a group.
// Secrets: LINE_CHANNEL_SECRET (checks the X-Line-Signature, so only LINE can call this), LINE_CHANNEL_ACCESS_TOKEN (replies, group names).
// Deployed with verify_jwt off because LINE does not send a Supabase token; the signature check is the guard.
// Replies use the reply token, which LINE does not count against the monthly message quota.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const secret = Deno.env.get("LINE_CHANNEL_SECRET") ?? "";
const token = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN") ?? "";
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const SETUP = "https://drnirunv-art.github.io/repair-system/staff.html";

async function validSig(raw: string, sig: string | null) {
  if (!secret || !sig) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)));
  const b64 = btoa(String.fromCharCode(...mac));
  if (b64.length !== sig.length) return false;
  let d = 0; for (let i = 0; i < b64.length; i++) d |= b64.charCodeAt(i) ^ sig.charCodeAt(i);
  return d === 0;
}
async function api(path: string, init: RequestInit = {}) {
  if (!token) return null;
  const r = await fetch("https://api.line.me" + path, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });
  return r.ok ? await r.json().catch(() => ({})) : null;
}
const reply = (replyToken: string, text: string) => api("/v2/bot/message/reply", { method: "POST", body: JSON.stringify({ replyToken, messages: [{ type: "text", text }] }) });

// deno-lint-ignore no-explicit-any
function source(s: any) { return s?.type === "group" ? { id: s.groupId, kind: "group" } : s?.type === "room" ? { id: s.roomId, kind: "room" } : { id: s?.userId, kind: "user" }; }
async function nameOf(src: { id: string; kind: string }) {
  // deno-lint-ignore no-explicit-any
  const j: any = src.kind === "group" ? await api(`/v2/bot/group/${src.id}/summary`) : src.kind === "user" ? await api(`/v2/bot/profile/${src.id}`) : null;
  return j?.groupName ?? j?.displayName ?? null;
}
async function remember(src: { id: string; kind: string }) {
  const name = await nameOf(src);
  const { data: had } = await db.from("line_groups").select("id,left_at").eq("line_id", src.id).maybeSingle();
  if (had) await db.from("line_groups").update({ left_at: null, ...(name ? { name } : {}) }).eq("id", had.id);
  else await db.from("line_groups").insert({ line_id: src.id, kind: src.kind, name });
  return name;
}
async function status(src: { id: string }) {
  const { data: g } = await db.from("line_groups").select("*,hospitals(code,name)").eq("line_id", src.id).maybeSingle();
  if (!g) return "กลุ่มนี้ยังไม่อยู่ในระบบ ลองเชิญบอทออกแล้วเชิญเข้ามาใหม่";
  const for_ = g.all_hospitals ? "ทุกโรงพยาบาล" : g.hospitals ? `${g.hospitals.code} ${g.hospitals.name}` : "ยังไม่ได้เลือกโรงพยาบาล";
  const what = [g.notify_new && "งานใหม่", g.notify_resp && "เกินเวลาตอบรับ", g.notify_sla && "เกิน SLA"].filter(Boolean).join(", ") || "ไม่มี";
  return `สถานะกลุ่มนี้\nชื่อกลุ่ม: ${g.name ?? "-"}\nรับแจ้งเตือนของ: ${for_}\nเรื่องที่แจ้ง: ${what}\nการส่ง: ${g.active ? "เปิดอยู่" : "ยังไม่เปิด (หัวหน้าตั้งค่าที่ " + SETUP + " แท็บ ตั้งค่า > แจ้งเตือน LINE)"}`;
}

Deno.serve(async (req) => {
  const raw = await req.text();
  if (!(await validSig(raw, req.headers.get("x-line-signature")))) return new Response("bad signature", { status: 401 });
  // deno-lint-ignore no-explicit-any
  let body: any = {}; try { body = JSON.parse(raw); } catch { /* empty */ }
  for (const ev of body.events ?? []) {
    try {
      const src = source(ev.source); if (!src.id) continue;
      if (ev.type === "join" || ev.type === "follow") {
        const name = await remember(src);
        await reply(ev.replyToken, `สวัสดีครับ บอทแจ้งเตือนงานซ่อม (ระบบ FM และวิศวกรรมอาคาร) เข้ามาแล้ว\n${name ? "ชื่อ: " + name + "\n" : ""}ขั้นต่อไป: หัวหน้าเปิด ${SETUP} แท็บ “ตั้งค่า” หัวข้อ “แจ้งเตือน LINE” เลือกโรงพยาบาลของกลุ่มนี้ แล้วกด “บันทึก” ระบบจึงจะเริ่มส่ง\nพิมพ์คำว่า สถานะ ในกลุ่มนี้เมื่อต้องการดูการตั้งค่า`);
      } else if (ev.type === "leave" || ev.type === "unfollow") {
        await db.from("line_groups").update({ left_at: new Date().toISOString(), active: false }).eq("line_id", src.id);
      } else if (ev.type === "message" && ev.message?.type === "text") {
        const t = String(ev.message.text ?? "").trim();
        if (/^(สถานะ|status|รหัสกลุ่ม)$/i.test(t)) { await remember(src); await reply(ev.replyToken, await status(src)); }
      }
    } catch (_) { /* never fail the webhook: LINE retries otherwise */ }
  }
  return new Response("ok");
});
