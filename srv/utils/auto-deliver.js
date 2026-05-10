const cds = require('@sap/cds');

const AUTO_DELIVER_DAYS = 3;

cds.on('served', async () => {
    async function runAutoDeliver() {
        try {
            const db = await cds.connect.to('db');
            const { Shipments, AuditLogs } = db.entities('hub.procurement');
            const cutoff = new Date(Date.now() - AUTO_DELIVER_DAYS * 24 * 60 * 60 * 1000).toISOString();
            const overdue = await db.run(
                SELECT.from(Shipments)
                    .where({ status: 'Shipped' })
                    .and(`deliveryDate <= '${cutoff}'`)
            );
            for (const s of overdue) {
                await db.run(UPDATE(Shipments).set({ status: 'Delivered' }).where({ ID: s.ID }));
                await db.run(INSERT.into(AuditLogs).entries({
                    entityName: 'Shipments',
                    entityId:   s.ID,
                    action:     'AUTO_DELIVERED',
                    changedBy:  'system',
                    changedAt:  new Date().toISOString(),
                    oldValue:   JSON.stringify({ status: 'Shipped', deliveryDate: s.deliveryDate }),
                    newValue:   JSON.stringify({ status: 'Delivered', reason: `Auto-delivered after ${AUTO_DELIVER_DAYS} days` }),
                }));
                console.log(`[AutoDeliver] Shipment ${s.shipmentNumber || s.ID} auto-set to Delivered`);
            }
        } catch (err) {
            console.error('[AutoDeliver] Error:', err.message);
        }
    }

    await runAutoDeliver();
    setInterval(runAutoDeliver, 12 * 60 * 60 * 1000); //run every 12 hours
});
