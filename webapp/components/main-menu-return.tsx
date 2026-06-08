import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export function MainMenuReturn() {
  return (
    <Link
      href="https://esw-apps-menu.vercel.app"
      className="fixed right-4 top-4 z-[100] inline-flex min-h-10 items-center gap-2 rounded-md border border-sky-300/35 bg-slate-950/90 px-3 py-2 text-sm font-bold text-sky-100 shadow-[0_5px_0_rgba(2,6,23,0.95),0_14px_28px_rgba(14,165,233,0.18)] backdrop-blur transition hover:-translate-y-0.5 hover:bg-slate-900 active:translate-y-1 active:shadow-[0_2px_0_rgba(2,6,23,0.95),0_8px_16px_rgba(14,165,233,0.14)] print:hidden"
    >
      <ArrowLeft size={16} />
      Volver al Menu Principal
    </Link>
  );
}
