// ============================================================================
// Trợ lý hỏi đáp — nút nổi góc phải dưới, mở ra khung chat.
// ----------------------------------------------------------------------------
// Danh sách trang gửi kèm câu hỏi đã lọc theo quyền của người dùng (cùng luật
// với tìm kiếm nhanh), để AI chỉ hướng dẫn tới trang họ vào được. Liên kết
// trong câu trả lời cũng chỉ hiện thành nút khi nằm trong danh sách đó.
// ============================================================================

import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Bot, Eraser, Loader2, MessageCircleQuestion, SendHorizontal, X } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { ADMIN_NAV_ITEMS, STAFF_NAV_ITEMS } from '@/config/navigation';
import { hasAdminFunction, hasPermission, isFullAdmin, isTeamlead } from '@/lib/permissions';
import { askChatbot, revealNames, type ChatCard, type ChatMessage, type ChatPage } from '@/lib/chatbot';
import { PayslipChatCard } from './PayslipChatCard';

const HIDDEN_PATHS = ['/login', '/forgot-password', '/reset-password', '/change-password', '/setup'];

function storageKey(userId: string) {
  return `hrm-chatbot:${userId}`;
}

function loadSaved(userId: string): { messages: ChatMessage[]; aliases: Record<string, string> } {
  try {
    const raw = sessionStorage.getItem(storageKey(userId));
    if (raw) {
      const parsed = JSON.parse(raw) as { messages?: ChatMessage[]; aliases?: Record<string, string> };
      return { messages: Array.isArray(parsed.messages) ? parsed.messages : [], aliases: parsed.aliases ?? {} };
    }
  } catch {
    /* trình duyệt chặn lưu trữ: bắt đầu trống */
  }
  return { messages: [], aliases: {} };
}

let idSeq = 0;
const newId = () => `${Date.now()}-${++idSeq}`;

