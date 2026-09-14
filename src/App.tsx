import { lazy, Suspense, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Layout } from './components/Layout'
import { ForgotPasswordDialog } from './components/ForgotPasswordDialog'
import { ResetPasswordScreen } from './components/ResetPasswordScreen'
import { supabase } from './lib/supabase'
import { invokeAdminCommand } from './lib/adminApi'
import type { CloudAdminProfile, CloudAdminUser } from './types'
import type { CloudAdminPermissionKey } from './types'
import { hasCloudAdminPermission } from './lib/cloudAdminPermissions'

const Dashboard = lazy(() => import('./pages/Dashboard').then((module) => ({ default: module.Dashboard })));
const Tenants = lazy(() => import('./pages/Tenants').then((module) => ({ default: module.Tenants })));
const Customers = lazy(() => import('./pages/Customers').then((module) => ({ default: module.Customers })));
const KillSwitch = lazy(() => import('./pages/KillSwitch').then((module) => ({ default: module.KillSwitch })));
const Plans = lazy(() => import('./pages/Plans').then((module) => ({ default: module.Plans })));
const Configuration = lazy(() => import('./pages/Configuration').then((module) => ({ default: module.Configuration })));
const PosApkReleases = lazy(() => import('./pages/PosApkReleases').then((module) => ({ default: module.PosApkReleases })));
const SupportCommandCenter = lazy(() => import('./pages/SupportCommandCenter'));
const AccessManagement = lazy(() => import('./pages/AccessManagement').then((module) => ({ default: module.AccessManagement })));
const OperationalObservability = lazy(() => import('./pages/OperationalObservability').then((module) => ({ default: module.OperationalObservability })));
const InternalRequests = lazy(() => import('./pages/InternalRequests').then((module) => ({ default: module.InternalRequests })));
const KnowledgeCenter = lazy(() => import('./pages/KnowledgeCenter').then((module) => ({ default: module.KnowledgeCenter })));
const ImplementationCalendar = lazy(() => import('./pages/ImplementationCalendar').then((module) => ({ default: module.ImplementationCalendar })));

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

interface CloudAdminSession {
    authUser: User;
    adminUser: CloudAdminUser;
    profile: CloudAdminProfile | null;
}

function clearSupabaseAuthStorage() {
    if (typeof window === 'undefined') return;
    const clearMatchingKeys = (storage: Storage) => {
        Object.keys(storage)
            .filter((key) => key.startsWith('sb-') && key.includes('auth-token'))
            .forEach((key) => storage.removeItem(key));
    };

    clearMatchingKeys(window.localStorage);
    clearMatchingKeys(window.sessionStorage);
}

function isPasswordRecoveryRedirect() {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('passwordRecovery') === '1';
}

function clearPasswordRecoveryUrl() {
    if (typeof window === 'undefined') return;
    window.history.replaceState(null, '', window.location.pathname || '/');
}

async function resolveCloudAdminSession(session: Session | null): Promise<CloudAdminSession | null> {
    const authUser = session?.user;
    if (!authUser?.id) return null;

    const { adminUser, profile } = await invokeAdminCommand<{
        adminUser: CloudAdminUser | null;
        profile: CloudAdminProfile | null;
    }>('session');

    if (!adminUser || adminUser.status === 'suspended') return null;

    return { authUser, adminUser, profile };
}

