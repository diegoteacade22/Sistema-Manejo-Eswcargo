type WhatsAppResult = {
    success: boolean;
    message: string;
    provider?: 'webhook' | 'twilio' | 'meta';
};

function normalizePhone(rawPhone: string, defaultCountryCode: string): string | null {
    const trimmed = rawPhone.trim();
    if (!trimmed) return null;

    const cleanedDefault = defaultCountryCode.replace(/[^\d]/g, '');
    let normalized = trimmed.replace(/[^\d+]/g, '');

    if (!normalized) return null;

    if (normalized.startsWith('00')) {
        normalized = `+${normalized.slice(2)}`;
    }

    if (normalized.startsWith('+')) {
        let digits = normalized.replace(/[^\d]/g, '');
        if (digits.length % 2 === 0) {
            const half = digits.length / 2;
            const first = digits.slice(0, half);
            const second = digits.slice(half);
            if (first.length >= 8 && first === second) {
                digits = first;
            }
        }
        if (digits.length < 8) return null;
        return `+${digits}`;
    }

    let digitsOnly = normalized.replace(/[^\d]/g, '');
    if (digitsOnly.length % 2 === 0) {
        const half = digitsOnly.length / 2;
        const first = digitsOnly.slice(0, half);
        const second = digitsOnly.slice(half);
        if (first.length >= 8 && first === second) {
            // Defensive cleanup for duplicated phone values like 1402...1402...
            digitsOnly = first;
        }
    }
    if (digitsOnly.length < 8) return null;

    if (digitsOnly.startsWith('0') && cleanedDefault) {
        return `+${cleanedDefault}${digitsOnly.slice(1)}`;
    }

    if (cleanedDefault === '54' && (digitsOnly.length === 10 || digitsOnly.length === 11)) {
        // Argentina mobile WhatsApp format is usually +549 + area+number.
        // If local number doesn't already start with 9, prepend it.
        const local = digitsOnly.startsWith('9') ? digitsOnly : `9${digitsOnly}`;
        return `+54${local}`;
    }

    if (cleanedDefault && digitsOnly.length <= 10) {
        return `+${cleanedDefault}${digitsOnly}`;
    }

    return `+${digitsOnly}`;
}

async function sendViaWebhook(to: string, message: string): Promise<WhatsAppResult> {
    const webhookUrl = process.env.WHATSAPP_WEBHOOK_URL;
    if (!webhookUrl) {
        return { success: false, message: 'WHATSAPP_WEBHOOK_URL no configurado.' };
    }

    const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ to, message })
    });

    if (!response.ok) {
        const text = await response.text();
        return {
            success: false,
            message: `Webhook WhatsApp respondió ${response.status}: ${text || 'sin detalle'}`,
            provider: 'webhook'
        };
    }

    return { success: true, message: 'WhatsApp enviado por webhook.', provider: 'webhook' };
}

async function sendViaTwilio(to: string, message: string): Promise<WhatsAppResult> {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    const from = process.env.TWILIO_WHATSAPP_FROM;

    if (!sid || !token || !from) {
        return { success: false, message: 'Credenciales Twilio WhatsApp incompletas.' };
    }

    const auth = Buffer.from(`${sid}:${token}`).toString('base64');
    const body = new URLSearchParams({
        From: from.startsWith('whatsapp:') ? from : `whatsapp:${from}`,
        To: to.startsWith('whatsapp:') ? to : `whatsapp:${to}`,
        Body: message
    });

    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: 'POST',
        headers: {
            authorization: `Basic ${auth}`,
            'content-type': 'application/x-www-form-urlencoded'
        },
        body: body.toString()
    });

    if (!response.ok) {
        const text = await response.text();
        return {
            success: false,
            message: `Twilio respondió ${response.status}: ${text || 'sin detalle'}`,
            provider: 'twilio'
        };
    }

    return { success: true, message: 'WhatsApp enviado por Twilio.', provider: 'twilio' };
}

async function sendViaMeta(to: string, message: string): Promise<WhatsAppResult> {
    const token = process.env.WHATSAPP_ACCESS_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

    if (!token || !phoneNumberId) {
        return { success: false, message: 'Credenciales WhatsApp Cloud API incompletas.' };
    }

    const response = await fetch(`https://graph.facebook.com/v22.0/${phoneNumberId}/messages`, {
        method: 'POST',
        headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json'
        },
        body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: to.replace(/^\+/, ''),
            type: 'text',
            text: { body: message }
        })
    });

    if (!response.ok) {
        const text = await response.text();
        return {
            success: false,
            message: `Meta WhatsApp respondió ${response.status}: ${text || 'sin detalle'}`,
            provider: 'meta'
        };
    }

    return { success: true, message: 'WhatsApp enviado por Meta Cloud API.', provider: 'meta' };
}

export async function sendWhatsAppMessage(rawPhone: string, message: string): Promise<WhatsAppResult> {
    const defaultCountryCode = process.env.WHATSAPP_DEFAULT_COUNTRY_CODE || '54';
    const to = normalizePhone(rawPhone, defaultCountryCode);

    if (!to) {
        return { success: false, message: 'Número de WhatsApp inválido o vacío.' };
    }

    if (process.env.WHATSAPP_WEBHOOK_URL) {
        return sendViaWebhook(to, message);
    }

    if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_WHATSAPP_FROM) {
        return sendViaTwilio(to, message);
    }

    if (process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID) {
        return sendViaMeta(to, message);
    }

    return {
        success: false,
        message: 'No hay proveedor WhatsApp configurado (webhook, Twilio o Meta).'
    };
}
