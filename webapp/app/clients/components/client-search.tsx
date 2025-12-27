'use client';

import { Input } from '@/components/ui/input';
import { Search } from 'lucide-react';
import { useSearchParams, usePathname, useRouter } from 'next/navigation';
import { useDebouncedCallback } from 'use-debounce';

export function ClientSearch() {
    const searchParams = useSearchParams();
    const pathname = usePathname();
    const { replace } = useRouter();

    const handleSearch = useDebouncedCallback((term: string) => {
        const params = new URLSearchParams(searchParams);
        if (term) {
            params.set('q', term);
        } else {
            params.delete('q');
        }
        replace(`${pathname}?${params.toString()}`);
    }, 300);

    return (
        <div className="flex items-center space-x-2 bg-slate-800/80 p-1 rounded-lg border border-slate-700 focus-within:ring-2 ring-violet-500/50 transition-all">
            <Search className="h-4 w-4 text-slate-400 ml-2" />
            <Input
                placeholder="Buscar cliente..."
                className="border-0 focus-visible:ring-0 w-[300px] bg-transparent text-white placeholder:text-slate-400"
                onChange={(e) => handleSearch(e.target.value)}
                defaultValue={searchParams.get('q')?.toString()}
            />
        </div>
    );
}
