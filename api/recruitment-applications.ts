import { createClient } from '@supabase/supabase-js';

type ApiRequest = { method?: string; headers: Record<string, string | string[] | undefined>; body?: unknown };
type ApiResponse = { status: (code: number) => ApiResponse; json: (body: Record<string, unknown>) => void; setHeader: (name: string, value: string) => void };

function bearer(request: ApiRequest) {
  const raw = request.headers.authorization;
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value?.startsWith('Bearer ') ? value.slice(7).trim() : '';
}

function bodyObject(body: unknown): Record<string, unknown> {
  if (body && typeof body === 'object') return body as Record<string, unknown>;
  if (typeof body === 'string') { try { return JSON.parse(body) as Record<string, unknown>; } catch { return {}; } }
  return {};
}

function stringValue(value: unknown, max = 500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export default async function handler(request: ApiRequest, response: ApiResponse) {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return response.status(405).json({ error: 'Chỉ hỗ trợ phương thức POST.' });
  }

  const token = process.env.RECRUITMENT_INTAKE_TOKEN;
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!token || !supabaseUrl || !serviceKey) {
    return response.status(503).json({ error: 'API tiếp nhận hồ sơ tuyển dụng chưa được cấu hình.' });
  }
  if (!bearer(request) || bearer(request) !== token) {
    return response.status(401).json({ error: 'Thông tin xác thực không hợp lệ.' });
  }

  const body = bodyObject(request.body);
  const requisitionCode = stringValue(body.requisition_code, 40);
  const submissionId = stringValue(body.submission_id, 200);
  const fullName = stringValue(body.full_name, 200);
  const email = stringValue(body.email, 320).toLowerCase();
  const phone = stringValue(body.phone, 50);
  const cvUrl = stringValue(body.cv_url, 2000);
  const note = stringValue(body.note, 2000);
  if (!requisitionCode || !submissionId || fullName.length < 2 || !email || !email.includes('@') || body.consent !== true) {
    return response.status(400).json({ error: 'Thiếu mã yêu cầu, mã phản hồi, họ tên, email hợp lệ hoặc xác nhận đồng ý lưu thông tin.' });
  }
  try { if (!cvUrl || new URL(cvUrl).protocol !== 'https:') throw new Error(); }
  catch { return response.status(400).json({ error: 'CV phải có liên kết HTTPS hợp lệ.' }); }

  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: requisition, error: requisitionError } = await supabase
    .from('recruitment_requisitions').select('id,status,external_form_url').eq('code', requisitionCode).maybeSingle();
  if (requisitionError) return response.status(500).json({ error: 'Không thể tra cứu đợt tuyển dụng.' });
  if (!requisition || requisition.status !== 'OPEN' || !requisition.external_form_url) {
    return response.status(409).json({ error: 'Đợt tuyển dụng chưa mở hoặc chưa cấu hình form ngoài.' });
  }

  const storedSubmissionId = `${requisitionCode}:${submissionId}`;
  const payload = {
    requisition_id: requisition.id, full_name: fullName, email, phone: phone || null,
    cv_url: cvUrl || null, note: note || null, source: 'EXTERNAL_FORM', stage: 'APPLIED', consent_at: new Date().toISOString(),
    external_submission_id: storedSubmissionId, created_by: null,
  };
  const refreshPayload = {
    requisition_id: requisition.id, full_name: fullName, email, phone: phone || null,
    cv_url: cvUrl || null, note: note || null, source: 'EXTERNAL_FORM', external_submission_id: storedSubmissionId,
  };
  const { data: bySubmission, error: lookupError } = await supabase.from('recruitment_candidates')
    .select('id').eq('external_submission_id', storedSubmissionId).maybeSingle();
  if (lookupError) return response.status(500).json({ error: 'Không thể kiểm tra phản hồi đã nhận.' });

  let result;
  if (bySubmission) {
    result = await supabase.from('recruitment_candidates').update(refreshPayload).eq('id', bySubmission.id).select('id').single();
  } else {
    const { data: byEmail, error: emailError } = await supabase.from('recruitment_candidates')
      .select('id').eq('requisition_id', requisition.id).ilike('email', email).maybeSingle();
    if (emailError) return response.status(500).json({ error: 'Không thể kiểm tra email ứng viên.' });
    if (byEmail) {
      result = await supabase.from('recruitment_candidates').update(refreshPayload).eq('id', byEmail.id).select('id').single();
    } else {
      result = await supabase.from('recruitment_candidates').insert(payload).select('id').single();
    }
  }
  if (result.error || !result.data) return response.status(500).json({ error: 'Không lưu được hồ sơ ứng viên.' });
  return response.status(201).json({ ok: true, candidate_id: result.data.id });
}
