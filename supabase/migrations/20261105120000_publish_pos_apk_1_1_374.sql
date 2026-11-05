-- Publica el APK 1.1.374 del POS y repara el canal roto de la 1.1.373.
--
-- Contexto: la fila más reciente (1.1.373) apuntaba a
-- https://alfa-admin-eta.vercel.app/apk/... , un proyecto Vercel abandonado que
-- devuelve 404. Cualquier terminal que comprobaba actualizaciones recibía un
-- enlace de descarga muerto.
--
-- El binario publicado en alfa-admin-nine es byte a byte el mismo
-- (sha256 a4f7e6cd...), por eso la reparación es solo de URL.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '2min';

-- 1. Reparar filas históricas que apuntan al host retirado.
update landlord.pos_apk_releases
set
  apk_url = replace(apk_url, 'https://alfa-admin-eta.vercel.app', 'https://alfa-admin-nine.vercel.app'),
  direct_download_url = replace(direct_download_url, 'https://alfa-admin-eta.vercel.app', 'https://alfa-admin-nine.vercel.app'),
  updated_at = timezone('utc'::text, now())
where apk_url like '%alfa-admin-eta.vercel.app%';

update landlord.pos_apk_releases
set
  direct_download_url = replace(direct_download_url, 'https://alfa-admin-eta.vercel.app', 'https://alfa-admin-nine.vercel.app'),
  updated_at = timezone('utc'::text, now())
where direct_download_url like '%alfa-admin-eta.vercel.app%';

-- 2. Registrar la 1.1.374 (idempotente por version_code).
insert into landlord.pos_apk_releases (
  version_name,
  version_code,
  apk_url,
  direct_download_url,
  checksum_sha256,
  changelog,
  release_type,
  release_status,
  summary,
  new_features,
  internal_changes,
  validation_checklist,
  install_notes,
  rollout_scope,
  is_latest
)
select
  '1.1.374',
  1374,
  'https://alfa-admin-nine.vercel.app/apk/Clic-Pos-1.1.374-release.apk',
  'https://alfa-admin-nine.vercel.app/apk/Clic-Pos-1.1.374-release.apk',
  'c1144d5e62a23c819b115bb6517593e24858aed7fa21df714fced8c29bc04c96',
  'Integra EGO Club (niveles, canje y tarjeta digital), pago CardNET por canal ECR Ethernet y corrige la identidad del dispositivo para que reinstalar la APK no obligue a reautorizar la caja.',
  'feature',
  'available',
  'Primera versión con EGO Club y CardNET en el mismo binario; el canal de actualizaciones ya apunta a ALFA-Admin.',
  -- En producción estas columnas son jsonb (202605232030_pos_apk_release_notes);
  -- la migración 20260525093000 las declara TEXT[] pero es no-op si ya existen.
  to_jsonb(array[
    'EGO Club: niveles de socio, canje en caja con código o tarjeta y reporte de venta al ERP.',
    'Tarjeta digital del socio con código QR.',
    'Pago con CardNET por ECR Ethernet (cobro, anulación, devolución y cierre de lote).',
    'Alta de socios sin conexión, con cola que se sincroniza al volver la red.'
  ]::text[]),
  to_jsonb(array[
    'El identificador de la caja se deriva de ANDROID_ID: reinstalar la APK conserva el mismo dispositivo y permite re-vincular sin reautorización manual.',
    'El canal de APK apunta a alfa-admin-nine; se elimina la referencia a cloud-admin-gamma del binario.',
    'Configuración de Supabase y ERP de producción embebida en la compilación.'
  ]::text[]),
  to_jsonb(array[
    'npx tsc -b sin errores.',
    'scripts/verify-ego-club-* 7/7 PASS.',
    'tests/cardnetEcrCodec + tests/posApkUpdateContract 30/30 PASS.',
    'Instalación verificada sobre 1.1.373 (misma firma CLIC POS, SHA-256 17746ded...).'
  ]::text[]),
  'Requiere Android 7.0 o superior (minSdk 24). Actualiza sobre 1.1.373 con la misma firma; no es necesario desinstalar.',
  'general',
  false
where not exists (
  select 1 from landlord.pos_apk_releases where version_code = 1374
);

-- 3. Recalcular la versión vigente: la de mayor version_code disponible.
update landlord.pos_apk_releases
set is_latest = false,
    updated_at = timezone('utc'::text, now())
where is_latest;

update landlord.pos_apk_releases
set is_latest = true,
    updated_at = timezone('utc'::text, now())
where id = (
  select id
  from landlord.pos_apk_releases
  where release_status = 'available'
  order by version_code desc, published_at desc
  limit 1
);

commit;
