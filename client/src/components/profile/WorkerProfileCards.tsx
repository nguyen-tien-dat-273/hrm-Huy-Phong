// ============================================================================
// Hồ sơ người lao động và giấy tờ, hiển thị trên trang cá nhân.
// ----------------------------------------------------------------------------
// Cùng dữ liệu mà HR quản lý ở "Hồ sơ người lao động" và "Hồ sơ giấy tờ",
// nhưng chỉ phần của chính người đang đăng nhập và ở dạng chỉ đọc.
//
// Ưu tiên lớn nhất của màn này là HẠN GIẤY TỜ: hộ chiếu hay visa hết hạn mà
// không ai để ý là hỏng cả kế hoạch xuất cảnh, nên giấy tờ quá hạn và sắp hết
// hạn được đẩy lên đầu và tô màu rõ.
// ============================================================================

import {
  BadgeJapaneseYen, CalendarClock, CircleCheck, Clock3, FileText,
  IdCard, MapPin, TriangleAlert,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { formatDate } from '@/lib/utils';
import {
  expiryState, EXPIRY_WARNING_DAYS, JAPANESE_LEVEL_LABEL, WORKER_DOCUMENT_LABEL,
  WORKER_PROGRAM_LABEL, WORKER_STAGE_ORDER, WORKER_STATUS_LABEL,
  type OwnWorkerProfile,
} from '@/lib/workerProfile';

export function WorkerProfileCards({ data }: { data: OwnWorkerProfile }) {
  // Chưa chạy migration, hoặc người này không thuộc diện lao động xuất khẩu →
  // không hiện gì. Một thẻ trống "bạn chưa có hồ sơ" chỉ làm nhiễu trang.
  if (!data.supported || !data.worker) return null;

  const { worker, documents, logs } = data;
  const status = WORKER_STATUS_LABEL[worker.status];
  const stageIndex = WORKER_STAGE_ORDER.indexOf(worker.status);

  // Quá hạn lên trước, rồi sắp hết hạn, rồi còn hạn dài. Giấy không có hạn
  // (chứng chỉ tiếng Nhật chẳng hạn) xuống cuối.
  const rank = { expired: 0, soon: 1, valid: 2, none: 3 };
  const sortedDocuments = [...documents].sort((a, b) => {
    const left = expiryState(a.expiry_date);
    const right = expiryState(b.expiry_date);
    if (rank[left.state] !== rank[right.state]) return rank[left.state] - rank[right.state];
    return (left.days ?? 0) - (right.days ?? 0);
  });

  const problemCount = documents.filter((item) => {
    const state = expiryState(item.expiry_date).state;
    return state === 'expired' || state === 'soon';
  }).length;

  return (
    <>
      {/* ---- Hồ sơ người lao động ---- */}
      <Card>
        <CardHeader>
          <CardTitle>Hồ sơ người lao động</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-none bg-slate-100 text-slate-600">
                <IdCard className="h-4 w-4" />
              </div>
              <div>
                <p className="text-xs text-slate-600">Mã lao động</p>
                <p className="font-mono text-sm font-bold text-slate-800">{worker.code}</p>
              </div>
            </div>
            <Badge className={status.color}>{status.label}</Badge>
          </div>

          <div className="grid grid-cols-1 gap-x-5 gap-y-1 sm:grid-cols-2">
            <Field icon={<BadgeJapaneseYen className="h-4 w-4" />} label="Chương trình"
              value={WORKER_PROGRAM_LABEL[worker.program]} />
            <Field icon={<FileText className="h-4 w-4" />} label="Ngành nghề"
              value={worker.industry} />
            <Field icon={<CircleCheck className="h-4 w-4" />} label="Trình độ tiếng Nhật"
              value={JAPANESE_LEVEL_LABEL[worker.japanese_level]} />
            <Field icon={<CalendarClock className="h-4 w-4" />} label="Ngày sinh"
              value={worker.date_of_birth ? formatDate(worker.date_of_birth) : null} />
            <Field icon={<MapPin className="h-4 w-4" />} label="Quê quán"
              value={worker.hometown} />
            <Field icon={<IdCard className="h-4 w-4" />} label="Giới tính"
              value={worker.gender === 'MALE' ? 'Nam' : worker.gender === 'FEMALE' ? 'Nữ' : null} />
          </div>

          {/* Thanh tiến trình: người lao động cần thấy mình đang ở đâu trong
              hành trình, không chỉ một nhãn trạng thái rời rạc. */}
          {stageIndex >= 0 && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-semibold text-slate-600">Tiến trình</p>
                <p className="text-xs text-slate-600">
                  Bước {stageIndex + 1}/{WORKER_STAGE_ORDER.length}
                </p>
              </div>
              <div className="flex gap-1">
                {WORKER_STAGE_ORDER.map((stage, index) => (
                  <div
                    key={stage}
                    title={WORKER_STATUS_LABEL[stage].label}
                    className={`h-1.5 flex-1 rounded-full ${
                      index <= stageIndex ? 'bg-indigo-500' : 'bg-slate-200'
                    }`}
                  />
                ))}
              </div>
              <p className="mt-2 text-xs text-slate-600">
                Giai đoạn hiện tại: <strong className="text-slate-700">{status.label}</strong>
              </p>
            </div>
          )}

          {worker.note && (
            <p className="rounded-none bg-slate-50 px-3.5 py-2.5 text-xs leading-relaxed text-slate-600">
              <strong className="text-slate-700">Ghi chú từ HR:</strong> {worker.note}
            </p>
          )}


        </CardContent>
      </Card>

      {/* ---- Giấy tờ ---- */}
      <Card>
        <CardHeader>
          <CardTitle>Hồ sơ giấy tờ</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {problemCount > 0 && (
            <div className="flex items-start gap-2.5 rounded-none border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs leading-relaxed text-amber-800">
              <TriangleAlert className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span>
                {problemCount} giấy tờ đã hết hạn hoặc sắp hết hạn trong {EXPIRY_WARNING_DAYS} ngày
                tới. Liên hệ HR để chuẩn bị gia hạn.
              </span>
            </div>
          )}

          {sortedDocuments.length === 0 ? (
            <p className="py-4 text-center text-sm text-slate-600">
              Chưa có giấy tờ nào được ghi nhận.
            </p>
          ) : (
            <ul className="divide-y divide-slate-50">
              {sortedDocuments.map((document) => {
                const { state, days } = expiryState(document.expiry_date);
                return (
                  <li key={document.id} className="flex items-start justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-800">
                        {WORKER_DOCUMENT_LABEL[document.document_type] ?? document.document_type}
                      </p>
                      <p className="mt-0.5 font-mono text-xs text-slate-600">{document.document_number}</p>
                      <p className="mt-0.5 text-xs text-slate-600">
                        {document.issue_date ? `Cấp ${formatDate(document.issue_date)}` : 'Chưa rõ ngày cấp'}
                        {document.expiry_date ? ` · Hết hạn ${formatDate(document.expiry_date)}` : ''}
                      </p>
                      {document.note && (
                        <p className="mt-1 text-xs leading-relaxed text-slate-600">{document.note}</p>
                      )}
                    </div>
                    <ExpiryBadge state={state} days={days} />
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* ---- Lịch sử tiến trình ---- */}
      {logs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Lịch sử tiến trình</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3.5">
              {logs.map((log) => (
                <li key={log.id} className="flex gap-3">
                  <span className="mt-1.5 h-2.5 w-2.5 flex-shrink-0 rounded-full bg-indigo-500 ring-4 ring-indigo-50" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-700">
                      {WORKER_STATUS_LABEL[log.status]?.label ?? log.status}
                    </p>
                    <p className="text-xs text-slate-600">
                      {new Date(log.changed_at).toLocaleString('vi-VN')}
                      {log.note ? ` · ${log.note}` : ''}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </>
  );
}

function Field({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | null }) {
  return (
    <div className="flex items-start gap-3 py-2.5">
      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-none bg-slate-100 text-slate-600">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs text-slate-600">{label}</p>
        <p className="break-words text-sm font-medium text-slate-800">
          {value || <span className="text-slate-600">Chưa có</span>}
        </p>
      </div>
    </div>
  );
}

function ExpiryBadge({ state, days }: { state: ReturnType<typeof expiryState>['state']; days: number | null }) {
  if (state === 'none') {
    return <Badge className="flex-shrink-0 bg-slate-100 text-slate-600">Không có hạn</Badge>;
  }
  if (state === 'expired') {
    return (
      <Badge className="flex-shrink-0 bg-red-50 text-red-700">
        <TriangleAlert className="mr-1 inline h-3 w-3" />
        Quá hạn {Math.abs(days ?? 0)} ngày
      </Badge>
    );
  }
  if (state === 'soon') {
    return (
      <Badge className="flex-shrink-0 bg-amber-50 text-amber-700">
        <Clock3 className="mr-1 inline h-3 w-3" />
        Còn {days} ngày
      </Badge>
    );
  }
  return (
    <Badge className="flex-shrink-0 bg-emerald-50 text-emerald-700">
      <CircleCheck className="mr-1 inline h-3 w-3" />
      Còn hạn
    </Badge>
  );
}
