// ============================================================================
// Phiếu lương của tôi (FR06.04.05, BR-PAY-011, UI_05, UI_08).
// ----------------------------------------------------------------------------
// • Chỉ phiếu của CHÍNH MÌNH, chỉ khi kỳ đã chi trả và PHÁT HÀNH.
// • Mở chi tiết phải xác thực lại (mật khẩu — trên điện thoại điền bằng vân
//   tay / FaceID qua trình quản lý mật khẩu); database chỉ trả phiếu khi phiên
//   vừa xác thực trong cửa sổ cho phép, không phải chỉ màn này chặn.
// • Không còn bản "tạm tính" trên máy nhân viên: con số nhân viên thấy phải là
//   con số Ban Giám đốc đã ký, không phải một phép tính song song có thể lệch.
// ============================================================================

import { useEffect, useState } from 'react';
import { format, startOfMonth } from 'date-fns';
import {
  Banknote, CalendarCheck2, CircleDollarSign, Clock3, EyeOff, Hourglass, LockKeyhole, Printer, ReceiptText,
  ShieldCheck, WalletCards,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { MonthNav } from '@/components/ui/MonthNav';
import { Skeleton } from '@/components/ui/Skeleton';
import { PayslipBreakdown, type BreakdownLine } from '@/components/payroll/PayslipBreakdown';
import { ReauthDialog } from '@/components/payroll/ReauthDialog';
import { OrgContact } from '@/components/OrgContact';
import { useAuth } from '@/contexts/AuthContext';
import { formatDateTime, formatVND, toDateString } from '@/lib/utils';
import { REAUTH_REQUIRED, fetchMyPayslip, fetchMyPayslipStatus, type MyPayslipStatus } from '@/lib/payrollData';
import type { Payslip, PayslipLine } from '@/types';

export function StaffPayroll() {
  const { profile } = useAuth();
  const [monthStart, setMonthStart] = useState(() => startOfMonth(new Date()));
  const [status, setStatus] = useState<MyPayslipStatus | null>(null);
  const [payslip, setPayslip] = useState<Payslip | null>(null);
  const [lines, setLines] = useState<PayslipLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unlockOpen, setUnlockOpen] = useState(false);

  const monthStartStr = toDateString(monthStart);
  const monthLabel = format(monthStart, 'MM/yyyy');

  const loadSlip = async (): Promise<string | null> => {
    const result = await fetchMyPayslip(monthStartStr);
    if (result.error) return result.error === REAUTH_REQUIRED ? 'Phiên xác thực đã hết hạn — nhập lại mật khẩu.' : result.error;
    setPayslip(result.payslip);
    setLines(result.lines);
    return null;
  };

  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    setLoading(true);
    setPayslip(null);
    setLines([]);
    setError(null);
    void (async () => {
      const next = await fetchMyPayslipStatus(monthStartStr);
      if (cancelled) return;
      setStatus(next);
      if (next?.published && !next.reauthRequired) {
        const failure = await loadSlip();
        if (!cancelled && failure) setError(failure);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [profile?.id, monthStartStr]); // eslint-disable-line react-hooks/exhaustive-deps

  const hide = () => { setPayslip(null); setLines([]); };

  const breakdown: BreakdownLine[] = lines
    // Chi phí doanh nghiệp đóng là chuyện nội bộ, không thuộc phiếu của nhân viên.
    .filter((line) => line.kind !== 'EMPLOYER_COST')
    .map((line) => ({
      code: line.code, name: line.name, kind: line.kind, quantity: line.quantity, rate: line.rate,
      amount: Number(line.amount), detail: line.detail,
    }));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-600">Thu nhập cá nhân</p>
          <h1 className="mt-1 font-display text-2xl font-extrabold text-slate-900">Phiếu lương của tôi</h1>
          <p className="mt-1 text-sm text-slate-500">Chỉ bạn xem được phiếu của mình, sau khi xác thực lại.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 no-print">
          <MonthNav value={monthStart} onChange={setMonthStart} theme="staff" />
          {payslip && (
            <>
              <Button variant="outline" onClick={() => window.print()} aria-label="In hoặc lưu PDF phiếu lương">
                <Printer className="h-4 w-4" /> In / PDF
              </Button>
              <Button variant="ghost" onClick={hide} aria-label="Ẩn phiếu lương">
                <EyeOff className="h-4 w-4" /> Ẩn
              </Button>
            </>
          )}
        </div>
      </div>

      {loading ? (
        <div className="space-y-5"><Skeleton className="h-36" /><Skeleton className="h-80" /></div>
      ) : payslip ? (
        <PayslipView payslip={payslip} lines={breakdown} monthLabel={monthLabel} employeeName={profile?.name ?? payslip.employee_name} />
      ) : status?.published ? (
        <Card>
          <CardContent className="py-12 text-center">
            <LockKeyhole className="mx-auto h-11 w-11 text-emerald-500" />
            <h2 className="mt-3 font-display text-lg font-bold text-slate-800">Phiếu lương tháng {monthLabel} đã phát hành</h2>
            <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
              Phát hành lúc {formatDateTime(status.publishedAt)}. Để bảo mật, xác thực lại để mở chi tiết — phiên xem có hiệu lực
              {' '}{status.reauthWindowMinutes} phút.
            </p>
            {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
            <Button className="mt-4" theme="staff" onClick={() => setUnlockOpen(true)}>
              <ShieldCheck className="h-4 w-4" /> Xác thực để xem phiếu
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-12 text-center">
            {status?.inProgress
              ? <Hourglass className="mx-auto h-11 w-11 text-amber-400" />
              : <WalletCards className="mx-auto h-11 w-11 text-slate-300" />}
            <h2 className="mt-3 font-display text-lg font-bold text-slate-800">
              {status?.inProgress ? `Bảng lương tháng ${monthLabel} đang được hoàn tất` : `Chưa có phiếu lương tháng ${monthLabel}`}
            </h2>
            <p className="mx-auto mt-1 max-w-lg text-sm text-slate-500">
              {status?.inProgress
                ? 'Phiếu lương sẽ hiện ở đây khi Ban Giám đốc duyệt chi và công ty xác nhận đã chi trả. Bạn sẽ nhận được thông báo.'
                : 'Kỳ lương tháng này chưa được tính hoặc bạn không có phiếu trong kỳ.'}
            </p>
          </CardContent>
        </Card>
      )}

      <OrgContact prefix="Thắc mắc về phiếu lương, liên hệ" className="px-1 no-print" />

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

function PayslipView({ payslip, lines, monthLabel, employeeName }: {
  payslip: Payslip; lines: BreakdownLine[]; monthLabel: string; employeeName: string;
}) {
  return (
    <>
      {/* Đầu phiếu chỉ hiện khi in (UI_08) — trên màn đã có tiêu đề trang. */}
      <div className="hidden print:block">
        <h2 className="text-xl font-bold">PHIẾU LƯƠNG THÁNG {monthLabel}</h2>
        <p className="text-sm">Nhân viên: {employeeName}{payslip.employee_code ? ` · Mã NV: ${payslip.employee_code}` : ''}{payslip.department ? ` · ${payslip.department}` : ''}</p>
      </div>

      <Card className="overflow-hidden border-emerald-200 bg-gradient-to-br from-emerald-600 to-teal-700 text-white shadow-lg shadow-emerald-900/10 print:border-slate-300 print:bg-none print:text-slate-900 print:shadow-none">
        <CardContent className="relative py-7">
          <CircleDollarSign className="absolute -right-6 -top-8 h-36 w-36 text-white/10 print:hidden" />
          <div className="relative flex flex-wrap items-end justify-between gap-5">
            <div>
              <p className="text-sm font-medium text-emerald-100 print:text-slate-600">Thực nhận tháng {monthLabel}</p>
              <p className="mt-2 font-display text-4xl font-extrabold tracking-tight">{formatVND(Number(payslip.net_pay))}</p>
            </div>
            <div className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-right backdrop-blur-sm print:border-slate-300">
              <p className="text-xs text-emerald-100 print:text-slate-600">Ngày hưởng lương</p>
              <p className="mt-1 text-2xl font-extrabold">
                {Number(payslip.paid_days)}
                <span className="ml-1 text-sm font-medium text-emerald-100 print:text-slate-600">/{Number(payslip.standard_days)} ngày</span>
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Metric icon={<Banknote className="h-5 w-5" />} label="Tổng thu nhập trước khấu trừ" value={formatVND(Number(payslip.gross_pay))} tone="blue" />
        <Metric icon={<CalendarCheck2 className="h-5 w-5" />} label="Công + phép hưởng lương" value={`${Number(payslip.work_days)} + ${Number(payslip.leave_days)} ngày`} tone="emerald" />
        <Metric icon={<Clock3 className="h-5 w-5" />} label="Giờ làm ghi nhận" value={`${Number(payslip.work_hours)} giờ`} tone="violet" />
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4 sm:px-6">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 print:hidden">
              <ReceiptText className="h-5 w-5" />
            </span>
            <div>
              <h2 className="font-display text-lg font-bold text-slate-900">Chi tiết phiếu lương</h2>
              <p className="text-xs text-slate-500">Mỗi dòng kèm cách tính ra con số.</p>
            </div>
          </div>
          <div className="px-5 py-5 sm:px-6">
            <PayslipBreakdown
              lines={lines}
              netPay={Number(payslip.net_pay)}
              roundingAdjustment={Number(payslip.rounding_adjustment ?? 0)}
              showEmployerCost={false}
              theme="staff"
            />
          </div>
          {payslip.note && (
            <div className="border-t border-slate-100 bg-slate-50 px-5 py-4 text-xs text-slate-600 sm:px-6">
              <strong className="text-slate-700">Ghi chú từ HR/C&B:</strong> {payslip.note}
            </div>
          )}
        </CardContent>
      </Card>

      <p className="flex items-start gap-2 text-xs leading-relaxed text-slate-400 no-print">
        <ShieldCheck className="mt-0.5 h-4 w-4 flex-shrink-0" />
        Phiếu đã được Ban Giám đốc duyệt và không thay đổi. Nếu thấy sai sót, liên hệ HR/C&B — điều chỉnh sẽ ghi vào kỳ lương sau.
      </p>
    </>
  );
}

function Metric({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone: 'blue' | 'emerald' | 'violet' }) {
  const tones = { blue: 'bg-blue-50 text-blue-600', emerald: 'bg-emerald-50 text-emerald-600', violet: 'bg-violet-50 text-violet-600' };
  return (
    <Card>
      <CardContent className="flex items-center gap-3 py-5">
        <span className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ${tones[tone]} print:hidden`}>{icon}</span>
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-500">{label}</p>
          <p className="mt-1 truncate text-base font-extrabold tabular-nums text-slate-900">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}
