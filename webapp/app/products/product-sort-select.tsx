'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"

export function ProductSortSelect({ currentSort }: { currentSort: string }) {
    const router = useRouter();
    const searchParams = useSearchParams();

    const handleSortChange = (value: string) => {
        const params = new URLSearchParams(searchParams.toString());
        params.set('sort', value);
        params.set('page', '1'); // Reset to page 1 on sort change
        router.push(`?${params.toString()}`);
    };

    return (
        <Select value={currentSort} onValueChange={handleSortChange}>
            <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Ordenar por..." />
            </SelectTrigger>
            <SelectContent>
                <SelectItem value="popular">Más Vendidos</SelectItem>
                <SelectItem value="name">Nombre (A-Z)</SelectItem>
                <SelectItem value="price">Precio (Mayor-Menor)</SelectItem>
            </SelectContent>
        </Select>
    );
}
