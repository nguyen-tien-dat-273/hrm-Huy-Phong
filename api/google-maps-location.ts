import { createClient } from '@supabase/supabase-js';

type ApiRequest = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
};

type ApiResponse = {
  status: (code: number) => ApiResponse;
  json: (body: Record<string, unknown>) => void;
  setHeader: (name: string, value: string) => void;
};

const GOOGLE_MAPS_HOSTS = new Set(['google.com', 'www.google.com', 'maps.google.com', 'maps.app.goo.gl', 'goo.gl']);
const APP_USER_AGENT = process.env.APP_USER_AGENT || 'HuyPhongHRM/1.0 (self-hosted)';

function fail(response: ApiResponse, status: number, error: string) {
  response.status(status).json({ error });
}

function readBearer(request: ApiRequest) {
  const raw = request.headers.authorization;
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value?.startsWith('Bearer ') ? value.slice(7).trim() : null;
}

function parseBody(body: unknown): Record<string, unknown> {
  if (body && typeof body === 'object') return body as Record<string, unknown>;
  if (typeof body === 'string') {
    try { return JSON.parse(body) as Record<string, unknown>; } catch { return {}; }
  }
  return {};
}

function allowedGoogleMapsUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && GOOGLE_MAPS_HOSTS.has(url.hostname.toLowerCase()) && (url.hostname.includes('goo.gl') || url.pathname.startsWith('/maps'));
  } catch {
    return false;
  }
}

function parseCoordinates(value: string) {
  let decoded = value;
  try { decoded = decodeURIComponent(value); } catch { /* Giữ URL gốc nếu mã hóa không chuẩn. */ }
  const patterns = [
    /@(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/,
    /[?&](?:q|query|ll)=(-?\d{1,2}(?:\.\d+)?)[,\s]+(-?\d{1,3}(?:\.\d+)?)/i,
    /\/place\/[^/]*\/(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/i,
  ];
  for (const pattern of patterns) {
    const match = decoded.match(pattern);
    if (!match) continue;
    const latitude = Number(match[1]);
    const longitude = Number(match[2]);
    if (Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180) return { latitude, longitude };
  }
  return null;
}

function placeNameFromUrl(value: string) {
  try {
    const url = new URL(value);
    const placeMatch = url.pathname.match(/\/maps\/place\/([^/]+)/i);
    if (placeMatch) return decodeURIComponent(placeMatch[1]).replace(/\+/g, ' ').trim();
    const query = url.searchParams.get('query') || url.searchParams.get('q');
    return query && !/^-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?$/.test(query) ? query : null;
  } catch {
    return null;
  }
}

async function resolveGoogleUrl(inputUrl: string) {
  if (parseCoordinates(inputUrl)) return { resolvedUrl: inputUrl, html: '' };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const result = await fetch(inputUrl, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': APP_USER_AGENT, Accept: 'text/html' },
    });
    const resolvedUrl = result.url;
    if (!allowedGoogleMapsUrl(resolvedUrl)) throw new Error('Link chuyển hướng ra ngoài Google Maps.');
    const html = (await result.text()).slice(0, 1_000_000);
    return { resolvedUrl, html };
  } finally {
    clearTimeout(timeout);
  }
}

async function reverseGeocode(latitude: number, longitude: number) {
  const baseUrl = process.env.REVERSE_GEOCODING_URL || 'https://nominatim.openstreetmap.org';
  const endpoint = new URL('/reverse', baseUrl);
  endpoint.searchParams.set('format', 'jsonv2');
  endpoint.searchParams.set('lat', String(latitude));
  endpoint.searchParams.set('lon', String(longitude));
  endpoint.searchParams.set('zoom', '18');
  endpoint.searchParams.set('addressdetails', '1');
  endpoint.searchParams.set('accept-language', 'vi');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const result = await fetch(endpoint, { signal: controller.signal, headers: { 'User-Agent': APP_USER_AGENT, Accept: 'application/json' } });
    if (!result.ok) return null;
    const data = await result.json() as { display_name?: string };
    return data.display_name?.trim() || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export default async function handler(request: ApiRequest, response: ApiResponse) {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return fail(response, 405, 'Chỉ hỗ trợ phương thức POST.');
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) return fail(response, 503, 'Dịch vụ xác thực chưa được cấu hình.');
  const token = readBearer(request);
  if (!token) return fail(response, 401, 'Phiên đăng nhập không hợp lệ.');
  const authClient: any = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authData, error: authError } = await authClient.auth.getUser(token);
  if (authError || !authData.user) return fail(response, 401, 'Phiên đăng nhập đã hết hạn.');

  const body = parseBody(request.body);
  const inputUrl = typeof body.url === 'string' ? body.url.trim() : '';
  if (!allowedGoogleMapsUrl(inputUrl)) return fail(response, 400, 'Link phải thuộc Google Maps và sử dụng HTTPS.');

  try {
    const { resolvedUrl, html } = await resolveGoogleUrl(inputUrl);
    const coordinates = parseCoordinates(resolvedUrl) || parseCoordinates(html);
    if (!coordinates) return fail(response, 422, 'Không tìm thấy tọa độ trong link Google Maps này.');
    const address = await reverseGeocode(coordinates.latitude, coordinates.longitude)
      || placeNameFromUrl(resolvedUrl)
      || placeNameFromUrl(inputUrl);
    response.status(200).json({ ...coordinates, address, resolved_url: resolvedUrl });
  } catch (error) {
    fail(response, 422, error instanceof Error ? error.message : 'Không xử lý được link Google Maps.');
  }
}
