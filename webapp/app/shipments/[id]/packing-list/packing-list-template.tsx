'use client';

import { Button } from '../../../../components/ui/button';
import { Printer, Package, Globe, Instagram, Facebook, Mail, Loader2, Download } from 'lucide-react';
import { savePackingListPdfToDrive, sendPackingListEmail } from '../../../email-actions';
import { useEffect, useTransition } from 'react';
import { buildShipmentItems, getShipmentCargoDescription } from '../../../../lib/shipment-items';
import { getPackingDocumentNumber, getPackingSubtotal, isSharedShipmentPacking } from '../../../../lib/packing-segments';
import { toInvNumber4 } from '../../../../lib/inv-filename';
import { PACKING_LIST_TYPOGRAPHY } from '../../../../lib/packing-list-typography';

/* eslint-disable @next/next/no-img-element */

interface PackingListTemplateProps {
    shipment: any;
}

export default function PackingListTemplate({ shipment }: PackingListTemplateProps) {
    const [isSending, startTransition] = useTransition();
    const [isSaving, startSaveTransition] = useTransition();
    const invNumber = toInvNumber4(shipment?.invoice, shipment?.shipment_number || shipment?.id);
    const isSharedShipment = isSharedShipmentPacking(shipment);
    const packingSubtotal = getPackingSubtotal(shipment);
    const packingDocumentNumber = getPackingDocumentNumber(shipment);
    const invBaseName = isSharedShipment ? `PL ${packingDocumentNumber}` : `INV ${invNumber}`;
    const invFileName = `${invBaseName}.pdf`;

    useEffect(() => {
        const previousTitle = document.title;
        document.title = invFileName.replace(/\.pdf$/i, '');
        return () => {
            document.title = previousTitle;
        };
    }, [invFileName]);

    const handleSendEmail = () => {
        const defaultEmail = shipment.client?.email || '';
        if (!defaultEmail) {
            alert('El cliente seleccionado no tiene un email confirmado.');
            return;
        }

        startTransition(async () => {
                const result = await sendPackingListEmail(shipment.id, defaultEmail, shipment.packingSegment?.clientId);
            if (result.success) {
                alert('Email enviado correctamente!');
            } else {
                alert('Error al enviar email: ' + result.message);
            }
        });
    };

    const handleSaveDrive = () => {
        startSaveTransition(async () => {
            const result = await savePackingListPdfToDrive(shipment.id, shipment.packingSegment?.clientId);
            if (result.success) {
                alert(`PDF guardado: ${result.fileName}`);
            } else {
                alert('Error al guardar PDF: ' + result.message);
            }
        });
    };

    const handlePrint = () => {
        if (!hasConfirmedContent) return;
        const previousTitle = document.title;
        document.title = invBaseName;

        requestAnimationFrame(() => {
            try {
                window.print();
            } finally {
                setTimeout(() => {
                    document.title = previousTitle;
                }, 250);
            }
        });
    };

    // Basic date formatting
    const dateShipped = shipment.date_shipped
        ? new Date(shipment.date_shipped).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })
        : '-';

    const shipmentItems = buildShipmentItems(shipment);
    const cargoDescription = getShipmentCargoDescription(shipment);
    const hasConfirmedContent = shipmentItems.length > 0 || Boolean(cargoDescription);
    // Colors
    // Dark Blue: #0D3B4C
    // Teal: #72C4B7
    // Orange: #F4AB3D

    return (
        <div className="min-h-screen bg-white text-black p-8 font-sans print:p-0 print:m-0">
            <style jsx global>{`
                #packing-list-content {
                    --packing-brand-size: ${PACKING_LIST_TYPOGRAPHY.ui.brandPx}px;
                    --packing-brand-meta-size: ${PACKING_LIST_TYPOGRAPHY.ui.brandMetaPx}px;
                    --packing-address-size: ${PACKING_LIST_TYPOGRAPHY.ui.addressPx}px;
                    --packing-document-title-size: ${PACKING_LIST_TYPOGRAPHY.ui.documentTitlePx}px;
                    --packing-document-number-size: ${PACKING_LIST_TYPOGRAPHY.ui.documentNumberPx}px;
                    --packing-segment-notice-size: ${PACKING_LIST_TYPOGRAPHY.ui.segmentNoticePx}px;
                    --packing-section-title-size: ${PACKING_LIST_TYPOGRAPHY.ui.sectionTitlePx}px;
                    --packing-detail-size: ${PACKING_LIST_TYPOGRAPHY.ui.detailPx}px;
                    --packing-content-title-size: ${PACKING_LIST_TYPOGRAPHY.ui.contentTitlePx}px;
                    --packing-item-header-size: ${PACKING_LIST_TYPOGRAPHY.ui.itemHeaderPx}px;
                    --packing-item-detail-size: ${PACKING_LIST_TYPOGRAPHY.ui.itemDetailPx}px;
                    --packing-item-ratio-size: ${PACKING_LIST_TYPOGRAPHY.ui.itemRatioPx}px;
                    --packing-summary-title-size: ${PACKING_LIST_TYPOGRAPHY.ui.summaryTitlePx}px;
                    --packing-summary-weight-size: ${PACKING_LIST_TYPOGRAPHY.ui.summaryWeightPx}px;
                    --packing-summary-amount-size: ${PACKING_LIST_TYPOGRAPHY.ui.summaryAmountPx}px;
                    --packing-remarks-title-size: ${PACKING_LIST_TYPOGRAPHY.ui.remarksTitlePx}px;
                    --packing-remarks-copy-size: ${PACKING_LIST_TYPOGRAPHY.ui.remarksCopyPx}px;
                    --packing-footer-size: ${PACKING_LIST_TYPOGRAPHY.ui.footerPx}px;
                    --packing-footer-links-size: ${PACKING_LIST_TYPOGRAPHY.ui.footerLinksPx}px;
                }
                #packing-list-content .packing-brand { font-size: var(--packing-brand-size); }
                #packing-list-content .packing-brand-meta { font-size: var(--packing-brand-meta-size); }
                #packing-list-content .packing-address { font-size: var(--packing-address-size); }
                #packing-list-content .packing-document-title { font-size: var(--packing-document-title-size); }
                #packing-list-content .packing-document-number { font-size: var(--packing-document-number-size); }
                #packing-list-content .packing-segment-notice { font-size: var(--packing-segment-notice-size); }
                #packing-list-content .packing-section-title { font-size: var(--packing-section-title-size); }
                #packing-list-content .packing-detail { font-size: var(--packing-detail-size); }
                #packing-list-content .packing-content-title { font-size: var(--packing-content-title-size); }
                #packing-list-content .packing-item-header { font-size: var(--packing-item-header-size); }
                #packing-list-content .packing-item-detail { font-size: var(--packing-item-detail-size); }
                #packing-list-content .packing-item-ratio { font-size: var(--packing-item-ratio-size); }
                #packing-list-content .packing-summary-title { font-size: var(--packing-summary-title-size); }
                #packing-list-content .packing-summary-weight { font-size: var(--packing-summary-weight-size); }
                #packing-list-content .packing-summary-amount { font-size: var(--packing-summary-amount-size); }
                #packing-list-content .packing-remarks-title { font-size: var(--packing-remarks-title-size); }
                #packing-list-content .packing-remarks-copy { font-size: var(--packing-remarks-copy-size); }
                #packing-list-content .packing-footer { font-size: var(--packing-footer-size); }
                #packing-list-content .packing-footer-links { font-size: var(--packing-footer-links-size); }
                @media print {
                    @page {
                        margin: 0.2cm;
                        size: Letter;
                    }
                    html, body {
                        width: 8.5in;
                        min-height: 11in;
                        margin: 0 !important;
                        padding: 0 !important;
                    }
                    .print-container {
                        width: 100%;
                        height: 10.84in;
                        display: flex;
                        flex-direction: column;
                        padding: 0;
                        margin: 0 auto;
                    }
                    .packing-bottom {
                        margin-top: auto;
                        page-break-inside: avoid;
                    }
                    /* Forzar colores de fondo y bordes */
                    * {
                        -webkit-print-color-adjust: exact !important;
                        print-color-adjust: exact !important;
                        color-adjust: exact !important;
                    }
                    .page-break-inside-avoid {
                        page-break-inside: avoid;
                    }
                    #packing-list-content {
                        --packing-brand-meta-size: ${PACKING_LIST_TYPOGRAPHY.browserPrint.brandMetaPx}px;
                        --packing-document-title-size: ${PACKING_LIST_TYPOGRAPHY.browserPrint.documentTitlePx}px;
                        --packing-document-number-size: ${PACKING_LIST_TYPOGRAPHY.browserPrint.documentNumberPx}px;
                        --packing-remarks-title-size: ${PACKING_LIST_TYPOGRAPHY.browserPrint.remarksTitlePx}px;
                    }
                }
            `}</style>

            {/* Print Controls */}
            <div className="max-w-[850px] mx-auto mb-8 flex flex-col items-end gap-2 print:hidden">
                <div className="flex gap-4">
                    <Button
                        onClick={handleSaveDrive}
                        disabled={isSaving || !hasConfirmedContent}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white"
                    >
                        {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                        Guardar PDF
                    </Button>
                    <Button
                        onClick={handleSendEmail}
                        disabled={isSending || !hasConfirmedContent}
                        className={`${shipment.email_sent_at ? 'bg-gray-100 text-gray-800 hover:bg-gray-200 border border-gray-300' : 'bg-[#72C4B7] hover:bg-[#5aa89c] text-white'}`}
                    >
                        {isSending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mail className="mr-2 h-4 w-4" />}
                        {shipment.email_sent_at ? 'Reenviar Email' : 'Enviar Email'}
                    </Button>
                    <Button onClick={handlePrint} disabled={!hasConfirmedContent} className="bg-[#0D3B4C] hover:bg-[#082a36] text-white">
                        <Printer className="mr-2 h-4 w-4" /> Imprimir / Guardar PDF
                    </Button>
                </div>
                {shipment.email_sent_at && !isSharedShipment && (
                    <p className="text-xs text-green-600 font-medium flex items-center">
                        <span className="mr-1">✓</span>
                        Email enviado el {new Date(shipment.email_sent_at).toLocaleDateString()} a las {new Date(shipment.email_sent_at).toLocaleTimeString()}
                    </p>
                )}
                {!hasConfirmedContent && (
                    <p className="text-xs text-red-600 font-medium">Packing bloqueado: falta contenido confirmado.</p>
                )}
            </div>

            {/* A4 Container */}
            <div id="packing-list-content" className="max-w-[850px] mx-auto bg-white print:w-full print:max-w-none print-container">

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
                            <h1 className="packing-brand font-black italic tracking-tighter text-[#0D3B4C] leading-none font-sans">
                                ESW
                            </h1>
                            {/* CARGO Text */}
                            <h2 className="packing-brand-meta font-bold tracking-[0.2em] text-[#72C4B7] uppercase leading-none mt-0">
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
                    <div className="packing-address hidden sm:block text-[#0D3B4C] font-semibold mt-8 text-center">
                        <p>9600 NW 38th OF 208</p>
                        <p>DORAL, FL 33172</p>
                        <p>FLORIDA USA</p>
                        <p>INFO@ESWCARGO.COM</p>
                    </div>

                    {/* Right: Document Label */}
                    <div className="text-right">
                        <h2 className="packing-document-title text-[#0D3B4C] font-bold uppercase tracking-wide mb-1">PACKING LIST</h2>
                        <div className="inline-block bg-[#F4AB3D] text-[#0D3B4C] px-3 py-1 rounded-sm shadow-sm">
                            <p className="packing-document-number font-bold tracking-wider">ENVÍO #{packingDocumentNumber}</p>
                        </div>
                    </div>
                </div>

                {isSharedShipment && <p className="packing-segment-notice mb-4 border border-amber-300 bg-amber-50 px-3 py-2 font-medium text-amber-900 print:hidden">Packing segmentado por cliente. El subtotal mostrado corresponde exclusivamente a este cliente.</p>}

                {/* Info Grid */}
                <div className="grid grid-cols-2 gap-8 mb-4 print:mb-2 border-t-2 border-[#0D3B4C] pt-4 print:pt-2">
                    {/* Consignee */}
                    <div>
                        <div className="packing-section-title bg-[#0D3B4C] text-white px-3 py-1.5 font-bold uppercase mb-2 rounded-sm shadow-sm">
                            CONSIGNEE / CLIENT
                        </div>
                        <div className="packing-detail space-y-1 px-2 font-medium text-gray-800">
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
                        <div className="packing-section-title bg-[#0D3B4C] text-white px-3 py-1.5 font-bold uppercase mb-2 rounded-sm shadow-sm">
                            SHIPMENT DETAILS
                        </div>
                        <div className="packing-detail space-y-1 px-2 font-medium text-gray-800">
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
                    <div className="packing-content-title bg-[#0D3B4C] text-white px-3 py-1 font-bold uppercase mb-0 rounded-t-sm">
                        CONTENT DESCRIPTION
                    </div>
                    <table className="packing-item-detail w-full border-collapse border border-gray-200 shadow-sm">
                        <thead className="packing-item-header">
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
                                            <td className="packing-item-ratio py-2 px-4 text-center border-gray-200 align-top font-black text-[#0D3B4C]">
                                                {displayRatio}
                                            </td>
                                        </tr>
                                    );
                                })
                            ) : cargoDescription ? (
                                <tr>
                                    <td colSpan={4} className="py-5 px-4 text-left text-gray-800 font-semibold uppercase">
                                        {cargoDescription}
                                    </td>
                                </tr>
                            ) : (
                                <tr>
                                    <td colSpan={4} className="py-8 text-center text-gray-500 italic">No items listed in orders.</td>
                                </tr>
                            )}
                            {/* Spacer Rows - Dynamic and smaller */}
                            {[...Array(Math.max(0, (shipmentItems.length > 15 ? 0 : 8 - shipmentItems.length)))].map((_, i) => (
                                <tr key={`empty-${i}`} className="border-b border-gray-100 h-6 print:h-4">
                                    <td className="border-r border-gray-100"></td>
                                    <td className="border-r border-gray-100"></td>
                                    <td className="border-r border-gray-100"></td>
                                    <td></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                <div className="packing-bottom">
                {/* Footer / Totals Section */}
                <div className="mt-4 print:mt-2 flex justify-end">
                    <div className="w-1/2 rounded border border-[#0D3B4C] overflow-hidden shadow-sm">
                        <div className="packing-summary-title bg-[#0D3B4C] text-white px-3 py-1 font-bold text-center uppercase">
                            SHIPPING SUMMARY
                        </div>
                        <div className="p-3 print:p-2 space-y-2 bg-white">
                            {!isSharedShipment && (
                                <div className="packing-summary-weight flex justify-between items-center border-b border-gray-200 pb-1">
                                    <span className="font-bold text-gray-700">TOTAL WEIGHT</span>
                                    <span className="font-bold text-[#0D3B4C]">{shipment.weight_cli ? shipment.weight_cli.toFixed(2) : '0.00'} kg</span>
                                </div>
                            )}
                            <div className="packing-summary-amount flex justify-between items-center bg-orange-50 p-1.5 rounded border border-[#F4AB3D]/20">
                                <span className="font-bold text-[#0D3B4C]">{isSharedShipment ? 'SUBTOTAL A PAGAR' : 'TOTAL DUE'}</span>
                                <span className="font-bold text-[#0D3B4C]">
                                    USD {new Intl.NumberFormat('en-US', { minimumFractionDigits: 2 }).format(packingSubtotal || 0)}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Remarks */}
                {shipment.notes && (
                    <div className="mt-4 print:mt-1 page-break-inside-avoid">
                        <span className="packing-remarks-title font-bold block mb-1 text-[#0D3B4C]">REMARKS / OBSERVACIONES:</span>
                        <div className="packing-remarks-copy border border-gray-300 p-2 text-gray-600 min-h-[40px] print:min-h-0 bg-slate-50 rounded-sm italic">
                            {shipment.notes}
                        </div>
                    </div>
                )}

                <div className="packing-footer text-center text-gray-400 mt-12 italic print:mt-16 border-t pt-4">
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
                    <div className="packing-footer-links hidden print:flex justify-center gap-4 mt-1">
                        <span>eswcargo.com</span>
                        <span>instagram.com/eswcargo</span>
                        <span>facebook.com/ESWCargo</span>
                    </div>
                </div>
                </div>
            </div>
        </div>
    );
}
