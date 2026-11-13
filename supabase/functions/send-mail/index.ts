// Sends queued e-mails (public.email_outbox) through Gmail SMTP.
// Secrets: GMAIL_USER, GMAIL_APP_PASSWORD. Called by the database (pg_net) and pg_cron; takes no input.
// A row with "attach" gets an Excel file built here from live data (PM month results or the yearly master plan).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import nodemailer from "npm:nodemailer@6.9.16";
import { Buffer } from "node:buffer";
import { masterPlan, monthResult } from "./xlsx.ts";

const user = Deno.env.get("GMAIL_USER") ?? "";
const pass = (Deno.env.get("GMAIL_APP_PASSWORD") ?? "").replace(/\s+/g, "");
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

// deno-lint-ignore no-explicit-any
async function all(q: (from: number) => any) {
  // deno-lint-ignore no-explicit-any
  const out: any[] = [];
  for (let from = 0; ; from += 1000) { const { data, error } = await q(from); if (error) throw new Error(error.message); out.push(...(data ?? [])); if (!data || data.length < 1000) return out; }
}
// deno-lint-ignore no-explicit-any
async function attachment(r: any) {
  const a = r.attach; if (!a?.kind) return [];
  const { data: h, error } = await db.from("hospitals").select("code,name").eq("id", r.hospital_id).single();
  if (error) throw new Error(error.message);
  const equip = await all((f) => db.from("equipment").select("id,name,tag,place,building,floor,system,eq_type,pm_group,pm_by,pm_vendor,pm_grid,pm_months,pm_week,pm_freq")
    .eq("hospital_id", r.hospital_id).eq("active", true).order("tag").range(f, f + 999));
  const type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (a.kind === "pm_master_plan") return [{ filename: `PM_${h.code}_${a.year + 543}.xlsx`, content: Buffer.from(masterPlan(h.code, a.year, equip.filter((e) => (e.pm_months ?? []).length))), contentType: type }];
  if (a.kind === "pm_month") {
    const f = await db.rpc("pm_followup_core", { p_hospital: r.hospital_id, p_year: a.year, p_month: a.month }); if (f.error) throw new Error(f.error.message);
    const tasks = await all((from) => db.from("pm_tasks").select("equipment_id,week,status,score,abnormal,submitted_at,eng_at").eq("hospital_id", r.hospital_id).eq("year", a.year).eq("month", a.month).order("id").range(from, from + 999));
    return [{ filename: `PM-result-${h.code}-${a.year + 543}-${String(a.month).padStart(2, "0")}.xlsx`, content: Buffer.from(monthResult(h.name, h.code, a.year, a.month, f.data ?? [], equip, tasks)), contentType: type }];
  }
  return [];
}

Deno.serve(async () => {
  if (!user || !pass) return Response.json({ ok: false, reason: "GMAIL_USER / GMAIL_APP_PASSWORD not set" });
  const { data: rows, error } = await db.rpc("claim_outbox", { p_limit: 20 });
  if (error) return Response.json({ ok: false, reason: error.message }, { status: 500 });
  if (!rows?.length) return Response.json({ ok: true, sent: 0 });
  const mail = nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user, pass } });
  let sent = 0;
  for (const r of rows) {
    try {
      const from = r.attach ? `"งานวิศวกรรมอาคาร" <${user}>` : `"แจ้งซ่อม งานวิศวกรรมอาคาร" <${user}>`;
      await mail.sendMail({ from, to: r.to_email, subject: r.subject, text: r.body_text, attachments: await attachment(r) });
      await db.from("email_outbox").update({ status: "sent", sent_at: new Date().toISOString(), error: null }).eq("id", r.id);
      sent++;
    } catch (e) {
      const msg = String((e as Error)?.message ?? e).slice(0, 500);
      await db.from("email_outbox").update({ status: r.attempts >= 5 ? "failed" : "pending", error: msg }).eq("id", r.id);
    }
  }
  return Response.json({ ok: true, sent, of: rows.length });
});
