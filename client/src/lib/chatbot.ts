// ============================================================================
// Trợ lý hỏi đáp — phía trình duyệt.
// ----------------------------------------------------------------------------
// Gửi câu hỏi tới `/api/chatbot` kèm JWT của người đang đăng nhập. Câu trả lời
// của AI nhắc người bằng bí danh NV-XXXXXX; trình duyệt giữ bảng bí danh → tên
// thật và chỉ đổi lúc HIỂN THỊ. Lịch sử gửi lại cho AI vẫn là bản bí danh,
// nên họ tên không bao giờ đi tới nhà cung cấp AI.
// ============================================================================

import { supabase } from './supabase';
import { describeDbError } from './dbError';

const API_BASE = (import.meta.env.VITE_ADMIN_API_BASE as string | undefined)?.replace(/\/$/, '') ?? '';

export type ChatCardLink = { to: string; label: string };
export type ChatCard =
  | { kind: 'stats'; title: string; items: { label: string; value: string }[]; link?: ChatCardLink }
  | { kind: 'table'; title: string; columns: string[]; rows: (string | number | null)[][]; link?: ChatCardLink }
  | { kind: 'payslip'; month: string };

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  /** Nguyên văn — với câu trả lời của AI là bản còn bí danh. */
  text: string;
  cards?: ChatCard[];
  error?: boolean;
}

export interface ChatPage {
  to: string;
  label: string;
  description: string;
}

export interface ChatReply {
  answer: string;
  aliases: Record<string, string>;
  cards: ChatCard[];
}

export async function askChatbot(input: {
  question: string;
  history: ChatMessage[];
  pages: ChatPage[];
  aliases: Record<string, string>;
}): Promise<{ data?: ChatReply; error?: string }> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) return { error: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.' };

  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/chatbot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        question: input.question,
        history: input.history.filter((m) => !m.error).map((m) => ({ role: m.role, text: m.text })),
        pages: input.pages,
        aliases: input.aliases,
      }),
    });
  } catch {
    return { error: 'Không kết nối được tới trợ lý. Kiểm tra mạng rồi thử lại.' };
  }

  let json: (ChatReply & { error?: string }) | null = null;
  try {
    json = (await res.json()) as ChatReply & { error?: string };
  } catch {
    /* phản hồi không phải JSON */
  }
  if (!res.ok) {
    if (res.status === 404) return { error: 'Không tìm thấy dịch vụ trợ lý (/api/chatbot) trên máy chủ.' };
    return { error: json?.error ?? `Lỗi máy chủ (${res.status}).` };
  }
  if (!json) return { error: 'Trợ lý trả về dữ liệu không hợp lệ.' };
  return { data: { answer: json.answer ?? '', aliases: json.aliases ?? {}, cards: json.cards ?? [] } };
}

/** Đổi bí danh về tên thật để hiển thị. */
export function revealNames(text: string, aliases: Record<string, string>): string {
  return text.replace(/NV-[0-9A-F]{6}/g, (alias) => aliases[alias] ?? alias);
}

export interface ChatbotLog {
  id: string;
  created_at: string;
  person: string | null;
  question: string;
  tools: string[];
  answered: boolean | null;
  error: string | null;
}

export async function fetchChatbotLogs(onlyUnanswered: boolean): Promise<{ rows: ChatbotLog[]; error: string | null }> {
  const { data, error } = await supabase.rpc('chatbot_recent_logs', { p_only_unanswered: onlyUnanswered, p_limit: 300 });
  if (error) return { rows: [], error: describeDbError(error) };
  return { rows: (data ?? []) as ChatbotLog[], error: null };
}

// Văn bản quy chế cho trợ lý tra cứu (công cụ `company_policy`). Nội dung được
// gửi cho nhà cung cấp AI nên chỉ dành cho thông tin công khai trong công ty.
export interface ChatbotKnowledge {
  id: string;
  title: string;
  content: string;
  is_active: boolean;
  updated_at: string;
}

export async function fetchChatbotKnowledge(): Promise<{ rows: ChatbotKnowledge[]; error: string | null }> {
  const { data, error } = await supabase
    .from('chatbot_knowledge')
    .select('id, title, content, is_active, updated_at')
    .order('title');
  if (error) return { rows: [], error: describeDbError(error) };
  return { rows: (data ?? []) as ChatbotKnowledge[], error: null };
}

export async function saveChatbotKnowledge(input: { id?: string; title: string; content: string; is_active: boolean }): Promise<string | null> {
  const row = { title: input.title.trim(), content: input.content.trim(), is_active: input.is_active };
  const { error } = input.id
    ? await supabase.from('chatbot_knowledge').update(row).eq('id', input.id)
    : await supabase.from('chatbot_knowledge').insert(row);
  return error ? describeDbError(error) : null;
}

export async function deleteChatbotKnowledge(id: string): Promise<string | null> {
  const { error } = await supabase.from('chatbot_knowledge').delete().eq('id', id);
  return error ? describeDbError(error) : null;
}
