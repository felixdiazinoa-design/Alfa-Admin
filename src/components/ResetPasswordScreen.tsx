import { useState, type FormEvent } from 'react';
import { Eye, EyeOff, KeyRound, ShieldCheck } from 'lucide-react';
import { completePasswordRecovery, MIN_ACCOUNT_PASSWORD_LENGTH, validateRecoveredPassword } from '../lib/accountService';

interface ResetPasswordScreenProps {
    onComplete: () => Promise<void>;
    onCancel: () => Promise<void>;
}

export function ResetPasswordScreen({ onComplete, onCancel }: ResetPasswordScreenProps) {
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [visible, setVisible] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);

    const submit = async (event: FormEvent) => {
        event.preventDefault();
        const input = { newPassword, confirmPassword };
        const validationError = validateRecoveredPassword(input);
        if (validationError) {
            setError(validationError);
            return;
        }

        setSaving(true);
        setError(null);
        try {
            await completePasswordRecovery(input);
            setSuccess(true);
        } catch (recoveryError) {
            const message = recoveryError instanceof Error ? recoveryError.message : 'El enlace no es válido o ha expirado.';
            setError(message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="flex min-h-screen items-center justify-center bg-brand-sidebar-deep px-4 text-brand-text">
            <form onSubmit={submit} className="w-full max-w-md rounded-2xl border border-brand-border bg-white p-7 shadow-2xl">
                <div className="text-center">
                    <img src="/alfa-admin-mark.svg" alt="ALFA-Admin" className="mx-auto h-16 w-16" />
                    <div className="mx-auto mt-4 flex h-11 w-11 items-center justify-center rounded-xl bg-brand-soft text-brand"><KeyRound size={22} /></div>
                    <p className="mt-4 text-xs font-black uppercase tracking-[0.28em] text-brand">ALFA-ADMIN</p>
                    <h1 className="mt-2 text-2xl font-black text-slate-950">Restablecer contraseña</h1>
                    <p className="mt-1 text-sm text-slate-500">Define una nueva clave para recuperar el acceso.</p>
                </div>

                {success ? (
                    <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-800">
                        <div className="flex items-center gap-2 font-black"><ShieldCheck size={19} /> Contraseña restablecida</div>
                        <p className="mt-1 text-sm">La nueva contraseña ya está activa.</p>
                    </div>
                ) : (
                    <div className="mt-6 space-y-4">
                        <PasswordInput id="recovery-new-password" label="Nueva contraseña" value={newPassword} onChange={setNewPassword} visible={visible} />
                        <PasswordInput id="recovery-confirm-password" label="Confirmar contraseña" value={confirmPassword} onChange={setConfirmPassword} visible={visible} />
                        <label className="flex items-center gap-2 text-xs font-bold text-slate-500"><input type="checkbox" checked={visible} onChange={(event) => setVisible(event.target.checked)} />{visible ? <EyeOff size={15} /> : <Eye size={15} />}Mostrar contraseñas</label>
                        <p className="text-xs text-slate-500">Usa al menos {MIN_ACCOUNT_PASSWORD_LENGTH} caracteres.</p>
                    </div>
                )}

                {error ? <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700" role="alert">{error}</div> : null}

                <div className="mt-6 flex gap-3">
                    {!success ? <button type="button" onClick={() => void onCancel()} disabled={saving} className="flex-1 rounded-xl border border-slate-200 px-4 py-3 text-sm font-black text-slate-600 hover:bg-slate-50 disabled:opacity-50">Volver al acceso</button> : null}
                    <button type={success ? 'button' : 'submit'} onClick={success ? () => void onComplete() : undefined} disabled={saving} className="flex-1 rounded-xl bg-brand px-4 py-3 text-sm font-black text-white hover:bg-brand-hover disabled:opacity-60">{success ? 'Ir al acceso' : saving ? 'Actualizando…' : 'Guardar contraseña'}</button>
                </div>
            </form>
        </div>
    );
}

function PasswordInput({ id, label, value, onChange, visible }: { id: string; label: string; value: string; onChange: (value: string) => void; visible: boolean }) {
    return (
        <label className="block" htmlFor={id}>
            <span className="text-xs font-black uppercase tracking-wide text-slate-500">{label}</span>
            <input id={id} required minLength={MIN_ACCOUNT_PASSWORD_LENGTH} type={visible ? 'text' : 'password'} autoComplete="new-password" value={value} onChange={(event) => onChange(event.target.value)} className="input mt-2 px-4 py-3" />
        </label>
    );
}
