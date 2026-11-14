window.RS_CONFIG={supabaseUrl:"http://x",supabaseKey:"k",defaultHospital:"PT1"};
const now=Date.now(), iso=m=>new Date(now-m*60000).toISOString();
const H={id:"h1",code:"PT1",name:"พญาไท1"};
const ME={id:"u1",full_name:"Owner Test",role:"owner",hospital_id:"h1",hospitals:H};
const DB={
 hospitals:[H],
 profiles:[{id:"u1",full_name:"Owner Test",role:"owner",active:true},{id:"u2",full_name:"ช่างหนึ่ง",role:"technician",active:true},{id:"u3",full_name:"ช่างสอง",role:"technician",active:true}],
 priorities:[{id:"p1",name:"Critical",sla_minutes:60,is_default:false},{id:"p3",name:"Non-priority",sla_minutes:1440,is_default:true}],
 job_types:[{id:"t1",code:"AC",name:"ระบบแอร์",standard_minutes:120,kpi:true}],
 locations:[{id:"l1",building:"อาคาร 1",floor:"ชั้น 1",department:"ER",active:true},{id:"l2",building:"อาคาร 1",floor:"ชั้น 2",department:"ICU",active:true}],
 hold_reasons:[{id:"r1",name:"รออะไหล่",active:true}],
 hospital_settings:[{hospital_id:"h1",require_photo:false,max_photos:6,alert_unassigned_min:5,alert_not_started_min:10,appointment_grace_min:120,hold_needs_approval:true,late_grace_min:15,contract_headcount:17}],
 staff_invites:[], equipment:[{id:"e1",name:"แอร์ ER",location_id:"l1"}],
 jobs:[
  {id:"j1",job_no:"PT1-6911-0001",status:"register",created_at:iso(30),detail:"ไฟดับ",building:"อาคาร 1",floor:"ชั้น 1",department:"ER",reporter_name:"สมชาย",reporter_phone:"0812345678",photo_paths:["PT1/a.jpg"],before_photo_paths:[],close_photo_paths:[],priority_id:"p1",hold_minutes:0},
  {id:"j2",job_no:"PT1-6911-0002",status:"assign",technician_id:"u2",assigned_at:iso(20),created_at:iso(40),detail:"แอร์ไม่เย็น",building:"อาคาร 1",floor:"ชั้น 2",department:"ICU",reporter_name:"ก",reporter_phone:"1111",photo_paths:[],before_photo_paths:[],close_photo_paths:[],priority_id:"p3",job_type_id:"t1",due_minutes:30,hold_minutes:0},
  {id:"j3",job_no:"PT1-6911-0003",status:"on_hold",technician_id:"u2",hold_status:"pending",hold_category:"รออะไหล่",hold_reason:"รอคอม",hold_until:"2026-11-01",hold_started_at:iso(100),created_at:iso(3000),detail:"ปั๊มรั่ว",building:"อาคาร 1",floor:"ชั้น 1",department:"ER",reporter_name:"ข",reporter_phone:"2222",photo_paths:[],before_photo_paths:["PT1/b.jpg"],close_photo_paths:[],priority_id:"p3",hold_minutes:10,appointment_at:iso(500),memo_requested:true},
  {id:"j4",job_no:"PT1-6911-0004",status:"clear",technician_id:"u3",cleared_at:iso(5),created_at:iso(200),detail:"ก๊อกน้ำ",building:"อาคาร 1",floor:"ชั้น 1",department:"ER",reporter_name:"ค",reporter_phone:"3333",summary:"เปลี่ยนวาล์ว",uses_parts:true,photo_paths:[],before_photo_paths:[],close_photo_paths:["PT1/c.mp4"],priority_id:"p3",hold_minutes:0,rating:4}],
 parts:[{id:"pa1",code:"EE-001",name:"หลอด LED 18W",unit:"หลอด",category:"ไฟฟ้า",store:"B1",min_qty:10,qty:4,unit_cost:120,active:true},{id:"pa2",code:"AC-001",name:"คอมเพรสเซอร์",unit:"ตัว",category:"แอร์",min_qty:0,qty:2,unit_cost:9000,active:true}],
 part_moves:[{id:1,part_id:"pa1",kind:"issue",qty:-2,qty_after:4,unit_cost:120,job_id:"j4",equipment_text:"ก๊อก ER",created_at:iso(100),actor_id:"u3"},{id:2,part_id:"pa1",kind:"receive",qty:6,qty_after:6,unit_cost:120,created_at:iso(1000),actor_id:"u1",note:"ยอดยกมา"}],
 purchase_requests:[{id:"pr1",pr_no:"PT1-PR-6911-001",job_id:"j3",reason:"รอคอมเพรสเซอร์",status:"requested",total:10500,requested_by:"u2",created_at:iso(60)},{id:"pr2",pr_no:"PT1-PR-6911-002",reason:"สต็อกหลอด",status:"approved",total:1200,requested_by:"u1",decided_by:"u1",created_at:iso(600)}],
 pr_items:[{id:1,pr_id:"pr1",part_id:"pa2",description:"คอมเพรสเซอร์",qty:1,unit:"ตัว",unit_price:9000},{id:2,pr_id:"pr1",description:"น้ำยา R32",qty:1,unit:"ถัง",unit_price:1500},{id:3,pr_id:"pr2",part_id:"pa1",description:"หลอด LED 18W",qty:10,unit:"หลอด",unit_price:120}],
 memos:[{id:"m1",memo_no:"PT1-MEMO-6911-001",job_id:"j3",pr_id:"pr1",subject:"ขออนุมัติซื้อคอมเพรสเซอร์",to_whom:"ผอ.",body:"รายละเอียด\nบรรทัด 2",amount:10500,status:"submitted",created_by:"u2",created_at:iso(50)}],

 contract_staffing:[{hospital_id:"h1",sort:1,position:"Project Manager",headcount:"1",hours:"08.00-17.00",days:"จันทร์-ศุกร์"},{hospital_id:"h1",sort:2,position:"Technician",headcount:"4",hours:"08.00-17.00",days:"จันทร์-อาทิตย์"}],
 shifts:[{id:"s1",name:"เช้า",start_time:"08:00:00",end_time:"17:00:00",sort:1,active:true,min_staff:4,note:"ตามสัญญา เอกสารแนบ 3"},{id:"s2",name:"บ่าย",start_time:"15:30:00",end_time:"00:30:00",sort:2,active:true,min_staff:3,note:"สัญญาระบุช่าง 11 คน 24 ชั่วโมง ไม่ได้แบ่งเวลากะ กะบ่าย/ดึกนี้ตั้งไว้ให้ก่อน แก้ได้"},{id:"s3",name:"ดึก",start_time:"00:00:00",end_time:"08:00:00",sort:3,active:true}],
 shift_reports:[{id:"sr1",work_date:new Date().toLocaleDateString("en-CA",{timeZone:"Asia/Bangkok"}),shift_id:"s1",author_id:"u2",status:"submitted",submitted_at:iso(300),notes:"ไฟดับ 10 นาที",handover:"ตามงาน PT1-6911-0003",issues:"ปั๊ม P2 เสียงดัง",stats:{received:3,assigned:2,started:2,held:1,cleared:1,closed:0,open_end:4,received_jobs:["PT1-6911-0001","PT1-6911-0002"],cleared_jobs:["PT1-6911-0004"]}}],
 shift_roster:[{id:"ro1",work_date:new Date().toLocaleDateString("en-CA",{timeZone:"Asia/Bangkok"}),shift_id:"s1",profile_id:"u2",check_in_at:new Date(new Date().toLocaleDateString("en-CA",{timeZone:"Asia/Bangkok"})+"T08:25:00+07:00").toISOString()},{id:"ro2",work_date:new Date().toLocaleDateString("en-CA",{timeZone:"Asia/Bangkok"}),shift_id:"s2",profile_id:"u1"},{id:"ro3",work_date:new Date().toLocaleDateString("en-CA",{timeZone:"Asia/Bangkok"}),shift_id:"s3",profile_id:"u3",check_in_at:null}],
 kb_articles:[{id:"k1",hospital_id:"h1",title:"แอร์ไม่เย็น น้ำหยด",job_type_id:"t1",equipment_text:"แอร์ Split",symptom:"ไม่เย็น",cause:"ฟิลเตอร์ตัน",solution:"ล้างฟิลเตอร์\nเป่าท่อน้ำทิ้ง",tags:"แอร์ ฟิลเตอร์",shared:true,author_id:"u2",created_at:iso(900),hospitals:{code:"PT1",name:"พญาไท1"}},{id:"k2",hospital_id:"h2",title:"ปั๊มน้ำไม่ตัด",solution:"เปลี่ยนเพรสเชอร์สวิตช์",shared:true,author_id:"x",created_at:iso(2000),hospitals:{code:"PT2",name:"พญาไท2"}}],
 monthly_notes:[],
 job_assignees:[{job_id:"j2",profile_id:"u2",is_lead:true,active:true},{job_id:"j2",profile_id:"u3",is_lead:false,active:true},{job_id:"j3",profile_id:"u2",is_lead:true,active:true}],
};
window.__calls=[];
function q(table){const st={t:table,single:false,f:[]};const p={select(){return p},eq(k,v){st.f.push([k,v]);return p},in(){return p},is(){return p},gte(){return p},lt(){return p},lte(){return p},neq(){return p},not(){return p},upsert(v){window.__calls.push(['upsert',table,v]);return p},single(){st.single=true;return p},or(){return p},order(){return p},range(){return p},limit(){return p},
 maybeSingle(){st.single=true;return p},update(v){window.__calls.push(["update",table,v]);return p},insert(v){window.__calls.push(["insert",table,v]);return p},delete(){return p},
 then(res,rej){let d=table==="profiles"&&st.single?ME:DB[table]||[];if(Array.isArray(d))d=d.filter(r=>st.f.every(([k,v])=>r[k]===undefined||r[k]===v));if(st.single&&Array.isArray(d))d=d[0]||null;return Promise.resolve({data:d,error:null}).then(res,rej)}};return p}
