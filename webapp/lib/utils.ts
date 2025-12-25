
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

export function getStatusColorClass(status: string | null) {
  if (!status || status.toLowerCase() === 'nan' || status === '0') {
    return 'bg-slate-100 text-slate-500 border-slate-200 opacity-50 font-medium';
  }

  const s = status.toUpperCase();

  // Commercial / Process (Based on provided image)
  if (s === 'COMPRAR')
    return 'bg-red-600 text-white border-red-700 font-black shadow-sm';
  if (s === 'ENCARGADO')
    return 'bg-green-700 text-white border-green-800 font-black shadow-sm';
  if (s === 'RESERVADO')
    return 'bg-[#D9F99D] text-[#365314] border-[#BEF264] font-black'; // Light Lime
  if (s === 'VENDIDO')
    return 'bg-blue-600 text-white border-blue-700 font-black shadow-sm';
  if (s === 'CANCELADO' || s === '2023')
    return 'bg-slate-300 text-slate-700 border-slate-400 font-bold';
  if (s === 'PARCIAL')
    return 'bg-rose-200 text-rose-800 border-rose-300 font-bold';
  if (s === 'CONCESION')
    return 'bg-blue-900 text-white border-blue-950 font-black';
  if (s === 'MIAMI')
    return 'bg-yellow-400 text-yellow-950 border-yellow-500 font-black';
  if (s === 'STOCK 🇦🇷')
    return 'bg-blue-50 text-blue-700 border-blue-100 font-bold';

  // Logistics (Shipment & Order Statuses)
  if (s === 'ENTREGADO')
    return 'bg-sky-200 text-sky-800 border-sky-300 font-black uppercase';
  if (s === 'SALIENDO' || s === 'SALIENDO MIAMI')
    return 'bg-orange-200 text-orange-800 border-orange-300 font-black uppercase';
  if (s === 'LLEGANDO')
    return 'bg-purple-200 text-purple-800 border-purple-300 font-black uppercase';
  if (s === 'EN 🇦🇷' || s === 'EN BSAS' || s === 'RECIBIDO BSAS')
    return 'bg-cyan-200 text-cyan-800 border-cyan-300 font-black uppercase';

  return 'bg-slate-100 text-slate-800 border-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700 font-bold';
}
