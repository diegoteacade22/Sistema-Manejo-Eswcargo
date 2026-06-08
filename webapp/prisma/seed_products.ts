
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

async function main() {
    // process.cwd() in "webapp" folder context
    const seedFile = path.join(process.cwd(), 'prisma', 'products_seed.json');
    if (!fs.existsSync(seedFile)) {
        // Fallback or error
        console.error(`No products_seed.json found at ${seedFile}.`);
        return;
    }

    const products = JSON.parse(fs.readFileSync(seedFile, 'utf-8'));
    console.log(`Seeding ${products.length} products...`);

    for (const p of products) {
        try {
            // Check existence by SKU or unique constraint if strictly enforced.
            // Schema might not have unique SKU, so use findFirst.
            const existing = await prisma.product.findFirst({
                where: { sku: p.sku }
            });

            const data = {
                sku: p.sku,
                name: p.name,
                color_grade: p.color_grade, // Now cleaned of 'nan'
                status: p.status,
                active: p.active,
                lp1: p.lp1,
                lp2: p.lp2 || 0,
                lp3: p.lp3 || 0,
                stock: 0,
                last_purchase_cost: p.last_purchase_cost || 0,
                webpage: p.webpage
            };

            if (existing) {
                await prisma.product.update({
                    where: { id: existing.id },
                    data: data
                });
            } else {
                await prisma.product.create({
                    data: data
                });
            }
        } catch (e) {
            console.error(`Error seeding ${p.sku}:`, e);
        }
    }
    console.log("Product seeding completed.");
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
