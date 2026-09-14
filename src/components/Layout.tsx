import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Activity, BookOpen, Building2, CalendarDays, ClipboardList, KeyRound, LayoutDashboard, Users, ShieldPlus, BadgeDollarSign, Headset, LogOut, Menu, Settings, Smartphone, UserCog, X } from 'lucide-react';
import type { CloudAdminPermissionKey, CloudAdminPermissions } from '../types';
import { hasCloudAdminPermission } from '../lib/cloudAdminPermissions';
import { ChangePasswordDialog } from './ChangePasswordDialog';

interface LayoutProps {
    adminName?: string | null;
    adminEmail?: string | null;
    adminRole?: string | null;
    permissions?: Partial<CloudAdminPermissions> | null;
    signingOut?: boolean;
    onSignOut: () => void;
}

const navItems: Array<{ path: string; label: string; icon: React.ComponentType<{ className?: string }>; permission: CloudAdminPermissionKey }> = [
    { path: '/', label: 'Dashboard', icon: LayoutDashboard, permission: 'dashboard_view' },
    { path: '/tenants', label: 'Tenants', icon: Users, permission: 'tenants_view' },
    { path: '/clientes', label: 'Clientes', icon: Building2, permission: 'tenants_view' },
    { path: '/plans', label: 'Planes SaaS', icon: BadgeDollarSign, permission: 'plans_view' },
    { path: '/pos-apk', label: 'APK POS', icon: Smartphone, permission: 'apk_view' },
    { path: '/support', label: 'Helpdesk & Soporte', icon: Headset, permission: 'support_view' },
    { path: '/conocimiento', label: 'Manuales y videos', icon: BookOpen, permission: 'knowledge_view' },
    { path: '/calendario', label: 'Implementaciones', icon: CalendarDays, permission: 'calendar_view' },
    { path: '/solicitudes', label: 'Solicitudes', icon: ClipboardList, permission: 'internal_requests_view' },
    { path: '/configuracion', label: 'Configuración', icon: Settings, permission: 'settings_view' },
    { path: '/observabilidad', label: 'Observabilidad', icon: Activity, permission: 'observability_view' },
    { path: '/accesos', label: 'Usuarios y perfiles', icon: UserCog, permission: 'users_view' },
    { path: '/kill-switch', label: 'Kill Switch', icon: ShieldPlus, permission: 'kill_switch_execute' },
];

function getInitials(name?: string | null, email?: string | null) {
    const source = name?.trim() || email?.split('@')[0] || 'AD';
    return source
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part.charAt(0).toUpperCase())
        .join('') || 'AD';
}

