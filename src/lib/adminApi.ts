import { supabase } from './supabase';

type AdminCommandResponse<T> = {
    data?: T;
    error?: string;
    message?: string;
};

export async function invokeAdminCommand<T>(
    action: string,
    payload: Record<string, unknown> = {},
): Promise<T> {
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    if (!accessToken) throw new Error('Sesión administrativa requerida.');

    const response = await fetch('/api/admin/command', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action, payload }),
    });

    const result = await response.json().catch(() => null) as AdminCommandResponse<T> | null;
    if (!response.ok) {
        throw new Error(result?.message || result?.error || 'La operación administrativa falló.');
    }

    return result?.data as T;
}
