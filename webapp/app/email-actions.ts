
'use server'

import { sendEmail } from '@/lib/email';
import { prisma } from '@/lib/prisma';
import { generatePdfFromHtml } from '@/lib/pdf-generator';
import { requireAdminUser } from '@/lib/access';
import { savePdfToDriveFolder } from '@/lib/document-storage';
import { getInvoicePdfFileName, getPackingPdfFileName } from '@/lib/document-filenames';
import { buildShipmentItems, getShipmentCargoDescription } from '@/lib/shipment-items';
import { canUseSegmentedPackingForShipmentBlock, getOrderSourceDocumentBlock, getSourceDocumentBlock, sourceBlockMessage } from '@/lib/source-document-guard';
import { getPackingDocumentNumber, getPackingSegmentIssue, getPackingSegments, getPackingSubtotal, projectShipmentForPacking } from '@/lib/packing-segments';
import { getShipmentClientCharge } from '@/lib/shipment-client-charge';
import { isCancelledOrderItem } from '@/lib/order-totals';
import { INVOICE_TYPOGRAPHY } from '@/lib/invoice-typography';
import { PACKING_LIST_TYPOGRAPHY } from '@/lib/packing-list-typography';

type PackingListDocument = {
    shipment: any;
    htmlBody: string;
    pdfBuffer: Uint8Array;
    fileName: string;
};

type InvoiceDocument = {
    order: any;
    htmlBody: string;
    pdfBuffer: Uint8Array;
    fileName: string;
};

function formatBusinessDate(value: Date | string) {
    return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC' }).format(new Date(value));
}

function escapeHtml(value: unknown) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function assertInvoiceIsReady(order: { items: Array<{ quantity: number; unit_price: number }>; total_amount: number | null }) {
    if (!order.items.length) {
        throw new Error('No se puede emitir el invoice: el pedido no tiene productos confirmados.');
    }

    const total = Number(order.total_amount || 0);
    if (!Number.isFinite(total) || total <= 0) {
        throw new Error('No se puede emitir el invoice: el total del pedido debe ser mayor a USD 0.');
    }
}

async function trySavePdfToDriveFolder(pdfBuffer: Uint8Array, fileName: string) {
    try {
        const savedPath = await savePdfToDriveFolder(pdfBuffer, fileName);
        return { success: true, savedPath };
    } catch (error: any) {
        console.error('PDF save warning (email flow continues):', {
            fileName,
            message: error?.message || 'Error desconocido al guardar PDF'
        });
        return {
            success: false,
            message: error?.message || 'No se pudo guardar copia local del PDF.'
        };
    }
}

