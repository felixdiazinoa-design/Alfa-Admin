import { createClient } from '@supabase/supabase-js';

const isBrowser = typeof window !== 'undefined';
const browserEnv = isBrowser ? import.meta.env : {} as ImportMetaEnv;
const serverEnv = (globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
}).process?.env ?? {};

export const supabaseProjectUrl = isBrowser
    ? browserEnv.VITE_SUPABASE_URL
    : serverEnv.SUPABASE_URL || serverEnv.VITE_SUPABASE_URL;
const supabaseKey = isBrowser
    ? browserEnv.VITE_SUPABASE_ANON_KEY
    : serverEnv.SUPABASE_ANON_KEY || serverEnv.SUPABASE_SERVICE_ROLE_KEY;
const allowInsecureKeys = browserEnv.VITE_ALLOW_INSECURE_SUPABASE_KEYS === 'true';

function decodeJwtRole(token: string): string | null {
    try {
        const [, payload] = token.split('.');
        if (!payload) return null;
        const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
        const decoded = JSON.parse(atob(normalized));
        return typeof decoded.role === 'string' ? decoded.role : null;
    } catch {
        return null;
    }
}

function isPublicClientKey(token: string): boolean {
    if (token.startsWith('sb_publishable_')) return true;
    return decodeJwtRole(token) === 'anon';
}

if (!supabaseProjectUrl || !supabaseKey) {
    throw new Error('Missing Supabase Environment Variables');
}

if (isBrowser && !allowInsecureKeys) {
    if (!isPublicClientKey(supabaseKey)) {
        const anonRole = decodeJwtRole(supabaseKey);
        throw new Error(`VITE_SUPABASE_ANON_KEY must be anon or sb_publishable (current role: ${anonRole || 'unknown'})`);
    }
}

export const supabase = createClient(supabaseProjectUrl, supabaseKey, {
    auth: { persistSession: true },
    db: { schema: 'landlord' }
});

function createServerAdminClient() {
    if (isBrowser) return supabase;

    const serviceRoleKey = serverEnv.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceRoleKey) {
        throw new Error('Missing server-only SUPABASE_SERVICE_ROLE_KEY');
    }

    return createClient(supabaseProjectUrl, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
        db: { schema: 'landlord' }
    });
}

// Compatibility for server-side service modules. In the browser this is the
// authenticated public client; elevated credentials never enter the bundle.
export const supabaseAdmin = createServerAdminClient();

export const authorizeAdminRealtime = async () => {
    const { data } = await supabase.auth.getSession();
    const accessToken = data.session?.access_token;
    if (!accessToken) throw new Error('Sesión administrativa requerida.');
    supabase.realtime.setAuth(accessToken);
};
