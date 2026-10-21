// Thẻ phiếu lương trong trợ lý. Số tiền KHÔNG đi qua API trợ lý hay AI: thẻ
// tự gọi `get_my_payslip` — cùng hàng rào phát hành + xác thực lại như trang
// Lương của tôi.

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { EyeOff, Hourglass, ShieldCheck, WalletCards } from 'lucide-react';
import { ReauthDialog } from '@/components/payroll/ReauthDialog';
import { REAUTH_REQUIRED, fetchMyPayslip, fetchMyPayslipStatus, type MyPayslipStatus } from '@/lib/payrollData';
import { formatVND } from '@/lib/utils';
import type { Payslip } from '@/types';

export function PayslipChatCard({ month }: { month: string }) {
  const monthStart = `${month}-01`;
  const monthLabel = `${month.slice(5, 7)}/${month.slice(0, 4)}`;
  const [status, setStatus] = useState<MyPayslipStatus | null | undefined>(undefined);
  const [payslip, setPayslip] = useState<Payslip | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unlockOpen, setUnlockOpen] = useState(false);

  const loadSlip = async (): Promise<string | null> => {
    const result = await fetchMyPayslip(monthStart);
    if (result.error) return result.error === REAUTH_REQUIRED ? 'Phiên xác thực đã hết hạn, nhập lại mật khẩu.' : result.error;
    setPayslip(result.payslip);
    return null;
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next = await fetchMyPayslipStatus(monthStart);
      if (cancelled) return;
      setStatus(next);
      if (next?.published && !next.reauthRequired) {
        const failure = await loadSlip();
        if (!cancelled && failure) setError(failure);
      }
    })();
    return () => { cancelled = true; };
  }, [monthStart]); // eslint-disable-line react-hooks/exhaustive-deps

  const shell = 'rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 text-sm';

  if (status === undefined) {
    return <div className={`${shell} animate-pulse text-slate-500`}>Đang kiểm tra phiếu lương tháng {monthLabel}…</div>;
  }

  if (payslip) {
    return (
      <div className={shell}>
        <div className="flex items-center justify-between gap-2">
          <p className="font-semibold text-emerald-800">Phiếu lương tháng {monthLabel}</p>
          <button type="button" onClick={() => setPayslip(null)} className="text-slate-400 hover:text-slate-600" aria-label="Ẩn số tiền">
            <EyeOff className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-1 text-xl font-bold text-emerald-700">{formatVND(Number(payslip.net_pay))}</p>
        <p className="text-xs text-slate-500">Thực lĩnh</p>
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          <dt className="text-slate-500">Tổng thu nhập</dt><dd className="text-right font-medium text-slate-700">{formatVND(Number(payslip.gross_pay))}</dd>
          <dt className="text-slate-500">Bảo hiểm</dt><dd className="text-right font-medium text-slate-700">{formatVND(Number(payslip.insurance_employee))}</dd>
          <dt className="text-slate-500">Thuế TNCN</dt><dd className="text-right font-medium text-slate-700">{formatVND(Number(payslip.personal_income_tax))}</dd>
          <dt className="text-slate-500">Ngày công</dt><dd className="text-right font-medium text-slate-700">{Number(payslip.work_days)}/{Number(payslip.standard_days)}</dd>
        </dl>
        <Link to="/staff/payroll" className="mt-2 inline-block text-xs font-semibold text-emerald-700 hover:underline">Xem phiếu đầy đủ →</Link>
      </div>
    );
  }

  if (status?.published) {
    return (
      <div className={shell}>
        <p className="font-semibold text-emerald-800">Phiếu lương tháng {monthLabel} đã phát hành</p>
        <p className="mt-0.5 text-xs text-slate-500">Để bảo mật, nhập lại mật khẩu để xem số tiền.</p>
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
        <button
          type="button"
          onClick={() => setUnlockOpen(true)}
          className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
        >
          <ShieldCheck className="h-3.5 w-3.5" /> Xác thực để xem
        </button>
        <ReauthDialog
          open={unlockOpen}
          title="Xác thực để xem phiếu lương"
          description={<>Nhập lại mật khẩu đăng nhập để mở phiếu lương tháng <strong>{monthLabel}</strong>.</>}
          confirmLabel="Mở phiếu lương"
          tone="success"
          onClose={() => setUnlockOpen(false)}
          onConfirmed={async () => {
            const failure = await loadSlip();
            if (!failure) setError(null);
            return failure;
          }}
        />
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
      <div className="flex items-start gap-2">
        {status?.inProgress
          ? <Hourglass className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          : <WalletCards className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />}
        <div>
          <p className="font-semibold text-slate-700">
            {status?.inProgress ? `Bảng lương tháng ${monthLabel} đang được hoàn tất` : `Chưa có phiếu lương tháng ${monthLabel}`}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            {status?.inProgress
              ? 'Phiếu sẽ xem được khi kỳ lương được duyệt chi và phát hành.'
              : 'Kỳ lương tháng này chưa được tính hoặc bạn không có phiếu trong kỳ.'}
          </p>
        </div>
      </div>
    </div>
  );
}
