
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const PHONE_COUNTRY_MAP: Record<string, string> = {
    '54': 'Argentina',
    '1': 'United States',
    '598': 'Uruguay',
    '56': 'Chile',
    '55': 'Brazil',
    '595': 'Paraguay',
    '591': 'Bolivia',
    '51': 'Peru',
    '57': 'Colombia',
    '52': 'Mexico',
    '34': 'Spain',
    '86': 'China'
};

function inferCountryFromPhone(phone: string): string | null {
    if (!phone) return null;

    // Clean phone: remove non-digits, keep leading + if exists, but for matching we just need digits
    // Usually formats are +54 9 11..., 54911...
    // Let's strip everything non-digit
    const digits = phone.replace(/\D/g, '');

    // Check for match
    for (const [code, country] of Object.entries(PHONE_COUNTRY_MAP)) {
        if (digits.startsWith(code)) {
            return country;
        }
    }
    return null;
}

async function main() {
    // Cast where clause to any to avoid TypeScript errors if types aren't fully synced yet
    const clients = await prisma.client.findMany({
        where: {
            OR: [
                { country: null },
                { country: '' }
            ],
            phone: { not: null }
        } as any
    });

    console.log(`Found ${clients.length} clients with potential missing country info.`);

    let updatedCount = 0;

    for (const client of clients) {
        if (!client.phone) continue;

        const inferred = inferCountryFromPhone(client.phone);
        // Cast client to any to check country property safely
        const currentCountry = (client as any).country;

        if (inferred && !currentCountry) {
            await prisma.client.update({
                where: { id: client.id },
                data: { country: inferred } as any
            });
            console.log(`Updated ${client.name}: ${client.phone} -> ${inferred}`);
            updatedCount++;
        }
    }

    console.log(`\nSuccessfully inferred country for ${updatedCount} clients.`);
}

main()
    .catch(e => console.error(e))
    .finally(() => prisma.$disconnect());
