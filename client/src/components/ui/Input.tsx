import { Children, isValidElement, type ChangeEvent, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes, type ReactNode, useId } from 'react';
import { Dropdown, type DropdownOption } from './Dropdown';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export function Input({ label, error, className = '', ...props }: InputProps) {
  const generatedId = useId();
  const inputId = props.id || generatedId;
  const errorId = `${inputId}-error`;
  return (
    <div className="w-full">
      {label && <label htmlFor={inputId} className="block text-sm font-bold text-slate-800 dark:text-slate-200 mb-1.5">{label}{props.required && <span className="ml-1 text-red-500" aria-hidden="true">*</span>}</label>}
      <input
        id={inputId}
        aria-invalid={!!error}
        aria-describedby={error ? errorId : props['aria-describedby']}
        className={`w-full h-11 px-3.5 rounded-none border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm font-medium text-slate-900 dark:text-slate-100 shadow-sm placeholder:text-slate-600 transition-all hover:border-slate-400 dark:hover:border-slate-500 focus:outline-none focus:border-indigo-600 focus:ring-4 focus:ring-indigo-600/15 disabled:cursor-not-allowed disabled:bg-slate-100 dark:disabled:bg-slate-800/60 disabled:text-slate-600 ${error ? 'border-red-400 focus:border-red-400 focus:ring-red-500/10' : ''} ${className}`}
        {...props}
      />
      {error && <p id={errorId} role="alert" className="mt-1.5 text-xs font-semibold text-red-600">{error}</p>}
    </div>
  );
}

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange'> {
  label?: string;
  error?: string;
  children: ReactNode;
  onChange?: (event: ChangeEvent<HTMLSelectElement>) => void;
}

const textOf = (node: ReactNode): string => {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return '';
};

function collectOptions(children: ReactNode, out: DropdownOption[] = []): DropdownOption[] {
  Children.forEach(children, (child) => {
    if (!isValidElement<{ value?: string | number; children?: ReactNode }>(child)) return;
    if (child.type === 'option') {
      const label = textOf(child.props.children);
      out.push({ value: child.props.value === undefined ? label : String(child.props.value), label });
    } else {
      collectOptions(child.props.children, out);
    }
  });
  return out;
}

/** Ô chọn dùng chung: giữ cách viết <Select><option/></Select> nhưng vẽ bằng Dropdown (có ô tìm khi danh sách dài). */
export function Select({ label, error, children, className = '', value, onChange, disabled, required, ...props }: SelectProps) {
  const options = collectOptions(children);
  const compact = /(^|\s)h-(7|8|9)(\s|$)/.test(className);
  const wrapperClass = className.split(/\s+/).filter((token) => /^(w-|min-w-|max-w-|flex-|shrink|grow|sm:|md:|lg:|col-|mt-|mb-)/.test(token)).join(' ');
  return (
    <Dropdown
      options={options}
      value={value === undefined || value === null ? '' : String(value)}
      onChange={(next) => onChange?.({ target: { value: next }, currentTarget: { value: next } } as unknown as ChangeEvent<HTMLSelectElement>)}
      label={label}
      error={error}
      required={required}
      disabled={disabled}
      compact={compact}
      className={wrapperClass}
      aria-label={props['aria-label']}
    />
  );
}

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
}

export function Textarea({ label, error, className = '', ...props }: TextareaProps) {
  const generatedId = useId();
  const inputId = props.id || generatedId;
  const errorId = `${inputId}-error`;
  return (
    <div className="w-full">
      {label && <label htmlFor={inputId} className="block text-sm font-bold text-slate-800 dark:text-slate-200 mb-1.5">{label}{props.required && <span className="ml-1 text-red-500" aria-hidden="true">*</span>}</label>}
      <textarea
        id={inputId}
        aria-invalid={!!error}
        aria-describedby={error ? errorId : props['aria-describedby']}
        className={`w-full px-3.5 py-3 rounded-none border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm font-medium text-slate-900 dark:text-slate-100 shadow-sm placeholder:text-slate-600 transition-all hover:border-slate-400 dark:hover:border-slate-500 focus:outline-none focus:border-indigo-600 focus:ring-4 focus:ring-indigo-600/15 disabled:cursor-not-allowed disabled:bg-slate-100 dark:disabled:bg-slate-800/60 ${error ? 'border-red-400' : ''} ${className}`}
        {...props}
      />
      {error && <p id={errorId} role="alert" className="mt-1.5 text-xs font-semibold text-red-600">{error}</p>}
    </div>
  );
}
