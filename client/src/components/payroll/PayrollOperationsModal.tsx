// ============================================================================
// Hộp thoại Vận hành & Quy trình kỳ lương tháng:
// ----------------------------------------------------------------------------
// Gom:
// - Vòng đời trạng thái kỳ lương (Bản nháp → Đã tính → Đã khoá → Đã duyệt → Đã chi trả)
// - Các nút hành động chính (Tính lương/Tính lại, Khoá kỳ 2FA, Rút lại, Chi trả, File bank)
// - Danh sách kiểm tra điều kiện khoá kỳ (Checklist)
// - Cảnh báo tính toán & thiết lập lương
// - Bút toán kết chuyển & Xuất file
// ============================================================================

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BookOpenCheck,
  Calculator,
  CheckCircle2,
  CircleAlert,
  CircleCheck,
  History,
  Landmark,
  ListChecks,
  LockKeyhole,
  TriangleAlert,
  Undo2,
  Wallet,
} from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { ExportButtons } from '@/components/payroll/ExportButtons';
import { Timeline } from '@/components/payroll/PayrollApprovals';
import { RUN_STATUS_LABEL } from '@/components/payroll/PayrollRegister';
import { formatDateTime } from '@/lib/utils';
import type { PayrollApprovalEvent, PayrollRun, PayrollRunStatus } from '@/types';
import type { PayrollRow } from '@/components/payroll/PayrollRegister';

const RUN_ORDER: PayrollRunStatus[] = ['DRAFT', 'CALCULATED', 'LOCKED', 'APPROVED', 'PAID'];

export function RunLifecycle({ status }: { status: PayrollRunStatus }) {
  const current = RUN_ORDER.indexOf(status);
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="status" aria-label={`Trạng thái kỳ: ${RUN_STATUS_LABEL[status]}`}>
      {RUN_ORDER.map((step, index) => (
        <span key={step} className="flex items-center gap-1.5">
          {index > 0 && (
            <span
              className={`h-px w-3 sm:w-4 ${
                index <= current ? 'bg-indigo-400 dark:bg-indigo-600' : 'bg-slate-200 dark:bg-slate-700'
              }`}
            />
          )}
          <span
            className={`rounded-full px-2.5 py-1 text-[11px] font-bold transition-colors ${
              index === current
                ? 'bg-indigo-600 text-white shadow-xs'
                : index < current
                ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500'
            }`}
          >
            {RUN_STATUS_LABEL[step]}
          </span>
        </span>
      ))}
    </div>
  );
}

interface PayrollOperationsModalProps {
  open: boolean;
  onClose: () => void;
  run: PayrollRun | null;
  runStatus: PayrollRunStatus;
  monthLabel: string;
  monthStartStr: string;
  canManage: boolean;
  closed: boolean;
  approved: boolean;
  busy: 'calc' | 'paid' | 'journal' | null;
  liveRowsCount: number;
  missingInputCount: number;
  canLock: boolean;
  unmetCount: number;
  blockingUnmet: Array<{ ok: boolean; blocking: boolean; label: string; hint: string }>;
  checklist: Array<{ ok: boolean; blocking: boolean; label: string; hint: string }>;
  allWarnings: string[];
  setupGaps: PayrollRow[];
  lastEvent?: PayrollApprovalEvent | null;
  runEvents: PayrollApprovalEvent[];
  onCalculate: () => Promise<void>;
  onOpenLock: () => void;
  onOpenWithdraw: () => void;
  onOpenBank: () => void;
  onMarkPaid: () => Promise<void>;
  onExportJournal: () => Promise<void>;
  exportOptions: () => any;
  nameOf: (id: string | null) => string;
  sortedCount: number;
  filteredCount: number;
}