export function ChatbotWidget() {
  const { profile } = useAuth();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [aliases, setAliases] = useState<Record<string, string>>({});
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Mỗi tài khoản một lịch sử, chỉ trong phiên trình duyệt.
  useEffect(() => {
    if (!profile) return;
    const saved = loadSaved(profile.id);
    setMessages(saved.messages);
    setAliases(saved.aliases);
  }, [profile?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!profile) return;
    try {
      sessionStorage.setItem(storageKey(profile.id), JSON.stringify({ messages: messages.slice(-40), aliases }));
    } catch {
      /* bỏ qua */
    }
  }, [messages, aliases, profile]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy, open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const pages = useMemo<ChatPage[]>(() => {
    if (!profile) return [];
    const admin = ADMIN_NAV_ITEMS.filter((item) => {
      const allowed = item.anyPermissions?.length
        ? item.anyPermissions.some((permission) => hasPermission(profile, permission))
        : hasPermission(profile, item.permission);
      return allowed
        && (!item.fullAdminOnly || isFullAdmin(profile))
        && (!item.functionCode || hasAdminFunction(profile, item.functionCode))
        && (!item.hideForTeamlead || !isTeamlead(profile));
    });
    return [...STAFF_NAV_ITEMS, ...admin, { to: '/profile', label: 'Hồ sơ cá nhân', description: 'Thông tin cá nhân, ảnh đại diện, số điện thoại' }]
      .map((item) => ({ to: item.to, label: item.label, description: item.description }));
  }, [profile]);

  const allowedPaths = useMemo(() => new Set(pages.map((p) => p.to)), [pages]);

  const suggestions = useMemo(() => {
    if (!profile) return [];
    const manager = hasPermission(profile, 'attendance');
    return manager
      ? ['Hôm nay bao nhiêu người đi muộn?', 'Phòng nào đi muộn nhiều nhất tháng này?', 'Tháng trước ai làm thêm giờ nhiều nhất?', 'Có đơn nào đang chờ tôi duyệt?', 'Tháng này tôi được bao nhiêu tiền?']
      : ['Tháng này tôi được bao nhiêu tiền?', 'Tháng này tôi đi làm mấy ngày?', 'Tôi còn mấy ngày phép?', 'Trung bình tôi đến công ty lúc mấy giờ?', 'Đi muộn bao nhiêu lần thì bị trừ công?'];
  }, [profile]);

  if (!profile || profile.must_change_password || HIDDEN_PATHS.some((p) => location.pathname.startsWith(p))) return null;

  const send = async (text: string) => {
    const question = text.trim();
    if (!question || busy) return;
    const history = messages.slice(-8);
    const userMessage: ChatMessage = { id: newId(), role: 'user', text: question };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setBusy(true);

    const result = await askChatbot({ question, history, pages, aliases });
    setBusy(false);
    if (result.error || !result.data) {
      setMessages((prev) => [...prev, { id: newId(), role: 'model', text: result.error ?? 'Có lỗi xảy ra.', error: true }]);
      return;
    }
    const reply = result.data;
    setAliases((prev) => ({ ...prev, ...reply.aliases }));
    setMessages((prev) => [...prev, { id: newId(), role: 'model', text: reply.answer, cards: reply.cards }]);
  };

  const clear = () => {
    setMessages([]);
    setAliases({});
  };

  return (
    <div className="print:hidden">
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-24 right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-indigo-600 text-white shadow-lg shadow-indigo-600/30 transition hover:bg-indigo-700 hover:shadow-xl lg:bottom-6 lg:right-6"
          aria-label="Mở trợ lý hỏi đáp"
          title="Trợ lý hỏi đáp"
        >
          <MessageCircleQuestion className="h-6 w-6" />
        </button>
      )}

      {open && (
        <div
          role="dialog"
          aria-label="Trợ lý hỏi đáp"
          className="fixed inset-x-0 bottom-0 z-[65] flex h-[85dvh] flex-col overflow-hidden rounded-t-2xl border border-slate-200 bg-white shadow-2xl sm:inset-x-auto sm:bottom-6 sm:right-6 sm:h-[min(640px,calc(100dvh-3rem))] sm:w-[420px] sm:rounded-2xl"
        >
          <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-100 text-indigo-600">
              <Bot className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-800">Trợ lý HRM</p>
              <p className="truncate text-[11px] text-slate-400">Hỏi về chấm công, phép, KPI, phiếu lương…</p>
            </div>
            {messages.length > 0 && (
              <button type="button" onClick={clear} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Xoá hội thoại" title="Xoá hội thoại">
                <Eraser className="h-4 w-4" />
              </button>
            )}
            <button type="button" onClick={() => setOpen(false)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Đóng trợ lý">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {messages.length === 0 && (
              <div className="space-y-3">
                <p className="text-sm text-slate-600">
                  Xin chào {profile.name.split(' ').pop()}! Mình trả lời được các câu hỏi về chấm công, đi muộn, ngày công, phép,
                  việc chờ duyệt, KPI và phiếu lương của bạn. Bạn thử hỏi:
                </p>
                <div className="flex flex-wrap gap-2">
                  {suggestions.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => void send(s)}
                      className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-left text-xs font-medium text-indigo-700 hover:bg-indigo-100"
                    >
                      {s}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] leading-relaxed text-slate-400">
                  Trợ lý chỉ xem được dữ liệu bạn có quyền xem. Số tiền lương không được gửi cho AI, họ tên được ẩn danh trước khi gửi.
                </p>
              </div>
            )}

            {messages.map((m) => (
              m.role === 'user' ? (
                <div key={m.id} className="flex justify-end">
                  <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-indigo-600 px-3.5 py-2 text-sm text-white">
                    {revealNames(m.text, aliases)}
                  </div>
                </div>
              ) : (
                <div key={m.id} className="space-y-2">
                  <div className={`max-w-[92%] rounded-2xl rounded-bl-md px-3.5 py-2 text-sm ${m.error ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-800'}`}>
                    <RichText text={revealNames(m.text, aliases)} allowedPaths={allowedPaths} onNavigate={() => setOpen(false)} />
                  </div>
                  {m.cards?.map((card, i) => <ChatCardView key={i} card={card} allowedPaths={allowedPaths} />)}
                </div>
              )
            ))}

            {busy && (
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Đang tra cứu…
              </div>
            )}
          </div>

          <form
            className="flex items-end gap-2 border-t border-slate-100 p-3"
            onSubmit={(e) => { e.preventDefault(); void send(input); }}
          >
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value.slice(0, 500))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void send(input);
                }
              }}
              rows={1}
              placeholder="Nhập câu hỏi…"
              className="max-h-28 min-h-11 flex-1 resize-none rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40"
              aria-label="Gửi câu hỏi"
            >
              <SendHorizontal className="h-4 w-4" />
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hiển thị câu trả lời: **đậm**, gạch đầu dòng, [liên kết](/trang)
// ---------------------------------------------------------------------------
function RichText({ text, allowedPaths, onNavigate }: { text: string; allowedPaths: Set<string>; onNavigate: () => void }) {
  const inline = (line: string, key: string): ReactNode[] => {
    const out: ReactNode[] = [];
    const re = /\*\*(.+?)\*\*|\[([^\]]+)\]\((\/[^)\s]*)\)/g;
    let last = 0;
    let match: RegExpExecArray | null;
    let n = 0;
    while ((match = re.exec(line))) {
      if (match.index > last) out.push(line.slice(last, match.index));
      if (match[1]) {
        out.push(<strong key={`${key}-${n++}`}>{match[1]}</strong>);
      } else if (allowedPaths.has(match[3])) {
        out.push(
          <Link key={`${key}-${n++}`} to={match[3]} onClick={onNavigate} className="font-semibold text-indigo-600 underline-offset-2 hover:underline">
            {match[2]}
          </Link>,
        );
      } else {
        out.push(match[2]);
      }
      last = match.index + match[0].length;
    }
    if (last < line.length) out.push(line.slice(last));
    return out;
  };

  const lines = text.split('\n');
  return (
    <div className="space-y-1 leading-relaxed">
      {lines.map((line, i) => {
        const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
        if (bullet) {
          return (
            <div key={i} className="flex gap-2">
              <span className="text-slate-400">•</span>
              <span>{inline(bullet[1], String(i))}</span>
            </div>
          );
        }
        return line.trim() ? <p key={i}>{inline(line, String(i))}</p> : <Fragment key={i} />;
      })}
    </div>
  );
}

