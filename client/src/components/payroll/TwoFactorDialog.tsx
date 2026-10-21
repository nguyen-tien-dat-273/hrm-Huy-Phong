// ============================================================================
// Mã 2FA để khoá kỳ lương (FR06.04.03).
// ----------------------------------------------------------------------------
// Yếu tố thứ hai là mã TOTP 6 số từ ứng dụng xác thực (Google Authenticator,
// Microsoft Authenticator…), do Supabase Auth MFA kiểm. Lần đầu dùng thì đăng
// ký ứng dụng ngay trong hộp này bằng mã QR.
//
// Nhập sai mã: Supabase từ chối, hộp giữ nguyên để nhập lại — đúng luồng ngoại
// lệ của đặc tả ("yêu cầu Kế toán trưởng nhập lại mã OTP hợp lệ").
// ============================================================================

import { useEffect, useState } from 'react';
import { KeyRound, Smartphone, TriangleAlert } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/Skeleton';
import { enrollTotp, listTotpFactors, verifyTotp, type TotpEnrollment } from '@/lib/payrollSecurity';

interface TwoFactorDialogProps {
  open: boolean;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  onClose: () => void;
  /** Chạy ngay sau khi mã đúng (phiên đã lên aal2). Trả về lỗi nếu thao tác hỏng. */
  onVerified: () => Promise<string | null>;
}

type Step = 'loading' | 'verify' | 'enroll-start' | 'enroll-scan';

export function TwoFactorDialog({ open, title, description, confirmLabel, onClose, onVerified }: TwoFactorDialogProps) {
  const [step, setStep] = useState<Step>('loading');
  const [factorId, setFactorId] = useState<string | null>(null);
  const [enrollment, setEnrollment] = useState<TotpEnrollment | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setStep('loading');
    setCode('');
    setError(null);
    setEnrollment(null);
    void listTotpFactors().then(({ factors, error: listError }) => {
      if (cancelled) return;
      const verified = factors.find((factor) => factor.status === 'verified');
      if (listError) setError(listError);
      if (verified) {
        setFactorId(verified.id);
        setStep('verify');
      } else {
        setStep('enroll-start');
      }
    });
    return () => { cancelled = true; };
  }, [open]);

  const startEnroll = async () => {
    setBusy(true);
    setError(null);
    const { enrollment: created, error: enrollError } = await enrollTotp('HRM Huy Phong — khoá kỳ lương');
    setBusy(false);
    if (enrollError || !created) {
      setError(enrollError ?? 'Không đăng ký được ứng dụng xác thực.');
      return;
    }
    setEnrollment(created);
    setFactorId(created.factorId);
    setStep('enroll-scan');
  };

  const confirm = async () => {
    if (!factorId) return;
    setBusy(true);
    setError(null);
    const verifyError = await verifyTotp(factorId, code);
    if (verifyError) {
      setBusy(false);
      setError(verifyError);
      setCode('');
      return;
    }
    const actionError = await onVerified();
    setBusy(false);
    if (actionError) {
      setError(actionError);
      return;
    }
    onClose();
  };

  return (
    <Modal square open={open} onClose={busy ? () => undefined : onClose} title={title} size="md">
      <div className="space-y-4">
        <div className="rounded-none border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-900">
          {description}
        </div>

        {step === 'loading' && <Skeleton className="h-24" />}

        {step === 'enroll-start' && (
          <div className="space-y-3 rounded-none border border-slate-200 p-4">
            <p className="flex items-start gap-2 text-sm leading-relaxed text-slate-700">
              <Smartphone className="mt-0.5 h-4 w-4 flex-shrink-0 text-indigo-600" />
              Tài khoản của bạn chưa đăng ký ứng dụng xác thực. Cài Google Authenticator hoặc Microsoft
              Authenticator trên điện thoại rồi bấm đăng ký — chỉ làm một lần.
            </p>
            <Button onClick={() => void startEnroll()} disabled={busy}>
              <KeyRound className="h-4 w-4" /> {busy ? 'Đang tạo mã QR…' : 'Đăng ký ứng dụng xác thực'}
            </Button>
          </div>
        )}

        {step === 'enroll-scan' && enrollment && (
          <div className="grid gap-4 rounded-none border border-slate-200 p-4 sm:grid-cols-[auto_1fr]">
            <img src={enrollment.qrCode} alt="Mã QR đăng ký ứng dụng xác thực" className="h-40 w-40 rounded-lg border border-slate-100" />
            <div className="min-w-0 space-y-2 text-sm text-slate-600">
              <p>Mở ứng dụng xác thực, chọn <strong>Thêm tài khoản → Quét mã QR</strong>.</p>
              <p>Không quét được thì nhập mã bí mật:</p>
              <code className="block break-all rounded bg-slate-100 px-2 py-1 font-mono text-xs text-slate-800">
                {enrollment.secret}
              </code>
              <p>Rồi nhập mã 6 số đang hiện trên ứng dụng ở ô dưới.</p>
            </div>
          </div>
        )}

        {(step === 'verify' || step === 'enroll-scan') && (
          <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void confirm(); }}>
            <Input
              label="Mã xác thực 2FA (OTP 6 số)"
              required
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
              className="!rounded-none text-center font-mono text-lg tracking-[0.4em]"
              error={error ?? undefined}
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>Huỷ</Button>
              <Button type="submit" disabled={busy || code.length !== 6}>
                {busy ? 'Đang xác thực…' : confirmLabel}
              </Button>
            </div>
          </form>
        )}

        {error && step !== 'verify' && step !== 'enroll-scan' && (
          <p role="alert" className="flex items-start gap-2 rounded-none bg-red-50 px-3 py-2 text-sm text-red-700">
            <TriangleAlert className="mt-0.5 h-4 w-4 flex-shrink-0" /> {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