export async function buildPackingListDocument(shipmentId: number, packingClientId?: number): Promise<PackingListDocument> {
    const shipment = await prisma.shipment.findUnique({
        where: { id: shipmentId },
        include: {
            client: true,
            items: { include: { product: true, order: { include: { client: true } } } },
            orders: {
                include: {
                    client: true,
                    items: { include: { product: true } }
                }
            }
        }
    });

    if (!shipment) {
        throw new Error('Envío no encontrado.');
    }

    const packingIssue = getPackingSegmentIssue(shipment);
    if (packingIssue) throw new Error(packingIssue);

    const segments = getPackingSegments(shipment);
    if (segments.length > 1 && !Number.isInteger(packingClientId)) {
        throw new Error('Este envío tiene más de un cliente. Seleccioná el cliente antes de emitir el Packing List.');
    }
    const segment = segments.find((item) => item.clientId === packingClientId) || (segments.length === 1 ? segments[0] : null);
    if (!segment) throw new Error('El cliente seleccionado no tiene artículos confirmados en este envío.');
    const projectedShipment = projectShipmentForPacking(shipment, segment, segments.length);
    const shipmentNumber = shipment.shipment_number || shipment.id;
    const clientCharge = projectedShipment.packingSegment.isSharedShipment
        ? await getShipmentClientCharge(shipmentNumber, segment.clientId)
        : null;
    const documentShipment = {
        ...projectedShipment,
        packingSegment: {
            ...projectedShipment.packingSegment,
            clientChargeSubtotal: clientCharge?.amount ?? null,
            clientChargeReference: clientCharge?.reference ?? null,
        },
    };
    if (documentShipment.packingSegment.isSharedShipment && !clientCharge) {
        throw new Error(`Falta confirmar el subtotal del envío #${shipmentNumber} para ${segment.client.name}.`);
    }
    const packingSubtotal = getPackingSubtotal(documentShipment);
    const packingDocumentNumber = getPackingDocumentNumber(documentShipment);

    const shipmentSourceBlock = await getSourceDocumentBlock('SHIPMENT', shipment.shipment_number);
    const orderSourceBlock = await getOrderSourceDocumentBlock([
        ...documentShipment.orders.map((order: any) => order.order_number),
        ...documentShipment.items.map((item: any) => item.order?.order_number),
    ]);
    const sourceBlock = (!canUseSegmentedPackingForShipmentBlock(shipmentSourceBlock, documentShipment.packingSegment.isSharedShipment)
        ? shipmentSourceBlock
        : null) || (orderSourceBlock ? orderSourceBlock.reason : null);
    if (sourceBlock) {
        throw new Error(sourceBlockMessage(sourceBlock));
    }

    const shipmentItems = buildShipmentItems(documentShipment);
    const cargoDescription = getShipmentCargoDescription(documentShipment);

    if (shipmentItems.length === 0 && !cargoDescription) {
        throw new Error('No se puede emitir el packing: faltan artículos o una descripción operativa confirmada.');
    }

    let itemsHtml = '';
    let totalPcs = 0;
    shipmentItems.forEach(item => {
        totalPcs += item.quantity;
        itemsHtml += `
                <tr>
                    <td class="packing-item-detail" style="padding: 10px; border-bottom: 1px solid #eee; text-align: center; font-weight: bold; color: #0D3B4C;">${item.quantity}</td>
                    <td class="packing-item-detail" style="padding: 10px; border-bottom: 1px solid #eee; font-weight: 500;">${item.productName}</td>
                    <td class="packing-item-color" style="padding: 10px; border-bottom: 1px solid #eee; text-align: center; color: #666; text-transform: uppercase;">${item.product?.color_grade || '-'}</td>
                    <td class="packing-item-detail" style="padding: 10px; border-bottom: 1px solid #eee; text-align: center; font-weight: bold; color: #F4AB3D;">#${item.order?.order_number || '-'}</td>
                </tr>
             `;
    });

    if (shipmentItems.length === 0) {
        totalPcs = documentShipment.item_count || 0;
        itemsHtml += `
                <tr>
                    <td colspan="4" class="packing-item-detail" style="padding: 12px; border-bottom: 1px solid #eee; font-weight: 600; text-transform: uppercase;">${cargoDescription}</td>
                </tr>
             `;
    }

    itemsHtml += `
            <tr style="background-color: #f9f9f9; border-top: 2px solid #0D3B4C;">
                <td class="packing-total-pcs" style="padding: 12px; text-align: center; font-weight: 900; color: #0D3B4C;">${totalPcs}</td>
                <td colspan="2" class="packing-total-label" style="padding: 12px; text-align: right; font-weight: 900; color: #0D3B4C; text-transform: uppercase; letter-spacing: 1px;">Total PCs</td>
                <td></td>
            </tr>
        `;

    const htmlBody = `<!doctype html>
        <html>
        <head>
            <meta charset="utf-8">
            <style>
                @page { size: Letter; margin: 0; }
                :root {
                    --packing-brand-size: ${PACKING_LIST_TYPOGRAPHY.pdf.brandPx}px;
                    --packing-brand-meta-size: ${PACKING_LIST_TYPOGRAPHY.pdf.brandMetaPx}px;
                    --packing-document-title-size: ${PACKING_LIST_TYPOGRAPHY.pdf.documentTitlePx}px;
                    --packing-document-number-size: ${PACKING_LIST_TYPOGRAPHY.pdf.documentNumberPx}px;
                    --packing-metadata-size: ${PACKING_LIST_TYPOGRAPHY.pdf.metadataPx}px;
                    --packing-item-header-size: ${PACKING_LIST_TYPOGRAPHY.pdf.itemHeaderPx}px;
                    --packing-item-detail-size: ${PACKING_LIST_TYPOGRAPHY.pdf.itemDetailPx}px;
                    --packing-item-color-size: ${PACKING_LIST_TYPOGRAPHY.pdf.itemColorPx}px;
                    --packing-total-pcs-size: ${PACKING_LIST_TYPOGRAPHY.pdf.totalPcsPx}px;
                    --packing-total-label-size: ${PACKING_LIST_TYPOGRAPHY.pdf.totalLabelPx}px;
                    --packing-shipping-label-size: ${PACKING_LIST_TYPOGRAPHY.pdf.shippingLabelPx}px;
                    --packing-shipping-route-size: ${PACKING_LIST_TYPOGRAPHY.pdf.shippingRoutePx}px;
                    --packing-shipping-amount-size: ${PACKING_LIST_TYPOGRAPHY.pdf.shippingAmountPx}px;
                    --packing-footer-size: ${PACKING_LIST_TYPOGRAPHY.pdf.footerPx}px;
                }
                * { box-sizing: border-box; }
                html, body { width: 8.5in; min-height: 11in; margin: 0; padding: 0; background: #fff; }
                body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #333; font-size: var(--packing-item-detail-size); -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                .packing-page { width: 8.5in; height: 11in; padding: 0.38in 0.48in 0.32in; display: flex; flex-direction: column; background: #fff; }
                .packing-shell { width: 100%; max-width: 700px; flex: 1; min-height: 0; margin: 0 auto; display: flex; flex-direction: column; background: #fff; border: 1px solid #eee; }
                .packing-main { padding: 20px; flex: 1; min-height: 0; display: flex; flex-direction: column; }
                .packing-bottom { margin-top: auto; page-break-inside: avoid; }
                .packing-brand { font-size: var(--packing-brand-size); }
                .packing-brand-meta { font-size: var(--packing-brand-meta-size); }
                .packing-document-title { font-size: var(--packing-document-title-size); }
                .packing-document-number { font-size: var(--packing-document-number-size); }
                .packing-metadata { font-size: var(--packing-metadata-size); }
                .packing-item-header { font-size: var(--packing-item-header-size); }
                .packing-item-detail { font-size: var(--packing-item-detail-size); }
                .packing-item-color { font-size: var(--packing-item-color-size); }
                .packing-total-pcs { font-size: var(--packing-total-pcs-size); }
                .packing-total-label { font-size: var(--packing-total-label-size); }
                .packing-shipping-label { font-size: var(--packing-shipping-label-size); }
                .packing-shipping-route { font-size: var(--packing-shipping-route-size); }
                .packing-shipping-amount { font-size: var(--packing-shipping-amount-size); }
                .packing-footer { font-size: var(--packing-footer-size); }
            </style>
        </head>
        <body>
        <main class="packing-page">
            <div class="packing-shell">
                <!-- Header ESWCARGO -->
                <div style="background-color: #0D3B4C; padding: 20px; text-align: center; border-bottom: 5px solid #F4AB3D;">
                    <h1 class="packing-brand" style="color: #fff; margin: 0; letter-spacing: 2px; font-style: italic;">
                        ESW<span style="color: #72C4B7; font-style: normal; font-weight: 900;">CARGO</span>
                    </h1>
                    <p class="packing-brand-meta" style="color: #72C4B7; margin: 5px 0 0 0; font-weight: bold; text-transform: uppercase; letter-spacing: 3px;">International Logistics & Forwarding</p>
                </div>
                
                <div class="packing-main">
                    <table style="width: 100%; margin-bottom: 25px;">
                        <tr>
                            <td>
                                <h2 class="packing-document-title" style="color: #0D3B4C; margin: 0; text-transform: uppercase; font-weight: 900;">PACKING LIST</h2>
                                <p class="packing-document-number" style="font-weight: bold; color: #F4AB3D; margin: 5px 0 0 0;">SHIPMENT #${packingDocumentNumber}</p>
                            </td>
                            <td style="text-align: right; vertical-align: top;">
                                <p class="packing-metadata" style="margin: 0; color: #666;"><strong>FECHA:</strong> ${new Date().toLocaleDateString()}</p>
                                <p class="packing-metadata" style="margin: 5px 0 0 0; color: #666;"><strong>CLIENTE:</strong> ${documentShipment.client?.name || 'N/A'}</p>
                            </td>
                        </tr>
                    </table>
                    
                    <table style="width: 100%; border-collapse: collapse; background-color: #fff; border-radius: 8px; overflow: hidden;">
                        <thead>
                            <tr style="background-color: #0D3B4C; color: #fff; text-transform: uppercase;">
                                <th class="packing-item-header" style="padding: 12px;">QTY</th>
                                <th class="packing-item-header" style="padding: 12px; text-align: left;">DESCRIPTION</th>
                                <th class="packing-item-header" style="padding: 12px; text-align: center;">COLOR</th>
                                <th class="packing-item-header" style="padding: 12px; text-align: center;">INVOICE</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${itemsHtml || '<tr><td colspan="4" class="packing-item-detail" style="padding: 30px; text-align: center; color: #999;">No items found in this shipment</td></tr>'}
                        </tbody>
                    </table>
                    
                    <div class="packing-bottom">
                    <div style="padding: 20px; background-color: #f9f9f9; border-radius: 8px; border-left: 5px solid #0D3B4C;">
                        <table style="width: 100%;">
                            <tr>
                                <td>
                                    <p class="packing-shipping-label" style="margin: 0; color: #666; text-transform: uppercase; font-weight: bold;">Transporte Internacional</p>
                                    <p class="packing-shipping-route" style="margin: 5px 0 0 0; font-weight: bold; color: #0D3B4C;">MIAMI > BUENOS AIRES</p>
                                </td>
                                <td style="text-align: right;">
                                    <p class="packing-shipping-label" style="margin: 0; color: #666; text-transform: uppercase; font-weight: bold;">${documentShipment.packingSegment.isSharedShipment ? 'Subtotal a pagar' : 'Costo de Envío'}</p>
                                    <p class="packing-shipping-amount" style="margin: 5px 0 0 0; font-weight: 900; color: #0D3B4C;">
                                    USD ${packingSubtotal?.toFixed(2) || '0.00'}
                                    </p>
                                </td>
                            </tr>
                        </table>
                    </div>
                    
                    <div class="packing-footer" style="margin-top: 50px; color: #888; text-align: center; border-top: 1px solid #eee; padding-top: 25px;">
                        <p style="font-weight: bold; color: #0D3B4C; margin-bottom: 10px;">ESWCARGO | 9600 NW 38th OF 208, Doral, FL 33172</p>
                        <p>
                            <a href="https://eswcargo.com" style="color: #72C4B7; text-decoration: none; font-weight: bold;">eswcargo.com</a> | 
                            <a href="https://instagram.com/eswcargo" style="color: #72C4B7; text-decoration: none; font-weight: bold;">@eswcargo</a>
                        </p>
                        <p style="margin-top: 20px; font-style: italic; color: #aaa;">This is an automated shipping document. Please retain for your records.</p>
                    </div>
                    </div>
                </div>
            </div>
        </main>
        </body>
        </html>
        `;

    const pdfBuffer = await generatePdfFromHtml(htmlBody);
    const fileName = getPackingPdfFileName(
        shipment.shipment_number,
        shipment.id,
        documentShipment.client?.old_id,
        documentShipment.client?.id,
    );

    return {
        shipment: documentShipment,
        htmlBody,
        pdfBuffer,
        fileName
    };
}

