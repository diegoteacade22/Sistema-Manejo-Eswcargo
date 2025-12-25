
'use server'

import { sendEmail } from '@/lib/email';
import { prisma } from '@/lib/prisma';

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
            include: { items: true }
        });

        // Simple HTML construction for Email

        let itemsHtml = '';
        orders.forEach(order => {
            order.items.forEach(item => {
                itemsHtml += `
                    <tr>
                        <td style="padding: 8px; border-bottom: 1px solid #ddd; text-align: center;">${item.quantity}</td>
                        <td style="padding: 8px; border-bottom: 1px solid #ddd;">${item.productName}</td>
                        <td style="padding: 8px; border-bottom: 1px solid #ddd; text-align: center;">#${order.order_number}</td>
                    </tr>
                 `;
            });
        });

        const htmlBody = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
                <div style="background-color: #0D3B4C; padding: 20px; text-align: center;">
                    <h1 style="color: #fff; margin: 0; font-style: italic;">ESW<span style="color: #72C4B7; font-style: normal;">CARGO</span></h1>
                </div>
                
                <div style="padding: 20px; background-color: #f9f9f9;">
                    <h2 style="color: #0D3B4C; border-bottom: 2px solid #F4AB3D; padding-bottom: 10px;">PACKING LIST - ENVÍO #${shipment.shipment_number}</h2>
                    
                    <p><strong>CLIENTE:</strong> ${shipment.client?.name || 'N/A'}</p>
                    <p><strong>FECHA:</strong> ${new Date().toLocaleDateString()}</p>
                    
                    <table style="width: 100%; border-collapse: collapse; margin-top: 20px; background-color: #fff;">
                        <thead>
                            <tr style="background-color: #0D3B4C; color: #fff;">
                                <th style="padding: 10px;">QTY</th>
                                <th style="padding: 10px;">DESCRIPTION</th>
                                <th style="padding: 10px;">INVOICE</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${itemsHtml || '<tr><td colspan="3" style="padding: 20px; text-align: center;">Sin items</td></tr>'}
                        </tbody>
                    </table>
                    
                    <div style="margin-top: 30px; text-align: right;">
                        <p style="font-size: 18px; font-weight: bold; color: #0D3B4C;">
                            SHIPPING COST: USD ${shipment.price_total ? shipment.price_total.toFixed(2) : '0.00'}
                        </p>
                    </div>
                    
                    <div style="margin-top: 40px; font-size: 12px; color: #888; text-align: center; border-top: 1px solid #ddd; padding-top: 20px;">
                        <p>ESWCARGO | 9600 NW 38th OF 208, Doral, FL 33172</p>
                        <p>
                            <a href="https://eswcargo.com" style="color: #0D3B4C; text-decoration: none;">eswcargo.com</a> | 
                            <a href="https://instagram.com/eswcargo" style="color: #0D3B4C; text-decoration: none;">@eswcargo</a>
                        </p>
                    </div>
                </div>
            </div>
        `;

        const result = await sendEmail(targetEmail, `ESWCARGO Packing List - Envío #${shipment.shipment_number}`, htmlBody);

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
                items: true,
                client: true
            }
        });

        if (!order) return { success: false, message: 'Pedido no encontrado.' };

        // HTML Construction for Invoice (Blue Theme)
        let itemsHtml = '';
        order.items.forEach(item => {
            itemsHtml += `
                <tr>
                    <td style="padding: 8px; border-bottom: 1px solid #ddd; text-align: center;">${item.quantity}</td>
                    <td style="padding: 8px; border-bottom: 1px solid #ddd;">${item.productName}</td>
                    <td style="padding: 8px; border-bottom: 1px solid #ddd; text-align: right;">USD ${item.unit_price.toFixed(2)}</td>
                    <td style="padding: 8px; border-bottom: 1px solid #ddd; text-align: right;">USD ${(item.unit_price * item.quantity).toFixed(2)}</td>
                </tr>
             `;
        });

        const htmlBody = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
                <div style="padding: 20px; text-align: left; border-bottom: 3px solid #103a89;">
                    <h1 style="color: #103a89; margin: 0; font-size: 24px;">ELECTRO-SURWEB INC</h1>
                    <p style="font-size: 12px; color: #666; margin: 5px 0 0 0;">21180 MAINSAIL CIR B19, MIAMI, FL 33180</p>
                </div>
                
                <div style="padding: 20px; background-color: #fff;">
                    <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 20px;">
                        <div>
                            <h2 style="color: #103a89; margin: 0 0 10px 0;">INVOICE #${order.order_number}</h2>
                            <p style="margin: 0; font-size: 14px;"><strong>Date:</strong> ${new Date(order.date).toLocaleDateString()}</p>
                            <p style="margin: 5px 0 0 0; font-size: 14px;"><strong>Customer:</strong> ${order.client.name}</p>
                        </div>
                    </div>
                
                    <table style="width: 100%; border-collapse: collapse; margin-top: 10px;">
                        <thead>
                            <tr style="background-color: #103a89; color: #fff;">
                                <th style="padding: 8px; text-align: center;">QTY</th>
                                <th style="padding: 8px; text-align: left;">DESCRIPTION</th>
                                <th style="padding: 8px; text-align: right;">UNIT PRICE</th>
                                <th style="padding: 8px; text-align: right;">TOTAL</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${itemsHtml}
                        </tbody>
                        <tfoot>
                            <tr style="background-color: #f0f0f0; font-weight: bold;">
                                <td colspan="3" style="padding: 10px; text-align: right;">TOTAL:</td>
                                <td style="padding: 10px; text-align: right; color: #103a89;">USD ${order.total_amount.toFixed(2)}</td>
                            </tr>
                        </tfoot>
                    </table>
                    
                    <div style="margin-top: 30px; font-size: 11px; color: #666; padding: 15px; background: #f9f9f9; border-radius: 4px;">
                        <p style="font-weight: bold; color: #103a89; margin-bottom: 5px;">Payment Instructions / Banking:</p>
                        <p style="margin: 2px 0;">Beneficiary: Electro-Surweb Inc</p>
                        <p style="margin: 2px 0;">Bank: MERCURY (Choice Financial Group)</p>
                        <p style="margin: 2px 0;">Account: 202557771823 | Routing (ABA): 09131122</p>
                        <p style="margin: 5px 0;"><strong>USDT / Crypto accepted. Please ask for wallet address.</strong></p>
                    </div>

                    <div style="margin-top: 30px; text-align: center; font-size: 12px; color: #888;">
                        <p>Thank you for your business!</p>
                        <p>
                            <a href="https://electrosurweb.com" style="color: #103a89; text-decoration: none;">electrosurweb.com</a> | 
                            <a href="https://wa.me/17862814922" style="color: #103a89; text-decoration: none;">WhatsApp</a>
                        </p>
                    </div>
                </div>
            </div>
        `;

        const result = await sendEmail(targetEmail, `INVOICE #${order.order_number} - Electro-Surweb Inc`, htmlBody);

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
