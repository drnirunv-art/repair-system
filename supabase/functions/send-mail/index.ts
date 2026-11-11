// Sends queued e-mails (public.email_outbox) through Gmail SMTP.
// Secrets: GMAIL_USER, GMAIL_APP_PASSWORD. Called by the database (pg_net) and pg_cron; takes no input.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import nodemailer from "npm:nodemailer@6.9.16";

const user = Deno.env.get("GMAIL_USER") ?? "";
const pass = (Deno.env.get("GMAIL_APP_PASSWORD") ?? "").replace(/\s+/g, "");
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

Deno.serve(async () => {
  if (!user || !pass) return Response.json({ ok: false, reason: "GMAIL_USER / GMAIL_APP_PASSWORD not set" });
  const { data: rows, error } = await db.rpc("claim_outbox", { p_limit: 20 });
  if (error) return Response.json({ ok: false, reason: error.message }, { status: 500 });
  if (!rows?.length) return Response.json({ ok: true, sent: 0 });
  const mail = nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user, pass } });
  let sent = 0;
  for (const r of rows) {
    try {
      await mail.sendMail({ from: `"แจ้งซ่อม งานวิศวกรรมอาคาร" <${user}>`, to: r.to_email, subject: r.subject, text: r.body_text });
      await db.from("email_outbox").update({ status: "sent", sent_at: new Date().toISOString(), error: null }).eq("id", r.id);
      sent++;
    } catch (e) {
      const msg = String((e as Error)?.message ?? e).slice(0, 500);
      await db.from("email_outbox").update({ status: r.attempts >= 5 ? "failed" : "pending", error: msg }).eq("id", r.id);
    }
  }
  return Response.json({ ok: true, sent, of: rows.length });
});
