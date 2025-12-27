
'use server'

import { sendEmail } from '@/lib/email';
import { prisma } from '@/lib/prisma';
import { generatePdfFromHtml } from '@/lib/pdf-generator';

export async function sendPackingListEmail(shipmentId: number, targetEmail: string) {
    if (!targetEmail) {
        return { success: false, message: 'El email de destino es obligatorio.' };
    }

    try {
        const shipment = await prisma.shipment.findUnique({
            where: { id: shipmentId },
            include: { client: true }
        });

        if (!shipment) return { success: false, message: 'Envío no encontrado.' };

        // We need to fetch items to build the email body
        const orders = await prisma.order.findMany({
            where: { shipmentId: shipmentId },
            include: {
                items: {
                    include: {
                        product: true
                    }
                }
            }
        });

        // Simple HTML construction for Email

        let itemsHtml = '';
        let totalPcs = 0;
        orders.forEach(order => {
            order.items.forEach(item => {
                totalPcs += item.quantity;
                itemsHtml += `
                    <tr>
                        <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: center; font-weight: bold; color: #0D3B4C;">${item.quantity}</td>
                        <td style="padding: 10px; border-bottom: 1px solid #eee; font-weight: 500;">${item.productName}</td>
                        <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: center; color: #666; font-size: 11px; text-transform: uppercase;">${(item as any).product?.color_grade || '-'}</td>
                        <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: center; font-weight: bold; color: #F4AB3D;">#${order.order_number}</td>
                    </tr>
                 `;
            });
        });

        // Add Total Row for Packing List
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
                                <p style="font-size: 18px; font-weight: bold; color: #F4AB3D; margin: 5px 0 0 0;">SHIPMENT #${shipment.shipment_number}</p>
                            </td>
                            <td style="text-align: right; vertical-align: top;">
                                <p style="margin: 0; font-size: 13px; color: #666;"><strong>FECHA:</strong> ${new Date().toLocaleDateString()}</p>
                                <p style="margin: 5px 0 0 0; font-size: 13px; color: #666;"><strong>CLIENTE:</strong> ${shipment.client?.name || 'N/A'}</p>
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
                                    <p style="margin: 0; font-size: 12px; color: #666; text-transform: uppercase; font-weight: bold;">Costo de Envío</p>
                                    <p style="margin: 5px 0 0 0; font-size: 22px; font-weight: 900; color: #0D3B4C;">
                                        USD ${shipment.price_total ? shipment.price_total.toFixed(2) : '0.00'}
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

        // Generate PDF
        const pdfBuffer = await generatePdfFromHtml(htmlBody);

        const result = await sendEmail(
            targetEmail,
            `PACKING LIST #${shipment.shipment_number} - ESWCARGO`,
            htmlBody,
            [
                {
                    filename: `PackingList_${shipment.shipment_number}.pdf`,
                    content: pdfBuffer
                }
            ]
        );

        if (result.success) {
            await prisma.shipment.update({
                where: { id: shipmentId },
                data: { email_sent_at: new Date() }
            });
        }

        return result;

    } catch (error: any) {
        console.error('Action Error:', error);
        return { success: false, message: error.message || 'Error desconocido en el servidor.' };
    }
}

export async function sendInvoiceEmail(orderId: number, targetEmail: string) {
    if (!targetEmail) {
        return { success: false, message: 'El email de destino es obligatorio.' };
    }

    try {
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

        if (!order) return { success: false, message: 'Pedido no encontrado.' };

        // HTML Construction for Invoice (Premium Blue Theme)
        let itemsHtml = '';
        let totalPcs = 0;
        order.items.forEach(item => {
            totalPcs += item.quantity;
            itemsHtml += `
                <tr>
                    <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: center;">${item.quantity}</td>
                    <td style="padding: 10px; border-bottom: 1px solid #eee;">${item.productName}</td>
                    <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: center; color: #666; font-size: 11px;">${(item as any).product?.color_grade || '-'}</td>
                    <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: right;">USD ${item.unit_price.toFixed(0)}</td>
                    <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: right; font-weight: bold;">USD ${(item.unit_price * item.quantity).toFixed(0)}</td>
                </tr>
             `;
        });

        // Add Total Quantity row
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
                <div style="background-color: #fff; padding: 30px; border-bottom: 5px solid #103a89;">
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
                <div style="padding: 30px;">
                    <table style="width: 100%; margin-bottom: 30px;">
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
                                        <td style="padding: 5px; font-size: 13px;">${new Date(order.date).toLocaleDateString()}</td>
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
                                <th style="padding: 12px; font-size: 11px;">QTY</th>
                                <th style="padding: 12px; font-size: 11px; text-align: left;">DESCRIPTION</th>
                                <th style="padding: 12px; font-size: 11px; text-align: center;">COLOR</th>
                                <th style="padding: 12px; font-size: 11px; text-align: right;">UNIT VALUE</th>
                                <th style="padding: 12px; font-size: 11px; text-align: right;">TOTAL VALUE</th>
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
                    <div style="margin-top: 40px; padding: 20px; border: 1px solid #eee; background-color: #fcfcfc;">
                        <h3 style="color: #103a89; margin: 0 0 15px 0; font-size: 14px; text-transform: uppercase; border-bottom: 1px solid #103a89; padding-bottom: 5px;">Payment Instructions</h3>
                        <div style="font-size: 12px; line-height: 1.6;">
                            <p style="margin: 0 0 10px 0;"><strong>Beneficiary:</strong> Electro-Surweb Inc<br><strong>Address:</strong> 21180 Mainsail Circle, B19, Aventura, FL 33180</p>
                            
                            <p style="margin: 0 0 10px 0;"><strong>Bank:</strong> MERCURY (Choice Financial Group)<br>
                               <strong>Account Number:</strong> 202557771823<br>
                               <strong>ABA / Routing:</strong> 09131122<br>
                               <strong>Bank Address:</strong> 4501 23rd Avenue S, Fargo, ND 58104</p>
                            
                            <div style="margin-top: 15px; padding-top: 10px; border-top: 1px dashed #ccc;">
                                <p style="margin: 0; font-weight: bold; color: #103a89;">ACEPTAMOS USDT - CONSULTAR WALLET</p>
                            </div>
                        </div>
                    </div>

                    <!-- Footer -->
                    <div style="margin-top: 50px; text-align: center; border-top: 1px solid #eee; padding-top: 30px;">
                        <p style="font-size: 16px; font-weight: bold; color: #103a89; margin-bottom: 10px;">Thank you for doing business with us!</p>
                        <p style="font-size: 12px; color: #666; margin-bottom: 20px;">For questions, contact Diego Rodriguez: (786) 281-4922 | diego@electrosurweb.com</p>
                        
                        <div style="font-size: 11px; color: #103a89; font-weight: bold;">
                            electrosurweb.com | eswtech.net | WhatsApp | @eswtech1
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Generate PDF from this same HTML
        const pdfBuffer = await generatePdfFromHtml(htmlBody);

        const result = await sendEmail(
            targetEmail,
            `INVOICE #${order.order_number} - Electro-Surweb Inc`,
            htmlBody,
            [
                {
                    filename: `Invoice_${order.order_number}.pdf`,
                    content: pdfBuffer
                }
            ]
        );

        if (result.success) {
            await prisma.order.update({
                where: { id: orderId },
                data: { email_sent_at: new Date() }
            });
        }

        return result;

    } catch (error: any) {
        console.error('Action Error:', error);
        return { success: false, message: error.message || 'Error desconocido en el servidor.' };
    }
}
