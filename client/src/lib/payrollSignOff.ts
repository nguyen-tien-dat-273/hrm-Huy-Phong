// ============================================================================
// Chữ ký điện tử & con dấu "ĐÃ DUYỆT" in trên chứng từ lương bàn giao Thủ quỹ.
// ----------------------------------------------------------------------------
// Lấy thẳng từ dấu vết của kỳ lương (người tính, người khoá kỳ bằng 2FA, người
// ký duyệt chi) — không ai gõ tay. Bước nào chưa làm thì ô ký để trống; con dấu
// chỉ đóng khi kỳ đã được duyệt chi. Ô Thủ quỹ luôn để trống để ký nhận tiền.
// ============================================================================
import type { PrintSignOff } from '@/lib/tablePrint';
import type { PayrollRun } from '@/types';

export function payrollSignOff(
  run: PayrollRun | null | undefined,
  nameOf: (id: string | null) => string,
): PrintSignOff {
  const approved = !!run && (run.status === 'APPROVED' || run.status === 'PAID') && !!run.approved_at;
  const maker = run?.calculated_by ?? run?.created_by ?? null;
  const signer = (role: string, id: string | null | undefined, at: string | null | undefined) => ({
    role,
    name: id && at ? nameOf(id) : null,
    signedAt: id && at ? at : null,
  });
  return {
    signers: [
      signer('Người lập bảng', maker, run?.calculated_at),
      signer('Kế toán trưởng', run?.locked_by, run?.locked_at),
      signer('Giám đốc', approved ? run?.approved_by : null, approved ? run?.approved_at : null),
      { role: 'Thủ quỹ' },
    ],
    approvedStamp: approved && run?.approved_by && run.approved_at
      ? { by: nameOf(run.approved_by), at: run.approved_at }
      : null,
  };
}

/** Cùng nội dung khối ký, dạng dòng chữ cho file Excel. */
export function signOffLines(signOff: PrintSignOff): string[] {
  const at = (iso: string) => new Date(iso).toLocaleString('vi-VN');
  const lines = signOff.signers.map((signer) => (signer.name && signer.signedAt
    ? `${signer.role}: Đã ký điện tử — ${signer.name} — ${at(signer.signedAt)}`
    : `${signer.role}: (chưa ký)`));
  if (signOff.approvedStamp) lines.push(`ĐÃ DUYỆT bởi ${signOff.approvedStamp.by} lúc ${at(signOff.approvedStamp.at)}`);
  return lines;
}
