import { useId, useState } from 'react';
import { Lock, Eye, EyeOff, Check, X } from 'lucide-react';
import { getPasswordStrength, passwordRules } from '@/lib/passwordPolicy';

interface PasswordFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Hiện thanh độ mạnh + checklist yêu cầu mật khẩu. */
  showRules?: boolean;
  autoComplete?: string;
  hasError?: boolean;
}

export function PasswordField({
  label,
  value,
  onChange,
  placeholder,
  showRules = false,
  autoComplete,
  hasError = false,
}: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  const [focused, setFocused] = useState(false);
  const inputId = useId();
  const strength = getPasswordStrength(value);

  const strengthText =
    strength.color === 'bg-red-500'
      ? 'text-red-500'
      : strength.color === 'bg-amber-500'
        ? 'text-amber-500'
        : 'text-emerald-500';

  return (
    <div>
      <label htmlFor={inputId} className="block text-sm font-medium text-slate-700 mb-1.5">{label}</label>
      <div className="relative">
        <Lock
          className={`absolute left-3.5 top-1/2 -translate-y-1/2 w-4.5 h-4.5 transition-colors ${focused ? 'text-blue-500' : 'text-slate-400'}`}
        />
        <input
          id={inputId}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          aria-invalid={hasError}
          className={`w-full h-12 pl-11 pr-11 rounded-xl bg-slate-50/80 border text-sm text-slate-800 placeholder:text-slate-400 transition-all duration-200 focus:outline-none focus:ring-4 ${
            hasError
              ? 'border-red-300 focus:border-red-400 focus:ring-red-100'
              : 'border-slate-200 focus:border-blue-500 focus:ring-blue-100 focus:bg-white'
          }`}
        />
        <button
          type="button"
          onClick={() => setVisible(!visible)}
          className="absolute right-0 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          aria-label={visible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
        >
          {visible ? <EyeOff className="w-4.5 h-4.5" /> : <Eye className="w-4.5 h-4.5" />}
        </button>
      </div>

      {showRules && value && (
        <div className="mt-2 fade-up">
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1.5 rounded-full overflow-hidden bg-slate-200">
              <div className={`h-full ${strength.color} ${strength.bar} transition-all duration-300`} />
            </div>
            <span className={`text-xs font-medium ${strengthText}`}>{strength.label}</span>
          </div>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1 mt-2">
            {passwordRules(value).map((rule) => (
              <li
                key={rule.label}
                className={`flex items-center gap-1.5 text-xs transition-colors ${rule.ok ? 'text-emerald-600' : 'text-slate-400'}`}
              >
                <span
                  className={`flex items-center justify-center w-3.5 h-3.5 rounded-full ${rule.ok ? 'bg-emerald-100 check-pop' : 'bg-slate-100'}`}
                >
                  {rule.ok ? <Check className="w-2.5 h-2.5" /> : <X className="w-2.5 h-2.5" />}
                </span>
                {rule.label}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