export async function buildInvoiceDocument(orderId: number): Promise<InvoiceDocument> {
    const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: {
            items: {
                include: {
                    product: true
                }
            },
            client: true,
            shipment: true
        }
    });

    if (!order) {
        throw new Error('Pedido no encontrado.');
    }

    const sourceBlock = await getSourceDocumentBlock('ORDER', order.order_number);
    if (sourceBlock) {
        throw new Error(sourceBlockMessage(sourceBlock));
    }

    const invoiceItems = order.items.filter(item => !isCancelledOrderItem(item.status));
    assertInvoiceIsReady({ ...order, items: invoiceItems });

    const totalPcs = invoiceItems.reduce((sum, item) => sum + item.quantity, 0);
    const itemsHtml = invoiceItems.map((item, index) => `
        <tr class="${index % 2 ? 'alternate' : ''}">
            <td class="qty">${item.quantity}</td>
            <td class="description">${escapeHtml(item.productName)}</td>
            <td class="color">${escapeHtml((item as any).product?.color_grade || '-')}</td>
            <td class="money">USD ${new Intl.NumberFormat('en-US').format(item.unit_price)}</td>
            <td class="money strong">USD ${new Intl.NumberFormat('en-US').format(item.unit_price * item.quantity)}</td>
        </tr>
    `).join('');

    const clientCode = order.client.old_id || order.client.id;
    const shipmentWeight = Number(order.shipment?.weight_cli || 0);
    const weightLabel = shipmentWeight > 0
        ? `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(shipmentWeight)} KG`
        : '- KG';

    const htmlBody = `<!doctype html>
        <html>
            <head>
                <meta charset="utf-8">
                <style>
                    @page { size: Letter; margin: 0; }
                    :root {
                        --invoice-brand-size: ${INVOICE_TYPOGRAPHY.pdf.brandPx}px;
                        --invoice-brand-meta-size: ${INVOICE_TYPOGRAPHY.pdf.brandMetaPx}px;
                        --invoice-document-title-size: ${INVOICE_TYPOGRAPHY.pdf.documentTitlePx}px;
                        --invoice-document-number-size: ${INVOICE_TYPOGRAPHY.pdf.documentNumberPx}px;
                        --invoice-section-label-size: ${INVOICE_TYPOGRAPHY.pdf.sectionLabelPx}px;
                        --invoice-customer-name-size: ${INVOICE_TYPOGRAPHY.pdf.customerNamePx}px;
                        --invoice-customer-line-size: ${INVOICE_TYPOGRAPHY.pdf.customerLinePx}px;
                        --invoice-meta-row-size: ${INVOICE_TYPOGRAPHY.pdf.metaRowPx}px;
                        --invoice-item-header-size: ${INVOICE_TYPOGRAPHY.pdf.itemHeaderPx}px;
                        --invoice-item-detail-size: ${INVOICE_TYPOGRAPHY.pdf.itemDetailPx}px;
                        --invoice-item-color-size: ${INVOICE_TYPOGRAPHY.pdf.itemColorPx}px;
                        --invoice-total-pcs-size: ${INVOICE_TYPOGRAPHY.pdf.totalPcsPx}px;
                        --invoice-total-label-size: ${INVOICE_TYPOGRAPHY.pdf.totalLabelPx}px;
                        --invoice-bank-title-size: ${INVOICE_TYPOGRAPHY.pdf.bankTitlePx}px;
                        --invoice-bank-copy-size: ${INVOICE_TYPOGRAPHY.pdf.bankCopyPx}px;
                        --invoice-summary-row-size: ${INVOICE_TYPOGRAPHY.pdf.summaryRowPx}px;
                        --invoice-grand-total-label-size: ${INVOICE_TYPOGRAPHY.pdf.grandTotalLabelPx}px;
                        --invoice-grand-total-amount-size: ${INVOICE_TYPOGRAPHY.pdf.grandTotalAmountPx}px;
                        --invoice-currency-size: ${INVOICE_TYPOGRAPHY.pdf.currencyPx}px;
                        --invoice-legal-size: ${INVOICE_TYPOGRAPHY.pdf.legalPx}px;
                        --invoice-social-size: ${INVOICE_TYPOGRAPHY.pdf.socialPx}px;
                        --invoice-thanks-size: ${INVOICE_TYPOGRAPHY.pdf.thanksPx}px;
                    }
                    * { box-sizing: border-box; }
                    html, body { width: 8.5in; min-height: 11in; margin: 0; padding: 0; background: #fff; }
                    body { font-family: Arial, Helvetica, sans-serif; color: #263853; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                    .page { width: 8.5in; min-height: 11in; height: auto; padding: 0.38in 0.48in 0.32in; background: #fff; display: block; overflow: visible; }
                    .header { min-height: 1.12in; padding: 0.19in 0.26in; background: #103a89; color: #fff; display: flex; justify-content: space-between; align-items: flex-start; }
                    .brand { margin: 0; font-size: var(--invoice-brand-size); line-height: 1; letter-spacing: -0.5px; font-weight: 900; }
                    .brand-meta { margin-top: 7px; font-size: var(--invoice-brand-meta-size); line-height: 1.5; letter-spacing: 0.35px; font-weight: 700; }
                    .invoice-title { min-width: 2.32in; padding: 7px 12px; border: 1px solid rgba(255,255,255,.3); border-radius: 5px; text-align: center; font-size: var(--invoice-document-title-size); font-weight: 900; letter-spacing: 1.3px; }
                    .invoice-number { margin-top: 8px; text-align: right; font-size: var(--invoice-document-number-size); line-height: 1; font-weight: 900; letter-spacing: 1px; }
                    .main { min-height: 0; padding: 0.22in 0.21in 0; display: block; }
                    .meta-grid { display: grid; grid-template-columns: 1fr 2.25in; gap: 0.45in; margin-bottom: 0.18in; }
                    .section-label { width: 1.05in; padding-bottom: 5px; border-bottom: 1px solid #b8c5db; color: #103a89; font-size: var(--invoice-section-label-size); font-weight: 900; letter-spacing: 1px; text-transform: uppercase; }
                    .customer-name { margin-top: 9px; color: #273953; font-size: var(--invoice-customer-name-size); font-weight: 900; text-transform: uppercase; }
                    .customer-line { margin-top: 5px; color: #53657e; font-size: var(--invoice-customer-line-size); font-weight: 600; text-transform: uppercase; }
                    .invoice-meta .section-label { width: 100%; text-align: right; }
                    .meta-row { display: grid; grid-template-columns: 0.8in 1fr; margin-top: 8px; font-size: var(--invoice-meta-row-size); text-align: right; }
                    .meta-key { color: #64748b; font-weight: 800; }
                    .meta-value { color: #103a89; font-weight: 900; }
                    table.items { width: 100%; border-collapse: separate; border-spacing: 0; border: 1px solid #dbe3ef; border-radius: 5px; overflow: visible; }
                    .items thead { display: table-header-group; background: #103a89; color: #fff; }
                    .items tfoot { display: table-row-group; }
                    .items tr { break-inside: avoid; page-break-inside: avoid; }
                    .items th { height: 0.39in; padding: 7px 9px; border-right: 1px solid rgba(255,255,255,.18); font-size: var(--invoice-item-header-size); letter-spacing: 0.8px; text-transform: uppercase; }
                    .items th:nth-child(1) { width: 7%; }
                    .items th:nth-child(2) { width: 50%; text-align: left; }
                    .items th:nth-child(3) { width: 13%; }
                    .items th:nth-child(4) { width: 14%; text-align: right; }
                    .items th:nth-child(5) { width: 16%; text-align: right; }
                    .items td { min-height: 0.27in; padding: 7px 9px; border-right: 1px solid #dbe3ef; border-bottom: 1px solid #dbe3ef; font-size: var(--invoice-item-detail-size); }
                    .items tr.alternate td { background: #f6f8fb; }
                    .items .qty { color: #103a89; text-align: center; font-weight: 900; }
                    .items .description { font-weight: 600; }
                    .items .color { color: #64748b; text-align: center; font-size: var(--invoice-item-color-size); font-weight: 700; text-transform: uppercase; }
                    .items .money { text-align: right; white-space: nowrap; }
                    .items .strong { color: #263853; font-weight: 900; }
                    .items tfoot td { height: 0.36in; border-bottom: 0; background: #f6f8fb; }
                    .items tfoot .total-pcs { color: #103a89; font-size: var(--invoice-total-pcs-size); font-weight: 900; text-align: center; }
                    .items tfoot .total-label { color: #103a89; font-size: var(--invoice-total-label-size); font-weight: 900; text-align: right; text-transform: uppercase; letter-spacing: .8px; }
                    .document-bottom { margin-top: 0.18in; break-inside: avoid; page-break-inside: avoid; }
                    .summary-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.28in; page-break-inside: avoid; }
                    .bank { min-height: 1.48in; padding: 0.16in; border: 1px solid #e3e9f1; border-radius: 5px; background: #f8fafc; }
                    .bank h3 { margin: 0 0 8px; color: #103a89; font-size: var(--invoice-bank-title-size); letter-spacing: 1px; text-transform: uppercase; }
                    .bank p { margin: 0; font-size: var(--invoice-bank-copy-size); line-height: 1.45; }
                    .bank .crypto { margin-top: 8px; padding-top: 7px; border-top: 1px solid #cbd5e1; color: #103a89; font-weight: 900; }
                    .summary-row { display: flex; justify-content: space-between; padding: 0.12in 0.13in; border-radius: 4px; background: #f6f8fb; color: #64748b; font-size: var(--invoice-summary-row-size); font-weight: 900; text-transform: uppercase; }
                    .summary-row + .summary-row { margin-top: 6px; }
                    .summary-row .value { color: #263853; }
                    .grand-total { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 6px; padding: 0.12in 0.08in 0.09in; border-top: 2px solid #103a89; color: #103a89; font-size: var(--invoice-grand-total-label-size); font-weight: 900; text-transform: uppercase; }
                    .grand-total .amount { text-align: right; font-size: var(--invoice-grand-total-amount-size); line-height: .9; }
                    .grand-total .currency { display: block; margin-bottom: 4px; color: #64748b; font-size: var(--invoice-currency-size); }
                    .legal { margin-top: 0.11in; color: #94a3b8; font-size: var(--invoice-legal-size); line-height: 1.35; font-style: italic; }
                    .footer { margin-top: 0.16in; padding-top: 0.11in; border-top: 1px solid #e3e9f1; text-align: center; page-break-inside: avoid; }
                    .social { color: #54709f; font-size: var(--invoice-social-size); font-weight: 800; letter-spacing: .6px; word-spacing: 10px; }
                    .thanks { margin-top: 0.15in; color: #263853; font-size: var(--invoice-thanks-size); font-weight: 900; font-style: italic; text-transform: uppercase; }
                </style>
            </head>
            <body>
                <main class="page">
                    <header class="header">
                        <div>
                            <h1 class="brand">ELECTRO-SURWEB INC</h1>
                            <div class="brand-meta">9600 NW 38TH ST - OFICINA 208 - DORAL, FL 33178<br>PH: (786) 281-4922 | INFO@ELECTROSURWEB.COM</div>
                        </div>
                        <div>
                            <div class="invoice-title">INVOICE - FACTURA</div>
                            <div class="invoice-number">#${escapeHtml(order.order_number)}</div>
                        </div>
                    </header>
                    <section class="main">
                        <div class="meta-grid">
                            <div>
                                <div class="section-label">Customer</div>
                                <div class="customer-name">${escapeHtml(order.client.name)}</div>
                                <div class="customer-line">${escapeHtml(order.client.address || 'NO ADDRESS')}</div>
                                <div class="customer-line">${escapeHtml(order.client.city || 'MIAMI')}, ${escapeHtml(order.client.country || 'USA')}</div>
                                <div class="customer-line">CLIENT ID: ${escapeHtml(clientCode)}</div>
                            </div>
                            <div class="invoice-meta">
                                <div class="section-label">Invoice Meta</div>
                                <div class="meta-row"><span class="meta-key">DATE:</span><span class="meta-value">${formatBusinessDate(order.date)}</span></div>
                                <div class="meta-row"><span class="meta-key">TERMS:</span><span class="meta-value">USDT (USD)</span></div>
                            </div>
                        </div>
                        <table class="items">
                            <thead><tr><th>Qty</th><th>Full Description of Goods</th><th>Color</th><th>Unit Value</th><th>Total Value</th></tr></thead>
                            <tbody>${itemsHtml}</tbody>
                            <tfoot><tr><td class="total-pcs">${totalPcs}</td><td colspan="2" class="total-label">Total PCS</td><td colspan="2"></td></tr></tfoot>
                        </table>
                        <div class="document-bottom">
                            <div class="summary-grid">
                                <div>
                                    <div class="bank">
                                        <h3>Banking Instructions</h3>
                                        <p><strong>BENEFICIARY:</strong> ELECTRO-SURWEB INC<br><strong>BANK:</strong> TD BANK<br><strong>ACCOUNT:</strong> 4447209530<br><strong>ROUTING:</strong> 067014822<br><strong>ABA:</strong> 031101266<br><strong>SWIFT:</strong> NRTHUS33XXX</p>
                                        <p class="crypto">USDT / CRYPTO ACCEPTED</p>
                                    </div>
                                    <p class="legal">These commodities, technology or software, were exported from the United States in accordance with the Export Administration regulations. Diversion contrary to U.S. Law Prohibited.</p>
                                </div>
                                <div>
                                    <div class="summary-row"><span>Weight Total</span><span class="value">${weightLabel}</span></div>
                                    <div class="summary-row"><span>Items Count</span><span class="value">${invoiceItems.length} PCS</span></div>
                                    <div class="grand-total"><span>Total Invoice</span><span class="amount"><span class="currency">USD</span>${new Intl.NumberFormat('en-US').format(order.total_amount)}</span></div>
                                </div>
                            </div>
                            <footer class="footer">
                                <div class="social">◉ ELECTROSURWEB.COM　◎ @ESWTECH1　□ WHATSAPP　☆ @ESWTECH1</div>
                                <div class="thanks">Thank you for doing business with us!</div>
                            </footer>
                        </div>
                    </section>
                </main>
            </body>
        </html>`;

    const pdfBuffer = await generatePdfFromHtml(htmlBody);
    const fileName = getInvoicePdfFileName(order.order_number, order.id, order.client.old_id, order.client.id);

    return {
        order,
        htmlBody,
        pdfBuffer,
        fileName
    };
}

