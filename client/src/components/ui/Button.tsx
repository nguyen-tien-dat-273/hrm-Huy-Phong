import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'success';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  children: ReactNode;
  theme?: 'admin' | 'staff';
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({
  variant = 'primary',
  size = 'md',
  theme = 'admin',
  children,
  className = '',
  disabled,
  type = 'button',
  ...props
}, ref) {
  const base =
    'inline-flex shrink-0 items-center justify-center gap-2 rounded-xl font-semibold shadow-sm transition-all duration-200 active:translate-y-px disabled:pointer-events-none disabled:translate-y-0 disabled:opacity-45 disabled:shadow-none focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2';

  const sizes: Record<Size, string> = {
    sm: 'min-h-11 text-xs px-3 py-2',
    md: 'min-h-11 text-sm px-4 py-2.5',
    lg: 'min-h-12 text-base px-6 py-3',
  };

  const variants: Record<Variant, string> = {
    primary: theme === 'admin'
      ? 'bg-indigo-600 text-white hover:bg-indigo-700 hover:shadow-md focus-visible:ring-indigo-500'
      : 'bg-indigo-600 text-white hover:bg-indigo-700 hover:shadow-md focus-visible:ring-indigo-500',
    secondary: 'bg-slate-100 text-slate-700 hover:bg-slate-200 focus-visible:ring-slate-400 shadow-none',
    outline: 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:border-slate-300 focus-visible:ring-slate-400',
    ghost: 'text-slate-600 hover:bg-slate-100 focus-visible:ring-slate-400 shadow-none',
    danger: 'bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-500',
    success: 'bg-emerald-600 text-white hover:bg-emerald-700 focus-visible:ring-emerald-500',
  };

  return (
    <button
      ref={ref}
      type={type}
      className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  );
});
