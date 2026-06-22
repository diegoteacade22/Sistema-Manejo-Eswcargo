'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export function WeekRangeSelector({ initialValue }: { initialValue: number }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const handleChange = (weeks: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('weeks', weeks);
    router.push(`/analytics/weekly?${params.toString()}`);
  };

  return (
    <Select value={String(initialValue)} onValueChange={handleChange}>
      <SelectTrigger className="w-[190px] bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-800">
        <SelectValue placeholder="Seleccionar semanas" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="1">Semana actual</SelectItem>
        <SelectItem value="2">Últimas 2 semanas</SelectItem>
        <SelectItem value="4">Últimas 4 semanas</SelectItem>
        <SelectItem value="8">Últimas 8 semanas</SelectItem>
      </SelectContent>
    </Select>
  );
}
