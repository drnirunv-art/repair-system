# Seed data

Equipment lists for all 12 hospitals were imported (read-only) from each hospital's
Operation Dashboard Google Sheet, tab `OP_PT2`, columns A:C (system, code, name),
using `select * from import_equipment('<CODE>', '<json rows>'::jsonb);` (migration 0005).

Building-level locations were then added from "อาคาร X" mentions in equipment names
(floor `-`, department `พื้นที่ทั่วไป`). Departments from the contract still to be added.