export function PayrollOperationsModal({
  open,
  onClose,
  run,
  runStatus,
  monthLabel,
  monthStartStr,
  canManage,
  closed,
  approved,
  busy,
  liveRowsCount,
  missingInputCount,
  canLock,
  unmetCount,
  blockingUnmet,
  checklist,
  allWarnings,
  setupGaps,
  lastEvent,
  runEvents,
  onCalculate,
  onOpenLock,
  onOpenWithdraw,
  onOpenBank,
  onMarkPaid,
  onExportJournal,
  exportOptions,
  nameOf,
  sortedCount,
  filteredCount,
}: PayrollOperationsModalProps) {
  const navigate = useNavigate();
  const [historyOpen, setHistoryOpen] = useState(false);

  return (
    <Modal square open={open} onClose={onClose} title={`Vận hành & Quy trình kỳ lương tháng ${monthLabel}`} size="xl">
      <div className="space-y-5">
        {/* ===================== KHỐI 1: VÒNG ĐỜI TRẠNG THÁI ===================== */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/60 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 pb-2.5">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Tiến trình kỳ lương
            </span>
            <span className="rounded-full bg-indigo-100 dark:bg-indigo-950 text-indigo-800 dark:text-indigo-200 px-2.5 py-0.5 text-xs font-black">
              {RUN_STATUS_LABEL[runStatus]}
            </span>
          </div>

          <RunLifecycle status={runStatus} />

          {/* Thông báo chi tiết theo trạng thái */}
          {runStatus === 'CALCULATED' && run?.review_note && lastEvent && (lastEvent.action === 'REJECTED' || lastEvent.action === 'WITHDRAWN') && (
            <div className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800 dark:border-red-900 dark:bg-red-950/60 dark:text-red-200">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
              <div>
                <p className="font-bold">
                  {lastEvent.action === 'REJECTED' ? 'Người duyệt từ chối' : 'Kế toán đã rút lại'} ({lastEvent.actor_name ?? nameOf(lastEvent.actor_id)},{' '}
                  {formatDateTime(lastEvent.created_at)}):
                </p>
                <p className="mt-0.5">{run.review_note}</p>
              </div>
            </div>
          )}

          {runStatus === 'LOCKED' && (
            <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-200">
              <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <div>
                <p className="font-bold">Kỳ đã khoá lúc {formatDateTime(run?.locked_at ?? null)} bởi {nameOf(run?.locked_by ?? null)}</p>
                <p className="mt-0.5 text-amber-700 dark:text-amber-300">
                  Đang chờ Ban Giám đốc ký duyệt chi. Số liệu không sửa được; nếu phát hiện sai sót cần <strong>Rút lại</strong> kèm lý do.
                </p>
              </div>
            </div>
          )}

          {runStatus === 'APPROVED' && (
            <div className="flex items-start gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-200">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <div>
                <p className="font-bold">Kỳ lương đã được Ban Giám đốc duyệt chi</p>
                <p className="mt-0.5 text-emerald-700 dark:text-emerald-300">
                  Bạn có thể xuất file chi ngân hàng hoặc xác nhận chi trả để phát hành phiếu lương đến nhân viên.
                </p>
              </div>
            </div>
          )}

          {runStatus === 'PAID' && (
            <div className="flex items-start gap-2.5 rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-xs text-indigo-800 dark:border-indigo-900 dark:bg-indigo-950/60 dark:text-indigo-200">
              <Wallet className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600 dark:text-indigo-400" />
              <div>
                <p className="font-bold">Đã hoàn tất chi trả và phát hành phiếu lương</p>
                <p className="mt-0.5 text-indigo-700 dark:text-indigo-300">
                  Phiếu lương đã gửi đến ứng dụng của nhân viên. Bút toán kết chuyển lương đã sẵn sàng để đối chiếu.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* ===================== KHỐI 2: HÀNH ĐỘNG CHÍNH & VẬN HÀNH ===================== */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* CỘT TRÁI: CÁC NÚT HÀNH ĐỘNG VẬN HÀNH */}
          <div className="space-y-3 rounded-xl border border-slate-200 dark:border-slate-800 p-4 bg-white dark:bg-slate-900">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5 border-b border-slate-200 dark:border-slate-800 pb-2">
              <Calculator className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
              Thao tác vận hành kỳ
            </h4>

            <div className="space-y-2.5 pt-1">
              {/* Nút Tính lương / Tính lại */}
              {canManage && !closed && (
                <div className="space-y-1">
                  <Button
                    variant="primary"
                    onClick={() => void onCalculate()}
                    disabled={!!busy || liveRowsCount === 0 || missingInputCount > 0}
                    title={missingInputCount > 0 ? `Còn ${missingInputCount} ô số liệu tháng chưa nhập` : undefined}
                    className="w-full justify-center h-10 gap-2 font-bold"
                  >
                    <Calculator className="h-4 w-4" />
                    {busy === 'calc' ? 'Đang tính toán lại…' : runStatus === 'DRAFT' ? 'Tính lương (bản nháp)' : 'Tính lại bảng lương'}
                  </Button>
                  {missingInputCount > 0 && (
                    <p className="text-[11px] text-amber-600 dark:text-amber-400 font-medium text-center">
                      ⚠️ Còn {missingInputCount} ô số liệu tháng chưa nhập — nhập đủ để tính lương.
                    </p>
                  )}
                </div>
              )}

              {/* Nút Khoá kỳ & trình duyệt */}
              {canManage && runStatus === 'CALCULATED' && (
                <div className="space-y-1">
                  <Button
                    variant="success"
                    onClick={() => {
                      onClose();
                      onOpenLock();
                    }}
                    disabled={!!busy || !canLock}
                    title={canLock ? undefined : 'Hoàn tất các mục bắt buộc trong danh sách kiểm tra'}
                    className="w-full justify-center h-10 gap-2 font-bold"
                  >
                    <LockKeyhole className="h-4 w-4" /> Khoá kỳ & trình duyệt (2FA)
                  </Button>
                  {!canLock && (
                    <p className="text-[11px] text-red-500 font-medium text-center">
                      Còn {blockingUnmet.length} mục bắt buộc chưa đạt bên danh sách kiểm tra.
                    </p>
                  )}
                </div>
              )}

              {/* Nút Rút lại để sửa */}
              {canManage && runStatus === 'LOCKED' && (
                <Button
                  variant="outline"
                  onClick={() => {
                    onClose();
                    onOpenWithdraw();
                  }}
                  disabled={!!busy}
                  className="w-full justify-center h-10 gap-2 font-bold border-amber-300 text-amber-800 dark:text-amber-300 hover:bg-amber-50"
                >
                  <Undo2 className="h-4 w-4" /> Rút kỳ lương về để sửa
                </Button>
              )}

              {/* Nút File chi lương ngân hàng */}
              {canManage && approved && (
                <Button
                  variant="outline"
                  onClick={() => {
                    onClose();
                    onOpenBank();
                  }}
                  disabled={!!busy}
                  className="w-full justify-center h-10 gap-2 font-bold"
                >
                  <Landmark className="h-4 w-4" /> Xuất file chi lương ngân hàng
                </Button>
              )}

              {/* Nút Xác nhận chi trả */}
              {canManage && runStatus === 'APPROVED' && (
                <Button
                  variant="success"
                  onClick={() => void onMarkPaid()}
                  disabled={!!busy}
                  className="w-full justify-center h-10 gap-2 font-bold"
                >
                  <Wallet className="h-4 w-4" />
                  {busy === 'paid' ? 'Đang xác nhận…' : 'Xác nhận đã chi trả & phát hành phiếu'}
                </Button>
              )}
            </div>

            {/* Xuất file & Bút toán kết chuyển */}
            <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">
                Xuất tài liệu & Báo cáo
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <ExportButtons options={exportOptions} disabled={sortedCount === 0} />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void onExportJournal()}
                  disabled={!!busy || !approved || filteredCount === 0}
                  title={approved ? undefined : 'Duyệt chi xong mới xuất bút toán kết chuyển'}
                  className="gap-1.5"
                >
                  <BookOpenCheck className="h-3.5 w-3.5" /> Bút toán kết chuyển
                </Button>
              </div>
            </div>

            {/* Lịch sử kỳ lương */}
            {runEvents.length > 0 && (
              <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setHistoryOpen((v) => !v)}
                  className="text-xs font-bold text-slate-600 dark:text-slate-400 hover:text-indigo-600 flex items-center gap-1.5"
                >
                  <History className="h-3.5 w-3.5" />
                  {historyOpen ? 'Thu gọn lịch sử kỳ lương' : `Xem lịch sử phê duyệt kỳ lương (${runEvents.length})`}
                </button>
                {historyOpen && (
                  <div className="mt-2.5 max-h-48 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-800 p-2.5 bg-slate-50 dark:bg-slate-850">
                    <Timeline rows={runEvents} nameOf={nameOf} />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* CỘT PHẢI: DANH SÁCH KIỂM TRA ĐIỀU KIỆN & CẢNH BÁO */}
          <div className="space-y-3 rounded-xl border border-slate-200 dark:border-slate-800 p-4 bg-white dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-2">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                <ListChecks className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
                Kiểm tra trước khi khoá kỳ
              </h4>
              <span
                className={`text-[10px] font-black px-1.5 py-0.5 rounded ${
                  canLock ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'
                }`}
              >
                {canLock ? 'Đạt' : `${unmetCount} chưa đạt`}
              </span>
            </div>

            {/* Danh sách 7 mục kiểm tra */}
            <ul className="space-y-2.5 max-h-[220px] overflow-y-auto pr-1">
              {checklist.map((item) => (
                <li key={item.label} className="flex items-start gap-2.5 text-xs">
                  {item.ok ? (
                    <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <CircleAlert
                      className={`mt-0.5 h-4 w-4 shrink-0 ${item.blocking ? 'text-red-500' : 'text-amber-500'}`}
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`font-semibold ${
                          item.ok
                            ? 'text-slate-700 dark:text-slate-300'
                            : item.blocking
                            ? 'text-red-700 dark:text-red-400 font-bold'
                            : 'text-amber-800 dark:text-amber-300'
                        }`}
                      >
                        {item.label}
                      </span>
                      {item.blocking && (
                        <span className="text-[9px] font-black px-1 py-0.2 rounded bg-slate-100 dark:bg-slate-800 text-slate-500">
                          Bắt buộc
                        </span>
                      )}
                    </div>
                    {!item.ok && (
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">
                        {item.hint}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>

            {/* Cảnh báo tính toán nếu có */}
            {(allWarnings.length > 0 || setupGaps.length > 0) && (
              <div className="pt-2.5 border-t border-slate-200 dark:border-slate-800 space-y-2">
                <div className="flex items-center gap-1.5 text-xs font-bold text-amber-700 dark:text-amber-400">
                  <TriangleAlert className="h-3.5 w-3.5" />
                  Cảnh báo tính toán ({allWarnings.length + setupGaps.length})
                </div>

                {setupGaps.length > 0 && (
                  <div className="rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/80 p-2 text-[11px] text-amber-900 dark:text-amber-200 flex items-center justify-between gap-2">
                    <span>{setupGaps.length} người chưa thiết lập xong cơ chế</span>
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        navigate(`/admin/payroll/setup/schemes?month=${monthStartStr.slice(0, 7)}`);
                      }}
                      className="font-bold underline text-amber-800 dark:text-amber-300 shrink-0"
                    >
                      Thiết lập ngay
                    </button>
                  </div>
                )}

                {allWarnings.length > 0 && (
                  <div className="max-h-24 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-800 p-2 text-[11px] text-slate-600 dark:text-slate-400 space-y-1">
                    {allWarnings.slice(0, 5).map((w, idx) => (
                      <p key={idx} className="truncate">• {w}</p>
                    ))}
                    {allWarnings.length > 5 && (
                      <p className="font-semibold text-slate-500">...và {allWarnings.length - 5} cảnh báo khác</p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ===================== KHỐI 3: NÚT ĐÓNG ===================== */}
        <div className="flex justify-end pt-2 border-t border-slate-200 dark:border-slate-800">
          <Button type="button" variant="primary" size="sm" onClick={onClose} className="px-6 font-bold">
            Đóng
          </Button>
        </div>
      </div>
    </Modal>
  );
}
