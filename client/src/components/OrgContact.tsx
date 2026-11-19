// ============================================================================
// Thông tin liên hệ của bộ phận nhân sự.
// ----------------------------------------------------------------------------
// Khắp app có những câu kiểu "liên hệ HR/C&B để được cập nhật" mà không nói
// liên hệ bằng cách nào. Trong khi đó trang Cấu hình lại có hai ô "Email liên
// hệ" và "Số điện thoại" mà TRƯỚC ĐÂY KHÔNG CHỖ NÀO ĐỌC — nhập vào rồi nằm đó.
// Component này nối hai đầu ấy lại.
//
// Không có gì để hiện thì trả về null: một dòng "Liên hệ: —" còn vô dụng hơn
// là không có dòng nào.
// ============================================================================

import { Mail, Phone } from 'lucide-react';
import { useAppSettings } from '@/contexts/SettingsContext';

interface OrgContactProps {
  /** Câu dẫn trước thông tin liên hệ. */
  prefix?: string;
  className?: string;
}

export function OrgContact({ prefix = 'Cần hỗ trợ, liên hệ', className = '' }: OrgContactProps) {
  const { contactEmail, phone, orgName } = useAppSettings();

  const email = contactEmail.trim();
  const tel = phone.trim();
  if (!email && !tel) return null;

  return (
    <p className={`flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-600 ${className}`}>
      <span>{prefix} {orgName}:</span>
      {email && (
        <a href={`mailto:${email}`} className="inline-flex items-center gap-1.5 font-medium text-slate-700 hover:text-indigo-600 hover:underline">
          <Mail className="h-3.5 w-3.5" />
          {email}
        </a>
      )}
      {tel && (
        <a href={`tel:${tel.replace(/\s/g, '')}`} className="inline-flex items-center gap-1.5 font-medium text-slate-700 hover:text-indigo-600 hover:underline">
          <Phone className="h-3.5 w-3.5" />
          {tel}
        </a>
      )}
    </p>
  );
}
