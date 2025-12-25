'use client';

import { Button } from '@/components/ui/button';
import { Printer, Package, Globe, Instagram, Facebook, Mail, Loader2 } from 'lucide-react';
import { sendPackingListEmail } from '@/app/email-actions';
import { useState, useTransition } from 'react';

/* eslint-disable @next/next/no-img-element */

interface PackingListTemplateProps {
    shipment: any;
}

export default function PackingListTemplate({ shipment }: PackingListTemplateProps) {
    const [isSending, startTransition] = useTransition();

    const handleSendEmail = () => {
        const defaultEmail = shipment.client?.email || '';
        const email = window.prompt('Ingrese el email de destino:', defaultEmail);

        if (!email) return;

        startTransition(async () => {
            const result = await sendPackingListEmail(shipment.id, email);
            if (result.success) {
                alert('Email enviado correctamente!');
            } else {
                alert('Error al enviar email: ' + result.message);
            }
        });
    };

    // Basic date formatting
    const dateShipped = shipment.date_shipped
        ? new Date(shipment.date_shipped).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })
        : '-';

    // Filter items
    const shipmentItemsMap = new Map<number, any>();

    // 1. Direct items
    if (shipment.items) {
        shipment.items.forEach((item: any) => {
            shipmentItemsMap.set(item.id, {
                ...item,
                orderId: item.order?.id,
                orderNumber: item.order?.order_number
            });
        });
    }

    // 2. Orders' items (Implicit)
    if (shipment.orders) {
        shipment.orders.forEach((order: any) => {
            if (order.items) {
                order.items.forEach((item: any) => {
                    // Only add if not already present (direct link takes precedence)
                    if (!shipmentItemsMap.has(item.id)) {
                        // Inherit shipment if item has no explicit shipment
                        const isInShipment = item.shipmentId === shipment.id || (!item.shipmentId && order.shipmentId === shipment.id);
                        if (isInShipment) {
                            shipmentItemsMap.set(item.id, {
                                ...item,
                                orderId: order.id,
                                orderNumber: order.order_number
                            });
                        }
                    }
                });
            }
        });
    }

    const shipmentItems = Array.from(shipmentItemsMap.values());

    // Group Items Logic for "Items of Total" calculation
    const orderTotalsMap = new Map<string, number>();

    // We can just iterate the final shipmentItems to verify totals? 
    // No, "Items of Total" refers to the TOTAL ordered quantity vs shipped quantity?
    // Usually a Packing list shows "Quantity Shipped".
    // If we want "Items of Total", we usually need the context of the whole order.
    // For now, let's just make the totals based on what's visible, or if we had access to the full order we could do partials.
    // Let's assume the user wants to see totals of what is in THIS packing list for now, 
    // OR if they want "3 of 10", we'd need the full order context. 
    // Given the previous code iterated `shipment.orders`, it assumed full orders were loaded.
    // Let's keep it simple: map what we have.
    shipmentItems.forEach((item: any) => {
        const key = item.productId ? `${item.orderId}-${item.productId}` : `${item.orderId}-${item.productName}`;
        const current = orderTotalsMap.get(key) || 0;
        orderTotalsMap.set(key, current + item.quantity);
    });

    // Colors
    // Dark Blue: #0D3B4C
    // Teal: #72C4B7
    // Orange: #F4AB3D

    return (
        <div className="min-h-screen bg-white text-black p-8 font-sans print:p-0">
            {/* Print Controls */}
            <div className="max-w-[850px] mx-auto mb-8 flex flex-col items-end gap-2 print:hidden">
                <div className="flex gap-4">
                    <Button
                        onClick={handleSendEmail}
                        disabled={isSending}
                        className={`${shipment.email_sent_at ? 'bg-gray-100 text-gray-800 hover:bg-gray-200 border border-gray-300' : 'bg-[#72C4B7] hover:bg-[#5aa89c] text-white'}`}
                    >
                        {isSending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mail className="mr-2 h-4 w-4" />}
                        {shipment.email_sent_at ? 'Reenviar Email' : 'Enviar Email'}
                    </Button>
                    <Button onClick={() => window.print()} className="bg-[#0D3B4C] hover:bg-[#082a36] text-white">
                        <Printer className="mr-2 h-4 w-4" /> Imprimir / Guardar PDF
                    </Button>
                </div>
                {shipment.email_sent_at && (
                    <p className="text-xs text-green-600 font-medium flex items-center">
                        <span className="mr-1">✓</span>
                        Email enviado el {new Date(shipment.email_sent_at).toLocaleDateString()} a las {new Date(shipment.email_sent_at).toLocaleTimeString()}
                    </p>
                )}
            </div>

            {/* A4 Container */}
            <div className="max-w-[850px] mx-auto bg-white print:w-full print:max-w-none">

                {/* Header Section */}
                <div className="flex justify-between items-start mb-8">
                    {/* Left: Custom Logo Construction */}
                    <div className="flex flex-col items-center justify-center w-40">
                        {/* Logo Icon Part */}
                        <div className="relative mb-0 flex flex-col items-center">
                            {/* Orange Box */}
                            <div className="bg-[#F4AB3D] text-white p-1 rounded-sm transform -rotate-12 mb-[-5px] z-10 shadow-sm">
                                <Package className="h-6 w-6 stroke-[3]" />
                            </div>
                            {/* ESW Text */}
                            <h1 className="text-5xl font-black italic tracking-tighter text-[#0D3B4C] leading-none" style={{ fontFamily: 'Arial, sans-serif' }}>
                                ESW
                            </h1>
                            {/* CARGO Text */}
                            <h2 className="text-xl font-bold tracking-[0.2em] text-[#72C4B7] uppercase leading-none mt-0">
                                CARGO
                            </h2>
                        </div>
                        {/* Address under logo or separate? User image shows logo standalone. Address usually next to it.
                             Let's put address to the right of logo or below.
                             In previous template address was next to logo. 
                             Let's keep address next to it for balance, or below if desired.
                             Image 1 shows logo standalone. Let's put address separate.
                         */}
                    </div>

                    {/* Center: Address */}
                    <div className="hidden sm:block text-[#0D3B4C] text-xs font-semibold mt-8 text-center">
                        <p>9600 NW 38th OF 208</p>
                        <p>DORAL, FL 33172</p>
                        <p>FLORIDA USA</p>
                        <p>INFO@ESWCARGO.COM</p>
                    </div>

                    {/* Right: Document Label */}
                    <div className="text-right">
                        <h2 className="text-[#0D3B4C] text-3xl font-bold uppercase tracking-wide mb-2">PACKING LIST</h2>
                        <div className="inline-block bg-[#F4AB3D] text-[#0D3B4C] px-3 py-1 rounded-sm shadow-sm">
                            <p className="font-bold text-xl tracking-wider">ENVÍO #{shipment.shipment_number}</p>
                        </div>
                    </div>
                </div>

                {/* Info Grid */}
                <div className="grid grid-cols-2 gap-8 mb-8 border-t-2 border-[#0D3B4C] pt-6">
                    {/* Consignee */}
                    <div>
                        <div className="bg-[#0D3B4C] text-white px-3 py-1.5 font-bold text-sm uppercase mb-2 rounded-sm shadow-sm">
                            CONSIGNEE / CLIENT
                        </div>
                        <div className="text-sm space-y-1 px-2 font-medium text-gray-800">
                            {shipment.client ? (
                                <>
                                    <div className="grid grid-cols-[80px_1fr]">
                                        <span className="font-bold text-[#0D3B4C]">NAME</span>
                                        <span className="uppercase">{shipment.client.name}</span>
                                    </div>
                                    <div className="grid grid-cols-[80px_1fr]">
                                        <span className="font-bold text-[#0D3B4C]">ADDRESS</span>
                                        <span className="uppercase">{shipment.client.address || '-'}</span>
                                    </div>
                                    <div className="grid grid-cols-[80px_1fr]">
                                        <span className="font-bold text-[#0D3B4C]">CITY</span>
                                        <span className="uppercase">{shipment.client.city || '-'}</span>
                                    </div>
                                    <div className="grid grid-cols-[80px_1fr]">
                                        <span className="font-bold text-[#0D3B4C]">COUNTRY</span>
                                        <span className="uppercase">{shipment.client.country || '-'}</span>
                                    </div>
                                    <div className="grid grid-cols-[80px_1fr]">
                                        <span className="font-bold text-[#0D3B4C]">PHONE</span>
                                        <span>{shipment.client.phone || '-'}</span>
                                    </div>
                                </>
                            ) : (
                                <div className="italic text-gray-500">No client assigned.</div>
                            )}
                        </div>
                    </div>

                    {/* Shipment Details */}
                    <div>
                        <div className="bg-[#0D3B4C] text-white px-3 py-1.5 font-bold text-sm uppercase mb-2 rounded-sm shadow-sm">
                            SHIPMENT DETAILS
                        </div>
                        <div className="text-sm space-y-1 px-2 font-medium text-gray-800">
                            <div className="grid grid-cols-[100px_1fr]">
                                <span className="font-bold text-[#0D3B4C]">DATE</span>
                                <span>{dateShipped}</span>
                            </div>
                            <div className="grid grid-cols-[100px_1fr]">
                                <span className="font-bold text-[#0D3B4C]">FORWARDER</span>
                                <span className="uppercase font-bold text-[#0D3B4C]">ESWCARGO</span>
                            </div>
                            <div className="grid grid-cols-[100px_1fr]">
                                <span className="font-bold text-[#0D3B4C]">TYPE</span>
                                <span className="uppercase">{shipment.type_load || 'Carga Gral'}</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Items Table */}
                <div className="mb-0">
                    <div className="bg-[#0D3B4C] text-white px-3 py-1.5 font-bold text-sm uppercase mb-0 rounded-t-sm">
                        CONTENT DESCRIPTION
                    </div>
                    <table className="w-full text-sm border-collapse border border-gray-200 shadow-sm">
                        <thead>
                            <tr className="bg-gray-100 text-[#0D3B4C] border-b border-gray-300">
                                <th className="py-2 px-4 text-center font-bold w-16 border-r border-gray-300">QTY</th>
                                <th className="py-2 px-4 text-left font-bold border-r border-gray-300">DESCRIPTION</th>
                                <th className="py-2 px-4 text-center font-bold w-24 border-r border-gray-300">INVOICE</th>
                                <th className="py-2 px-4 text-center font-bold w-48">ITEMS DE UN TOTAL DE</th>
                            </tr>
                        </thead>
                        <tbody>
                            {shipmentItems.length > 0 ? (
                                shipmentItems.map((item: any, idx: number) => {
                                    // 1. Find the parent order in shipment.orders to get the total quantity for this SKU/Product
                                    const parentOrder = shipment.orders?.find((o: any) => o.id === item.orderId);
                                    let orderTotalQty = item.quantity; // Fallback

                                    if (parentOrder && parentOrder.items) {
                                        // Sum up all items in the ENTIRE order that match this product (SKU or Name)
                                        orderTotalQty = parentOrder.items
                                            .filter((oi: any) => {
                                                if (item.productId) return oi.productId === item.productId;
                                                return oi.productName === item.productName;
                                            })
                                            .reduce((sum: number, oi: any) => sum + oi.quantity, 0);
                                    }

                                    const displayRatio = `${item.quantity} / ${orderTotalQty}`;

                                    // Description Construction (Model / Color)
                                    let desc = item.productName || 'Item';
                                    if (item.product?.model) desc = item.product.model;
                                    if (item.product?.color_grade) desc += ` - ${item.product.color_grade}`;

                                    return (
                                        <tr key={idx} className="border-b border-gray-200 hover:bg-slate-50">
                                            <td className="py-2 px-4 text-center border-r border-gray-200 align-top font-bold text-[#0D3B4C]">
                                                {item.quantity}
                                            </td>
                                            <td className="py-2 px-4 text-left border-r border-gray-200 align-top uppercase text-gray-800 font-semibold">
                                                {desc}
                                            </td>
                                            <td className="py-2 px-4 text-center border-r border-gray-200 align-top text-gray-700 font-mono font-bold">
                                                {item.orderNumber ? item.orderNumber : '-'}
                                            </td>
                                            <td className="py-2 px-4 text-center border-gray-200 align-top font-black text-[#0D3B4C] text-base">
                                                {displayRatio}
                                            </td>
                                        </tr>
                                    );
                                })
                            ) : (
                                <tr>
                                    <td colSpan={4} className="py-8 text-center text-gray-500 italic">No items listed in orders.</td>
                                </tr>
                            )}
                            {/* Spacer Rows */}
                            {[...Array(Math.max(0, 10 - shipmentItems.length))].map((_, i) => (
                                <tr key={`empty-${i}`} className="border-b border-gray-100 h-8">
                                    <td className="border-r border-gray-100"></td>
                                    <td className="border-r border-gray-100"></td>
                                    <td className="border-r border-gray-100"></td>
                                    <td></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {/* Footer / Totals Section */}
                <div className="mt-8 flex justify-end">
                    <div className="w-1/2 rounded border border-[#0D3B4C] overflow-hidden shadow-sm">
                        <div className="bg-[#0D3B4C] text-white px-3 py-1.5 font-bold text-center text-sm uppercase">
                            SHIPPING SUMMARY
                        </div>
                        <div className="p-4 space-y-3 bg-white">
                            <div className="flex justify-between items-center text-lg border-b border-gray-200 pb-2">
                                <span className="font-bold text-gray-700">TOTAL WEIGHT (KG)</span>
                                <span className="font-bold text-[#0D3B4C]">{shipment.weight_cli ? shipment.weight_cli.toFixed(2) : '0.00'} kg</span>
                            </div>
                            <div className="flex justify-between items-center text-xl bg-orange-50 p-2 rounded border border-[#F4AB3D]/20">
                                <span className="font-bold text-[#0D3B4C]">SHIPPING COST</span>
                                <span className="font-bold text-[#0D3B4C]">
                                    USD {new Intl.NumberFormat('en-US', { minimumFractionDigits: 2 }).format(shipment.price_total || 0)}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Remarks */}
                {shipment.notes && (
                    <div className="mt-8">
                        <span className="font-bold text-sm block mb-1 text-[#0D3B4C]">REMARKS / OBSERVACIONES:</span>
                        <div className="border border-gray-300 p-2 text-sm text-gray-600 min-h-[60px] bg-slate-50 rounded-sm italic">
                            {shipment.notes}
                        </div>
                    </div>
                )}

                <div className="text-center text-xs text-gray-400 mt-12 italic print:mt-16 border-t pt-4">
                    <p>ESWCARGO | 9600 NW 38th OF 208, Doral, 33172 - Florida USA | LOGISTICS & SOLUTIONS</p>

                    <div className="flex justify-center items-center gap-4 mt-2 print:hidden">
                        <a href="https://eswcargo.com/" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:text-[#0D3B4C]">
                            <Globe className="h-3 w-3" /> eswcargo.com
                        </a>
                        <a href="https://www.instagram.com/eswcargo/" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:text-[#0D3B4C]">
                            <Instagram className="h-3 w-3" /> @eswcargo
                        </a>
                        <a href="https://www.facebook.com/ESWCargo" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:text-[#0D3B4C]">
                            <Facebook className="h-3 w-3" /> ESWCargo
                        </a>
                    </div>
                    {/* Print version of links (just text) */}
                    <div className="hidden print:flex justify-center gap-4 mt-1 text-[10px]">
                        <span>eswcargo.com</span>
                        <span>instagram.com/eswcargo</span>
                        <span>facebook.com/ESWCargo</span>
                    </div>
                </div>
            </div>
        </div>
    );
}