window.supabase={createClient(){return{from:q,
 rpc(n,a){window.__calls.push(["rpc",n,a]);if(n==="submit_job")return Promise.resolve({data:[{job_no:"PT1-6911-0009"}],error:null});
   if(n==="track_jobs_v2")return Promise.resolve({data:[{job_no:"PT1-6911-0004",created_at:iso(200),building:"อาคาร 1",floor:"ชั้น 1",department:"ER",detail:"ก๊อกน้ำ",status:"clear",technician:"ช่างสอง",reporter_masked:"ค*",phone_masked:"****3333",photo_paths:[],before_photo_paths:[],after_photo_paths:["PT1/c.jpg"],summary:"เปลี่ยนวาล์ว",can_rate:true}],error:null});
   if(n==="track_location_jobs")return Promise.resolve({data:[{job_no:"PT1-6911-0002",created_at:iso(40),detail:"แอร์ไม่เย็น",status:"assign",technician:"ช่างหนึ่ง",reporter_masked:"ก*",can_rate:false},{job_no:"PT1-6911-0005",created_at:iso(4000),detail:"หลอดไฟ",status:"close",closed_at:iso(3000),technician:"ช่างสอง",reporter_masked:"ง*",rating:5,can_rate:false}],error:null});
   if(n==="pm_import"||n==="pm_import_for")return Promise.resolve({data:{updated:0,added:a.p_rows.length},error:null});
   if(n==="pm_followup"||n==="pm_followup_by")return Promise.resolve({data:[{grp:"ปรับอากาศ",planned:40,done:22,waiting_sign:6,not_done:12,abnormal:2,pct:55,ytd_planned:300,ytd_done:240,ytd_pct:80},{grp:"ไฟฟ้า",planned:120,done:110,waiting_sign:10,not_done:0,abnormal:0,pct:92,ytd_planned:900,ytd_done:850,ytd_pct:94},{grp:"รวม",planned:160,done:132,waiting_sign:16,not_done:12,abnormal:2,pct:83,ytd_planned:1200,ytd_done:1090,ytd_pct:91}],error:null});
   if(n==="pm_followup_all"||n==="pm_followup_all_by")return Promise.resolve({data:["PT1","PT2","PLK"].map((c,i)=>({code:c,name:"รพ. "+c,machines:800+i,planned:i?100+i:null,done:i?80:null,waiting_sign:i?5:null,not_done:i?15+i:null,abnormal:i?1:null,pct:i?80:null,ytd_planned:i?900:null,ytd_done:i?700:null,ytd_pct:i?78:null})),error:null});
   if(n==="pm_followup_send_now")return Promise.resolve({data:1,error:null});
   if(n==="am_exec")return Promise.resolve({data:true,error:null});
   if(n==="shift_stats")return Promise.resolve({data:{received:1,assigned:1,started:0,held:0,cleared:0,closed:0,open_end:4,received_jobs:["PT1-6911-0001"],cleared_jobs:[]},error:null});
   if(n==="exec_overview")return Promise.resolve({data:["PT1","PT2","PT3","PTN","PTW","PTS","PTP","PLD","PLR","PLS","PLK","PLC"].map((c,i)=>({code:c,name:"โรงพยาบาล "+c,received:20+i,cleared:15+i,closed:12,open_now:10-i%5,late_open:i%3,on_hold:2,hold_pending:i%2,avg_close_min:300+i*20,sla_ok_pct:80+i,rating_avg:4.2,rating_n:8,parts_cost:1200*i,pr_pending:1,pr_value:5000})),error:null});
   return Promise.resolve({data:null,error:null})},
 storage:{from(){return{upload(p){window.__calls.push(["upload",p]);return Promise.resolve({error:null})},createSignedUrl(){return Promise.resolve({data:{signedUrl:"data:,"}})},createSignedUrls(ps){return Promise.resolve({data:ps.map(p=>({path:p,signedUrl:"data:image/gif;base64,R0lGODlhAQABAAAAACw="}))})}}}},
 auth:{getSession(){return Promise.resolve({data:{session:{user:{id:"u1"}}}})},onAuthStateChange(cb){setTimeout(()=>cb("SIGNED_IN",{user:{id:"u1",email:"o@x"}}),0)},signOut(){}},
 channel(){const c={on(){return c},subscribe(){return c}};return c},removeChannel(){}}}};
