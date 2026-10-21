// ============================================================================
// Trợ lý hỏi đáp — màn quản trị.
// ----------------------------------------------------------------------------
// Tab "Câu hỏi": tìm câu trợ lý CHƯA trả lời được để bổ sung. Nhật ký chỉ có
// câu hỏi và tên công cụ đã dùng, không lưu câu trả lời hay số liệu.
// Tab "Quy chế": văn bản nội quy / chính sách để trợ lý trả lời câu hỏi kiểu
// "nghỉ phép được mấy ngày", "đi muộn bị trừ thế nào".
// ============================================================================

import { useEffect, useMemo, useState } from 'react';
import { BookOpen, MessageCircleQuestion, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Input, Textarea } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { useConfirm } from '@/contexts/ConfirmContext';
import { useToast } from '@/contexts/ToastContext';
import {
  deleteChatbotKnowledge,
  fetchChatbotKnowledge,
  fetchChatbotLogs,
  saveChatbotKnowledge,
  type ChatbotKnowledge,
  type ChatbotLog,
} from '@/lib/chatbot';
import { formatDateTime } from '@/lib/utils';

const TOOL_LABELS: Record<string, string> = {
  attendance_day: 'Chấm công trong ngày',
  late_summary: 'Thống kê đi muộn',
  month_summary: 'Công tháng',
  leave_balance: 'Phép còn lại',
  pending_items: 'Việc đang chờ',
  kpi_result: 'KPI',
  holidays: 'Ngày lễ',
  headcount: 'Quân số',
  query_data: 'Truy vấn thống kê',
  company_policy: 'Quy chế',
  my_payslip: 'Phiếu lương',
  unsupported: 'Chưa hỗ trợ',
};

type Tab = 'logs' | 'knowledge';