function ChatCardView({ card, allowedPaths }: { card: ChatCard; allowedPaths: Set<string> }) {
  if (card.kind === 'payslip') return <PayslipChatCard month={card.month} />;

  const link = card.link && allowedPaths.has(card.link.to) ? card.link : null;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{card.title}</p>
      {card.kind === 'stats' ? (
        <dl className="grid grid-cols-2 gap-2">
          {card.items.map((item) => (
            <div key={item.label} className="rounded-lg bg-slate-50 px-2.5 py-2">
              <dt className="text-[11px] text-slate-500">{item.label}</dt>
              <dd className="text-sm font-semibold text-slate-800">{item.value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <div className="max-h-64 overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-white">
              <tr>
                {card.columns.map((c) => <th key={c} className="whitespace-nowrap border-b border-slate-100 px-2 py-1.5 text-left font-semibold text-slate-500">{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {card.rows.map((row, i) => (
                <tr key={i} className="border-b border-slate-50 last:border-0">
                  {row.map((cell, j) => (
                    <td key={j} className={`px-2 py-1.5 text-slate-700 ${typeof cell === 'number' ? 'text-right tabular-nums' : ''} ${j === 0 ? 'font-medium' : ''}`}>
                      {cell ?? '—'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {link && (
        <Link to={link.to} className="mt-2 inline-block text-xs font-semibold text-indigo-600 hover:underline">
          {link.label} →
        </Link>
      )}
    </div>
  );
}