const _ym=new Date().toLocaleDateString("en-CA",{timeZone:"Asia/Bangkok"}).slice(0,7).split("-").map(Number);
DB.equipment=[
 {id:"e1",hospital_id:"h1",name:"BOOSTER PUMP 1 อาคาร A",tag:"A-BP-1-001",eq_type:"Booster Pump",building:"อาคาร A",floor:"ชั้น 1",place:"ห้องปั๊ม",pm_freq:"Q",pm_months:[2,5,8,11],pm_week:2,pm_by:"TW",active:true,code:"BP1"},
 {id:"e2",hospital_id:"h1",name:"ไฟฉุกเฉิน ทางออก ชั้น 2",tag:"A-EEL-2-001",eq_type:"ทั่วไป",building:"อาคาร A",floor:"ชั้น 2",place:"ทางออก",pm_freq:"M",pm_months:[1,2,3,4,5,6,7,8,9,10,11,12],pm_week:1,pm_by:"TW",active:true},
 {id:"e3",hospital_id:"h1",name:"AIR COOL CHILLER No.1 (MRI) ที่ยาวมากเพื่อทดสอบการตัดบรรทัดบนมือถือ",tag:null,eq_type:"Chiller",building:"อาคาร B",floor:"ดาดฟ้า",place:null,pm_freq:null,pm_months:[],pm_week:1,pm_by:"MA",active:true},
{id:"e4",hospital_id:"h1",name:"LIFT No.1",tag:"A-LF-1-001",eq_type:"Lift",system:"ลิฟต์",building:"อาคาร A",floor:"ชั้น 1",pm_freq:"M",pm_months:[1,2,3,4,5,6,7,8,9,10,11,12],pm_week:3,pm_by:"MA",pm_by_raw:"MA",pm_vendor:"บ. ลิฟต์ทดสอบ จำกัด",active:true},
{id:"e5",hospital_id:"h1",name:"GEN No.1",tag:"A-GEN-1-001",eq_type:"Generator",building:"อาคาร B",floor:"ชั้น 1",pm_freq:"Y",pm_months:[6],pm_week:1,pm_grid:{"21":"Y"},pm_by:"TW",pm_by_raw:"TW/MA",active:true}];
DB.pm_templates=[
 {id:"t0",hospital_id:null,eq_type:"ทั่วไป",items:[{t:"สภาพภายนอก",k:"level"},{t:"ทดสอบการทำงาน",k:"level"},{t:"ถ่ายรูปเครื่องหลังตรวจ",k:"level",ph:true}]},
 {id:"t1",hospital_id:null,eq_type:"Booster Pump",items:[{t:"แรงดันด้านจ่าย",k:"value",u:"bar",lo:2,hi:6},{t:"กระแสมอเตอร์",k:"value",u:"A"},{t:"เสียงและการสั่นปกติ",k:"level"},{t:"ไม่มีน้ำรั่วที่ซีล",k:"level",ph:true}]},
 {id:"t2",hospital_id:null,eq_type:"Chiller",items:[{t:"อุณหภูมิน้ำเย็นจ่าย",k:"value",u:"°C",lo:5,hi:8}]}];
DB.pm_tasks=[
 {id:"pt9",hospital_id:"h1",equipment_id:"e4",year:_ym[0],month:_ym[1],week:3,status:"approved",items:[],answers:[],score:100,abnormal:0,scanned:true,tech_id:"u2",submitted_at:iso(60)},
 {id:"pt1",hospital_id:"h1",equipment_id:"e1",year:_ym[0],month:_ym[1],week:2,status:"submitted",items:DB.pm_templates[1].items,answers:[{v:"3"},{v:"10"},{v:"ok"},{v:"bad",n:"ซีลรั่ว",ph:["PT1/pm/a.jpg"]}],score:75,abnormal:1,scanned:true,tech_id:"u2",submitted_at:iso(60)},
 {id:"pt2",hospital_id:"h1",equipment_id:"e2",year:_ym[0],month:_ym[1],week:1,status:"todo",items:[],answers:[],abnormal:0,scanned:false}];

DB.report_recipients=[{id:"r1",hospital_id:ME.hospital_id,kind:"pm_followup",email:"chief@example.com",active:true,created_at:"2026-11-01"},{id:"r2",hospital_id:ME.hospital_id,kind:"pm_followup",email:"old@example.com",active:false,created_at:"2026-11-02"}];
