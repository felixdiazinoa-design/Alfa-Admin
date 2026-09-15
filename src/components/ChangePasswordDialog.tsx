import { useEffect, useState, type FormEvent } from 'react';
import { Eye, EyeOff, KeyRound, ShieldCheck, X } from 'lucide-react';
import {
    changeCurrentUserPassword,
    MIN_ACCOUNT_PASSWORD_LENGTH,
    validatePasswordChange,
} from '../lib/accountService';

interface ChangePasswordDialogProps {
    open: boolean;
    onClose: () => void;
}

type PasswordField = 'current' | 'next' | 'confirm';

export function ChangePasswordDialog({ open, onClose }: ChangePasswordDialogProps) {
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [visibleFields, setVisibleFields] = useState<Set<PasswordField>>(new Set());
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);

    useEffect(() => {
        if (!open) {
            setCurrentPassword('');
            setNewPassword('');
            setConfirmPassword('');
            setVisibleFields(new Set());
            setSaving(false);
            setError(null);
            setSuccess(false);
        }
    }, [open]);

    if (!open) return null;

    const toggleVisibility = (field: PasswordField) => {
        setVisibleFields((current) => {
            const next = new Set(current);
            if (next.has(field)) next.delete(field);
            else next.add(field);
            return next;
        });
    };

    const close = () => {
        if (!saving) onClose();
    };

    const submit = async (event: FormEvent) => {
        event.preventDefault();
        const input = { currentPassword, newPassword, confirmPassword };
        const validationError = validatePasswordChange(input);
        if (validationError) {
            setError(validationError);
            return;
        }

        setSaving(true);
        setError(null);
        setSuccess(false);
        try {
            await changeCurrentUserPassword(input);
            setCurrentPassword('');
            setNewPassword('');
            setConfirmPassword('');
            setSuccess(true);
        } catch (passwordError) {
            const message = passwordError instanceof Error ? passwordError.message : 'No se pudo cambiar la contraseña.';
            setError(message);
        } finally {
            setSaving(false);
        }
    };

    const fields: Array<{
        id: string;
        field: PasswordField;
        label: string;
        value: string;
        onChange: (value: string) => void;
        autoComplete: string;
    }> = [
        { id: 'current-password', field: 'current', label: 'Contraseña actual', value: currentPassword, onChange: setCurrentPassword, autoComplete: 'current-password' },
        { id: 'new-password', field: 'next', label: 'Nueva contraseña', value: newPassword, onChange: setNewPassword, autoComplete: 'new-password' },
        { id: 'confirm-password', field: 'confirm', label: 'Confirmar contraseña', value: confirmPassword, onChange: setConfirmPassword, autoComplete: 'new-password' },
    ];

    return (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="change-password-title">
            <button type="button" className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm" onClick={close} aria-label="Cerrar cambio de contraseña" />
            <form onSubmit={submit} className="relative w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
                <div className="flex items-start gap-4">
                    <div className="rounded-xl bg-brand-soft p-3 text-brand"><KeyRound size={22} /></div>
                    <div className="min-w-0 flex-1">
                        <h2 id="change-password-title" className="text-xl font-black text-slate-900">Cambiar contraseña</h2>
                        <p className="mt-1 text-sm leading-relaxed text-slate-500">Confirma tu contraseña actual y elige una nueva clave de acceso.</p>
                    </div>
                    <button type="button" onClick={close} disabled={saving} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50" aria-label="Cerrar"><X size={19} /></button>
                </div>

                {success ? (
                    <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-800">
                        <div className="flex items-center gap-2 font-black"><ShieldCheck size={19} /> Contraseña actualizada</div>
                        <p className="mt-1 text-sm">Ya puedes usar la nueva contraseña en tu próximo inicio de sesión.</p>
                    </div>
                ) : (
                    <div className="mt-6 space-y-4">
                        {fields.map((passwordField) => {
                            const visible = visibleFields.has(passwordField.field);
                            return (
                                <label key={passwordField.id} htmlFor={passwordField.id} className="block">
                                    <span className="text-xs font-black uppercase tracking-wide text-slate-500">{passwordField.label}</span>
                                    <div className="relative mt-2">
                                        <input
                                            id={passwordField.id}
                                            required
                                            minLength={passwordField.field === 'current' ? undefined : MIN_ACCOUNT_PASSWORD_LENGTH}
                                            type={visible ? 'text' : 'password'}
                                            value={passwordField.value}
                                            onChange={(event) => passwordField.onChange(event.target.value)}
                                            autoComplete={passwordField.autoComplete}
                                            disabled={saving}
                                            className="input px-4 py-3 pr-12"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => toggleVisibility(passwordField.field)}
                                            className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-slate-400 hover:text-slate-700"
                                            aria-label={visible ? `Ocultar ${passwordField.label.toLowerCase()}` : `Mostrar ${passwordField.label.toLowerCase()}`}
                                        >
                                            {visible ? <EyeOff size={18} /> : <Eye size={18} />}
                                        </button>
                                    </div>
                                </label>
                            );
                        })}
                        <p className="text-xs font-medium text-slate-500">La nueva contraseña debe tener al menos {MIN_ACCOUNT_PASSWORD_LENGTH} caracteres y ser diferente de la actual.</p>
                    </div>
                )}

                {error ? (
                    <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700" role="alert">{error}</div>
                ) : null}

                <div className="mt-6 flex justify-end gap-3">
                    <button type="button" onClick={close} disabled={saving} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-black text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                        {success ? 'Cerrar' : 'Cancelar'}
                    </button>
                    {!success ? (
                        <button type="submit" disabled={saving} className="rounded-xl bg-brand px-4 py-2.5 text-sm font-black text-white hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-60">
                            {saving ? 'Actualizando…' : 'Actualizar contraseña'}
                        </button>
                    ) : null}
                </div>
            </form>
        </div>
    );
}
