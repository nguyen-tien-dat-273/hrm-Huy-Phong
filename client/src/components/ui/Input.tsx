import { type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes, type ReactNode, useId } from 'react';

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
      {label && <label htmlFor={inputId} className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{label}{props.required && <span className="ml-1 text-red-500" aria-hidden="true">*</span>}</label>}
      <input
        id={inputId}
        aria-invalid={!!error}
        aria-describedby={error ? errorId : props['aria-describedby']}
        className={`w-full h-11 px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-slate-100 shadow-sm placeholder:text-slate-400 transition-all hover:border-slate-300 dark:hover:border-slate-600 focus:outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 disabled:cursor-not-allowed disabled:bg-slate-100 dark:disabled:bg-slate-800/60 disabled:text-slate-500 ${error ? 'border-red-400 focus:border-red-400 focus:ring-red-500/10' : ''} ${className}`}
        {...props}
      />
      {error && <p id={errorId} role="alert" className="mt-1.5 text-xs font-medium text-red-600">{error}</p>}
    </div>
  );
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  children: ReactNode;
}

export function Select({ label, error, children, className = '', ...props }: SelectProps) {
  const generatedId = useId();
  const inputId = props.id || generatedId;
  const errorId = `${inputId}-error`;
  return (
    <div className="w-full">
      {label && <label htmlFor={inputId} className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{label}{props.required && <span className="ml-1 text-red-500" aria-hidden="true">*</span>}</label>}
      <select
        id={inputId}
        aria-invalid={!!error}
        aria-describedby={error ? errorId : props['aria-describedby']}
        className={`w-full h-11 px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100 bg-white dark:bg-slate-800 shadow-sm transition-all hover:border-slate-300 dark:hover:border-slate-600 focus:outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 disabled:cursor-not-allowed disabled:bg-slate-100 dark:disabled:bg-slate-800/60 ${error ? 'border-red-400' : ''} ${className}`}
        {...props}
      >
        {children}
      </select>
      {error && <p id={errorId} role="alert" className="mt-1.5 text-xs font-medium text-red-600">{error}</p>}
    </div>
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
      {label && <label htmlFor={inputId} className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{label}{props.required && <span className="ml-1 text-red-500" aria-hidden="true">*</span>}</label>}
      <textarea
        id={inputId}
        aria-invalid={!!error}
        aria-describedby={error ? errorId : props['aria-describedby']}
        className={`w-full px-3.5 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-slate-100 shadow-sm placeholder:text-slate-400 transition-all hover:border-slate-300 dark:hover:border-slate-600 focus:outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 disabled:cursor-not-allowed disabled:bg-slate-100 dark:disabled:bg-slate-800/60 ${error ? 'border-red-400' : ''} ${className}`}
        {...props}
      />
      {error && <p id={errorId} role="alert" className="mt-1.5 text-xs font-medium text-red-600">{error}</p>}
    </div>
  );
}
