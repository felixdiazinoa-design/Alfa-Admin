import { readFileSync } from 'node:fs';

const manualPath = 'docs/helpdesk/clic-suite-copilot-manual.md';
const migrationPath = 'supabase/migrations/20260810234500_seed_clic_suite_copilot_manual.sql';
const manual = readFileSync(manualPath, 'utf8');
const migration = readFileSync(migrationPath, 'utf8');

const checks = [
    ['manual declares a version', manual.includes('**Versión:** 1.0')],
    ['manual explains retrieval rather than irreversible training', manual.includes('ni entrena de forma irreversible')],
    ['manual defines minimum diagnostic data', manual.includes('## 2. Datos mínimos para cualquier incidencia')],
    ['manual protects local pending data', manual.includes('No indicar reinstalación') && manual.includes('borrado de SQLite')],
    ['manual covers POS', manual.includes('## 3. ALFA-RMS POS')],
    ['manual covers ERP', manual.includes('## 4. ALFA-RMS')],
    ['manual covers ALFA-Admin', manual.includes('## 5. ALFA-Admin')],
    ['manual defines autonomous response policy', manual.includes('## 6. Política de respuesta autónoma')],
    ['manual cites all repositories', ['CLIC-POS/', 'CLIC-ERP/', 'Cloud-Admin/'].every((prefix) => manual.includes(`\`${prefix}`))],
    ['migration is idempotent', migration.includes('on conflict (module, title) do update')],
    ['migration reactivates updated knowledge', migration.includes('is_active = true')],
    ['migration includes at least 18 knowledge chunks', (migration.match(/'clic_suite_manual_v1'/g) || []).length >= 18],
    ['migration covers all products', ['POS ', 'ERP ', 'Cloud Admin '].every((module) => migration.includes(`'${module}`))],
    ['migration contains no absolute workstation path', !migration.includes('/Users/')],
    ['migration contains no obvious secret material', !/(sk-proj-|BEGIN PRIVATE KEY|SUPABASE_SERVICE_ROLE_KEY)/.test(migration)],
];

const failures = checks.filter(([, passed]) => !passed);
for (const [label, passed] of checks) {
    console.log(`${passed ? 'PASS' : 'FAIL'} ${label}`);
}

if (failures.length) {
    process.exitCode = 1;
} else {
    console.log(`PASS ${manualPath} and ${migrationPath} are ready for Copilot retrieval`);
}
