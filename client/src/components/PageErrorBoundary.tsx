// ============================================================================
// Chặn một trang lỗi làm sập cả app.
// ----------------------------------------------------------------------------
// React không có lưới an toàn mặc định: một component ném lỗi lúc render mà
// không ai bắt thì React gỡ TOÀN BỘ cây — màn hình trắng trơn, không chữ nào,
// không nút nào. Ngày 05/10/2026 một `useMemo` đặt sai chỗ trong trang KPI đã
// làm đúng như vậy: cả hệ thống trắng, trông như hỏng hết chứ không phải một
// trang hỏng.
//
// Đặt lưới này BÊN TRONG layout, quanh phần nội dung trang. Nhờ vậy thanh điều
// hướng và đầu trang vẫn còn: người dùng đọc được lỗi gì và bấm sang trang khác
// đi làm việc tiếp, thay vì ngồi nhìn màn hình trắng.
//
// Tự khỏi khi đổi trang: `key` của boundary là đường dẫn hiện tại, nên chuyển
// trang là React dựng lại nó từ đầu, trạng thái lỗi biến mất. Không có cái đó
// thì lỗi dính luôn, bấm đi đâu cũng thấy màn hình lỗi.
// ============================================================================

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { RotateCw, TriangleAlert } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

class Boundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Giữ nguyên trên console: đây là thứ duy nhất còn lại để tra nguyên nhân
    // khi người dùng báo "trang này hỏng". Màn hình chỉ hiện câu thông báo,
    // còn vết gọi hàm thì nằm ở đây.
    console.error('[PageErrorBoundary]', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    // Mã nguồn chia nhỏ theo trang, tên tệp gắn mã băm. Deploy xong, tab đang
    // mở vẫn giữ danh sách mã băm cũ nên tải mảnh mới sẽ hỏng. `lazyRoute` đã
    // tự tải lại một lần rồi mới ném ra tới đây, nên tới được đây nghĩa là tải
    // lại vẫn hỏng — khi đó nói thẳng là do bản mới chứ không phải lỗi chức
    // năng, vì hai thứ đó cần hai cách xử lý khác hẳn nhau.
    const isStaleBuild = /dynamically imported module|Importing a module script failed|Failed to fetch/i
      .test(error.message);

    return (
      <div className="flex min-h-64 flex-col items-center justify-center px-6 py-12 text-center">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-red-200 bg-red-50 text-red-500 shadow-sm">
          <TriangleAlert className="h-8 w-8" />
        </div>
        <h3 className="font-display text-base font-bold text-slate-900">
          {isStaleBuild ? 'Trang chưa tải được bản mới' : 'Trang này đang lỗi'}
        </h3>
        <p className="mt-1.5 max-w-md text-sm leading-relaxed text-slate-500">
          {isStaleBuild
            ? 'Hệ thống vừa cập nhật. Tải lại trang để lấy bản mới nhất.'
            : 'Các trang khác vẫn dùng được bình thường — chọn ở thanh điều hướng. Nếu cần trang này, báo lại kèm nội dung lỗi bên dưới.'}
        </p>
        <code className="mt-3 max-w-lg break-words rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-600">
          {error.message || String(error)}
        </code>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          <RotateCw className="h-4 w-4" />
          Tải lại trang
        </button>
      </div>
    );
  }
}

export function PageErrorBoundary({ children }: Props) {
  const { pathname } = useLocation();
  // `key` đổi theo đường dẫn: chuyển trang là boundary được dựng lại, trạng
  // thái lỗi của trang cũ không dính sang trang mới.
  return <Boundary key={pathname}>{children}</Boundary>;
}
