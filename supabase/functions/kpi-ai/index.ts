// Action plan for KPI items that lost points, written by three Claude roles in turn:
//   AI 1 (ผู้เสนอ) proposes corrective methods and a plan,
//   AI 2 (ผู้วิเคราะห์ทบทวน) analyses causes and reviews the proposal,
//   AI 3 (ผู้ตรวจสอบแก้ไข) fixes what AI 2 found and writes the final report as structured JSON.
// Secret: ANTHROPIC_API_KEY (set by the owner in Supabase > Edge Functions > Secrets). The caller must be signed in and allowed to see the hospital.
// Only KPI figures, targets and the head's notes are sent; no patient or staff personal data.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import Anthropic from "npm:@anthropic-ai/sdk";
import { zodOutputFormat } from "npm:@anthropic-ai/sdk/helpers/zod";
import { z } from "npm:zod";

const MODEL = "claude-opus-5-5";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const out = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

const Report = z.object({
  summary: z.string(),
  analysis: z.array(z.string()),
  items: z.array(z.object({
    code: z.string(), title: z.string(), root_cause: z.string(),
    actions: z.array(z.object({ step: z.string(), owner: z.string(), due: z.string(), measure: z.string() })),
    expected_result: z.string(),
  })),
  timeline: z.array(z.object({ when: z.string(), activity: z.string() })),
  risks: z.array(z.string()),
  review_notes: z.array(z.string()),
  follow_up: z.array(z.string()),
});

const CONTEXT = `บริบท: บริษัทผู้รับจ้างงานบริหารวิศวกรรมอาคารของโรงพยาบาล ถูกประเมิน KPI ตามสัญญา (เอกสารแนบ 4) ทุกเดือน คะแนนเต็ม 100 ผ่านที่ 90
บางโรงพยาบาลมีส่วนลดค่าบริการเมื่อไม่ผ่าน ผู้อ่านรายงานคือผู้บริหารโรงพยาบาลและหัวหน้างานวิศวกรรม
เขียนเป็นภาษาไทยที่อ่านง่าย ทุกวิธีแก้ต้องทำได้จริงในงานวิศวกรรมอาคารโรงพยาบาล มีผู้รับผิดชอบระดับตำแหน่ง (ไม่ใส่ชื่อคน) มีกำหนดเสร็จเป็นวันที่ และวัดผลได้ด้วยตัวเลข KPI ข้อนั้น
อย่าแต่งตัวเลขที่ไม่มีในข้อมูล ถ้าข้อมูลไม่พอ ให้บอกว่าต้องเก็บข้อมูลอะไรเพิ่ม`;

