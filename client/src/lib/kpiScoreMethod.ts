// ============================================================================
// Danh mục cách tính kết quả KPI — kiểu dữ liệu và phép sinh mô tả.
// ----------------------------------------------------------------------------
// Tách khỏi component để cả trình khai bộ KPI lẫn màn danh mục dùng chung một
// định nghĩa. Hai nơi cùng mô tả một cách tính mà lệch nhau thì người dùng
// không biết tin cái nào.
// ============================================================================

/**
 * Mot cach tinh ket qua = bon tham so, khong phai mot nhanh code.
 *
 * Truoc day hai cach nay khai cung trong file: cong ty co cach cham thu ba la
 * phai sua code va deploy. Gio chung nam trong bang `kpi_score_methods`, va
 * bon tham so duoi day du de dien ta ca hai cach cu lan cac bien the khac.
 */
export interface ScoreMethod {
  code: string;
  name: string;
  description: string | null;
  /** Quy diem tieu chi ve ty le (diem/thang) hay giu diem tho. */
  normalize_mode: 'RATIO' | 'RAW';
  /** Co nhan trong so cua tieu chi hay coi cac tieu chi ngang nhau. */
  weight_mode: 'WEIGHTED' | 'EQUAL';
  /** Chia tong cho cai gi truoc khi nhan he so. */
  denominator_mode: 'NONE' | 'WEIGHT_SUM' | 'MAX_SUM';
  /** Nhan ra thang phan tram. */
  scale: number;
  is_system: boolean;
  sort_order: number;
}

export const NORMALIZE_LABELS: Record<ScoreMethod['normalize_mode'], string> = {
  RATIO: 'Quy ve % theo thang cua tieu chi',
  RAW: 'Giu nguyen diem cham',
};
export const WEIGHT_LABELS: Record<ScoreMethod['weight_mode'], string> = {
  WEIGHTED: 'Nhan trong so tung tieu chi',
  EQUAL: 'Cac tieu chi ngang nhau',
};
export const DENOMINATOR_LABELS: Record<ScoreMethod['denominator_mode'], string> = {
  NONE: 'Khong chia (tong da la ket qua)',
  WEIGHT_SUM: 'Chia tong trong so',
  MAX_SUM: 'Chia tong diem toi da',
};

/**
 * Dung khi chua chay migration 20260930190000 - giao dien van chon duoc hai
 * cach cu thay vi tro thanh mot o rong.
 */
export const FALLBACK_METHODS: ScoreMethod[] = [
  {
    code: 'WEIGHTED_PERCENT',
    name: 'Trung bình có trọng số',
    description: 'Mỗi tiêu chí quy về % theo thang của nó rồi nhân trọng số. Tổng trọng số phải đủ 100%.',
    normalize_mode: 'RATIO', weight_mode: 'WEIGHTED', denominator_mode: 'NONE',
    scale: 1, is_system: true, sort_order: 10,
  },
  {
    code: 'TOTAL_POINTS',
    name: 'Tổng điểm / tổng điểm tối đa',
    description: 'Cộng thẳng điểm các tiêu chí rồi chia tổng thang. Bỏ qua trọng số — được 17/20 điểm là 85%.',
    normalize_mode: 'RAW', weight_mode: 'EQUAL', denominator_mode: 'MAX_SUM',
    scale: 100, is_system: true, sort_order: 20,
  },
];

/**
 * Doi bon tham so thanh mot cau doc duoc.
 *
 * Nguoi khai KPI khong nghi bang "normalize_mode" - ho nghi bang "cham xong
 * thi cong the nao". Cau nay hien ngay duoi moi lua chon de ho doi chieu
 * voi cach phong ban minh dang cham tren giay.
 */
export function describeMethod(method: Pick<ScoreMethod, 'normalize_mode' | 'weight_mode' | 'denominator_mode' | 'scale'>): string {
  const parts = [
    NORMALIZE_LABELS[method.normalize_mode].toLowerCase(),
    WEIGHT_LABELS[method.weight_mode].toLowerCase(),
    DENOMINATOR_LABELS[method.denominator_mode].toLowerCase(),
  ];
  const scale = Number(method.scale);
  if (scale !== 1) parts.push(`nhân ${scale}`);
  return parts.join(', ') + '.';
}

export const BLANK_METHOD = {
  code: '', name: '', description: '',
  normalize_mode: 'RATIO' as ScoreMethod['normalize_mode'],
  weight_mode: 'WEIGHTED' as ScoreMethod['weight_mode'],
  denominator_mode: 'NONE' as ScoreMethod['denominator_mode'],
  scale: '1',
};
