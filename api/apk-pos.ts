import { createClient } from '@supabase/supabase-js';

type VercelRequest = {
    method?: string;
    query?: Record<string, string | string[] | undefined>;
    url?: string;
};

type VercelResponse = {
    status: (code: number) => VercelResponse;
    setHeader: (name: string, value: string) => void;
    end: (body?: string) => void;
};

type ReleaseRow = {
    version_name: string;
    version_code: number;
    apk_url: string;
    direct_download_url: string | null;
    checksum_sha256: string | null;
    changelog: string | null;
    published_at: string | null;
};

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const DOWNLOAD_QUERY_VALUES = new Set(['1', 'true', 'yes', 'download']);

function escapeHtml(value: unknown): string {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function getQueryValue(req: VercelRequest, key: string): string | null {
    const value = req.query?.[key];
    if (Array.isArray(value)) return value[0] ?? null;
    if (typeof value === 'string') return value;

    if (!req.url) return null;
    try {
        return new URL(req.url, 'https://cloud-admin.local').searchParams.get(key);
    } catch {
        return null;
    }
}

function formatDate(value: string | null): string {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    try {
        return date.toLocaleString('es-DO', {
            dateStyle: 'medium',
            timeStyle: 'short',
            timeZone: 'America/Santo_Domingo',
        });
    } catch {
        return date.toISOString();
    }
}

function renderPage(release: ReleaseRow | null, errorMessage?: string): string {
    const content = errorMessage
        ? `
    <p class="eyebrow">ALFA-RMS POS</p>
    <h1>Descarga no disponible</h1>
    <p class="hint">${escapeHtml(errorMessage)}</p>`
        : release
            ? `
    <p class="eyebrow">Versión publicada</p>
    <h1>${escapeHtml(release.version_name)}</h1>
    <p class="meta">Build ${escapeHtml(release.version_code)} · ${escapeHtml(formatDate(release.published_at))}</p>
    ${release.changelog ? `<p class="changelog">${escapeHtml(release.changelog)}</p>` : ''}
    <a class="button" href="${escapeHtml(release.direct_download_url || release.apk_url)}" rel="noopener">Descargar APK</a>
    ${release.checksum_sha256 ? `<p class="checksum">SHA-256<br><code>${escapeHtml(release.checksum_sha256)}</code></p>` : ''}
    <p class="hint">Si ya tienes la app instalada, Android la actualizará sobre la versión actual.</p>`
            : `
    <p class="eyebrow">ALFA-RMS POS</p>
    <h1>Sin versión disponible</h1>
    <p class="hint">Todavía no hay una versión publicada. Inténtalo de nuevo más tarde.</p>`;

    return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#00A7A0">
<title>ALFA-RMS POS · Descarga</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px;
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    background: #0f172a; color: #0f172a; }
  main { width: 100%; max-width: 440px; background: #fff; border-radius: 20px; padding: 32px 28px;
    box-shadow: 0 24px 60px rgba(2, 6, 23, .45); }
  .eyebrow { margin: 0 0 4px; font-size: 11px; font-weight: 800; letter-spacing: .18em;
    text-transform: uppercase; color: #00A7A0; }
  h1 { margin: 0; font-size: 30px; line-height: 1.1; }
  .meta { margin: 8px 0 0; font-size: 13px; color: #64748b; }
  .changelog { margin: 20px 0 0; font-size: 15px; line-height: 1.55; color: #334155; white-space: pre-line; }
  .button { display: block; margin: 24px 0 0; padding: 16px; border-radius: 14px; background: #00A7A0;
    color: #fff; text-align: center; font-size: 16px; font-weight: 800; text-decoration: none; }
  .button:active { transform: translateY(1px); }
  .checksum { margin: 20px 0 0; font-size: 11px; color: #64748b; word-break: break-all; }
  .checksum code { font-size: 10px; color: #334155; }
  .hint { margin: 18px 0 0; font-size: 12px; line-height: 1.5; color: #94a3b8; }
  @media (prefers-color-scheme: dark) {
    body { background: #020617; }
    main { background: #0f172a; color: #e2e8f0; }
    .changelog { color: #cbd5e1; }
    .meta, .checksum, .hint { color: #94a3b8; }
    .checksum code { color: #cbd5e1; }
  }
</style>
</head>
<body>
<main>${content}</main>
</body>
</html>`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');

    if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
    }

    if (req.method !== 'GET') {
        res.status(405).end(renderPage(null, 'Método no permitido.'));
        return;
    }

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
        res.status(500).end(renderPage(null, 'La descarga no está configurada en este entorno.'));
        return;
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
        db: { schema: 'landlord' },
    });

    const { data, error } = await supabase
        .from('pos_apk_releases')
        .select('version_name, version_code, apk_url, direct_download_url, checksum_sha256, changelog, published_at')
        .eq('release_status', 'available')
        .order('version_code', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) {
        console.error('[apk-pos] Failed to load latest release', error);
        res.status(500).end(renderPage(null, 'No se pudo consultar la versión publicada.'));
        return;
    }

    const release = (data as ReleaseRow | null) ?? null;
    const wantsDownload = DOWNLOAD_QUERY_VALUES.has((getQueryValue(req, 'download') || '').toLowerCase());

    if (wantsDownload) {
        if (!release) {
            res.status(404).end(renderPage(null));
            return;
        }
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Location', release.direct_download_url || release.apk_url);
        res.status(302).end();
        return;
    }

    res.status(200).end(renderPage(release));
}
