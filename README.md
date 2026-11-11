# Repair System (ระบบแจ้งซ่อม งานวิศวกรรมอาคาร)

New repair and maintenance system for hospital building engineering, rebuilt with its own design. Static web app + Supabase.

## Structure

- `web/index.html` – public page: repair request form and status tracking (no login)
- `web/staff.html` – staff page: work orders, dashboard, settings (login by email)
- `web/assets/` – styles, config (Supabase URL + publishable key) and scripts
- `supabase/migrations/` – database schema, applied to Supabase project `repair-system` (ref `ufyhxubzpoqjkvrejxek`)

## Phase 1 features

- Repair request: building > floor > department, job type, equipment, details, reporter, optional photo (resized, private bucket). Job number `<HOSPITAL>-<BE YYMM>-<0001>`.
- Status tracking by job number, phone or name.
- Work orders: assign technician / priority / job type, start, hold (reason + return date), clear (summary + parts used), supervisor close / send back / cancel, full history. Live updates.
- Dashboard: date range, open jobs, waiting, over SLA, average close time, jobs by type / technician / building, SLA per priority.
- Settings (managers): staff and roles, priorities and SLA, locations, job types.
- Roles: owner, admin, chief_engineer, supervisor, senior_technician, technician, safety_officer (จป.), observer. Each hospital only sees its own data (RLS).

## Deploy (GitHub Pages)

1. Push this repo, then Settings > Pages > Source: "GitHub Actions" (workflow in `.github/workflows/pages.yml` publishes `web/`).
2. Open `https://<user>.github.io/repair-system/?h=<HOSPITAL_CODE>`.

## First setup

1. Add hospitals, e.g. `insert into hospitals (code, name) values ('PT1', 'โรงพยาบาล ...');`
2. Sign up on `staff.html`, then make that account the owner:
   `update profiles set hospital_id = (select id from hospitals where code='PT1'), role='owner' where id = (select id from auth.users where email='...');`
3. Owner adds locations, job types, priorities and staff in the Settings tab.
