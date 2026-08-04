
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
                    <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: center; font-weight: bold; color: #0D3B4C;">${item.quantity}</td>
                    <td style="padding: 10px; border-bottom: 1px solid #eee; font-weight: 500;">${item.productName}</td>
                    <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: center; color: #666; font-size: 11px; text-transform: uppercase;">${item.product?.color_grade || '-'}</td>
                    <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: center; font-weight: bold; color: #F4AB3D;">#${item.order?.order_number || '-'}</td>
                </tr>
             `;
    });

    if (shipmentItems.length === 0) {
        totalPcs = documentShipment.item_count || 0;
        itemsHtml += `
                <tr>
                    <td colspan="4" style="padding: 12px; border-bottom: 1px solid #eee; font-weight: 600; text-transform: uppercase;">${cargoDescription}</td>
                </tr>
             `;
    }

    itemsHtml += `
            <tr style="background-color: #f9f9f9; border-top: 2px solid #0D3B4C;">
                <td style="padding: 12px; text-align: center; font-size: 16px; font-weight: 900; color: #0D3B4C;">${totalPcs}</td>
                <td colspan="2" style="padding: 12px; text-align: right; font-size: 11px; font-weight: 900; color: #0D3B4C; text-transform: uppercase; letter-spacing: 1px;">Total PCs</td>
                <td></td>
            </tr>
        `;

    const htmlBody = `
            <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; max-width: 700px; margin: 0 auto; color: #333; background-color: #fff; border: 1px solid #eee;">
                <!-- Header ESWCARGO -->
                <div style="background-color: #0D3B4C; padding: 20px; text-align: center; border-bottom: 5px solid #F4AB3D;">
                    <h1 style="color: #fff; margin: 0; font-size: 28px; letter-spacing: 2px; font-style: italic;">
                        ESW<span style="color: #72C4B7; font-style: normal; font-weight: 900;">CARGO</span>
                    </h1>
                    <p style="color: #72C4B7; margin: 5px 0 0 0; font-size: 11px; font-weight: bold; text-transform: uppercase; letter-spacing: 3px;">International Logistics & Forwarding</p>
                </div>
                
                <div style="padding: 20px;">
                    <table style="width: 100%; margin-bottom: 25px;">
                        <tr>
                            <td>
                                <h2 style="color: #0D3B4C; margin: 0; font-size: 24px; text-transform: uppercase; font-weight: 900;">PACKING LIST</h2>
                                <p style="font-size: 18px; font-weight: bold; color: #F4AB3D; margin: 5px 0 0 0;">SHIPMENT #${packingDocumentNumber}</p>
                            </td>
                            <td style="text-align: right; vertical-align: top;">
                                <p style="margin: 0; font-size: 13px; color: #666;"><strong>FECHA:</strong> ${new Date().toLocaleDateString()}</p>
                                <p style="margin: 5px 0 0 0; font-size: 13px; color: #666;"><strong>CLIENTE:</strong> ${documentShipment.client?.name || 'N/A'}</p>
                            </td>
                        </tr>
                    </table>
                    
                    <table style="width: 100%; border-collapse: collapse; background-color: #fff; border-radius: 8px; overflow: hidden;">
                        <thead>
                            <tr style="background-color: #0D3B4C; color: #fff; text-transform: uppercase;">
                                <th style="padding: 12px; font-size: 11px;">QTY</th>
                                <th style="padding: 12px; font-size: 11px; text-align: left;">DESCRIPTION</th>
                                <th style="padding: 12px; font-size: 11px; text-align: center;">COLOR</th>
                                <th style="padding: 12px; font-size: 11px; text-align: center;">INVOICE</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${itemsHtml || '<tr><td colspan="4" style="padding: 30px; text-align: center; color: #999;">No items found in this shipment</td></tr>'}
                        </tbody>
                    </table>
                    
                    <div style="margin-top: 30px; padding: 20px; background-color: #f9f9f9; border-radius: 8px; border-left: 5px solid #0D3B4C;">
                        <table style="width: 100%;">
                            <tr>
                                <td>
                                    <p style="margin: 0; font-size: 12px; color: #666; text-transform: uppercase; font-weight: bold;">Transporte Internacional</p>
                                    <p style="margin: 5px 0 0 0; font-size: 14px; font-weight: bold; color: #0D3B4C;">MIAMI > BUENOS AIRES</p>
                                </td>
                                <td style="text-align: right;">
                                    <p style="margin: 0; font-size: 12px; color: #666; text-transform: uppercase; font-weight: bold;">${documentShipment.packingSegment.isSharedShipment ? 'Subtotal a pagar' : 'Costo de Envío'}</p>
                                    <p style="margin: 5px 0 0 0; font-size: 22px; font-weight: 900; color: #0D3B4C;">
                                    USD ${packingSubtotal?.toFixed(2) || '0.00'}
                                    </p>
                                </td>
                            </tr>
                        </table>
                    </div>
                    
                    <div style="margin-top: 50px; font-size: 11px; color: #888; text-align: center; border-top: 1px solid #eee; padding-top: 25px;">
                        <p style="font-weight: bold; color: #0D3B4C; margin-bottom: 10px;">ESWCARGO | 9600 NW 38th OF 208, Doral, FL 33172</p>
                        <p>
                            <a href="https://eswcargo.com" style="color: #72C4B7; text-decoration: none; font-weight: bold;">eswcargo.com</a> | 
                            <a href="https://instagram.com/eswcargo" style="color: #72C4B7; text-decoration: none; font-weight: bold;">@eswcargo</a>
                        </p>
                        <p style="margin-top: 20px; font-style: italic; color: #aaa;">This is an automated shipping document. Please retain for your records.</p>
                    </div>
                </div>
            </div>
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

    assertInvoiceIsReady(order);

    let itemsHtml = '';
    let totalPcs = 0;
    order.items.filter(item => !isCancelledOrderItem(item.status)).forEach(item => {
        totalPcs += item.quantity;
        itemsHtml += `
                <tr>
                    <td style="padding: 5px 10px; border-bottom: 1px solid #eee; text-align: center;">${item.quantity}</td>
                    <td style="padding: 5px 10px; border-bottom: 1px solid #eee;">${item.productName}</td>
                    <td style="padding: 5px 10px; border-bottom: 1px solid #eee; text-align: center; color: #666; font-size: 11px;">${(item as any).product?.color_grade || '-'}</td>
                    <td style="padding: 5px 10px; border-bottom: 1px solid #eee; text-align: right;">USD ${item.unit_price.toFixed(0)}</td>
                    <td style="padding: 5px 10px; border-bottom: 1px solid #eee; text-align: right; font-weight: bold;">USD ${(item.unit_price * item.quantity).toFixed(0)}</td>
                </tr>
             `;
    });

    itemsHtml += `
            <tr style="background-color: #f9f9f9; border-top: 2px solid #103a89;">
                <td style="padding: 12px; text-align: center; font-size: 16px; font-weight: 900; color: #103a89;">${totalPcs}</td>
                <td colspan="2" style="padding: 12px; text-align: right; font-size: 11px; font-weight: 900; color: #103a89; text-transform: uppercase;">Total Units (PCs)</td>
                <td colspan="2"></td>
            </tr>
        `;

    const htmlBody = `
            <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; max-width: 700px; margin: 0 auto; color: #333; background-color: #fff; border: 1px solid #eee;">
                <!-- Header -->
                    <div style="background-color: #fff; padding: 12px 30px; border-bottom: 5px solid #103a89;">
                    <table style="width: 100%;">
                        <tr>
                            <td>
                                <h1 style="color: #103a89; margin: 0; font-size: 28px; text-transform: uppercase;">ELECTRO-SURWEB INC</h1>
                                <p style="font-size: 13px; color: #666; margin: 5px 0 0 0;">21180 MAINSAIL CIR B19, MIAMI, FL 33180</p>
                                <p style="font-size: 13px; color: #666; margin: 2px 0 0 0;">(786) 281-4922 | INFO@ELECTROSURWEB.COM</p>
                            </td>
                            <td style="text-align: right; vertical-align: top;">
                                <h2 style="color: #ffffff; background-color: #103a89; display: inline-block; padding: 5px 15px; border-radius: 5px; margin: 0; font-size: 20px; text-transform: uppercase; letter-spacing: 1px;">INVOICE - FACTURA</h2>
                                <p style="font-size: 32px; font-weight: 900; margin: 5px 0 0 0; color: #103a89;">#${order.order_number}</p>
                            </td>
                        </tr>
                    </table>
                </div>
                
                <!-- Info Section -->
                <div style="padding: 14px 30px;">
                    <table style="width: 100%; margin-bottom: 12px;">
                        <tr>
                            <td style="width: 50%; vertical-align: top;">
                                <div style="background-color: #103a89; color: #fff; padding: 5px 10px; font-weight: bold; font-size: 12px; margin-bottom: 10px;">CUSTOMER</div>
                                <p style="margin: 0; font-size: 15px; font-weight: bold; text-transform: uppercase;">${order.client.name}</p>
                                <p style="margin: 5px 0 0 0; font-size: 13px; color: #555;">${order.client.address || 'NO ADDRESS'}</p>
                                <p style="margin: 2px 0 0 0; font-size: 13px; color: #555;">${order.client.city || 'MIAMI'}, ${order.client.country || 'USA'}</p>
                            </td>
                            <td style="width: 50%; vertical-align: top; text-align: right;">
                                <table style="margin-left: auto; border-collapse: collapse;">
                                    <tr>
                                        <td style="padding: 5px; font-size: 13px; font-weight: bold; color: #103a89;">DATE:</td>
                                        <td style="padding: 5px; font-size: 13px;">${formatBusinessDate(order.date)}</td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 5px; font-size: 13px; font-weight: bold; color: #103a89;">CUSTOMER ID:</td>
                                        <td style="padding: 5px; font-size: 13px;">${order.client.old_id || order.client.id}</td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 5px; font-size: 13px; font-weight: bold; color: #103a89;">TERMS:</td>
                                        <td style="padding: 5px; font-size: 13px; font-weight: bold;">USDT (USD)</td>
                                    </tr>
                                </table>
                            </td>
                        </tr>
                    </table>
                
                    <!-- Items Table -->
                    <table style="width: 100%; border-collapse: collapse;">
                        <thead>
                            <tr style="background-color: #103a89; color: #fff; text-transform: uppercase;">
                                <th style="padding: 8px 12px; font-size: 11px;">QTY</th>
                                <th style="padding: 8px 12px; font-size: 11px; text-align: left;">DESCRIPTION</th>
                                <th style="padding: 8px 12px; font-size: 11px; text-align: center;">COLOR</th>
                                <th style="padding: 8px 12px; font-size: 11px; text-align: right;">UNIT VALUE</th>
                                <th style="padding: 8px 12px; font-size: 11px; text-align: right;">TOTAL VALUE</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${itemsHtml}
                        </tbody>
                        <tfoot>
                            <tr>
                                <td colspan="2"></td>
                                <td style="padding: 15px 10px; font-weight: 900; text-align: right; background-color: #103a89; color: #fff;">TOTAL INVOICE:</td>
                                <td style="padding: 15px 10px; font-weight: 900; text-align: right; font-size: 24px; background-color: #f9f9f9; color: #103a89; border-bottom: 3px solid #103a89;">
                                    USD ${new Intl.NumberFormat('en-US').format(order.total_amount)}
                                </td>
                            </tr>
                        </tfoot>
                    </table>
                    
                    <!-- Banking Section -->
                    <div style="margin-top: 12px; padding: 8px 20px; border: 1px solid #eee; background-color: #fcfcfc; page-break-inside: avoid;">
                        <h3 style="color: #103a89; margin: 0 0 8px 0; font-size: 13px; text-transform: uppercase; border-bottom: 1px solid #103a89; padding-bottom: 4px;">Payment Instructions</h3>
                        <div style="font-size: 11px; line-height: 1.2;">
                            <p style="margin: 0 0 6px 0;"><strong>Beneficiary:</strong> Electro-Surweb Inc<br><strong>Address:</strong> 21180 Mainsail Circle, B19, Aventura, FL 33180</p>
                            
                            <p style="margin: 0 0 6px 0;"><strong>Bank:</strong> MERCURY (Choice Financial Group)<br>
                               <strong>Account Number:</strong> 202557771823<br>
                               <strong>ABA / Routing:</strong> 09131122<br>
                               <strong>Bank Address:</strong> 4501 23rd Avenue S, Fargo, ND 58104</p>
                            
                            <div style="margin-top: 8px; padding-top: 6px; border-top: 1px dashed #ccc;">
                                <p style="margin: 0; font-weight: bold; color: #103a89;">ACEPTAMOS USDT - CONSULTAR WALLET</p>
                            </div>
                        </div>
                    </div>

                    <!-- Footer -->
                    <div style="margin-top: 8px; text-align: center; border-top: 1px solid #eee; padding-top: 6px; page-break-inside: avoid;">
                        <p style="font-size: 12px; font-weight: bold; color: #103a89; margin: 0 0 3px 0;">Thank you for doing business with us!</p>
                        <p style="font-size: 9px; color: #666; margin: 0 0 5px 0;">For questions, contact Diego Rodriguez: (786) 281-4922 | diego@electrosurweb.com</p>
                        
                        <div style="font-size: 9px; color: #103a89; font-weight: bold;">
                            electrosurweb.com | eswtech.net | WhatsApp | @eswtech1
                        </div>
                    </div>
                </div>
            </div>
        `;

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
