/**
 * Backfill basePrice for PriceLedger entries where basePrice = 0
 * Run as CF task: cf run-task <app-name> "node scripts/backfill-base-price.js"
 */
'use strict';

const cds = require('@sap/cds');

async function run() {
    await cds.connect.to('db');
    const { PriceLedger } = cds.entities('hub.procurement');

    // 1. Find all entries with basePrice = 0 or null
    const entries = await SELECT.from(PriceLedger)
        .columns('ID', 'materialId', 'basePrice')
        .where('basePrice = 0 or basePrice is null');

    if (!entries.length) {
        console.log('[backfill] No entries need updating. Done.');
        process.exit(0);
    }

    console.log(`[backfill] Found ${entries.length} entries with basePrice = 0`);

    // 2. Get unique materialIds
    const materialIds = [...new Set(entries.map(e => e.materialId).filter(Boolean))];
    console.log(`[backfill] Unique materials: ${materialIds.join(', ')}`);

    // 3. Fetch StandardPrice from S/4HANA for each material
    const S4_PROD = await cds.connect.to('API_PRODUCT');
    const { A_ProductValuation } = S4_PROD.entities;

    const priceMap = {};
    for (const mat of materialIds) {
        try {
            const val = await S4_PROD.run(
                SELECT.one.from(A_ProductValuation)
                    .columns('StandardPrice', 'MovingAveragePrice')
                    .where({ Product: mat })
            );
            const price = Number(val?.StandardPrice) || Number(val?.MovingAveragePrice) || 0;
            priceMap[mat] = price;
            console.log(`[backfill] ${mat} → basePrice = ${price}`);
        } catch (err) {
            console.warn(`[backfill] Failed to fetch price for ${mat}:`, err.message);
            priceMap[mat] = 0;
        }
    }

    // 4. Update each entry
    let updated = 0;
    for (const entry of entries) {
        const price = priceMap[entry.materialId] ?? 0;
        if (price === 0) {
            console.warn(`[backfill] Skipping ${entry.ID} — no price found for material ${entry.materialId}`);
            continue;
        }
        await UPDATE(PriceLedger).set({ basePrice: price }).where({ ID: entry.ID });
        updated++;
    }

    console.log(`[backfill] Done. Updated ${updated}/${entries.length} entries.`);
    process.exit(0);
}

run().catch(err => {
    console.error('[backfill] Fatal error:', err);
    process.exit(1);
});