function App() {
    const [authStatus, setAuthStatus] = useState<AuthStatus>('loading');
    const [cloudAdminSession, setCloudAdminSession] = useState<CloudAdminSession | null>(null);
    const [authError, setAuthError] = useState<string | null>(null);
    const [signingOut, setSigningOut] = useState(false);
    const [passwordRecoveryMode, setPasswordRecoveryMode] = useState(isPasswordRecoveryRedirect);

    useEffect(() => {
        let mounted = true;

        const loadSession = async () => {
            try {
                const { data, error } = await supabase.auth.getSession();
                if (error) throw error;
                if (isPasswordRecoveryRedirect()) {
                    if (!mounted) return;
                    setPasswordRecoveryMode(true);
                    setCloudAdminSession(null);
                    setAuthStatus(data.session ? 'authenticated' : 'unauthenticated');
                    return;
                }
                const resolved = await resolveCloudAdminSession(data.session);
                if (!mounted) return;
                setCloudAdminSession(resolved);
                setAuthStatus(resolved ? 'authenticated' : 'unauthenticated');
                if (data.session && !resolved) {
                    setAuthError('Tu usuario no tiene acceso activo a Cloud-Admin.');
                    await supabase.auth.signOut();
                    clearSupabaseAuthStorage();
                }
            } catch (error) {
                console.error('Cloud-Admin auth bootstrap failed', error);
                if (!mounted) return;
                setCloudAdminSession(null);
                setAuthStatus('unauthenticated');
                setAuthError(getAuthErrorMessage(error));
                clearSupabaseAuthStorage();
            }
        };

        void loadSession();

        const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
            if (event === 'PASSWORD_RECOVERY' || (event === 'SIGNED_IN' && isPasswordRecoveryRedirect())) {
                setPasswordRecoveryMode(true);
                setCloudAdminSession(null);
                setAuthStatus('authenticated');
                return;
            }

            if (event === 'SIGNED_OUT') {
                setCloudAdminSession(null);
                setAuthStatus('unauthenticated');
                return;
            }

            if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') {
                void resolveCloudAdminSession(session)
                    .then((resolved) => {
                        if (!mounted) return;
                        setCloudAdminSession(resolved);
                        setAuthStatus(resolved ? 'authenticated' : 'unauthenticated');
                    })
                    .catch((error) => {
                        console.error('Cloud-Admin auth state failed', error);
                        if (!mounted) return;
                        setCloudAdminSession(null);
                        setAuthStatus('unauthenticated');
                        setAuthError(getAuthErrorMessage(error));
                    });
            }
        });

        return () => {
            mounted = false;
            listener.subscription.unsubscribe();
        };
    }, []);

    const handleLogin = async (email: string, password: string) => {
        setAuthError(null);
        const { data, error } = await supabase.auth.signInWithPassword({
            email: email.trim().toLowerCase(),
            password,
        });

        if (error) throw error;

        const resolved = await resolveCloudAdminSession(data.session);
        if (!resolved) {
            await supabase.auth.signOut();
            clearSupabaseAuthStorage();
            throw new Error('Tu usuario no tiene acceso activo a Cloud-Admin.');
        }

        setCloudAdminSession(resolved);
        setAuthStatus('authenticated');
    };

    const handleSignOut = async () => {
        setSigningOut(true);
        setAuthError(null);
        try {
            await supabase.auth.signOut();
        } catch (error) {
            console.warn('Supabase sign out returned an error; clearing local session anyway.', error);
        } finally {
            clearSupabaseAuthStorage();
            setCloudAdminSession(null);
            setAuthStatus('unauthenticated');
            setSigningOut(false);
        }
    };

    const leavePasswordRecovery = async () => {
        try {
            await supabase.auth.signOut();
        } catch (error) {
            console.warn('Supabase recovery sign out returned an error; clearing local session anyway.', error);
        } finally {
            clearSupabaseAuthStorage();
            clearPasswordRecoveryUrl();
            setPasswordRecoveryMode(false);
            setCloudAdminSession(null);
            setAuthStatus('unauthenticated');
            setAuthError(null);
        }
    };

    if (authStatus === 'loading') {
        return <AuthLoadingScreen />;
    }

    if (passwordRecoveryMode) {
        return <ResetPasswordScreen onComplete={leavePasswordRecovery} onCancel={leavePasswordRecovery} />;
    }

    if (!cloudAdminSession) {
        return <LoginScreen error={authError} onLogin={handleLogin} />;
    }

    const permissions = cloudAdminSession.profile?.permissions;
    const allowed = (permission: CloudAdminPermissionKey) => hasCloudAdminPermission(permissions, permission);

    return (
        <HashRouter>
            <Suspense fallback={<PageLoadingScreen />}>
            <Routes>
                <Route
                    path="/"
                    element={(
                        <Layout
                            adminName={cloudAdminSession.adminUser.full_name}
                            adminEmail={cloudAdminSession.adminUser.email || cloudAdminSession.authUser.email}
                            adminRole={cloudAdminSession.profile?.name || 'Cloud Admin'}
                            permissions={permissions}
                            signingOut={signingOut}
                            onSignOut={() => void handleSignOut()}
                        />
                    )}
                >
                    <Route index element={<PermissionGate allowed={allowed('dashboard_view')}><Dashboard /></PermissionGate>} />
                    <Route path="tenants" element={<PermissionGate allowed={allowed('tenants_view')}><Tenants permissions={permissions} /></PermissionGate>} />
                    <Route path="clientes" element={<PermissionGate allowed={allowed('tenants_view')}><Customers /></PermissionGate>} />
                    <Route path="plans" element={<PermissionGate allowed={allowed('plans_view')}><Plans /></PermissionGate>} />
                    <Route path="pos-apk" element={<PermissionGate allowed={allowed('apk_view')}><PosApkReleases canManage={allowed('apk_manage')} /></PermissionGate>} />
                    <Route path="support" element={<PermissionGate allowed={allowed('support_view')}><SupportCommandCenter /></PermissionGate>} />
                    <Route path="conocimiento" element={<PermissionGate allowed={allowed('knowledge_view')}><KnowledgeCenter /></PermissionGate>} />
                    <Route path="calendario" element={<PermissionGate allowed={allowed('calendar_view')}><ImplementationCalendar /></PermissionGate>} />
                    <Route path="solicitudes" element={<PermissionGate allowed={allowed('internal_requests_view')}><InternalRequests canManage={allowed('internal_requests_manage')} /></PermissionGate>} />
                    <Route path="mejoras" element={<Navigate to="/solicitudes" replace />} />
                    <Route path="solicitudes-internas" element={<Navigate to="/solicitudes" replace />} />
                    <Route path="configuracion" element={<PermissionGate allowed={allowed('settings_view')}><Configuration /></PermissionGate>} />
                    <Route path="observabilidad" element={<PermissionGate allowed={allowed('observability_view')}><OperationalObservability /></PermissionGate>} />
                    <Route path="accesos" element={<PermissionGate allowed={allowed('users_view')}><AccessManagement /></PermissionGate>} />
                    <Route path="kill-switch" element={<PermissionGate allowed={allowed('kill_switch_execute')}><KillSwitch /></PermissionGate>} />
                </Route>
                <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
            </Suspense>
        </HashRouter>
    )
}

