// ============================================================================
// ESLint — đặt ra CHỈ để chặn những lỗi làm trắng màn hình.
// ----------------------------------------------------------------------------
// Vì sao sinh ra file này: ngày 05/10/2026 một `useMemo` bị đặt dưới lệnh
// `return` sớm trong KpiSchemeBoard. Lần render đầu component thoát sớm nên
// hook không chạy, lần sau mới chạy — React đếm được nhiều hook hơn lần trước
// và ném lỗi, trắng toàn bộ app. `tsc -b` sạch, `vite build` sạch, cả hai đều
// báo xanh ngay trước khi bản hỏng lên production.
//
// `react-hooks/rules-of-hooks` bắt đúng lỗi đó trong một giây.
//
// CỐ Ý KHÔNG bật bộ `recommended` đầy đủ: đây là codebase đã lớn, bật hết sẽ
// ra hàng trăm cảnh báo về cách viết, và một lệnh lint lúc nào cũng đỏ thì
// không ai đọc — đúng lúc nó báo lỗi thật thì cũng trôi mất trong đống đó.
// Ở đây chỉ giữ các luật bắt LỖI CHẠY THẬT. Muốn siết thêm thì thêm từng luật
// một, kèm lý do.
// ============================================================================

import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    // Thư mục sinh ra hoặc tải về — lint ở đây vô nghĩa và rất chậm.
    ignores: ['client/dist/**', 'node_modules/**', 'client/public/**', '**/*.cjs'],
  },

  // ---- Mã chạy trên trình duyệt -------------------------------------------
  {
    files: ['client/src/**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      // --- Lý do file này tồn tại ---
      'react-hooks/rules-of-hooks': 'error',
      // Thiếu dependency thì state cũ bị giữ lại âm thầm: số sai trông y hệt
      // số đúng. Để 'warn' vì trong mã cũ có vài chỗ cố tình bỏ qua, đã ghi
      // `eslint-disable-line` kèm lý do ngay tại chỗ.
      'react-hooks/exhaustive-deps': 'warn',

      // --- Lỗi chạy thật, không phải chuyện cách viết ---
      'no-constant-condition': ['error', { checkLoops: false }],
      // Dấu thoát thừa trong regex (`[\/]`) chạy y hệt như không có nó, nên
      // theo đúng nguyên tắc ở đầu file thì nó không phải lỗi chạy thật. Vẫn
      // giữ ở mức nhắc vì đôi khi dấu thoát thừa là dấu hiệu viết nhầm regex.
      'no-useless-escape': 'warn',

      // --- Tắt: ồn mà không bắt được lỗi nào ---
      // `tsc` đã bắt biến không dùng chặt hơn.
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      // Đã dùng có chủ ý ở ranh giới dữ liệu Supabase và vài chỗ generic.
      '@typescript-eslint/no-explicit-any': 'off',
      // `tsc` đã kiểm; bản của eslint hay báo nhầm với kiểu từ thư viện.
      '@typescript-eslint/no-empty-object-type': 'off',
    },
  },

  // ---- Script Node viết bằng JavaScript thuần -----------------------------
  {
    files: ['tools/**/*.{js,mjs}'],
    extends: [js.configs.recommended],
    languageOptions: {
      globals: globals.node,
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },

  // ---- Hàm serverless viết bằng TypeScript --------------------------------
  // Phải có bộ phân tích của typescript-eslint: bộ mặc định của eslint không
  // đọc được cú pháp TypeScript, gặp `import type` là báo lỗi phân tích và
  // nguyên thư mục `api/` coi như không được lint.
  {
    files: ['api/**/*.ts', 'tools/**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      globals: globals.node,
      sourceType: 'module',
    },
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