export async function sendPackingListEmail(shipmentId: number, targetEmail: string, packingClientId?: number) {
    await requireAdminUser();
    if (!targetEmail) {
        return { success: false, message: 'El email de destino es obligatorio.' };
    }

    try {
        const { shipment, htmlBody, pdfBuffer, fileName } = await buildPackingListDocument(shipmentId, packingClientId);
        const recipientEmail = shipment.client?.email?.trim();
        if (!recipientEmail || targetEmail.trim().toLowerCase() !== recipientEmail.toLowerCase()) {
            return { success: false, message: 'El Packing List sólo puede enviarse al email confirmado del cliente seleccionado.' };
        }
        const saveResult = await trySavePdfToDriveFolder(pdfBuffer, fileName);

        const result = await sendEmail(
            targetEmail,
            `PACKING LIST #${getPackingDocumentNumber(shipment)} - ESWCARGO`,
            htmlBody,
            [
                {
                    filename: fileName,
                    content: Buffer.from(pdfBuffer)
                }
            ]
        );

        if (!result.success && !saveResult.success) {
            return {
                success: false,
                message: `${result.message} | Además, falló guardado local: ${saveResult.message}`
            };
        }

        if (result.success && !shipment.packingSegment?.isSharedShipment) {
            await prisma.shipment.update({
                where: { id: shipmentId },
                data: { email_sent_at: new Date() }
            });

            if (!saveResult.success) {
                return {
                    success: true,
                    message: `Email enviado. Aviso: ${saveResult.message}`
                };
            }
        }

        return result;

    } catch (error: any) {
        console.error('Action Error:', error);
        return { success: false, message: error.message || 'Error desconocido en el servidor.' };
    }
}

