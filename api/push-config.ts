type ApiResponse = {
  status: (code: number) => ApiResponse;
  json: (body: Record<string, unknown>) => void;
  setHeader: (name: string, value: string) => void;
};

export default function handler(
  request: { method?: string },
  response: ApiResponse,
) {
  response.setHeader('Cache-Control', 'public, max-age=300');
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({ error: 'Chỉ hỗ trợ phương thức GET.' });
  }

  const publicKey = process.env.VAPID_PUBLIC_KEY;
  if (!publicKey) return response.status(503).json({ error: 'Thông báo điện thoại chưa được cấu hình.' });
  return response.status(200).json({ publicKey });
}

