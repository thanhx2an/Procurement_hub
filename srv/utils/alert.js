const cds = require('@sap/cds');

async function sendAlertNotification({ subject, body, shipmentId, eventType = 'CRITICALDELAY', severity = 'WARNING' }) {
    try {
        let ansCred;
        try {
            const vcap = JSON.parse(process.env.VCAP_SERVICES || '{}');
            ansCred = vcap['alert-notification']?.[0]?.credentials;
        } catch (e) { /* ignore */ }

        if (!ansCred) {
            console.log('[AlertNotification] Service not bound — skipping email. Would have sent:', subject);
            return;
        }

        const tokenRes = await fetch(ansCred.oauth_url, {
            method: 'POST',
            headers: {
                'Content-Type':  'application/x-www-form-urlencoded',
                'Authorization': 'Basic ' + Buffer.from(`${ansCred.client_id}:${ansCred.client_secret}`).toString('base64'),
            },
        });
        const { access_token } = await tokenRes.json();

        const alertRes = await fetch(`${ansCred.url}/cf/producer/v1/resource-events`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${access_token}`,
                'Content-Type':  'application/json',
            },
            body: JSON.stringify({
                eventType,
                eventTimestamp: Math.floor(Date.now() / 1000),
                severity,
                category:       'ALERT',
                subject,
                body,
                resource: {
                    resourceName:     'baongoc-procurement-hub',
                    resourceType:     'Shipment',
                    resourceInstance: shipmentId,
                    tags:             {},
                },
                tags: {},
            }),
        });

        if (!alertRes.ok) {
            const text = await alertRes.text();
            console.error('[AlertNotification] API error:', alertRes.status, text);
        } else {
            console.log('[AlertNotification] Alert sent:', subject);
        }
    } catch (err) {
        console.error('[AlertNotification] Failed to send:', err.message);
    }
}

async function patchS4DeliveryDate(purchaseOrderId, purchaseOrderItem, newDeliveryDate) {
    if (!purchaseOrderId || !purchaseOrderItem) {
        console.log('[S4 PATCH] Missing purchaseOrderId or purchaseOrderItem — skipping');
        return;
    }
    try {
        const S4_PO = await cds.connect.to('API_PURCHASEORDER');
        const { PurchaseOrderScheduleLine } = S4_PO.entities;

        // Lấy tất cả schedule lines của PO item này
        const scheduleLines = await S4_PO.run(
            SELECT.from(PurchaseOrderScheduleLine)
                .where({ PurchaseOrder: purchaseOrderId, PurchaseOrderItem: purchaseOrderItem })
        );

        if (!scheduleLines?.length) {
            console.warn('[S4 PATCH] No schedule lines found for PO', purchaseOrderId, 'item', purchaseOrderItem);
            return;
        }

        // Update ScheduleLineDeliveryDate trên từng schedule line
        for (const line of scheduleLines) {
            await S4_PO.run(
                UPDATE(PurchaseOrderScheduleLine)
                    .set({ ScheduleLineDeliveryDate: newDeliveryDate })
                    .where({
                        PurchaseOrder:     purchaseOrderId,
                        PurchaseOrderItem: purchaseOrderItem,
                        ScheduleLine:      line.ScheduleLine,
                    })
            );
            console.log('[S4 PATCH] Updated schedule line', line.ScheduleLine, '→', newDeliveryDate);
        }
        console.log('[S4 PATCH] PO', purchaseOrderId, 'item', purchaseOrderItem, 'delivery date updated to', newDeliveryDate);
    } catch (err) {
        console.error('[S4 PATCH] Failed:', err.message);
    }
}

module.exports = { sendAlertNotification, patchS4DeliveryDate };