function PermissionGate({ allowed, children }: { allowed: boolean; children: ReactNode }) {
    if (allowed) return children;
    return (
        <div className="flex min-h-[55vh] items-center justify-center p-6">
            <div className="max-w-md rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center shadow-sm">
                <p className="text-xs font-black uppercase tracking-[0.2em] text-amber-600">Acceso restringido</p>
                <h2 className="mt-2 text-xl font-black text-slate-900">Tu perfil no tiene permiso para este módulo</h2>
                <p className="mt-2 text-sm text-slate-600">Solicita a un Supervisor o Propietario que revise los permisos de tu perfil.</p>
            </div>
        </div>
    );
}

function PageLoadingScreen() {
    return (
        <div className="flex min-h-[40vh] items-center justify-center text-sm font-bold text-slate-500">
            Cargando módulo...
        </div>
    );
}

function AuthLoadingScreen() {
    return (
        <div className="flex min-h-screen items-center justify-center bg-slate-950 text-white">
            <div className="rounded-lg border border-white/10 bg-white/5 px-6 py-5 shadow-2xl">
                <p className="text-sm font-bold uppercase tracking-[0.24em] text-indigo-300">CLIC-CLOUD</p>
                <p className="mt-2 text-lg font-black">Validando sesión...</p>
            </div>
        </div>
    );
}

function LoginScreen({ error, onLogin }: { error: string | null; onLogin: (email: string, password: string) => Promise<void> }) {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [localError, setLocalError] = useState<string | null>(null);
    const [forgotPasswordOpen, setForgotPasswordOpen] = useState(false);

    const submit = async (event: FormEvent) => {
        event.preventDefault();
        setLoading(true);
        setLocalError(null);
        try {
            await onLogin(email, password);
        } catch (loginError) {
            console.error('Cloud-Admin login failed', loginError);
            setLocalError(getAuthErrorMessage(loginError));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4 text-slate-900">
            <form onSubmit={submit} className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-7 shadow-2xl">
                <div className="text-center">
                    <img
                        src="/login-logo.png"
                        alt="Cloud Admin"
                        className="mx-auto h-24 w-24 object-contain"
                    />
                    <p className="text-xs font-black uppercase tracking-[0.28em] text-indigo-600">CLIC-CLOUD</p>
                    <h1 className="mt-3 text-2xl font-black text-slate-950">Acceso Cloud-Admin</h1>
                    <p className="mt-1 text-sm text-slate-500">Inicia sesión con tu usuario autorizado.</p>
                </div>

                {error || localError ? (
                    <div className="mt-5 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
                        {localError || error}
                    </div>
                ) : null}

                <div className="mt-6 space-y-4">
                    <label className="block">
                        <span className="text-xs font-black uppercase tracking-wide text-slate-500">Email</span>
                        <input
                            required
                            type="email"
                            value={email}
                            onChange={(event) => setEmail(event.target.value)}
                            className="mt-2 w-full rounded-lg border border-slate-200 px-4 py-3 text-sm font-semibold outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
                            placeholder="usuario@empresa.com"
                        />
                    </label>
                    <label className="block">
                        <span className="flex items-center justify-between gap-3 text-xs font-black uppercase tracking-wide text-slate-500">
                            <span>Clave</span>
                            <button type="button" onClick={() => setForgotPasswordOpen(true)} className="normal-case tracking-normal text-indigo-600 hover:text-indigo-800">¿Olvidaste tu contraseña?</button>
                        </span>
                        <input
                            required
                            type="password"
                            value={password}
                            onChange={(event) => setPassword(event.target.value)}
                            className="mt-2 w-full rounded-lg border border-slate-200 px-4 py-3 text-sm font-semibold outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
                            placeholder="Clave de acceso"
                        />
                    </label>
                </div>

                <button
                    type="submit"
                    disabled={loading}
                    className="mt-6 w-full rounded-lg bg-indigo-600 px-4 py-3 text-sm font-black text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-70"
                >
                    {loading ? 'Validando...' : 'Entrar'}
                </button>
            </form>
            <ForgotPasswordDialog open={forgotPasswordOpen} initialEmail={email} onClose={() => setForgotPasswordOpen(false)} />
        </div>
    );
}

function getAuthErrorMessage(error: unknown) {
    const message = error instanceof Error ? error.message : String(error || '');
    if (/invalid login credentials/i.test(message)) return 'Email o clave incorrectos.';
    if (/email not confirmed/i.test(message)) return 'Este email no ha sido confirmado.';
    if (/access activo|cloud-admin/i.test(message)) return message;
    return message || 'No se pudo completar la autenticación.';
}

export default App
