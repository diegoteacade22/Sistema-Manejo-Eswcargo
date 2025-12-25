
import Link from 'next/link';
import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { TableHead } from '@/components/ui/table';

export type SortOrder = 'asc' | 'desc';

interface SortableColumnProps {
    field: string;
    label: string;
    currentSort: string;
    currentOrder: SortOrder;
    query?: string;
    page?: number | string;
    alignRight?: boolean;
    baseUrl: string; // e.g. "/orders", "/clients"
}

export function SortableColumn({
    field,
    label,
    currentSort,
    currentOrder,
    query = "",
    page = 1,
    alignRight = false,
    baseUrl
}: SortableColumnProps) {
    const isCurrent = currentSort === field;
    const nextOrder = isCurrent && currentOrder === 'desc' ? 'asc' : 'desc';
    const Icon = isCurrent ? (currentOrder === 'desc' ? ArrowDown : ArrowUp) : ArrowUpDown;

    // Construct URL Params
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    if (page && Number(page) > 1) params.set('page', page.toString());
    params.set('sort', field);
    params.set('order', nextOrder);

    const href = `${baseUrl}?${params.toString()}`;

    // Determine color based on base URL for simple theming or just use current text color with hover
    // But to match specific page themes (pink, violet, etc) we could pass a class.
    // For now, let's just use hover:text-primary which usually maps to the theme, 
    // but these pages assume specific colors. 
    // Let's use a generic 'hover:opacity-80' and 'text-foreground' interaction.
    // Actually, the user's layouts have specific colored gradients.
    // I'll leave the color class handling to the caller via logic or just default to a safe "text-primary" 
    // but the `text-pink-600` in my previous edit was specific. 
    // I will try to infer or just accept a 'colorClass' prop? 
    // Let's keep it simple: "hover:text-primary" works if valid, otherwise just text-current.

    return (
        <TableHead className={alignRight ? "text-right" : ""}>
            <Link
                href={href}
                scroll={false}
                className={`flex items-center gap-1 transition-colors hover:underline decoration-2 underline-offset-4 ${alignRight ? "justify-end" : ""
                    } ${isCurrent ? "font-bold text-foreground" : "text-slate-500 dark:text-slate-400 font-medium hover:text-slate-900 dark:hover:text-slate-200"}`}
            >
                {label}
                <Icon className={`h-3 w-3 ${isCurrent ? "opacity-100" : "opacity-40"}`} />
            </Link>
        </TableHead>
    );
}
