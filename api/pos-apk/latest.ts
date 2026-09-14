import { createClient } from '@supabase/supabase-js';

type VercelRequest = {
  method?: string;
  query?: Record<string, string | string[] | undefined>;
  url?: string;
};

type VercelResponse = {
  status: (code: number) => VercelResponse;
  setHeader: (name: string, value: string) => void;
  json: (body: unknown) => void;
  end: () => void;
};

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const truthyQueryValues = new Set(['1', 'true', 'yes', 'download']);

const jsonHeaders = (res: VercelResponse) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
};

const getQueryValue = (req: VercelRequest, key: string) => {
  const queryValue = req.query?.[key];
  if (Array.isArray(queryValue)) return queryValue[0];
  if (typeof queryValue === 'string') return queryValue;

  if (!req.url) return null;
  try {
    return new URL(req.url, 'https://cloud-admin.local').searchParams.get(key);
  } catch {
    return null;
  }
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  jsonHeaders(res);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ status: 'error', error: 'METHOD_NOT_ALLOWED' });
    return;
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    res.status(500).json({ status: 'error', error: 'SUPABASE_CONFIG_MISSING' });
    return;
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    db: { schema: 'landlord' },
  });

  const { data, error } = await supabase
    .from('pos_apk_releases')
    .select('version_name, version_code, apk_url, direct_download_url, checksum_sha256, changelog, release_type, release_status, summary, bugs_fixed, new_features, internal_changes, validation_checklist, install_notes, rollout_scope, published_at')
    .eq('release_status', 'available')
    .order('version_code', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('[pos-apk/latest] Failed to load latest release', error);
    res.status(500).json({ status: 'error', error: 'POS_APK_RELEASE_LOOKUP_FAILED' });
    return;
  }

  if (!data) {
    if (truthyQueryValues.has((getQueryValue(req, 'download') || '').toLowerCase())) {
      res.status(404).json({ status: 'error', error: 'POS_APK_RELEASE_NOT_FOUND' });
      return;
    }

    res.status(200).json({ status: 'ok', release: null });
    return;
  }

  const shouldDownload = truthyQueryValues.has((getQueryValue(req, 'download') || '').toLowerCase());
  if (shouldDownload) {
    const downloadUrl = data.direct_download_url || data.apk_url;
    res.setHeader('Location', downloadUrl);
    res.status(302).end();
    return;
  }

  res.status(200).json({ status: 'ok', release: data });
}
