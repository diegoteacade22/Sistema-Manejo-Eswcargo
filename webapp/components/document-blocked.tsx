import Link from 'next/link';
import { ShieldAlert } from 'lucide-react';

type DocumentBlockedProps = {
    title: string;
    detail: string;
    backHref: string;
    backLabel: string;
};

export function DocumentBlocked({ title, detail, backHref, backLabel }: DocumentBlockedProps) {
    return (
        <main className="min-h-screen bg-slate-950 px-6 py-16 text-slate-100">
            <div className="mx-auto max-w-xl border border-amber-500/40 bg-slate-900 p-8 shadow-xl">
                <ShieldAlert className="h-10 w-10 text-amber-400" aria-hidden="true" />
                <h1 className="mt-5 text-2xl font-bold">{title}</h1>
                <p className="mt-3 text-slate-300">{detail}</p>
                <Link
                    href={backHref}
                    className="mt-7 inline-flex border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-100 hover:bg-slate-800"
                >
                    {backLabel}
                </Link>
            </div>
        </main>
    );
}
