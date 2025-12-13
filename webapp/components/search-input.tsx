'use client';

import { Input } from '@/components/ui/input';
import { Search } from 'lucide-react';
import { useSearchParams, usePathname, useRouter } from 'next/navigation';
import { useDebouncedCallback } from 'use-debounce';

export function SearchInput({ placeholder = 'Buscar...' }: { placeholder?: string }) {
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
        <div className="flex items-center space-x-2 bg-white/50 p-1 rounded-lg border focus-within:ring-2 ring-primary/50 transition-all">
            <Search className="h-4 w-4 text-muted-foreground ml-2" />
            <Input
                placeholder={placeholder}
                className="border-0 focus-visible:ring-0 w-[300px] bg-transparent"
                onChange={(e) => handleSearch(e.target.value)}
                defaultValue={searchParams.get('q')?.toString()}
            />
        </div>
    );
}
