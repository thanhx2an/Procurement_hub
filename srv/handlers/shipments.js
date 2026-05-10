const cds = require('@sap/cds');
const { sendAlertNotification, patchS4DeliveryDate } = require('../utils/alert');

module.exports = (srv, { Shipments, AuditLogs, PriceLedger, ShipmentItems }) => {

    // ─── AUTO-SET vendorCode khi Vendor tạo shipment ──────────────────────
    const setVendorCode = (req) => {
        const user = req.user;
        if (user.is('VendorUser') || user.is('VendorAdmin')) {
            const raw = user.attr?.VendorID;
            const vendorCode = [].concat(raw ?? []).flat(Infinity)[0];
            if (vendorCode != null) {
                req.data.vendorCode = String(vendorCode);
                console.log(`[${req.event} Shipment] vendorCode set:`, req.data.vendorCode);
            }
        }
    };
    srv.before('CREATE', 'Shipments', setVendorCode);

    // ─── AUTO-UPSERT local Products khi tạo ShipmentItem từ PO ──────────
    srv.before('CREATE', 'ShipmentItems', async (req) => {
        const { materialId, materialDesc, unit, negotiatedPrice } = req.data;
        if (!materialId) return;

        const { Products } = srv.entities;
        const db = await cds.connect.to('db');

        let product = await db.run(SELECT.one.from(Products).where({ extProductId: materialId }));
        if (!product) {
            const newId = cds.utils.uuid();
            await db.run(INSERT.into(Products).entries({
                ID:           newId,
                extProductId: materialId,
                name:         materialDesc || materialId,
                unit:         unit || null,
                basePrice:    negotiatedPrice || null,
            }));
            product = { ID: newId };
            console.log('[ShipmentItems] Created local Product:', materialId, '→', newId);
        }
        req.data.product_ID = product.ID;
    });

    // ─── VALIDATION khi activate draft (SAVE = draftActivate) ────────────
    srv.before('SAVE', 'Shipments', async (req) => {
        const { deliveryDate } = req.data;
        if (!deliveryDate) {
            return req.reject(400, 'Delivery date is required before submitting a shipment');
        }
        const delivery = new Date(deliveryDate); delivery.setHours(0,0,0,0);
        const today    = new Date();              today.setHours(0,0,0,0);
        if (delivery < today) {
            return req.reject(400, 'Delivery date must be today or in the future');
        }
    });

    // ─── SAU KHI CREATE active Shipment: status → Pending ────────────────
    srv.after('CREATE', 'Shipments', async (data, req) => {
        const id = data?.ID;
        if (!id) return;
        try {
            const year = new Date().getFullYear();
            const maxResult = await SELECT.one.from(Shipments)
                .columns('max(shipmentNumber) as maxNum')
                .where(`shipmentNumber like 'SHP-${year}-%'`);
            const lastNum = maxResult?.maxNum ? parseInt(maxResult.maxNum.split('-')[2]) : 0;
            const shipmentNumber = `SHP-${year}-${String(lastNum + 1).padStart(5, '0')}`;

            await UPDATE(Shipments).set({ status: 'Pending', shipmentNumber }).where({ ID: id });
            console.log('[CREATE active] status → Pending, shipmentNumber:', shipmentNumber);

            await INSERT.into(AuditLogs).entries({
                entityName: 'Shipments',
                entityId:   id,
                action:     'SHIPMENT_ACTIVATED',
                changedBy:  req.user?.id || 'system',
                changedAt:  new Date().toISOString(),
                oldValue:   JSON.stringify({ status: 'Draft' }),
                newValue:   JSON.stringify({ status: 'Pending', vendorCode: data.vendorCode, shipmentNumber }),
            });
            console.log('[SHIPMENT_ACTIVATED] event logged for', id);

            // ─── Auto-populate PriceLedger from ShipmentItems ────────────
            try {
                const items = await SELECT.from(ShipmentItems).where({ parent_ID: id });
                const now     = new Date().toISOString();
                const openEnd = '9999-12-31T00:00:00Z';

                let S4_PROD;
                try { S4_PROD = await cds.connect.to('API_PRODUCT'); } catch (_) {}

                const filteredItems = items.filter(i => i.negotiatedPrice > 0 && i.materialId);
                const ledgerEntries = await Promise.all(filteredItems.map(async (i) => {
                    let basePrice = 0;
                    if (S4_PROD) {
                        try {
                            const { A_ProductValuation } = S4_PROD.entities;
                            const val = await S4_PROD.run(
                                SELECT.one.from(A_ProductValuation)
                                    .columns('StandardPrice', 'MovingAveragePrice')
                                    .where({ Product: i.materialId })
                            );
                            basePrice = Number(val?.StandardPrice) || Number(val?.MovingAveragePrice) || 0;
                            console.log(`[PriceLedger] S4 basePrice for ${i.materialId}:`, basePrice);
                        } catch (e) {
                            console.warn(`[PriceLedger] Could not fetch S4 price for ${i.materialId}:`, e.message);
                        }
                    }
                    return {
                        vendorCode:        data.vendorCode,
                        materialId:        i.materialId,
                        materialDesc:      i.materialDesc || '',
                        sourceShipment_ID: id,
                        negotiatedPrice:   i.negotiatedPrice,
                        basePrice,
                        validFrom:         now,
                        validTo:           openEnd,
                    };
                }));

                if (ledgerEntries.length > 0) {
                    await INSERT.into(PriceLedger).entries(...ledgerEntries);
                    console.log(`[PriceLedger] Auto-created ${ledgerEntries.length} entries for shipment ${id}`);
                }
            } catch (plErr) {
                console.error('[PriceLedger] Auto-populate failed:', plErr.message);
            }
        } catch (err) {
            console.error('[CREATE active] Failed to set status Pending:', err.message);
        }
    });

    // ─── AUDIT LOG: Sau mỗi lần UPDATE Shipment ───────────────────────────
    srv.after('UPDATE', 'Shipments', async (data, req) => {
        await INSERT.into(AuditLogs).entries({
            entityName: 'Shipments',
            entityId:   data.ID,
            action:     'UPDATE',
            changedBy:  req.user?.id || 'system',
            changedAt:  new Date().toISOString(),
            newValue:   JSON.stringify(data),
        });
    });

    // ─── AUDIT LOG: Trước mỗi lần tạo PriceLedger entry ─────────────────
    srv.before('CREATE', 'PriceLedger', async (req) => {
        await INSERT.into(AuditLogs).entries({
            entityName: 'PriceLedger',
            entityId:   req.data.ID,
            action:     'PRICE_NEGOTIATION',
            changedBy:  req.user?.id || 'system',
            changedAt:  new Date().toISOString(),
            newValue:   JSON.stringify(req.data),
        });
    });

    // ─── ACTION: criticalDelay ────────────────────────────────────────────
    srv.on('criticalDelay', async (req) => {
        const { shipmentId, reason, proposedDeliveryDate } = req.data;
        const shipment = await SELECT.one.from(Shipments).where({ ID: shipmentId });
        if (!shipment) return req.error(404, `Shipment ${shipmentId} not found`);

        await UPDATE(Shipments)
            .set({ status: 'Exception', exceptionType: 'VENDOR_DELAY', delayReason: reason || 'No reason provided', proposedDeliveryDate: proposedDeliveryDate || null })
            .where({ ID: shipmentId });

        await INSERT.into(AuditLogs).entries({
            entityName: 'Shipments',
            entityId:   shipmentId,
            action:     'CRITICAL_DELAY_FLAGGED',
            changedBy:  req.user?.id || 'system',
            changedAt:  new Date().toISOString(),
            oldValue:   JSON.stringify({ deliveryDate: shipment.deliveryDate, status: shipment.status }),
            newValue:   JSON.stringify({ status: 'Exception', reason, proposedDeliveryDate }),
        });

        await sendAlertNotification({
            shipmentId,
            subject: `Critical Delay: Shipment ${shipmentId.substring(0, 8).toUpperCase()}`,
            body:    `Vendor ${shipment.vendorCode} (${req.user?.id}) has flagged shipment ${shipmentId} as critically delayed. Reason: ${reason || 'Not provided'}. Proposed new delivery date: ${proposedDeliveryDate || 'Not specified'}. Please review in the Procurement Hub.`,
            severity: 'WARNING',
        });

        return `Shipment ${shipmentId} flagged as critical delay. Manager has been notified.`;
    });

    // ─── ACTION: approveException ─────────────────────────────────────────
    srv.on('approveException', async (req) => {
        const { shipmentId, newDeliveryDate } = req.data;
        const shipment = await SELECT.one.from(Shipments).where({ ID: shipmentId });
        if (!shipment) return req.error(404, `Shipment ${shipmentId} not found`);
        if (shipment.status !== 'Exception') {
            return req.error(400, `Shipment is not in Exception status (current: ${shipment.status})`);
        }

        const approvedDate = newDeliveryDate || shipment.deliveryDate;
        await UPDATE(Shipments).set({ status: 'Shipped', deliveryDate: approvedDate }).where({ ID: shipmentId });

        if (shipment.purchaseOrderId && shipment.purchaseOrderItem) {
            await patchS4DeliveryDate(shipment.purchaseOrderId, shipment.purchaseOrderItem, approvedDate);
        } else {
            console.log('[approveException] Missing purchaseOrderId or purchaseOrderItem — skipping S/4 PATCH');
        }

        await INSERT.into(AuditLogs).entries({
            entityName: 'Shipments',
            entityId:   shipmentId,
            action:     'EXCEPTION_APPROVED',
            changedBy:  req.user?.id || 'system',
            changedAt:  new Date().toISOString(),
            oldValue:   JSON.stringify({ deliveryDate: shipment.deliveryDate, proposedDeliveryDate: shipment.proposedDeliveryDate, reason: shipment.delayReason }),
            newValue:   JSON.stringify({ status: 'Shipped', newDeliveryDate: approvedDate }),
        });

        return `Exception approved. Shipment ${shipmentId} status set to Shipped. New delivery date: ${approvedDate}.`;
    });

    // ─── ACTION: rejectException ──────────────────────────────────────────
    srv.on('rejectException', async (req) => {
        const { shipmentId } = req.data;
        const shipment = await SELECT.one.from(Shipments).where({ ID: shipmentId });
        if (!shipment) return req.error(404, `Shipment ${shipmentId} not found`);
        if (shipment.status !== 'Exception') {
            return req.error(400, `Shipment is not in Exception status (current: ${shipment.status})`);
        }

        await UPDATE(Shipments).set({ status: 'Pending', delayReason: null }).where({ ID: shipmentId });

        await INSERT.into(AuditLogs).entries({
            entityName: 'Shipments',
            entityId:   shipmentId,
            action:     'EXCEPTION_REJECTED',
            changedBy:  req.user?.id || 'system',
            changedAt:  new Date().toISOString(),
            oldValue:   JSON.stringify({ status: 'Exception', reason: shipment.delayReason, proposedDeliveryDate: shipment.proposedDeliveryDate }),
            newValue:   JSON.stringify({ status: 'Pending', deliveryDate: shipment.deliveryDate }),
        });

        return `Exception rejected. Shipment ${shipmentId} reverted to Pending. Vendor must maintain original delivery date.`;
    });

    // ─── ACTION: markAsShipped ────────────────────────────────────────────
    srv.on('markAsShipped', async (req) => {
        const { shipmentId } = req.data;
        const shipment = await SELECT.one.from(Shipments).where({ ID: shipmentId });
        if (!shipment) return req.error(404, `Shipment ${shipmentId} not found`);
        if (shipment.status !== 'Pending') {
            return req.error(400, `Cannot mark as shipped — shipment is currently "${shipment.status}". Must be "Pending" first.`);
        }

        await UPDATE(Shipments).set({ status: 'Shipped' }).where({ ID: shipmentId });

        await INSERT.into(AuditLogs).entries({
            entityName: 'Shipments',
            entityId:   shipmentId,
            action:     'MARKED_AS_SHIPPED',
            changedBy:  req.user?.id || 'system',
            changedAt:  new Date().toISOString(),
            oldValue:   JSON.stringify({ status: 'Pending', deliveryDate: shipment.deliveryDate }),
            newValue:   JSON.stringify({ status: 'Shipped' }),
        });

        await sendAlertNotification({
            shipmentId,
            eventType: 'SHIPPED',
            severity:  'INFO',
            subject:   `Shipment ${shipment.shipmentNumber || shipmentId.substring(0, 8).toUpperCase()} has been shipped`,
            body:      `Vendor ${shipment.vendorCode} (${req.user?.id}) has marked shipment ${shipment.shipmentNumber || shipmentId} as Shipped. Expected delivery: ${shipment.deliveryDate ? new Date(shipment.deliveryDate).toLocaleDateString() : 'Not specified'}. Please prepare for goods receipt.`,
        });

        return `Shipment ${shipmentId} marked as Shipped.`;
    });

    // ─── ACTION: confirmDelivery ──────────────────────────────────────────
    srv.on('confirmDelivery', async (req) => {
        const { shipmentId, receivedDate, receivedNote } = req.data;
        const shipment = await SELECT.one.from(Shipments).where({ ID: shipmentId });
        if (!shipment) return req.error(404, `Shipment ${shipmentId} not found`);
        if (shipment.status !== 'Shipped') {
            return req.error(400, `Cannot confirm delivery — shipment is currently "${shipment.status}". Must be "Shipped" first.`);
        }

        const confirmedAt = receivedDate || new Date().toISOString();
        await UPDATE(Shipments).set({ status: 'Delivered', deliveryDate: confirmedAt }).where({ ID: shipmentId });

        await INSERT.into(AuditLogs).entries({
            entityName: 'Shipments',
            entityId:   shipmentId,
            action:     'DELIVERY_CONFIRMED',
            changedBy:  req.user?.id || 'system',
            changedAt:  new Date().toISOString(),
            oldValue:   JSON.stringify({ status: 'Shipped', expectedDelivery: shipment.deliveryDate }),
            newValue:   JSON.stringify({ status: 'Delivered', confirmedAt, receivedNote: receivedNote || null }),
        });

        return `Delivery confirmed. Shipment ${shipmentId} marked as Delivered on ${new Date(confirmedAt).toLocaleDateString()}.`;
    });

    // ─── ACTION: flagNotReceived ──────────────────────────────────────────
    srv.on('flagNotReceived', async (req) => {
        const { shipmentId, reason } = req.data;
        const shipment = await SELECT.one.from(Shipments).where({ ID: shipmentId });
        if (!shipment) return req.error(404, `Shipment ${shipmentId} not found`);
        if (shipment.status !== 'Shipped') {
            return req.error(400, `Cannot flag — shipment is currently "${shipment.status}". Must be "Shipped".`);
        }

        await UPDATE(Shipments)
            .set({ status: 'Exception', exceptionType: 'NOT_RECEIVED', delayReason: reason || 'Manager reported goods not received' })
            .where({ ID: shipmentId });

        await INSERT.into(AuditLogs).entries({
            entityName: 'Shipments',
            entityId:   shipmentId,
            action:     'NOT_RECEIVED_FLAGGED',
            changedBy:  req.user?.id || 'system',
            changedAt:  new Date().toISOString(),
            oldValue:   JSON.stringify({ status: 'Shipped' }),
            newValue:   JSON.stringify({ status: 'Exception', exceptionType: 'NOT_RECEIVED', reason: reason || null }),
        });

        return `Shipment ${shipmentId} flagged as not received.`;
    });

    // ─── ACTION: reconfirmDelivery ────────────────────────────────────────
    srv.on('reconfirmDelivery', async (req) => {
        const { shipmentId } = req.data;
        const shipment = await SELECT.one.from(Shipments).where({ ID: shipmentId });
        if (!shipment) return req.error(404, `Shipment ${shipmentId} not found`);
        if (shipment.status !== 'Exception' || shipment.exceptionType !== 'NOT_RECEIVED') {
            return req.error(400, `Cannot reconfirm — shipment is not in NOT_RECEIVED exception state.`);
        }

        await UPDATE(Shipments)
            .set({ status: 'Delivered', exceptionType: null, delayReason: null })
            .where({ ID: shipmentId });

        await INSERT.into(AuditLogs).entries({
            entityName: 'Shipments',
            entityId:   shipmentId,
            action:     'DELIVERY_RECONFIRMED',
            changedBy:  req.user?.id || 'system',
            changedAt:  new Date().toISOString(),
            oldValue:   JSON.stringify({ status: 'Exception', exceptionType: 'NOT_RECEIVED' }),
            newValue:   JSON.stringify({ status: 'Delivered', reconfirmedBy: req.user?.id }),
        });

        return `Vendor reconfirmed delivery. Shipment ${shipmentId} marked as Delivered.`;
    });

};
