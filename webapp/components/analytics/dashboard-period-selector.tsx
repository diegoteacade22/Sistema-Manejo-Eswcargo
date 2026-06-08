
'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { PeriodSelector } from './period-selector';

export function DashboardPeriodSelector({ initialValue }: { initialValue: number }) {
    const router = useRouter();
    const searchParams = useSearchParams();

    const handleChange = (months: number) => {
        const params = new URLSearchParams(searchParams.toString());
        params.set('months', months.toString());
        router.push(`/?${params.toString()}`);
    };

    return <PeriodSelector value={initialValue} onChange={handleChange} />;
}
