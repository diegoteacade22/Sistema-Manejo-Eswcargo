
'use client';

import { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Printer, Mail, FileText, Loader2, Instagram, Globe, MessageSquare, Twitter, Facebook } from 'lucide-react';
import { sendInvoiceEmail } from '@/app/email-actions';
import { toast } from 'sonner';

interface InvoiceTemplateProps {
    order: any;
}

export default function InvoiceTemplate({ order }: InvoiceTemplateProps) {
    const [isSending, setIsSending] = useState(false);

    const handlePrint = () => {
        window.print();
    };

    const handleSendEmail = async () => {
        const targetEmail = window.prompt('Ingrese el email del cliente:', order.client.email || '');

        if (!targetEmail) {
            toast.error('Operación cancelada: El email es obligatorio.');
            return;
        }

        setIsSending(true);
        try {
            const result = await sendInvoiceEmail(order.id, targetEmail);
            if (result.success) {
                toast.success('Factura enviada correctamente a: ' + targetEmail);
            } else {
                toast.error('Error al enviar: ' + result.message);
            }
        } catch (error) {
            toast.error('Error de red al enviar el email');
        } finally {
            setIsSending(false);
        }
    };

    const totalValue = order.total_amount;
    const items = order.items || [];
    const customerId = order.client.old_id || order.client.id;

    return (
        <div className="bg-slate-50 min-h-screen p-4 md:p-8 print:p-0 print:bg-white animate-in fade-in duration-500">
            <style dangerouslySetInnerHTML={{
                __html: `
                @media print {
                    @page {
                        size: letter;
                        margin: 0.4cm;
                    }
                    body {
                        -webkit-print-color-adjust: exact;
                        print-color-adjust: exact;
                        background: white !important;
                    }
                    .print-compact {
                        transform: scale(0.92);
                        transform-origin: top center;
                    }
                    .no-print { display: none !important; }
                }
            `}} />

            <div className="max-w-4xl mx-auto space-y-6 print:space-y-0 print:max-w-none print-compact">
                {/* PDF Actions - Hidden when printing */}
                <div className="flex items-center justify-between bg-white p-4 rounded-xl shadow-sm border border-slate-200 print:hidden">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-indigo-50 rounded-lg">
                            <FileText className="h-5 w-5 text-indigo-600" />
                        </div>
                        <div>
                            <h3 className="font-bold text-slate-800">Invoice #{order.order_number}</h3>
                            <p className="text-sm text-slate-500">Generado el {new Date().toLocaleDateString()}</p>
                        </div>
                    </div>
                    <div className="flex gap-3">
                        <Button
                            variant="outline"
                            onClick={handlePrint}
                            className="border-slate-400 hover:bg-slate-100 text-slate-700 font-bold"
                        >
                            <Printer className="mr-2 h-4 w-4" /> Imprimir
                        </Button>
                        <Button
                            onClick={handleSendEmail}
                            disabled={isSending}
                            className="bg-indigo-600 hover:bg-indigo-700 text-white"
                        >
                            {isSending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mail className="mr-2 h-4 w-4" />}
                            Enviar al Cliente
                        </Button>
                    </div>
                </div>

                {/* Main Invoice Sheet */}
                <div
                    id="invoice-content"
                    className="bg-white shadow-2xl rounded-sm overflow-hidden border border-slate-200 print:shadow-none print:border-none print:w-full"
                >
                    {/* Header */}
                    <div className="bg-[#103a89] text-white p-8 print:p-6 flex justify-between items-start">
                        <div className="space-y-1">
                            <h1 className="text-4xl font-black tracking-tighter leading-none">ELECTRO-SURWEB INC</h1>
                            <div className="text-xs opacity-90 font-medium uppercase tracking-wider">
                                <p>21180 MAINSAIL CIR B19, MIAMI, FL 33180</p>
                                <p>PH: (786) 281-4922 | INFO@ELECTROSURWEB.COM</p>
                            </div>
                        </div>
                        <div className="text-right flex flex-col items-end">
                            <div className="bg-white/10 px-4 py-1.5 rounded-lg border border-white/20 mb-2">
                                <h2 className="text-xl font-bold tracking-widest uppercase">INVOICE - FACTURA</h2>
                            </div>
                            <p className="text-4xl font-black">#{order.order_number}</p>
                        </div>
                    </div>

                    <div className="p-8 print:p-6 space-y-6 print:space-y-4">
                        {/* Info Blocks */}
                        <div className="grid grid-cols-2 gap-8 print:gap-4 border-b border-slate-100 pb-6 print:pb-4">
                            <div className="space-y-3 print:space-y-2">
                                <div className="text-[10px] font-black text-[#103a89] uppercase tracking-[0.2em] border-b border-[#103a89]/20 pb-1 w-fit pr-8">CUSTOMER</div>
                                <div className="space-y-0.5">
                                    <h3 className="text-lg font-bold text-slate-900 uppercase">{order.client.name}</h3>
                                    <p className="text-xs text-slate-600 uppercase font-medium leading-relaxed">
                                        {order.client.address || 'NO ADDRESS'}<br />
                                        {order.client.city || 'MIAMI'}, {order.client.country || 'USA'}
                                    </p>
                                    <p className="text-[10px] text-slate-500 font-bold mt-1">CLIENT ID: {customerId}</p>
                                </div>
                            </div>
                            <div className="space-y-3 print:space-y-2">
                                <div className="text-[10px] font-black text-[#103a89] uppercase tracking-[0.2em] border-b border-[#103a89]/20 pb-1 text-right w-fit ml-auto pl-8">Invoice Meta</div>
                                <div className="flex flex-col items-end gap-1.5">
                                    <div className="flex gap-4 text-xs">
                                        <span className="text-slate-500 font-bold uppercase">Date:</span>
                                        <span className="font-bold text-slate-800">{new Date(order.date).toLocaleDateString()}</span>
                                    </div>
                                    <div className="flex gap-4 text-xs">
                                        <span className="text-slate-500 font-bold uppercase">Terms:</span>
                                        <span className="font-black text-[#103a89] bg-[#103a89]/5 px-2 rounded">USDT (USD)</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Items Table */}
                        <div className="overflow-hidden rounded-lg border border-slate-200">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="bg-[#103a89] text-white uppercase text-[10px] font-black tracking-widest">
                                        <th className="px-4 py-3 border-r border-white/10 text-center w-12">Qty</th>
                                        <th className="px-4 py-3 border-r border-white/10">Full Description of Goods</th>
                                        <th className="px-4 py-3 border-r border-white/10 text-center w-24">Color</th>
                                        <th className="px-4 py-3 border-r border-white/10 text-right w-28">Unit Value</th>
                                        <th className="px-4 py-3 text-right w-28">Total Value</th>
                                    </tr>
                                </thead>
                                <tbody className="text-sm">
                                    {items.map((item: any, idx: number) => (
                                        <tr key={idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                                            <td className="px-4 py-2 border-r border-slate-200 text-center font-bold text-[#103a89]">{item.quantity}</td>
                                            <td className="px-4 py-2 border-r border-slate-200 font-medium text-slate-700">{item.productName}</td>
                                            <td className="px-4 py-2 border-r border-slate-200 text-center text-[10px] font-bold text-slate-500 uppercase">{item.product?.color_grade || '-'}</td>
                                            <td className="px-4 py-2 border-r border-slate-200 text-right font-mono text-slate-600">USD {item.unit_price.toFixed(0)}</td>
                                            <td className="px-4 py-2 text-right font-bold text-slate-900">USD {(item.unit_price * item.quantity).toFixed(0)}</td>
                                        </tr>
                                    ))}
                                    {/* Footer Row for Totals */}
                                    <tr className="bg-slate-100/50 border-t-2 border-slate-200">
                                        <td className="px-4 py-3 border-r border-slate-200 text-center font-black text-[#103a89] text-base">
                                            {items.reduce((sum: number, item: any) => sum + item.quantity, 0)}
                                        </td>
                                        <td colSpan={2} className="px-4 py-3 border-r border-slate-200 font-black text-[10px] text-[#103a89] uppercase tracking-widest text-right">
                                            Total PCs
                                        </td>
                                        <td colSpan={2} className="px-4 py-3"></td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>

                        {/* Bottom Section */}
                        <div className="grid grid-cols-2 gap-8 pt-4">
                            <div className="space-y-4">
                                <div className="bg-slate-50 p-4 rounded-lg border border-slate-100">
                                    <h4 className="text-[10px] font-black text-[#103a89] uppercase tracking-widest mb-2">Banking Instructions</h4>
                                    <div className="text-[10px] font-bold text-slate-700 space-y-1 uppercase leading-tight">
                                        <p><span className="text-[#103a89]">Beneficiary:</span> Electro-Surweb Inc</p>
                                        <p><span className="text-[#103a89]">Bank:</span> MERCURY (Choice Financial Group)</p>
                                        <p><span className="text-[#103a89]">Account:</span> 202557771823</p>
                                        <p><span className="text-[#103a89]">ABA/Routing:</span> 09131122</p>
                                        <p className="pt-2 text-[#103a89] border-t border-slate-200 mt-2">USDT / CRYPTO ACCEPTED</p>
                                    </div>
                                </div>
                                <div className="text-[9px] text-slate-400 leading-tight italic px-2">
                                    These commodities, technology or software, were exported from the United States in accordance with the Export Administration regulations. Diversion contrary to US Law Prohibited.
                                </div>
                            </div>

                            <div className="space-y-2">
                                <div className="flex justify-between items-center py-2 px-4 bg-slate-50 rounded-lg">
                                    <span className="text-xs font-black text-slate-500 uppercase">Weight Total</span>
                                    <span className="font-bold text-slate-900 uppercase">{order.shipment?.weight_cli || '-'} KG</span>
                                </div>
                                <div className="flex justify-between items-center py-2 px-4 bg-slate-50 rounded-lg">
                                    <span className="text-xs font-black text-slate-500 uppercase">Items Count</span>
                                    <span className="font-bold text-slate-900">{items.length} PCS</span>
                                </div>
                                <div className="pt-4 border-t-2 border-[#103a89] flex justify-between items-baseline px-2">
                                    <span className="text-lg font-black text-[#103a89] uppercase tracking-tighter">Total Invoice</span>
                                    <div className="text-right">
                                        <span className="text-[10px] font-bold text-slate-400 block -mb-1">USD</span>
                                        <span className="text-3xl font-black text-[#103a89] tracking-tighter">
                                            {new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(totalValue)}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Footer Socials */}
                        <div className="pt-8 print:pt-4 border-t border-slate-100">
                            <div className="flex flex-wrap justify-center gap-x-6 gap-y-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                                <div className="flex items-center gap-1.5 text-[#103a89]"><Globe className="h-3 w-3" /> electrosurweb.com</div>
                                <div className="flex items-center gap-1.5"><Instagram className="h-3 w-3" /> @eswtech1</div>
                                <div className="flex items-center gap-1.5"><MessageSquare className="h-3 w-3" /> WhatsApp</div>
                                <div className="flex items-center gap-1.5"><Twitter className="h-3 w-3" /> @eswtech1</div>
                            </div>
                            <p className="text-center mt-4 text-[11px] font-black text-slate-800 uppercase italic">
                                Thank you for doing business with us!
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