export const Layout: React.FC<LayoutProps> = ({ adminName, adminEmail, adminRole, permissions, signingOut = false, onSignOut }) => {
    const location = useLocation();
    const isImmersiveWorkspace = location.pathname === '/support';
    const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
    const [changePasswordOpen, setChangePasswordOpen] = useState(false);
    const currentLabel = navItems.find((item) => item.path === location.pathname)?.label || 'ALFA-Admin';

    return (
        <div className="flex h-screen overflow-hidden bg-brand-background font-sans text-brand-text antialiased">
            {/* BEGIN: Navigation Sidebar */}
            <aside className="hidden h-screen w-64 flex-shrink-0 flex-col border-r border-white/5 bg-brand-sidebar-deep text-white lg:flex">
                <div className="px-5 pb-5 pt-6">
                    <img src="/alfa-admin-logo-inverse.svg" alt="ALFA-Admin" className="h-auto w-[205px]" />
                </div>
                <nav className="flex-1 space-y-1 overflow-y-auto px-4 pb-4">
                    {navItems.filter((item) => hasCloudAdminPermission(permissions, item.permission)).map((item) => (
                        <NavLink
                            key={item.path}
                            to={item.path}
                            end={item.path === '/'}
                            className={({ isActive }) =>
                                `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                                    isActive 
                                    ? 'bg-brand text-white shadow-sm'
                                    : 'text-slate-300 hover:bg-white/[0.06] hover:text-white'
                                }`
                            }
                        >
                            <item.icon className="w-5 h-5" />
                            {item.label}
                        </NavLink>
                    ))}
                </nav>
                <div className="border-t border-white/10 p-4">
                    <div className="mb-3 flex items-center gap-3 rounded-xl border border-white/5 bg-white/[0.05] p-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand text-xs font-bold text-white">{getInitials(adminName, adminEmail)}</div>
                        <div className="flex-1 overflow-hidden">
                            <p className="truncate text-xs font-semibold">{adminName || adminEmail || 'Administrador'}</p>
                            <p className="mt-0.5 truncate text-[10px] text-slate-400">{adminRole || 'Administrador de plataforma'}</p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={() => setChangePasswordOpen(true)}
                        className="mb-1 flex w-full items-center gap-3 px-2 py-2 text-sm font-medium text-slate-400 transition-colors hover:text-white"
                    >
                        <KeyRound size={16} />
                        <span>Cambiar contraseña</span>
                    </button>
                    <button
                        type="button"
                        onClick={onSignOut}
                        disabled={signingOut}
                        className="flex items-center gap-3 text-slate-400 hover:text-white disabled:opacity-60 w-full px-2 py-2 transition-colors text-sm font-medium"
                    >
                        <LogOut size={16} />
                        <span>{signingOut ? 'Cerrando...' : 'Cerrar Sesión'}</span>
                    </button>
                </div>
            </aside>
            {/* END: Navigation Sidebar */}

            {mobileNavigationOpen ? (
                <div className="fixed inset-0 z-50 lg:hidden">
                    <button type="button" aria-label="Cerrar navegación" onClick={() => setMobileNavigationOpen(false)} className="absolute inset-0 bg-slate-950/55 backdrop-blur-sm" />
                    <aside className="relative flex h-full w-[min(86vw,320px)] flex-col border-r border-white/5 bg-brand-sidebar-deep text-white shadow-2xl">
                        <div className="flex items-center justify-between p-5">
                            <img src="/alfa-admin-logo-inverse.svg" alt="ALFA-Admin" className="h-auto w-[205px]" />
                            <button type="button" onClick={() => setMobileNavigationOpen(false)} className="rounded-lg border border-slate-700 p-2 text-slate-300"><X size={18} /></button>
                        </div>
                        <nav className="flex-1 space-y-1 overflow-y-auto px-4 pb-4">
                            {navItems.filter((item) => hasCloudAdminPermission(permissions, item.permission)).map((item) => (
                                <NavLink key={item.path} to={item.path} end={item.path === '/'} onClick={() => setMobileNavigationOpen(false)} className={({ isActive }) => `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium ${isActive ? 'bg-brand text-white' : 'text-slate-300 hover:bg-white/[0.06] hover:text-white'}`}>
                                    <item.icon className="h-5 w-5" />{item.label}
                                </NavLink>
                            ))}
                        </nav>
                        <div className="border-t border-slate-800 p-4">
                            <p className="truncate text-xs font-bold">{adminName || adminEmail || 'Administrador'}</p><p className="mt-1 truncate text-[10px] text-slate-400">{adminRole || 'Administrador de plataforma'}</p>
                            <button type="button" onClick={() => { setMobileNavigationOpen(false); setChangePasswordOpen(true); }} className="mt-3 flex w-full items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm font-bold text-slate-200"><KeyRound size={16} />Cambiar contraseña</button>
                            <button type="button" onClick={onSignOut} disabled={signingOut} className="mt-3 flex w-full items-center gap-2 rounded-lg bg-slate-800 px-3 py-2 text-sm font-bold text-slate-200"><LogOut size={16} />{signingOut ? 'Cerrando...' : 'Cerrar sesión'}</button>
                        </div>
                    </aside>
                </div>
            ) : null}

            {/* BEGIN: Main Content Container */}
            <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                {/* BEGIN: Slim Header */}
                <header className="sticky top-0 z-10 flex min-h-16 items-center gap-3 border-b border-brand-border bg-white/95 px-4 py-2 sm:px-6 xl:px-8">
                    <button type="button" onClick={() => setMobileNavigationOpen(true)} className="rounded-lg border border-slate-200 bg-white p-2 text-slate-700 shadow-sm lg:hidden" aria-label="Abrir navegación"><Menu size={19} /></button>
                    <div className="flex min-w-0 flex-1 items-center gap-4">
                        <div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-brand">Control Center</p><h2 className="truncate text-base font-extrabold text-brand-sidebar sm:text-lg">{currentLabel}</h2></div>
                    </div>
                </header>
                {/* END: Slim Header */}
                
                <div className={`min-h-0 flex-1 p-0 ${isImmersiveWorkspace ? 'overflow-hidden' : 'overflow-auto'}`}>
                    <Outlet />
                </div>
            </main>
            {/* END: Main Content Container */}
            <ChangePasswordDialog open={changePasswordOpen} onClose={() => setChangePasswordOpen(false)} />
        </div>
    );
};