async function ask(ai: Anthropic, system: string, user: string) {
  // deno-lint-ignore no-explicit-any
  const r: any = await ai.beta.messages.create({
    model: MODEL, max_tokens: 12000, system, messages: [{ role: "user", content: user }],
    output_config: { effort: "medium" }, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
  // deno-lint-ignore no-explicit-any
  } as any);
  if (r.stop_reason === "refusal") throw new Error("AI ไม่ตอบคำขอนี้ ลองใหม่อีกครั้ง");
  // deno-lint-ignore no-explicit-any
  return (r.content as any[]).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const key = Deno.env.get("ANTHROPIC_API_KEY");
    if (!key) return out({ error: "ยังไม่ได้ตั้งค่า ANTHROPIC_API_KEY ในระบบ" }, 503);
    const auth = req.headers.get("Authorization") ?? "";
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
    const { data: u } = await db.auth.getUser();
    if (!u?.user) return out({ error: "ต้องเข้าสู่ระบบก่อน" }, 401);
    const body = await req.json();
    const { hospital_id, year, month } = body ?? {};
    // the same check the KPI page uses: raises when this person may not see the hospital
    const chk = await db.rpc("kpi_auto", { p_hospital: hospital_id, p_year: year, p_month: month });
    if (chk.error) return out({ error: chk.error.message }, 403);
    const data = JSON.stringify({ hospital: body.hospital, month: body.month_name, total: body.total, pass_mark: 90, discount: body.discount, failed: body.failed, system_figures: chk.data }).slice(0, 30000);
    const ai = new Anthropic({ apiKey: key });

    const p1 = await ask(ai, `${CONTEXT}\nบทบาทของคุณ: AI 1 ผู้เสนอ ให้เสนอวิธีแก้ไขและแผนงานสำหรับทุกข้อ KPI ที่ตก`,
      `ข้อมูล KPI เดือนนี้ (JSON):\n${data}\n\nเสนอวิธีแก้ไขทีละข้อที่ตก (failed) โดยใช้สาเหตุที่หัวหน้าเขียน (cause) และร่างวิธีแก้ (draft_action) เป็นจุดเริ่ม ให้มีขั้นตอน ผู้รับผิดชอบ กำหนดเสร็จ และตัวชี้วัดผล แล้วเสนอแผนเวลารวม 4 สัปดาห์`);
    const p2 = await ask(ai, `${CONTEXT}\nบทบาทของคุณ: AI 2 ผู้วิเคราะห์และทบทวน ให้วิเคราะห์สาเหตุราก (Root cause) และทบทวนข้อเสนอของ AI 1 อย่างตรงไปตรงมา`,
      `ข้อมูล KPI (JSON):\n${data}\n\nข้อเสนอของ AI 1:\n${p1}\n\nวิเคราะห์: สาเหตุรากของแต่ละข้อ ข้อใดเกี่ยวโยงกัน ข้อเสนอใดยังไม่ตรงสาเหตุ ทำไม่ได้จริง ขาดผู้รับผิดชอบ กำหนดเวลาไม่สมเหตุผล หรือวัดผลไม่ได้ ความเสี่ยงของแผน และสิ่งที่ควรเพิ่มหรือตัดออก`);
    const r3 = await ai.messages.parse({
      model: MODEL, max_tokens: 16000,
      system: `${CONTEXT}\nบทบาทของคุณ: AI 3 ผู้ตรวจสอบแก้ไขและนำเสนอ ให้แก้ข้อเสนอของ AI 1 ตามผลทบทวนของ AI 2 ตรวจว่าครบทุกข้อที่ตก แล้วเรียบเรียงเป็นรายงาน Action plan ฉบับสุดท้าย`,
      messages: [{ role: "user", content: `ข้อมูล KPI (JSON):\n${data}\n\nข้อเสนอของ AI 1:\n${p1}\n\nผลวิเคราะห์และทบทวนของ AI 2:\n${p2}\n\nเขียนรายงานฉบับสุดท้าย: summary = บทสรุปผู้บริหาร 3-5 ประโยค, analysis = บทวิเคราะห์, items = ทุกข้อที่ตกพร้อมสาเหตุรากและขั้นตอนแก้ไข (due เป็นวันที่ เช่น 15 ธ.ค. 2569), timeline = แผนรายสัปดาห์, risks = ความเสี่ยงของแผน, review_notes = สิ่งที่ AI 2 พบและ AI 3 แก้แล้ว, follow_up = วิธีติดตามผล` }],
      output_config: { format: zodOutputFormat(Report), effort: "medium" },
    });
    if (r3.stop_reason === "refusal" || !r3.parsed_output) throw new Error("AI 3 เรียบเรียงรายงานไม่สำเร็จ ลองใหม่อีกครั้ง");
    return out({ report: r3.parsed_output, steps: { proposer: p1, reviewer: p2 }, model: MODEL });
  } catch (e) {
    console.error(e);
    return out({ error: e instanceof Anthropic.APIError ? `AI ขัดข้อง (${e.status}) ลองใหม่อีกครั้ง` : String((e as Error)?.message ?? e) }, 500);
  }
});
