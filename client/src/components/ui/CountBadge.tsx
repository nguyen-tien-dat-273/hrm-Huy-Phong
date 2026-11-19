/**
 * Chấm tròn đỏ có số — báo trang / tab / module đang có việc mới cần xem.
 * Không có gì (0) thì không vẽ gì, để chỗ có số luôn nổi bật.
 *
 * `inverted` dùng trên nền đậm (mục sidebar đang mở): nền trắng chữ đỏ để
 * không chìm vào nền màu.
 */
export function CountBadge({ count, inverted = false, className = '' }: {
  count: number;
  inverted?: boolean;
  className?: string;
}) {
  if (!count || count <= 0) return null;
  return (
    <span
      aria-label={`${count} mục mới`}
      className={`inline-flex h-5 min-w-5 flex-shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] font-bold leading-none tabular-nums ${
        inverted ? 'bg-white text-red-600' : 'bg-red-500 text-white'
      } ${className}`}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}
