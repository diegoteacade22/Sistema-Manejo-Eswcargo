
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';

const prisma = new PrismaClient();

async function main() {
    const csvPath = path.join(process.cwd(), 'contacts.csv');
    if (!fs.existsSync(csvPath)) {
        console.error("contacts.csv not found! Please save your Google Contacts export as 'contacts.csv' in the webapp folder.");
        return;
    }

    console.log("Reading contacts.csv...");
    const fileContent = fs.readFileSync(csvPath, 'utf-8');
    const records = parse(fileContent, {
        columns: true,
        skip_empty_lines: true
    });

    console.log(`Found ${records.length} contacts in CSV.`);

    let updated = 0;

    // Cache current clients
    const clients = await prisma.client.findMany();
    const clientMap = new Map<string, any>();

    clients.forEach(c => {
        clientMap.set(c.name.trim().toUpperCase(), c);
        // Also map by email if available?
        if (c.email) clientMap.set(c.email.trim().toUpperCase(), c);
    });

    for (const row of (records as any[])) {
        // Adapt fields based on Google CSV format
        // Common headers: 'Name', 'Given Name', 'Additional Name', 'Family Name', 'Yomi Name', 'Given Name Yomi', 'Additional Name Yomi', 'Family Name Yomi', 'Name Prefix', 'Name Suffix', 'Initials', 'Nickname', 'Short Name', 'Maiden Name', 'Birthday', 'Gender', 'Location', 'Billing Information', 'Directory Server', 'Mileage', 'Occupation', 'Hobby', 'Sensitivity', 'Priority', 'Subject', 'Notes', 'Language', 'Photo', 'Group Membership', 'E-mail 1 - Type', 'E-mail 1 - Value', 'Phone 1 - Type', 'Phone 1 - Value', 'Address 1 - Type', 'Address 1 - Formatted', 'Address 1 - Street', 'Address 1 - City', 'Address 1 - PO Box', 'Address 1 - Region', 'Address 1 - Postal Code', 'Address 1 - Country', 'Address 1 - Extended Address', 'Organization 1 - Type', 'Organization 1 - Name', 'Organization 1 - Yomi Name', 'Organization 1 - Title', 'Organization 1 - Department', 'Organization 1 - Symbol', 'Organization 1 - Location', 'Organization 1 - Job Description', 'Relation 1 - Type', 'Relation 1 - Value', 'Website 1 - Type', 'Website 1 - Value'

        // Construct possible names to match
        const firstName = row['First Name'] || '';
        const lastName = row['Last Name'] || '';
        const fullName = `${firstName} ${lastName}`.trim();
        const fileAs = row['File As'] || '';
        const orgName = row['Organization Name'] || '';
        const email = row['E-mail 1 - Value'] || row['E-mail 2 - Value'] || '';

        const matchCandidates = [fullName, fileAs, orgName].filter(n => n && n.length > 1);

        let dbClient = null;
        for (const candidate of matchCandidates) {
            const key = candidate.trim().toUpperCase();
            if (clientMap.has(key)) {
                dbClient = clientMap.get(key);
                break;
            }
        }

        if (!dbClient && email) {
            dbClient = clientMap.get(email.trim().toUpperCase());
        }

        const clean = (s: string) => {
            if (!s) return '';
            let cleaned = s.replace(/:::/g, '').replace(/\s+/g, ' ').trim();
            if (cleaned.toLowerCase() === 'nan') return '';
            return cleaned;
        };

        const validateEmail = (e: string) => {
            const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            return re.test(e) ? e.toLowerCase() : '';
        };

        const validatePhone = (p: string) => {
            if (!p) return '';
            let phone = p.replace(/\s+/g, '').replace(/-/g, '').replace(/\./g, '');

            if (phone.length <= 16) {
                if ((phone.match(/\+/g) || []).length > 1) {
                    // Fallthrough
                } else {
                    // Remove non-digit except leading +
                    return phone.replace(/[^\d+]/g, '');
                }
            }

            const argRegex = /(\+549\d{10})/;
            const usRegex = /(\+1\d{10})/;

            let match = phone.match(argRegex);
            if (match) return match[0];

            match = phone.match(usRegex);
            if (match) return match[0];

            const allMatches = phone.match(/(\+?\d{8,15})/g);
            if (allMatches && allMatches.length > 0) {
                const preferred = allMatches.find(m => m.startsWith('+54') || m.startsWith('54') || m.startsWith('+1') || m.startsWith('1'));
                if (preferred) {
                    return preferred.startsWith('+') ? preferred : '+' + preferred;
                }
                const first = allMatches[0];
                return first.startsWith('+') ? first : '+' + first;
            }

            return '';
        };

        const city = clean(row['Address 1 - City']);
        // Use Region as state, but if city is missing, some people put city in Region? 
        // Google often puts 'Buenos Aires' in Region and nothing in City for CABA. 
        // Let's assume Region key determines state primarily.
        const state = clean(row['Address 1 - Region']);
        // If city is empty, use state as a fallback for city
        // Actually, user wants "State/Provincia" separate.
        // If city is null, we can try to use part of Address? No.
        // Let's stick to CSV: Address 1 - City -> City. Address 1 - Region -> State.

        let country = clean(row['Address 1 - Country']);
        const zip = clean(row['Address 1 - Postal Code']);
        const address = clean(row['Address 1 - Formatted'] || row['Address 1 - Street']);

        // Prioritize Value, then try matching extraction if mixed
        let rawPhone = row['Phone 1 - Value'] || '';
        const phone = validatePhone(clean(rawPhone));

        let rawEmail = row['E-mail 1 - Value'] || '';
        const validEmail = validateEmail(clean(rawEmail));

        // Infer country from phone if missing
        if (!country && phone) {
            const PHONE_COUNTRY_MAP: Record<string, string> = {
                '54': 'Argentina', '1': 'United States', '598': 'Uruguay', '56': 'Chile',
                '55': 'Brazil', '595': 'Paraguay', '591': 'Bolivia', '51': 'Peru',
                '57': 'Colombia', '52': 'Mexico', '34': 'Spain', '86': 'China'
            };
            const digits = phone.replace(/\D/g, '');
            for (const [code, c] of Object.entries(PHONE_COUNTRY_MAP)) {
                if (digits.startsWith(code)) {
                    country = c;
                    break;
                }
            }
        }

        if (dbClient) {
            // Update if fields are missing in DB or if we want to overwrite (let's fill missing ones mainly)

            const updateData: any = {};
            let needsUpdate = false;

            if (city && dbClient.city !== city) { updateData.city = city; needsUpdate = true; }
            // If city is empty but state has value, maybe we can't infer city from state safely, so leave it.

            if (state && dbClient.state !== state) { updateData.state = state; needsUpdate = true; }
            if (country && dbClient.country !== country) { updateData.country = country; needsUpdate = true; }
            if (zip && dbClient.zipCode !== zip) { updateData.zipCode = zip; needsUpdate = true; }

            // For address, remove overwrite if it's cleaner to keep existing? 
            // User complained about "not depurated".
            if (address && dbClient.address !== address) { updateData.address = address; needsUpdate = true; }

            // Phone/Email
            if (validEmail && validEmail !== dbClient.email) { updateData.email = validEmail; needsUpdate = true; }

            // Only update phone if new one is valid and different
            if (phone && phone !== dbClient.phone) { updateData.phone = phone; needsUpdate = true; }

            if (needsUpdate) {
                await prisma.client.update({
                    where: { id: dbClient.id },
                    data: updateData
                });
                updated++;
                process.stdout.write('.');
            }
        }
    }

    console.log(`\nSynced! Updated ${updated} clients with Google Contacts data.`);
}

main()
    .catch(e => console.error(e))
    .finally(() => prisma.$disconnect());
