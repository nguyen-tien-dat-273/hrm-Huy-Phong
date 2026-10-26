// ============================================================================
// Cổng nhận máy chấm công (ADMS) chạy trên Cloudflare Workers.
// ----------------------------------------------------------------------------
// Vì sao có file này: máy chấm công chỉ nói được HTTP thường, hoặc không bắt tay
// được HTTPS với Vercel, mà Vercel thì đổi mọi yêu cầu cổng 80 sang HTTPS bằng
// mã 308 — máy không theo kiểu chuyển hướng đó nên không gửi được gì.
// Cloudflare cho phép nhận HTTP thường trên cổng 80/8080 (xem README.md cùng thư mục).
//
// Worker này KHÔNG chứa logic chấm công. Nó chỉ đổi Request của Cloudflare sang
// dạng (req, res) mà các hàm trong api/iclock/ đang chờ, rồi gọi chính các hàm đó.
// Nhờ vậy cách đọc dòng ATTLOG, múi giờ, mã trạng thái vào/ra, chống trùng... chỉ
// có MỘT bản; sửa ở api/iclock/ là cả Vercel lẫn Worker cùng đổi.
// ============================================================================

type Env = Record<string, unknown>;

type ApiRequest = {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
};

type ApiResponse = {
  status: (code: number) => ApiResponse;
  setHeader: (name: string, value: string) => void;
  send: (body: string) => void;
};

type Handler = (request: ApiRequest, response: ApiResponse) => unknown;

// Nạp lười: mỗi hàm đọc biến môi trường ngay lúc được nạp (xem đầu cdata.ts), nên
// phải đặt process.env XONG rồi mới import — import tĩnh sẽ chạy trước và thấy rỗng.
const routes: Record<string, () => Promise<{ default: Handler }>> = {
  '/iclock/cdata': () => import('../../api/iclock/cdata'),
  '/iclock/getrequest': () => import('../../api/iclock/getrequest'),
  '/iclock/devicecmd': () => import('../../api/iclock/devicecmd'),
};

const plain = (body: string, status = 200) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    for (const [key, value] of Object.entries(env)) {
      if (typeof value === 'string') process.env[key] = value;
    }

    const url = new URL(request.url);
    const path = url.pathname.toLowerCase().replace(/\/+$/, '');
    const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.text();

    // Xem trực tiếp bằng `wrangler tail`: cách duy nhất để biết máy ở xa thật sự gọi gì.
    // Không in thân bản tin chấm công (có mã nhân viên và giờ quét).
    console.log(`[iclock] ${request.method} ${url.pathname}${url.search} body=${body?.length ?? 0}B`);

    const load = routes[path];
    if (!load) {
      // Firmware đời mới còn gọi thêm registry/push/ping... mà HRM chưa xử lý. Trả OK
      // thay vì 404 và ghi lại nội dung để biết cần làm gì tiếp.
      console.warn(`[iclock] đường dẫn chưa hỗ trợ: ${path} ${(body ?? '').slice(0, 300)}`);
      return plain('OK');
    }

    let status = 200;
    const headers = new Headers();
    let out = '';
    const response: ApiResponse = {
      status(code) { status = code; return response; },
      setHeader(name, value) { headers.set(name, value); },
      send(text) { out = text; },
    };

    const handler = (await load()).default;
    await handler(
      {
        method: request.method,
        url: url.pathname + url.search,
        headers: Object.fromEntries(request.headers.entries()),
        body,
      },
      response,
    );
    return new Response(out, { status, headers });
  },
};
