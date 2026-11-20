// Pushes queued LINE alerts (public.line_outbox) to LINE groups through the LINE Messaging API.
// Secret: LINE_CHANNEL_ACCESS_TOKEN. Called by the database (pg_net, right after a row is queued, and every 5 minutes); takes no input.
// Rows waiting for the same group are joined into one push (up to 5 text bubbles), so many alerts use one message of the monthly quota.
// POST {"status":true} with a signed-in user's token only reports whether the token is set and this month's quota (for the settings page).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const token = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN") ?? "";
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const LIMIT = 4900;   // LINE text bubble limit is 5,000 characters

async function line(path: string, init: RequestInit = {}) {
  const r = await fetch("https://api.line.me" + path, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) } });
  const t = await r.text(); let j: unknown = null; try { j = t ? JSON.parse(t) : null; } catch { j = t; }
  if (!r.ok) throw new Error(`LINE ${r.status}: ${typeof j === "object" ? JSON.stringify(j) : t}`.slice(0, 500));
  return j;
}

// split texts into bubbles of at most LIMIT characters without cutting any alert; a single longer alert is split on line breaks
function bubbles(texts: string[]) {
  const parts: string[] = [];
  for (const t of texts) {
    if (t.length <= LIMIT) { parts.push(t); continue; }
    let cur = "";
    for (const ln of t.split("\n")) {
      if ((cur + "\n" + ln).length > LIMIT && cur) { parts.push(cur); cur = "(ต่อ)\n" + ln; } else cur = cur ? cur + "\n" + ln : ln;
    }
    if (cur) parts.push(cur);
  }
  const out: string[] = []; let cur = "";
  for (const p of parts) {
    const sep = "\n\n────────\n\n";
    if (cur && (cur + sep + p).length > LIMIT) { out.push(cur); cur = p; } else cur = cur ? cur + sep + p : p;
  }
  if (cur) out.push(cur);
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  let body: Record<string, unknown> = {}; try { body = await req.json(); } catch { /* no body */ }
  if (body.status) {
    const auth = req.headers.get("Authorization")?.replace("Bearer ", "") ?? "";
    const u = await db.auth.getUser(auth);
    if (!u.data?.user) return Response.json({ ok: false, reason: "sign in" }, { status: 401, headers: cors });
    if (!token) return Response.json({ ok: true, token: false }, { headers: cors });
    try {
      // deno-lint-ignore no-explicit-any
      const [q, c, b]: any = await Promise.all([line("/v2/bot/message/quota"), line("/v2/bot/message/quota/consumption"), line("/v2/bot/info")]);
      return Response.json({ ok: true, token: true, quota: q?.value ?? null, quotaType: q?.type ?? null, used: c?.totalUsage ?? null, bot: b?.displayName ?? null, basicId: b?.basicId ?? null }, { headers: cors });
    } catch (e) { return Response.json({ ok: true, token: true, error: String((e as Error).message) }, { headers: cors }); }
  }
  if (!token) return Response.json({ ok: false, reason: "LINE_CHANNEL_ACCESS_TOKEN not set" });
  const { data: rows, error } = await db.rpc("line_claim", { p_limit: 50 });
  if (error) return Response.json({ ok: false, reason: error.message }, { status: 500 });
  if (!rows?.length) return Response.json({ ok: true, sent: 0 });

  // group by target
  const byTarget = new Map<string, { id: number; body: string }[]>();
  // deno-lint-ignore no-explicit-any
  for (const r of rows as any[]) for (const t of r.targets ?? []) { if (!byTarget.has(t)) byTarget.set(t, []); byTarget.get(t)!.push({ id: r.id, body: r.body }); }
  const done = new Map<number, string[]>(), errs = new Map<number, string>();
  for (const [to, list] of byTarget) {
    const msgs = bubbles(list.map((x) => x.body));
    try {
      for (let i = 0; i < msgs.length; i += 5) {
        await line("/v2/bot/message/push", { method: "POST", body: JSON.stringify({ to, messages: msgs.slice(i, i + 5).map((text) => ({ type: "text", text })) }) });
      }
      for (const x of list) done.set(x.id, [...(done.get(x.id) ?? []), to]);
    } catch (e) {
      const m = String((e as Error).message);
      for (const x of list) errs.set(x.id, m);
      // the bot was removed from the group or the id is wrong: stop sending to it
      if (/LINE 40[34]/.test(m) || (/LINE 400/.test(m) && /'to'/.test(m))) await db.from("line_groups").update({ active: false }).eq("line_id", to);
    }
  }
  let sent = 0;
  // deno-lint-ignore no-explicit-any
  for (const r of rows as any[]) {
    const ok = done.get(r.id) ?? [];
    const { data: cur } = await db.from("line_outbox").select("sent_to,attempts").eq("id", r.id).single();
    const sentTo = [...new Set([...(cur?.sent_to ?? []), ...ok])];
    if (!errs.has(r.id)) { await db.from("line_outbox").update({ status: "sent", sent_at: new Date().toISOString(), sent_to: sentTo, error: (r.targets ?? []).length ? null : "ไม่มีกลุ่มที่ต้องส่ง" }).eq("id", r.id); sent++; }
    else await db.from("line_outbox").update({ status: (cur?.attempts ?? 0) >= 5 ? "failed" : "pending", sent_to: sentTo, error: errs.get(r.id) }).eq("id", r.id);
  }
  return Response.json({ ok: true, sent, of: rows.length, groups: byTarget.size });
});
