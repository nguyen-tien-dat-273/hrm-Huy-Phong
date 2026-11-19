import { getInitials } from '@/lib/utils';

interface AvatarProps {
  name: string;
  url?: string | null;
  size?: 'xs' | 'sm' | 'md' | 'lg';
}

export function Avatar({ name, url, size = 'md' }: AvatarProps) {
  const sizes = {
    xs: 'w-6 h-6 text-[11px]',
    sm: 'w-8 h-8 text-xs',
    md: 'w-10 h-10 text-sm',
    lg: 'w-14 h-14 text-lg',
  };

  const ring = {
    xs: '',
    sm: '',
    md: 'ring-2 ring-white',
    lg: 'ring-2 ring-white shadow-card',
  };

  const hash = name.split('').reduce((a, b) => a + b.charCodeAt(0), 0);
  const colors = [
    'bg-gradient-to-br from-blue-500 to-indigo-500',
    'bg-gradient-to-br from-emerald-500 to-teal-500',
    'bg-gradient-to-br from-amber-500 to-orange-500',
    'bg-gradient-to-br from-rose-500 to-pink-500',
    'bg-gradient-to-br from-violet-500 to-purple-500',
    'bg-gradient-to-br from-cyan-500 to-sky-500',
  ];
  const color = colors[hash % colors.length];

  if (url) {
    return <img src={url} alt={name} className={`${sizes[size]} ${ring[size]} rounded-full object-cover`} />;
  }

  return (
    <div className={`${sizes[size]} ${ring[size]} ${color} rounded-full flex items-center justify-center text-white font-semibold flex-shrink-0`}>
      {getInitials(name)}
    </div>
  );
}
