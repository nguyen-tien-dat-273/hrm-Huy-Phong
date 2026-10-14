// ============================================================================
// Hộp thư gộp — mọi đơn đang chờ MÌNH duyệt, trong một danh sách.
// ----------------------------------------------------------------------------
// Màn Đơn từ đang chia tab theo LOẠI ĐƠN. Người duyệt mở màn này để hỏi "có gì
// cần tôi?", nên trục đó trả lời sai câu hỏi: 7 đơn thuộc 3 loại thì phải vào
// 3 tab và tự cộng bằng mắt.
//
// Ở đây loại đơn là một CỘT, không phải một tab. Gộp được là nhờ vậy.
//
// CỐ Ý không có nút Duyệt/Từ chối ở đây. Ba loại đơn có ba luật khác nhau —
// đơn phép ≥2 ngày phải qua Ban Giám đốc (chặn ở database), đơn đi muộn tiêu
// hạn mức tháng, huỷ phép phải hoàn quỹ — và mỗi luồng còn gửi thông báo riêng.
// Nhân bản chúng vào đây là tạo ra bản thứ hai sẽ lệch dần với bản gốc, ở đúng
// chỗ lệch là duyệt sai thẩm quyền. Nút "Mở" đưa sang tab có sẵn luật.
// ============================================================================

import { useMemo } from 'react';
import { ArrowRight, Inbox } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Avatar } from '@/components/ui/Avatar';
import { formatDate } from '@/lib/utils';

/** Một dòng trong hộp thư, đã quy về cùng một hình dạng. */
export interface PendingRow {
  id: string;
  /** Tab sở hữu luồng duyệt của đơn này. */
  tab: 'attendance' | 'requests' | 'cancellations';
  loai: string;
  /** Màu nhãn loại đơn, theo bảng màu sẵn có của từng loại. */
  mau: string;
  tenNguoi: string;
  avatarUrl?: string | null;
  boPhan?: string | null;
  tuNgay: string;
  denNgay?: string | null;
  lyDo?: string | null;
}

interface Props {
  rows: readonly PendingRow[];
  loading?: boolean;
  onOpen: (tab: PendingRow['tab']) => void;
}

export function PendingRequestsInbox({ rows, loading = false, onOpen }: Props) {
  /** Gom theo tab để nút "Mở" nói rõ sẽ sang đâu và còn bao nhiêu. */
  const theoTab = useMemo(() => {
    const map = new Map<PendingRow['tab'], number>();
    for (const row of rows) map.set(row.tab, (map.get(row.tab) ?? 0) + 1);
    return map;
  }, [rows]);

  if (loading) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-slate-500">Đang tải đơn…</CardContent>
      </Card>
    );
  }

  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="p-0">
          <EmptyState
            icon={<Inbox className="h-8 w-8" />}
            title="Không có đơn nào chờ bạn duyệt"
            description="Đơn mới gửi sẽ xuất hiện ở đây ngay, không cần tải lại trang."
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-3">
          <p className="text-sm font-semibold text-slate-700">
            {rows.length} đơn đang chờ bạn duyệt
          </p>
          <div className="flex flex-wrap gap-1.5">
            {[...theoTab].map(([tab, so]) => (
              <button
                key={tab}
                type="button"
                onClick={() => onOpen(tab)}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-600 transition hover:border-indigo-300 hover:text-indigo-700"
              >
                {TAB_LABEL[tab]} {so}
                <ArrowRight className="h-3 w-3" />
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs font-semibold text-slate-500">
                <th className="px-5 py-3">Loại đơn</th>
                <th className="px-3 py-3">Nhân viên</th>
                <th className="px-3 py-3 w-52">Thời gian</th>
                <th className="px-3 py-3">Lý do</th>
                <th className="px-3 py-3 w-20" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {rows.map((row) => (
                <tr key={`${row.tab}-${row.id}`} className="transition-colors hover:bg-slate-50/70">
                  <td className="px-5 py-3">
                    <span className={`inline-block rounded-lg px-2 py-1 text-[11px] font-bold ${row.mau}`}>
                      {row.loai}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2.5">
                      <Avatar name={row.tenNguoi} url={row.avatarUrl} size="sm" />
                      <div className="min-w-0">
                        <p className="truncate font-medium text-slate-800">{row.tenNguoi}</p>
                        {row.boPhan && (
                          <p className="truncate text-xs text-slate-400">{row.boPhan}</p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-slate-600">
                    {formatDate(row.tuNgay)}
                    {row.denNgay && row.denNgay !== row.tuNgay && (
                      <> <span className="text-slate-400">→</span> {formatDate(row.denNgay)}</>
                    )}
                  </td>
                  <td className="px-3 py-3 text-slate-500">
                    <span className="line-clamp-2">{row.lyDo?.trim() || '—'}</span>
                  </td>
                  <td className="px-3 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => onOpen(row.tab)}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-bold text-slate-500 transition hover:border-indigo-300 hover:text-indigo-700"
                    >
                      Mở <ArrowRight className="h-3 w-3" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

const TAB_LABEL: Record<PendingRow['tab'], string> = {
  attendance: 'Đi muộn · Về sớm · Làm thêm',
  requests: 'Nghỉ phép',
  cancellations: 'Hủy phép',
};
