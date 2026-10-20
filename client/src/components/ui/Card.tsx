import { type ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  className?: string;
  hover?: boolean;
}

export function Card({ children, className = '', hover = false }: CardProps) {
  return (
    <div
      className={`bg-white/95 dark:bg-slate-900/80 rounded-2xl border border-slate-300 dark:border-slate-700 shadow-card ${hover ? 'card-lift' : ''} ${className}`}
    >
      {children}
    </div>
  );
}

export function CardHeader({ children, className = '' }: CardProps) {
  return <div className={`px-5 py-4 sm:px-6 sm:py-5 border-b border-slate-200 dark:border-slate-700 ${className}`}>{children}</div>;
}

export function CardTitle({ children, className = '' }: CardProps) {
  return <h3 className={`font-display text-base font-bold tracking-tight text-slate-800 dark:text-slate-100 ${className}`}>{children}</h3>;
}

export function CardContent({ children, className = '' }: CardProps) {
  return <div className={`p-4 sm:p-5 ${className}`}>{children}</div>;
}