export function AdminChatbotLogs() {
  const [tab, setTab] = useState<Tab>('logs');

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-xl font-bold text-slate-800">Trợ lý hỏi đáp</h1>
        <p className="text-sm text-slate-500">
          Xem người dùng hỏi gì, câu nào trợ lý chưa trả lời được, và soạn văn bản quy chế để trợ lý tra cứu.
        </p>
      </div>

      <div className="flex gap-1 border-b border-slate-200">
        {([
          ['logs', 'Câu hỏi', MessageCircleQuestion],
          ['knowledge', 'Quy chế cho trợ lý', BookOpen],
        ] as const).map(([key, label, Icon]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-semibold ${
              tab === key ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>

      {tab === 'logs' ? <LogsTab /> : <KnowledgeTab />}
    </div>
  );
}

function LogsTab() {
  const [onlyUnanswered, setOnlyUnanswered] = useState(false);
  const [rows, setRows] = useState<ChatbotLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void fetchChatbotLogs(onlyUnanswered).then((result) => {
      if (cancelled) return;
      setRows(result.rows);
      setError(result.error);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [onlyUnanswered, reload]);

  const stats = useMemo(() => {
    const total = rows.length;
    const failed = rows.filter((r) => r.answered !== true).length;
    const usage = new Map<string, number>();
    for (const r of rows) for (const t of new Set(r.tools)) usage.set(t, (usage.get(t) ?? 0) + 1);
    return { total, failed, usage: [...usage.entries()].sort((a, b) => b[1] - a[1]) };
  }, [rows]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500">Nhật ký giữ 180 ngày, không lưu câu trả lời.</p>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={onlyUnanswered} onChange={(e) => setOnlyUnanswered(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
          Chỉ câu chưa trả lời được
        </label>
      </div>

      {!loading && !error && rows.length > 0 && (
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-600">{stats.total} câu hỏi gần nhất</span>
          <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-700">{stats.failed} chưa trả lời được / lỗi</span>
          {stats.usage.map(([tool, n]) => (
            <span key={tool} className="rounded-full bg-indigo-50 px-3 py-1 text-indigo-700">{TOOL_LABELS[tool] ?? tool}: {n}</span>
          ))}
        </div>
      )}

      <Card className="!rounded-none">
        <CardContent className="p-0">
          {loading ? (
            <div className="p-4"><TableSkeleton rows={6} /></div>
          ) : error ? (
            <ErrorState message={error} onRetry={() => setReload((n) => n + 1)} />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={<MessageCircleQuestion className="h-7 w-7" />}
              title={onlyUnanswered ? 'Chưa có câu hỏi nào bị bỏ lỡ' : 'Chưa có ai hỏi trợ lý'}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
                    <th className="px-4 py-2.5 font-semibold">Thời gian</th>
                    <th className="px-4 py-2.5 font-semibold">Người hỏi</th>
                    <th className="px-4 py-2.5 font-semibold">Câu hỏi</th>
                    <th className="px-4 py-2.5 font-semibold">Công cụ đã dùng</th>
                    <th className="px-4 py-2.5 font-semibold">Kết quả</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b border-slate-50 align-top last:border-0">
                      <td className="whitespace-nowrap px-4 py-2.5 text-xs text-slate-500">{formatDateTime(r.created_at)}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-slate-700">{r.person ?? '—'}</td>
                      <td className="min-w-64 px-4 py-2.5 text-slate-800">{r.question}</td>
                      <td className="px-4 py-2.5 text-xs text-slate-500">
                        {r.tools.length ? [...new Set(r.tools)].map((t) => TOOL_LABELS[t] ?? t).join(', ') : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-xs">
                        {r.error
                          ? <span className="text-red-600" title={r.error}>Lỗi</span>
                          : r.answered === true
                            ? <span className="text-emerald-600">Đã trả lời</span>
                            : r.answered === false
                              ? <span className="text-amber-600">Chưa hỗ trợ</span>
                              : <span className="text-slate-400">Đang xử lý / bị ngắt</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

type Draft = { id?: string; title: string; content: string; is_active: boolean };

const MAX_CONTENT = 6000;

function KnowledgeTab() {
  const { toast } = useToast();
  const confirm = useConfirm();
  const [rows, setRows] = useState<ChatbotKnowledge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void fetchChatbotKnowledge().then((result) => {
      if (cancelled) return;
      setRows(result.rows);
      setError(result.error);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [reload]);

  const save = async () => {
    if (!draft) return;
    if (draft.title.trim().length < 2 || !draft.content.trim()) {
      toast('Cần nhập tiêu đề và nội dung.', 'warning');
      return;
    }
    setSaving(true);
    const failure = await saveChatbotKnowledge(draft);
    setSaving(false);
    if (failure) {
      toast(`Không lưu được: ${failure}`, 'error');
      return;
    }
    toast(draft.id ? 'Đã cập nhật văn bản.' : 'Đã thêm văn bản.', 'success');
    setDraft(null);
    setReload((n) => n + 1);
  };

  const remove = async (row: ChatbotKnowledge) => {
    const ok = await confirm({
      title: 'Xoá văn bản?',
      message: `Trợ lý sẽ không còn tra được "${row.title}".`,
      danger: true,
    });
    if (!ok) return;
    const failure = await deleteChatbotKnowledge(row.id);
    if (failure) {
      toast(`Không xoá được: ${failure}`, 'error');
      return;
    }
    setReload((n) => n + 1);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl space-y-1 text-sm text-slate-500">
          <p>
            Dán nội quy, chính sách nghỉ phép, thưởng, phúc lợi, quy trình… Trợ lý chỉ trả lời câu hỏi quy chế theo đúng các văn bản này,
            cùng giờ làm việc và mức trừ công đi muộn đã cài trong hệ thống.
          </p>
          <p className="text-amber-700">
            Nội dung được gửi cho dịch vụ AI khi có người hỏi. Chỉ đưa thông tin công khai trong công ty, không đưa lương hay dữ liệu cá nhân.
          </p>
        </div>
        <Button size="sm" onClick={() => setDraft({ title: '', content: '', is_active: true })}>
          <Plus className="h-4 w-4" /> Thêm văn bản
        </Button>
      </div>

      <Card className="!rounded-none">
        <CardContent className="p-0">
          {loading ? (
            <div className="p-4"><TableSkeleton rows={4} /></div>
          ) : error ? (
            <ErrorState message={error} onRetry={() => setReload((n) => n + 1)} />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={<BookOpen className="h-7 w-7" />}
              title="Chưa có văn bản quy chế"
              description="Thêm nội quy công ty để trợ lý trả lời được câu hỏi về chính sách."
            />
          ) : (
            <ul className="divide-y divide-slate-100">
              {rows.map((row) => (
                <li key={row.id} className="flex items-start gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-slate-800">
                      {row.title}
                      {!row.is_active && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-500">Đang ẩn</span>}
                    </p>
                    <p className="mt-0.5 line-clamp-2 whitespace-pre-line text-sm text-slate-500">{row.content}</p>
                    <p className="mt-1 text-xs text-slate-400">Cập nhật {formatDateTime(row.updated_at)}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDraft({ id: row.id, title: row.title, content: row.content, is_active: row.is_active })}
                    className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                    aria-label="Sửa"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(row)}
                    className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
                    aria-label="Xoá"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Modal open={!!draft} onClose={() => !saving && setDraft(null)} title={draft?.id ? 'Sửa văn bản quy chế' : 'Thêm văn bản quy chế'} size="lg">
        {draft && (
          <div className="space-y-4">
            <Input
              label="Tiêu đề"
              required
              maxLength={200}
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              placeholder="Ví dụ: Chính sách nghỉ phép năm"
            />
            <div>
              <Textarea
                label="Nội dung"
                required
                rows={12}
                maxLength={MAX_CONTENT}
                value={draft.content}
                onChange={(e) => setDraft({ ...draft, content: e.target.value })}
                placeholder="Dán nội dung quy định. Viết rõ con số, điều kiện, người phê duyệt…"
              />
              <p className="mt-1 text-right text-xs text-slate-400">{draft.content.length}/{MAX_CONTENT}</p>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={draft.is_active}
                onChange={(e) => setDraft({ ...draft, is_active: e.target.checked })}
                className="h-4 w-4 rounded border-slate-300"
              />
              Cho trợ lý dùng văn bản này
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDraft(null)} disabled={saving}>Huỷ</Button>
              <Button onClick={() => void save()} disabled={saving}>{saving ? 'Đang lưu…' : 'Lưu'}</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
