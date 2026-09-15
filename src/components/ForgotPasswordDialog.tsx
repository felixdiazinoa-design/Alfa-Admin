import { useEffect, useState, type FormEvent } from 'react';
import { Mail, ShieldCheck, X } from 'lucide-react';
import { requestPasswordReset } from '../lib/accountService';

interface ForgotPasswordDialogProps {
    open: boolean;
    initialEmail?: string;
    onClose: () => void;
}

export function ForgotPasswordDialog({ open, initialEmail = '', onClose }: ForgotPasswordDialogProps) {
    const [email, setEmail] = useState(initialEmail);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [sent, setSent] = useState(false);

    useEffect(() => {
        if (open) setEmail(initialEmail);
        if (!open) {
            setSending(false);
            setError(null);
            setSent(false);
        }
    }, [initialEmail, open]);

    if (!open) return null;

    const close = () => {
        if (!sending) onClose();
    };

    const submit = async (event: FormEvent) => {
        event.preventDefault();
        setSending(true);
        setError(null);
        try {
            await requestPasswordReset(email);
            setSent(true);
        } catch (resetError) {
            const message = resetError instanceof Error ? resetError.message : 'No se pudo procesar la solicitud.';
            setError(message);
        } finally {
            setSending(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="forgot-password-title">
            <button type="button" className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm" onClick={close} aria-label="Cerrar recuperación de contraseña" />
            <form onSubmit={submit} className="relative w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
                <div className="flex items-start gap-3">
                    <div className="rounded-xl bg-brand-soft p-3 text-brand"><Mail size={21} /></div>
                    <div className="min-w-0 flex-1">
                        <h2 id="forgot-password-title" className="text-xl font-black text-slate-900">Recuperar contraseña</h2>
                        <p className="mt-1 text-sm leading-relaxed text-slate-500">Te enviaremos un enlace seguro para establecer una nueva contraseña.</p>
                    </div>
                    <button type="button" onClick={close} disabled={sending} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50" aria-label="Cerrar"><X size={18} /></button>
                </div>

                {sent ? (
                    <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-800">
                        <div className="flex items-center gap-2 font-black"><ShieldCheck size={19} /> Revisa tu correo</div>
                        <p className="mt-1 text-sm">Si el correo pertenece a un usuario registrado, recibirá un enlace para restablecer la contraseña.</p>
                    </div>
                ) : (
                    <label className="mt-6 block" htmlFor="recovery-email">
                        <span className="text-xs font-black uppercase tracking-wide text-slate-500">Correo electrónico</span>
                        <input id="recovery-email" required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} disabled={sending} className="input mt-2 px-4 py-3" placeholder="usuario@empresa.com" />
                    </label>
                )}

                {error ? <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700" role="alert">{error}</div> : null}

                <div className="mt-6 flex justify-end gap-3">
                    <button type="button" onClick={close} disabled={sending} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-black text-slate-600 hover:bg-slate-50 disabled:opacity-50">{sent ? 'Cerrar' : 'Cancelar'}</button>
                    {!sent ? <button type="submit" disabled={sending} className="rounded-xl bg-brand px-4 py-2.5 text-sm font-black text-white hover:bg-brand-hover disabled:opacity-60">{sending ? 'Enviando…' : 'Enviar enlace'}</button> : null}
                </div>
            </form>
        </div>
    );
}
