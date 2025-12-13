import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function getProductColorClass(color: string | null) {
  if (!color) return '';
  const c = color.toLowerCase();
  if (c.includes('gold') || c.includes('oro')) return 'text-yellow-600 dark:text-yellow-400 font-semibold';
  if (c.includes('purple') || c.includes('purp')) return 'text-purple-600 dark:text-purple-400 font-semibold';
  if (c.includes('blue') || c.includes('azul')) return 'text-blue-600 dark:text-blue-400 font-semibold';
  if (c.includes('green') || c.includes('verde')) return 'text-green-600 dark:text-green-400 font-semibold';
  if (c.includes('red') || c.includes('rojo')) return 'text-red-600 dark:text-red-400 font-semibold';
  if (c.includes('black') || c.includes('negro') || c.includes('space') || c.includes('graphite')) return 'text-gray-900 dark:text-gray-100 font-semibold';
  if (c.includes('white') || c.includes('blanco') || c.includes('silver') || c.includes('plata')) return 'text-slate-500 dark:text-slate-300 font-semibold';
  if (c.includes('pink') || c.includes('rosa')) return 'text-pink-500 dark:text-pink-400 font-semibold';
  if (c.includes('titanium') || c.includes('tit')) return 'text-stone-500 dark:text-stone-300 font-semibold';
  return 'text-muted-foreground';
}
