
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

    let updatedClients = 0;
    let updatedSuppliers = 0;

    // Cache current clients and suppliers
    const [clients, suppliers] = await Promise.all([
        prisma.client.findMany(),
        (prisma as any).supplier.findMany()
    ]);

    const clientMap = new Map<string, any>();
    clients.forEach(c => {
        clientMap.set(c.name.trim().toUpperCase(), c);
        if (c.email) clientMap.set(c.email.trim().toUpperCase(), c);
    });

    const supplierMap = new Map<string, any>();
    suppliers.forEach((s: any) => {
        supplierMap.set(s.name.trim().toUpperCase(), s);
        if (s.email) supplierMap.set(s.email.trim().toUpperCase(), s);
    });

    for (const row of (records as any[])) {
        const firstName = row['First Name'] || '';
        const lastName = row['Last Name'] || '';
        const fullName = `${firstName} ${lastName}`.trim();
        const fileAs = row['File As'] || '';
        const orgName = row['Organization Name'] || '';
        const emailRaw = row['E-mail 1 - Value'] || row['E-mail 2 - Value'] || '';

        const matchCandidates = [fullName, fileAs, orgName].filter(n => n && n.length > 1);
        const matchKey = emailRaw ? emailRaw.trim().toUpperCase() : null;

        // Validation functions
        const validateEmail = (e: string) => {
            if (!e) return '';
            const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            return re.test(e.trim()) ? e.trim().toLowerCase() : '';
        };

        const validatePhone = (p: string) => {
            if (!p) return '';
            let phone = p.replace(/\s+/g, '').replace(/-/g, '').replace(/\./g, '');
            return phone.replace(/[^\d+]/g, '');
        };

        const validEmail = validateEmail(emailRaw);
        const validPhone = validatePhone(row['Phone 1 - Value'] || '');

        // 1. MATCH CLIENT
        let dbClient = null;
        for (const candidate of matchCandidates) {
            const key = candidate.trim().toUpperCase();
            if (clientMap.has(key)) {
                dbClient = clientMap.get(key);
                break;
            }
        }
        if (!dbClient && matchKey && clientMap.has(matchKey)) dbClient = clientMap.get(matchKey);

        if (dbClient) {
            const updateData: any = {};
            let needsUpdate = false;

            // SAFE SYNC: Only fill if empty in DB
            if (validEmail && !dbClient.email) {
                updateData.email = validEmail;
                needsUpdate = true;
            }
            if (validPhone && !dbClient.phone) {
                updateData.phone = validPhone;
                needsUpdate = true;
            }

            if (needsUpdate) {
                await prisma.client.update({
                    where: { id: dbClient.id },
                    data: updateData
                });
                updatedClients++;
            }
        }

        // 2. MATCH SUPPLIER
        let dbSupplier = null;
        for (const candidate of matchCandidates) {
            const key = candidate.trim().toUpperCase();
            if (supplierMap.has(key)) {
                dbSupplier = supplierMap.get(key);
                break;
            }
        }
        if (!dbSupplier && matchKey && supplierMap.has(matchKey)) dbSupplier = supplierMap.get(matchKey);

        if (dbSupplier) {
            const updateData: any = {};
            let needsUpdate = false;

            // SAFE SYNC: Only fill if empty in DB
            if (validEmail && !dbSupplier.email) {
                updateData.email = validEmail;
                needsUpdate = true;
            }
            if (validPhone && !dbSupplier.phone) {
                updateData.phone = validPhone;
                needsUpdate = true;
            }

            if (needsUpdate) {
                await (prisma as any).supplier.update({
                    where: { id: dbSupplier.id },
                    data: updateData
                });
                updatedSuppliers++;
            }
        }
    }

    console.log(`\n✅ Sincronización Finalizada!`);
    console.log(`👥 Clientes actualizados (campos vacíos completados): ${updatedClients}`);
    console.log(`🏭 Proveedores actualizados (campos vacíos completados): ${updatedSuppliers}`);
}

main()
    .catch(e => console.error(e))
    .finally(() => prisma.$disconnect());