export async function sendInvoiceEmail(orderId: number, targetEmail: string) {
    await requireAdminUser();
    if (!targetEmail) {
        return { success: false, message: 'El email de destino es obligatorio.' };
    }

    try {
        const { order, htmlBody, pdfBuffer, fileName } = await buildInvoiceDocument(orderId);
        const saveResult = await trySavePdfToDriveFolder(pdfBuffer, fileName);

        const result = await sendEmail(
            targetEmail,
            `INVOICE #${order.order_number} - Electro-Surweb Inc`,
            htmlBody,
            [
                {
                    filename: fileName,
                    content: Buffer.from(pdfBuffer)
                }
            ]
        );

        if (!result.success && !saveResult.success) {
            return {
                success: false,
                message: `${result.message} | Además, falló guardado local: ${saveResult.message}`
            };
        }

        if (result.success) {
            await prisma.order.update({
                where: { id: orderId },
                data: { email_sent_at: new Date() }
            });

            if (!saveResult.success) {
                return {
                    success: true,
                    message: `Email enviado. Aviso: ${saveResult.message}`
                };
            }
        }

        return result;

    } catch (error: any) {
        console.error('Action Error:', error);
        return { success: false, message: error.message || 'Error desconocido en el servidor.' };
    }
}

export async function saveInvoicePdfToDrive(orderId: number) {
    await requireAdminUser();

    try {
        const { fileName, pdfBuffer } = await buildInvoiceDocument(orderId);
        const savedPath = await savePdfToDriveFolder(pdfBuffer, fileName);
        return { success: true, fileName, savedPath };
    } catch (error: any) {
        console.error('Action Error:', error);
        return { success: false, message: error.message || 'No se pudo guardar el invoice.' };
    }
}

export async function savePackingListPdfToDrive(shipmentId: number, packingClientId?: number) {
    await requireAdminUser();

    try {
        const { fileName, pdfBuffer } = await buildPackingListDocument(shipmentId, packingClientId);
        const savedPath = await savePdfToDriveFolder(pdfBuffer, fileName);
        return { success: true, fileName, savedPath };
    } catch (error: any) {
        console.error('Action Error:', error);
        return { success: false, message: error.message || 'No se pudo guardar el packing list.' };
    }
}
