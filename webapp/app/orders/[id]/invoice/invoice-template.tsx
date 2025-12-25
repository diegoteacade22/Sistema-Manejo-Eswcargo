
'use client';

import { useEffect, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Printer, Globe, Instagram, Facebook, Twitter, Linkedin, MessageCircle, Mail, Loader2 } from 'lucide-react';
import { sendInvoiceEmail } from '@/app/email-actions';
import { Client, Order, OrderItem, Product } from '@prisma/client';

// Extended type for Order with relations
// Extended type for Order with relations, explicit fields to avoid stale type errors
type OrderWithRelations = Order & {
    paymentMethod?: string | null;
    email_sent_at?: Date | null; // Explicitly add for TS context if client update lags
    client: Client & {
        city?: string | null;
        country?: string | null;
        zipCode?: string | null;
    };
    items: (OrderItem & { product?: Product | null })[];
};

export default function InvoiceTemplate({ order }: { order: OrderWithRelations }) {
    const [isSending, startTransition] = useTransition();

    const handleSendEmail = () => {
        const defaultEmail = order.client?.email || '';
        const email = window.prompt('Ingrese el email de destino:', defaultEmail);

        if (!email) return;

        startTransition(async () => {
            const result = await sendInvoiceEmail(order.id, email);
            if (result.success) {
                alert('Email enviado correctamente!');
                // Optional: Force refresh or local state update if needed, 
                // but since it's a server component rendered client-side, 
                // we might not see the checkmark immediately without refresh or separate state.
                // For now, simpler is better.
                window.location.reload();
            } else {
                alert('Error al enviar email: ' + result.message);
            }
        });
    };

    // Determine today's date or order date for headers
    const invoiceDate = new Date(order.date).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
    const customerId = order.client.old_id || 'IDCLI' + order.client.id; // Fallback format

    return (
        <div className="min-h-screen bg-white text-black p-8 font-sans print:p-0">
            {/* Print Controls - Hidden when printing */}
            <div className="max-w-[850px] mx-auto mb-8 flex flex-col items-end gap-2 print:hidden">
                <div className="flex gap-4">
                    <Button
                        onClick={handleSendEmail}
                        disabled={isSending}
                        className={`${order.email_sent_at ? 'bg-gray-100 text-gray-800 hover:bg-gray-200 border border-gray-300' : 'bg-[#103a89] hover:bg-blue-900 text-white'}`}
                    >
                        {isSending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mail className="mr-2 h-4 w-4" />}
                        {order.email_sent_at ? 'Reenviar Invoice' : 'Enviar Invoice'}
                    </Button>
                    <Button onClick={() => window.print()} className="bg-gray-800 hover:bg-black text-white">
                        <Printer className="mr-2 h-4 w-4" /> Imprimir / Guardar PDF
                    </Button>
                </div>
                {order.email_sent_at && (
                    <p className="text-xs text-green-600 font-medium flex items-center">
                        <span className="mr-1">✓</span>
                        Email enviado el {new Date(order.email_sent_at).toLocaleDateString()} a las {new Date(order.email_sent_at).toLocaleTimeString()}
                    </p>
                )}
            </div>

            {/* A4 Container */}
            <div className="max-w-[850px] mx-auto bg-white print:w-full print:max-w-none">

                {/* Header Section */}
                <div className="flex justify-between items-start mb-8">
                    {/* Left: Logo & Company Info */}
                    <div className="flex gap-4">
                        <div className="w-24 h-24 relative">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                                src="/logo_factura.jpg"
                                alt="Electro-Surweb Logo"
                                className="w-full h-full object-contain"
                            />
                        </div>
                        <div className="text-[#103a89] space-y-1 text-sm font-semibold">
                            <h1 className="text-2xl font-bold uppercase mb-2">ELECTRO-SURWEB INC</h1>
                            <p>21180 MAINSAIL CIR B19</p>
                            <p>MIAMI, FL 33180</p>
                            <p>(786) 281-4922</p>
                            <p>INFO@ELECTROSURWEB.COM</p>
                        </div>
                    </div>

                    {/* Right: Invoice Label */}
                    <div className="text-right">
                        <h2 className="text-[#103a89] text-2xl font-bold uppercase tracking-wide mb-1">INVOICE - FACTURA</h2>
                    </div>
                </div>

                {/* Info Blocks Grid */}
                <div className="grid grid-cols-2 gap-8 mb-8">

                    {/* Customer Info (Left) */}
                    <div>
                        <div className="bg-[#103a89] text-white px-2 py-1 font-bold text-sm uppercase mb-2">
                            CUSTOMER
                        </div>
                        <div className="text-sm space-y-1 px-2">
                            <div className="grid grid-cols-[80px_1fr]">
                                <span className="font-bold text-[#103a89]">NAME</span>
                                <span className="uppercase">{order.client.name}</span>
                            </div>
                            <div className="grid grid-cols-[80px_1fr]">
                                <span className="font-bold text-[#103a89]">ADDRESS</span>
                                <span className="uppercase">{order.client.address || 'NO ADDRESS'}</span>
                            </div>
                            <div className="grid grid-cols-[80px_1fr]">
                                <span className="font-bold text-[#103a89]">CITY</span>
                                <span className="uppercase">{order.client.city || 'MIAMI'}</span>
                            </div>
                            <div className="grid grid-cols-[80px_1fr]">
                                <span className="font-bold text-[#103a89]">COUNTRY</span>
                                <span className="uppercase">{order.client.country || 'USA'}</span>
                            </div>
                            <div className="grid grid-cols-[80px_1fr]">
                                <span className="font-bold text-[#103a89]">DOC</span>
                                <span>{customerId}</span>
                            </div>
                            <div className="grid grid-cols-[80px_1fr]">
                                <span className="font-bold text-[#103a89]">EMAIL</span>
                                <span className="lowercase">{order.client.email || '-'}</span>
                            </div>
                        </div>
                    </div>

                    {/* Invoice Meta (Right) */}
                    <div>
                        <div className="grid grid-cols-[1fr_1fr] text-center mb-1">
                            <div className="bg-[#103a89] text-white px-1 py-1 font-bold text-sm">DATE</div>
                        </div>
                        <div className="text-center border-b border-gray-300 mb-2">
                            {invoiceDate}
                        </div>

                        <div className="grid grid-cols-2 gap-px bg-white mb-2">
                            <div className="bg-[#103a89] text-white px-1 py-1 font-bold text-sm text-center">INVOICE</div>
                            <div className="bg-[#103a89] text-white px-1 py-1 font-bold text-sm text-center">CUSTOMER ID</div>
                        </div>
                        <div className="grid grid-cols-2 gap-4 text-center border-b border-gray-300 mb-2 pb-1 text-sm">
                            <div>{order.order_number}</div>
                            <div>{customerId}</div>
                        </div>

                        <div className="bg-[#103a89] text-white px-2 py-1 font-bold text-sm uppercase text-center mb-1">
                            TERMS OF SALE
                        </div>
                        <div className="text-center text-sm font-bold border-b border-gray-300 pb-1">
                            {order.paymentMethod ? `${order.paymentMethod.toUpperCase()} (${order.currency})` : `${order.currency} - DOLAR USA`}
                        </div>
                    </div>
                </div>

                {/* Items Table */}
                <div className="mb-0">
                    <table className="w-full text-sm border-collapse">
                        <thead>
                            <tr className="bg-[#103a89] text-white">
                                <th className="py-1 px-4 text-center font-bold w-16">QTY</th>
                                <th className="py-1 px-4 text-left font-bold">FULL DESCRIPTION OF GOODS</th>
                                <th className="py-1 px-2 text-center font-bold w-24">COLOR</th>
                                <th className="py-1 px-4 text-right font-bold w-32">UNIT VALUE</th>
                                <th className="py-1 px-4 text-right font-bold w-32">TOTAL VALUE</th>
                            </tr>
                        </thead>
                        <tbody>
                            {order.items.map((item, idx) => (
                                <tr key={idx} className="border-b border-gray-200">
                                    <td className="py-2 px-4 text-center align-top">{item.quantity}</td>
                                    <td className="py-2 px-4 text-left align-top">{item.productName || item.productId || 'Item Desc'}</td>
                                    <td className="py-2 px-2 text-center align-top uppercase">{item.product?.color_grade || '-'}</td>
                                    <td className="py-2 px-4 text-right align-top">
                                        USD {new Intl.NumberFormat('en-US', { minimumFractionDigits: 2 }).format(item.unit_price)}
                                    </td>
                                    <td className="py-2 px-4 text-right align-top">
                                        USD {new Intl.NumberFormat('en-US', { minimumFractionDigits: 2 }).format(item.subtotal || (item.unit_price * item.quantity))}
                                    </td>
                                </tr>
                            ))}
                            {/* Empty rows filler if short? Optional. */}
                            {[...Array(Math.max(0, 5 - order.items.length))].map((_, i) => (
                                <tr key={`empty-${i}`} className="border-b border-gray-100 h-8">
                                    <td colSpan={4}></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {/* Footer Section */}
                <div className="grid grid-cols-[1.5fr_1fr] mt-0 items-start border-t border-gray-300">

                    {/* Left Footer: Remarks & Bank */}
                    <div className="pt-2 pr-4">
                        <div className="mb-4">
                            <span className="font-bold text-sm block mb-1">Remarks/Instructions:</span>
                            <div className="border-b border-gray-300 h-16 text-xs text-gray-500 italic p-1">
                                {order.status !== 'ENTREGADO' ? 'Pending Delivery.' : ''}
                            </div>
                        </div>

                        <div className="text-xs space-y-1">
                            <p className="font-bold">Instrucciones:</p>
                            <p><span className="font-bold">Beneficiary Name:</span> Electro-Surweb Inc</p>
                            <p><span className="font-bold">Beneficiary Address:</span> 21180 Mainsail Circle, B19</p>
                            <p className="ml-4">Aventura, FL 33180</p>

                            <p className="font-bold mt-2">MERCURY (Choice Financial Group)</p>
                            <p><span className="font-bold">Account Number:</span> 202557771823</p>
                            <p><span className="font-bold">Routing:</span></p>
                            <p><span className="font-bold">ABA:</span> 09131122</p>
                            <p><span className="font-bold">Bank Address:</span> 4501 23rd Avenue S</p>
                            <p className="ml-4">Fargo, ND 58104</p>

                            <div className="mt-4 border-t border-dashed border-gray-400 pt-2">
                                <p className="font-bold text-[#103a89]">ACEPTAMOS USDT</p>
                                <p className="font-bold text-[#103a89]">CONSULTAR WALLET</p>
                            </div>

                            <p className="text-[10px] text-[#103a89] mt-4 leading-tight italic">
                                These commodities, technology or software, were exported from the United States in accordance with the Export Administration regulations. Diversion contrary to US Law Prohibited.
                            </p>
                        </div>
                    </div>

                    {/* Right Footer: Totals */}
                    <div>
                        <div className="grid grid-cols-[1fr_120px] text-sm border-l border-gray-300">
                            <div className="bg-[#103a89] text-white px-2 py-1 text-right font-bold border-b border-white">SUBTOTAL</div>
                            <div className="px-2 py-1 text-right border-b border-gray-200">USD {order.total_amount.toFixed(2)}</div>

                            <div className="px-2 py-1 text-right font-bold text-gray-600 border-b border-gray-200">TAX</div>
                            <div className="px-2 py-1 text-right border-b border-gray-200">USD 0.00</div>

                            <div className="bg-[#103a89] text-white px-2 py-1 text-right font-bold border-b border-white">FREIGHT COST</div>
                            <div className="px-2 py-1 text-right border-b border-gray-200">USD 0</div>

                            <div className="bg-[#103a89] text-white px-2 py-1 text-right font-bold border-b border-white">INSURANCE COST</div>
                            <div className="px-2 py-1 text-right border-b border-gray-200">USD 0</div>

                            <div className="bg-[#103a89] text-white px-2 py-1 text-right font-bold border-b border-white">ADDITIONAL</div>
                            <div className="px-2 py-1 text-right border-b border-gray-200">USD 0</div>

                            <div className="bg-[#103a89] text-white px-2 py-2 text-right font-bold text-base">TOTAL INVOICE VALUE</div>
                            <div className="px-2 py-2 text-right font-bold text-base bg-gray-100">USD {order.total_amount.toFixed(2)}</div>
                        </div>

                        {/* Ports - cosmetic placeholders */}
                        <div className="mt-4 border border-[#103a89]">
                            <div className="bg-[#103a89] text-center text-white text-xs font-bold py-1">COUNTRY OF EXPORT</div>
                            <div className="text-center text-xs py-1">USA</div>
                        </div>
                        <div className="mt-1 border border-[#103a89]">
                            <div className="bg-[#103a89] text-center text-white text-xs font-bold py-1">EMBARKATION PORT</div>
                            <div className="text-center text-xs py-1">MIAMI</div>
                        </div>
                        <div className="mt-1 border border-[#103a89]">
                            <div className="bg-[#103a89] text-center text-white text-xs font-bold py-1">DISCHARGE PORT</div>
                            <div className="text-center text-xs py-1">BS-AS</div>
                        </div>
                    </div>
                </div>

                <div className="text-center text-xs text-[#103a89] mt-8 italic print:mt-4 border-t pt-4">
                    <p className="font-semibold">Thank you for doing business with us.</p>
                    <p>For questions concerning this invoice, please contact:</p>
                    <p>Diego Rodriguez, (786) 281-4922, diego@electrosurweb.com</p>

                    {/* Web View Links */}
                    <div className="flex flex-wrap justify-center items-center gap-4 mt-3 print:hidden">
                        <a href="http://electrosurweb.com/" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:text-blue-600">
                            <Globe className="h-3 w-3" /> electrosurweb.com
                        </a>
                        <a href="https://eswtech.net/" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:text-blue-600">
                            <Globe className="h-3 w-3" /> eswtech.net
                        </a>
                        <a href="https://wa.me/17862814922" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:text-green-600">
                            <MessageCircle className="h-3 w-3" /> WhatsApp
                        </a>
                        <a href="https://instagram.com/eswtech1" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:text-pink-600">
                            <Instagram className="h-3 w-3" /> @eswtech1
                        </a>
                        <a href="https://facebook.com/electrosurweb" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:text-blue-800">
                            <Facebook className="h-3 w-3" /> electrosurweb
                        </a>
                        <a href="https://x.com/electrosurweb" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:text-black">
                            <Twitter className="h-3 w-3" /> @electrosurweb
                        </a>
                        <a href="https://www.linkedin.com/company/electrosurweb" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:text-blue-700">
                            <Linkedin className="h-3 w-3" /> electrosurweb
                        </a>
                    </div>

                    {/* Print View Links (Text Only) */}
                    <div className="hidden print:grid grid-cols-3 gap-y-1 gap-x-4 mt-2 text-[9px] text-gray-600 justify-items-center">
                        <span>electrosurweb.com</span>
                        <span>eswtech.net</span>
                        <span>wa.me/17862814922</span>
                        <span>instagram.com/eswtech1</span>
                        <span>facebook.com/electrosurweb</span>
                        <span>x.com/electrosurweb</span>
                        <span>linkedin.com/company/electrosurweb</span>
                    </div>
                </div>
            </div>
        </div>
    );
}
