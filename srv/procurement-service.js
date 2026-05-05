const cds = require('@sap/cds');

// ─── Helper: BTP Alert Notification REST call ─────────────────────────────
async function sendAlertNotification({ subject, body, shipmentId, eventType = 'CRITICALDELAY', severity = 'WARNING' }) {
    try {
        // Đọc thẳng từ VCAP_SERVICES vì CAP không auto-map alert-notification
        let ansCred;
        try {
            const vcap = JSON.parse(process.env.VCAP_SERVICES || '{}');
            ansCred = vcap['alert-notification']?.[0]?.credentials;
        } catch (e) { /* ignore parse error */ }

        if (!ansCred) {
            console.log('[AlertNotification] Service not bound — skipping email. Would have sent:', subject);
            return;
        }

        // 1. Get OAuth token via client_credentials
        // oauth_url đã là full URL (bao gồm /oauth/token?grant_type=...) — dùng thẳng
        const tokenRes = await fetch(ansCred.oauth_url, {
            method: 'POST',
            headers: {
                'Content-Type':  'application/x-www-form-urlencoded',
                'Authorization': 'Basic ' + Buffer.from(`${ansCred.client_id}:${ansCred.client_secret}`).toString('base64'),
            },
        });
        const { access_token } = await tokenRes.json();

        // 2. POST alert event
        const alertRes = await fetch(`${ansCred.url}/cf/producer/v1/resource-events`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${access_token}`,
                'Content-Type':  'application/json',
            },
            body: JSON.stringify({
                eventType,
                eventTimestamp: Math.floor(Date.now() / 1000), // Unix timestamp (seconds)
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
        // Never let notification failure break the main business flow
        console.error('[AlertNotification] Failed to send:', err.message);
    }
}

// ─── Helper: PATCH S/4HANA PO delivery date ───────────────────────────────
async function patchS4DeliveryDate(purchaseOrderId, newDeliveryDate) {
    try {
        const S4_PO = await cds.connect.to('API_PURCHASEORDER');
        await S4_PO.run(
            UPDATE('PurchaseOrder')
                .set({ PurchaseOrderDate: newDeliveryDate })
                .where({ PurchaseOrder: purchaseOrderId })
        );
        console.log('[S4 PATCH] PO', purchaseOrderId, 'delivery date updated to', newDeliveryDate);
    } catch (err) {
        // Log but don't throw — S/4 patch is best-effort in sandbox/mock mode
        console.error('[S4 PATCH] Failed:', err.message);
    }
}

// ─── Auto-deliver cron: Shipped > 3 days past deliveryDate → Delivered ───────
cds.on('served', async () => {
    const AUTO_DELIVER_DAYS = 3;

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

    // Chạy ngay khi server start, sau đó mỗi 12 tiếng
    await runAutoDeliver();
    setInterval(runAutoDeliver, 12 * 60 * 60 * 1000);
});

module.exports = cds.service.impl(async function () {
    const { Shipments, AuditLogs, PriceLedger, AssetAttachments, ShipmentItems } = this.entities;

    // ─── Debug: log every request ─────────────────────────────────────────
    this.before('*', (req) => {
        console.log('[Request]', req.method, req.entity, '| User:', req.user?.id, req.user?.roles);
    });

    // ─── GET /me — trả về user hiện tại + roles ───────────────────────────
    this.on('me', (req) => {
        const user = req.user;
        const roles = ['ProcurementManager', 'VendorUser', 'VendorAdmin', 'Auditor']
            .filter(r => user.is(r));
        return { id: user.id, roles };
    });

    // ─── Vendors: live from S/4HANA API_BUSINESS_PARTNER ──────────────────
    this.on('READ', 'Vendors', async (req) => {
        try {
            const S4_BP = await cds.connect.to('API_BUSINESS_PARTNER');
            const { A_BusinessPartner, A_BusinessPartnerAddress } = S4_BP.entities;

            // ── Base query với extended fields ────────────────────────────
            let query = SELECT.from(A_BusinessPartner)
                .columns(
                    'BusinessPartner',
                    'BusinessPartnerFullName',
                    'BusinessPartnerName',
                    'OrganizationBPName1',
                    'BusinessPartnerCategory',
                    'Industry',
                    'Supplier',
                    'LegalForm'
                )
                .limit(20);

            const user = req.user;
            if (user.is('VendorUser') || user.is('VendorAdmin')) {
                const vendorID = user.attr?.VendorID;
                if (!vendorID) return req.error(403, 'No VendorID attribute assigned');
                query = query.where({ BusinessPartner: vendorID });
            }

            const bps = await S4_BP.run(query) ?? [];
            if (!bps.length) return [];

            // ── Fetch addresses và merge ───────────────────────────────────
            try {
                const bpIds = bps.map(b => b.BusinessPartner);
                const addresses = await S4_BP.run(
                    SELECT.from(A_BusinessPartnerAddress)
                        .columns('BusinessPartner', 'Country', 'CityName', 'StreetName', 'PostalCode', 'Region')
                        .where({ BusinessPartner: { in: bpIds } })
                );
                const addrMap = {};
                addresses.forEach(a => { if (!addrMap[a.BusinessPartner]) addrMap[a.BusinessPartner] = a; });
                return bps.map(bp => ({
                    ...bp,
                    Country:    addrMap[bp.BusinessPartner]?.Country    || null,
                    CityName:   addrMap[bp.BusinessPartner]?.CityName   || null,
                    StreetName: addrMap[bp.BusinessPartner]?.StreetName || null,
                    PostalCode: addrMap[bp.BusinessPartner]?.PostalCode || null,
                    Region:     addrMap[bp.BusinessPartner]?.Region     || null,
                }));
            } catch (addrErr) {
                // Address fetch thất bại → vẫn trả BP data, không crash
                console.warn('[Vendors] Address fetch failed:', addrErr.message);
                return bps;
            }
        } catch (err) {
            console.error('[Vendors]', err.message);
            throw err;
        }
    });

    // ─── Products: live from S/4HANA ──────────────────────────────────────
    this.on('READ', 'Products', async (req) => {
        try {
            const S4 = await cds.connect.to('API_PRODUCT');
            const { A_Product } = S4.entities;
            return await S4.run(
                SELECT.from(A_Product)
                    .columns('Product', 'ProductType', 'BaseUnit', 'ProductGroup', 'ProductDescription')
                    .limit(20)
            ) ?? [];
        } catch (err) {
            console.error('[Products]', err.message);
            throw err;
        }
    });

    // ─── PurchaseOrders: live from S/4HANA ────────────────────────────────
    this.on('READ', 'PurchaseOrders', async (req) => {
        try {
            const S4_PO = await cds.connect.to('API_PURCHASEORDER');
            const { PurchaseOrder } = S4_PO.entities;
            let query = SELECT.from(PurchaseOrder)
                .columns('PurchaseOrder', 'PurchaseOrderType', 'Supplier', 'DocumentCurrency')
                .limit(20);
            const user = req.user;
            if (user.is('VendorUser') || user.is('VendorAdmin')) {
                const vendorID = user.attr?.VendorID;
                if (!vendorID) return req.error(403, 'No VendorID attribute assigned');
                query = query.where({ Supplier: vendorID });
            }
            return await S4_PO.run(query) ?? [];
        } catch (err) {
            console.error('[PurchaseOrders]', err.message);
            throw err;
        }
    });

    // ─── SupplierInvoices: live from S/4HANA ──────────────────────────────
    this.on('READ', 'SupplierInvoices', async (req) => {
        try {
            const S4_INV = await cds.connect.to('API_SUPPLIERINVOICE');
            const { A_SupplierInvoice } = S4_INV.entities;
            return await S4_INV.run(
                SELECT.from(A_SupplierInvoice)
                    .columns('SupplierInvoice', 'FiscalYear', 'CompanyCode', 'DocumentCurrency')
                    .limit(20)
            ) ?? [];
        } catch (err) {
            console.error('[Invoices]', err.message);
            throw err;
        }
    });

    // ─── ACTION: Upload PDF Invoice (server-side Supabase upload) ────────
    // CAP check role trước, sau đó mới upload lên Supabase — anon key không lộ ra frontend
    this.on('uploadInvoicePdf', async (req) => {
        const { shipmentId, content, fileName, fileSize } = req.data;
        console.log('[UploadInvoice] Shipment:', shipmentId, '| File:', fileName, '| User:', req.user?.id);

        const SUPABASE_URL  = 'https://txdrpxbbeenefbeqexiv.supabase.co';
        // service_role key — bypasses RLS, server-side only, never sent to browser
        // Local: set in .env | BTP: cf set-env baongoc-procurement-hub-srv SUPABASE_SERVICE_ROLE_KEY "..."
        const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
        const BUCKET        = 'invoices';

        try {
            // 1. Upload lên Supabase Storage via REST API
            const filePath   = `shipments/${shipmentId}/${Date.now()}_${fileName}`;
            const pdfBuffer  = Buffer.from(content, 'base64');

            const uploadRes = await fetch(
                `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${filePath}`,
                {
                    method:  'POST',
                    headers: {
                        'Authorization': `Bearer ${SUPABASE_KEY}`,
                        'Content-Type':  'application/pdf',
                        'x-upsert':      'true',
                    },
                    body: pdfBuffer,
                }
            );

            if (!uploadRes.ok) {
                const err = await uploadRes.text();
                throw new Error(`Supabase upload failed: ${uploadRes.status} ${err}`);
            }

            const storageUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${filePath}`;
            console.log('[UploadInvoice] Uploaded to:', storageUrl);

            // 2. Record metadata vào AssetAttachments
            await INSERT.into(AssetAttachments).entries({
                shipment_ID: shipmentId,
                fileName,
                mimeType:    'application/pdf',
                storageUrl,
                fileSize:    fileSize || pdfBuffer.length,
                uploadedAt:  new Date().toISOString(),
                uploadedBy:  req.user?.id || 'anonymous',
            });

            // 3. Mock AI/OCR
            const ocrResult = {
                trackingNumber: `TRK-${shipmentId?.substring(0, 8).toUpperCase()}`,
                batchId:        `BATCH-${Date.now()}`,
                confidence:     0.95,
                storageUrl,
            };

            await INSERT.into(AuditLogs).entries({
                entityName: 'Shipments',
                entityId:   shipmentId,
                action:     'INVOICE_UPLOADED',
                changedBy:  req.user?.id || 'system',
                changedAt:  new Date().toISOString(),
                newValue:   JSON.stringify({ ...ocrResult, fileName }),
            });

            return ocrResult;
        } catch (err) {
            console.error('[UploadInvoice] Error:', err.message);
            throw err;
        }
    });

    // ─── SAU KHI CREATE active Shipment: status → Pending ───────────────
    // after('CREATE', 'Shipments') fire khi draftActivate copy sang main table
    // (draft creation đi qua 'Shipments.drafts' nên không bị ảnh hưởng)
    this.after('CREATE', 'Shipments', async (data, req) => {
        const id = data?.ID;
        if (!id) return;
        try {
            // ─── Generate shipmentNumber: SHP-YYYY-XXXXX ─────────────────
            const year = new Date().getFullYear();
            const countResult = await SELECT.one.from(Shipments)
                .columns('count(*) as cnt')
                .where(`shipmentNumber like 'SHP-${year}-%'`);
            const count = parseInt(countResult?.cnt ?? 0) + 1;
            const shipmentNumber = `SHP-${year}-${String(count).padStart(5, '0')}`;

            await UPDATE(Shipments).set({ status: 'Pending', shipmentNumber }).where({ ID: id });
            console.log('[CREATE active] status → Pending, shipmentNumber:', shipmentNumber);

            // ─── Event: SHIPMENT_ACTIVATED ────────────────────────────────
            // Thay thế Event Mesh (không có trên trial) — log event vào AuditLogs
            // Production: replace bằng messaging.emit('hub/shipment/created', ...)
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
                const now   = new Date().toISOString();
                const openEnd = '9999-12-31T00:00:00Z';

                const ledgerEntries = items
                    .filter(i => i.negotiatedPrice > 0 && i.materialId)
                    .map(i => ({
                        vendorCode:      data.vendorCode,
                        materialId:      i.materialId,
                        materialDesc:    i.materialDesc || '',
                        sourceShipment_ID: id,
                        negotiatedPrice: i.negotiatedPrice,
                        basePrice:       0,
                        validFrom:       now,
                        validTo:         openEnd,
                    }));

                if (ledgerEntries.length > 0) {
                    await INSERT.into(PriceLedger).entries(...ledgerEntries);
                    console.log(`[PriceLedger] Auto-created ${ledgerEntries.length} entries for shipment ${id}`);
                }
            } catch (plErr) {
                // Non-fatal: log but don't block shipment activation
                console.error('[PriceLedger] Auto-populate failed:', plErr.message);
            }
        } catch (err) {
            console.error('[CREATE active] Failed to set status Pending:', err.message);
        }
    });

    // ─── AUTO-SET vendorCode khi Vendor tạo shipment ─────────────────────
    // CDS restrict: 'vendorCode = $user.VendorID' — nếu không set thì CREATE fail
    // XSUAA trả VendorID dạng array hoặc nested array — flatten hoàn toàn
    this.before('CREATE', 'Shipments', (req) => {
        const user = req.user;
        if (user.is('VendorUser') || user.is('VendorAdmin')) {
            const raw = user.attr?.VendorID;
            // Flatten mọi dạng: '1000000', ['1000000'], [['1000000']]
            const vendorCode = [].concat(raw ?? []).flat(Infinity)[0];
            req.data.vendorCode = vendorCode != null ? String(vendorCode) : undefined;
            console.log('[CreateShipment] raw VendorID:', JSON.stringify(raw), '→ vendorCode:', req.data.vendorCode);
        }
    });

    // ─── EARLY VALIDATION: Delivery date không được là quá khứ ───────────
    this.before('SAVE', 'Shipments', async (req) => {
        const { deliveryDate } = req.data;
        if (deliveryDate && new Date(deliveryDate) < new Date()) {
            return req.reject(400, 'Delivery date must be in the future');
        }
    });

    // ─── AUDIT LOG: Sau mỗi lần UPDATE Shipment ───────────────────────────
    this.after('UPDATE', 'Shipments', async (data, req) => {
        await INSERT.into(AuditLogs).entries({
            entityName: 'Shipments',
            entityId:   data.ID,
            action:     'UPDATE',
            changedBy:  req.user?.id || 'system',
            changedAt:  new Date().toISOString(),
            newValue:   JSON.stringify(data),
        });
    });

    // ─── AUDIT LOG: Trước mỗi lần tạo PriceLedger entry ──────────────────
    this.before('CREATE', 'PriceLedger', async (req) => {
        await INSERT.into(AuditLogs).entries({
            entityName: 'PriceLedger',
            entityId:   req.data.ID,
            action:     'PRICE_NEGOTIATION',
            changedBy:  req.user?.id || 'system',
            changedAt:  new Date().toISOString(),
            newValue:   JSON.stringify(req.data),
        });
    });

    // ─── ACTION: criticalDelay — Vendor báo giao trễ ─────────────────────
    // Flow: status → Exception → ghi log → gửi email Manager qua Alert Notification
    this.on('criticalDelay', async (req) => {
        const { shipmentId, reason, proposedDeliveryDate } = req.data;

        // 1. Lấy thông tin shipment
        const shipment = await SELECT.one.from(Shipments).where({ ID: shipmentId });
        if (!shipment) return req.error(404, `Shipment ${shipmentId} not found`);

        // 2. Cập nhật status + lý do trễ + ngày đề xuất
        await UPDATE(Shipments)
            .set({
                status:               'Exception',
                delayReason:          reason || 'No reason provided',
                proposedDeliveryDate: proposedDeliveryDate || null,
            })
            .where({ ID: shipmentId });

        // 3. Ghi audit log
        await INSERT.into(AuditLogs).entries({
            entityName: 'Shipments',
            entityId:   shipmentId,
            action:     'CRITICAL_DELAY_FLAGGED',
            changedBy:  req.user?.id || 'system',
            changedAt:  new Date().toISOString(),
            oldValue:   JSON.stringify({ deliveryDate: shipment.deliveryDate, status: shipment.status }),
            newValue:   JSON.stringify({ status: 'Exception', reason, proposedDeliveryDate }),
        });

        // 4. Gửi email thông báo Manager qua BTP Alert Notification
        await sendAlertNotification({
            shipmentId,
            subject: `Critical Delay: Shipment ${shipmentId.substring(0, 8).toUpperCase()}`,
            body:    `Vendor ${shipment.vendorCode} (${req.user?.id}) has flagged shipment ${shipmentId} as critically delayed. Reason: ${reason || 'Not provided'}. Proposed new delivery date: ${proposedDeliveryDate || 'Not specified'}. Please review in the Procurement Hub.`,
            severity: 'WARNING',
        });

        return `Shipment ${shipmentId} flagged as critical delay. Manager has been notified.`;
    });

    // ─── ACTION: approveException — Manager chấp nhận giao trễ ──────────
    // Flow: status → Shipped → PATCH S/4HANA PO delivery date → ghi log
    this.on('approveException', async (req) => {
        const { shipmentId, newDeliveryDate } = req.data;

        // 1. Lấy thông tin shipment
        const shipment = await SELECT.one.from(Shipments).where({ ID: shipmentId });
        if (!shipment) return req.error(404, `Shipment ${shipmentId} not found`);
        if (shipment.status !== 'Exception') {
            return req.error(400, `Shipment is not in Exception status (current: ${shipment.status})`);
        }

        const approvedDate = newDeliveryDate || shipment.deliveryDate;

        // 2. Cập nhật local status
        await UPDATE(Shipments)
            .set({ status: 'Shipped', deliveryDate: approvedDate })
            .where({ ID: shipmentId });

        // 3. PATCH ngược về S/4HANA PO (nếu có purchaseOrderId)
        if (shipment.purchaseOrderId) {
            await patchS4DeliveryDate(shipment.purchaseOrderId, approvedDate);
        } else {
            console.log('[approveException] No purchaseOrderId on shipment — skipping S/4 PATCH');
        }

        // 4. Ghi audit log
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

    // ─── BEFORE DELETE AssetAttachment: xóa file khỏi Supabase trước ───────
    this.before('DELETE', 'AssetAttachments', async (req) => {
        const id = req.params?.[0]?.ID ?? req.params?.[0];
        if (!id) return;
        try {
            const attachment = await SELECT.one.from(AssetAttachments).where({ ID: id });
            if (!attachment?.storageUrl) return;

            // storageUrl format: .../storage/v1/object/public/invoices/shipments/...
            const marker = '/storage/v1/object/public/invoices/';
            const idx = attachment.storageUrl.indexOf(marker);
            if (idx === -1) return;
            const filePath = attachment.storageUrl.slice(idx + marker.length);

            const SUPABASE_URL = 'https://txdrpxbbeenefbeqexiv.supabase.co';
            const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

            const delRes = await fetch(`${SUPABASE_URL}/storage/v1/object/invoices`, {
                method:  'DELETE',
                headers: { 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
                body:    JSON.stringify({ prefixes: [filePath] }),
            });
            if (!delRes.ok) {
                console.error('[DeleteAttachment] Supabase error:', await delRes.text());
            } else {
                console.log('[DeleteAttachment] Deleted from Supabase:', filePath);
            }
        } catch (err) {
            // Không throw — vẫn để DB record bị xóa
            console.error('[DeleteAttachment] Error:', err.message);
        }
    });

    // ─── ACTION: rejectException — Manager từ chối, vendor phải giữ ngày ─
    // Flow: status → Pending → ghi log
    this.on('rejectException', async (req) => {
        const { shipmentId } = req.data;

        // 1. Lấy thông tin shipment
        const shipment = await SELECT.one.from(Shipments).where({ ID: shipmentId });
        if (!shipment) return req.error(404, `Shipment ${shipmentId} not found`);
        if (shipment.status !== 'Exception') {
            return req.error(400, `Shipment is not in Exception status (current: ${shipment.status})`);
        }

        // 2. Revert về Pending
        await UPDATE(Shipments)
            .set({ status: 'Pending', delayReason: null })
            .where({ ID: shipmentId });

        // 3. Ghi audit log
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

    // ─── markAsShipped: Vendor xác nhận hàng đã lên đường → Shipped ─────
    this.on('markAsShipped', async (req) => {
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
            severity: 'INFO',
            subject:  `Shipment ${shipment.shipmentNumber || shipmentId.substring(0, 8).toUpperCase()} has been shipped`,
            body:     `Vendor ${shipment.vendorCode} (${req.user?.id}) has marked shipment ${shipment.shipmentNumber || shipmentId} as Shipped. Expected delivery: ${shipment.deliveryDate ? new Date(shipment.deliveryDate).toLocaleDateString() : 'Not specified'}. Please prepare for goods receipt.`,
        });

        return `Shipment ${shipmentId} marked as Shipped.`;
    });

    // ─── confirmDelivery: Manager xác nhận đã nhận hàng → Delivered ──────
    this.on('confirmDelivery', async (req) => {
        const { shipmentId, receivedDate, receivedNote } = req.data;

        const shipment = await SELECT.one.from(Shipments).where({ ID: shipmentId });
        if (!shipment) return req.error(404, `Shipment ${shipmentId} not found`);
        if (shipment.status !== 'Shipped') {
            return req.error(400, `Cannot confirm delivery — shipment is currently "${shipment.status}". Must be "Shipped" first.`);
        }

        const confirmedAt = receivedDate || new Date().toISOString();

        await UPDATE(Shipments)
            .set({ status: 'Delivered', deliveryDate: confirmedAt })
            .where({ ID: shipmentId });

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

    // ─── flagNotReceived: Manager báo chưa nhận hàng → Exception ─────────
    this.on('flagNotReceived', async (req) => {
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

    // ─── reconfirmDelivery: Vendor xác nhận lại đã giao → Shipped ────────
    this.on('reconfirmDelivery', async (req) => {
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

    // ─── fetchPOItems: pull line items for a PO from S/4HANA ─────────────
    this.on('fetchPOItems', async (req) => {
        const { purchaseOrderId } = req.data;
        if (!purchaseOrderId) return req.error(400, 'purchaseOrderId is required');
        try {
            const S4_PO = await cds.connect.to('API_PURCHASEORDER');
            const { PurchaseOrderItem } = S4_PO.entities;
            const items = await S4_PO.run(
                SELECT.from(PurchaseOrderItem)
                    .columns(
                        'PurchaseOrder', 'PurchaseOrderItem',
                        'Material', 'PurchaseOrderItemText',
                        'OrderQuantity', 'PurchaseOrderQuantityUnit',
                        'NetPriceAmount', 'DocumentCurrency', 'Plant'
                    )
                    .where({ PurchaseOrder: purchaseOrderId })
            ) ?? [];
            return items.map(i => ({
                purchaseOrderItem: i.PurchaseOrderItem,
                material:          i.Material,
                materialDesc:      i.PurchaseOrderItemText,
                orderQuantity:     i.OrderQuantity,
                unit:              i.PurchaseOrderQuantityUnit,
                netPriceAmount:    i.NetPriceAmount,
                currency:          i.DocumentCurrency,
                plant:             i.Plant,
            }));
        } catch (err) {
            console.error('[fetchPOItems]', err.message);
            return req.error(500, `Failed to fetch PO items: ${err.message}`);
        }
    });

    // ─── fetchBPContacts: pull contact persons from S/4HANA Business Partner ─
    this.on('fetchBPContacts', async (req) => {
        const user = req.user;
        let vendorId = req.data?.vendorId;

        // VendorUser/VendorAdmin: ignore param, always use own VendorID
        if (user.is('VendorUser') || user.is('VendorAdmin')) {
            const raw = user.attr?.VendorID;
            vendorId = Array.isArray(raw) ? raw.flat(Infinity)[0] : raw;
            if (!vendorId) return req.error(403, 'No VendorID attribute assigned');
        }
        if (!vendorId) return req.error(400, 'vendorId is required for ProcurementManager');

        try {
            const S4_BP = await cds.connect.to('API_BUSINESS_PARTNER');
            const { A_BusinessPartnerContact, A_BusinessPartner,
                    A_BPContactPersonTelNmbr, A_BPContactPersonEmlAddr,
                    A_BPContactToFuncAndDept } = S4_BP.entities;

            // 1. Get all contact relationships for this vendor
            const contacts = await S4_BP.run(
                SELECT.from(A_BusinessPartnerContact)
                    .columns('RelationshipNumber', 'BusinessPartnerCompany', 'BusinessPartnerPerson')
                    .where({ BusinessPartnerCompany: vendorId })
            ) ?? [];

            if (!contacts.length) return [];

            const personIds = contacts.map(c => c.BusinessPartnerPerson);

            // 2. Fetch person names, phones, emails, func/dept in parallel
            // Phone/email: also filter by BusinessPartnerCompany to avoid cross-vendor data leakage
            const [persons, phones, emails, funcs] = await Promise.all([
                S4_BP.run(
                    SELECT.from(A_BusinessPartner)
                        .columns('BusinessPartner', 'FirstName', 'LastName')
                        .where({ BusinessPartner: { in: personIds } })
                ).catch(() => []),
                S4_BP.run(
                    SELECT.from(A_BPContactPersonTelNmbr)
                        .columns('BusinessPartnerPerson', 'InternationalPhoneNumber')
                        .where({ BusinessPartnerCompany: vendorId, BusinessPartnerPerson: { in: personIds } })
                ).catch(() => []),
                S4_BP.run(
                    SELECT.from(A_BPContactPersonEmlAddr)
                        .columns('BusinessPartnerPerson', 'EmailAddress')
                        .where({ BusinessPartnerCompany: vendorId, BusinessPartnerPerson: { in: personIds } })
                ).catch(() => []),
                S4_BP.run(
                    SELECT.from(A_BPContactToFuncAndDept)
                        .columns('BusinessPartnerPerson', 'ContactPersonDepartmentName', 'ContactPersonFunctionName')
                        .where({ BusinessPartnerPerson: { in: personIds } })
                ).catch(() => []),
            ]);

            // 3. Build lookup maps
            const personMap = Object.fromEntries((persons ?? []).map(p => [p.BusinessPartner, p]));
            const phoneMap  = Object.fromEntries((phones  ?? []).map(p => [p.BusinessPartnerPerson, p.InternationalPhoneNumber]));
            const emailMap  = Object.fromEntries((emails  ?? []).map(e => [e.BusinessPartnerPerson, e.EmailAddress]));
            const funcMap   = Object.fromEntries((funcs   ?? []).map(f => [f.BusinessPartnerPerson, f]));

            // 4. Merge and return
            return contacts.map(c => {
                const pid = c.BusinessPartnerPerson;
                const p   = personMap[pid] || {};
                const f   = funcMap[pid]   || {};
                return {
                    businessPartnerPerson: pid,
                    firstName:   p.FirstName  || '',
                    lastName:    p.LastName   || '',
                    department:  f.ContactPersonDepartmentName || '',
                    jobFunction: f.ContactPersonFunctionName   || '',
                    phone:       phoneMap[pid] || '',
                    email:       emailMap[pid] || '',
                };
            });
        } catch (err) {
            console.error('[fetchBPContacts]', err.message);
            return req.error(500, `Failed to fetch BP contacts: ${err.message}`);
        }
    });
});
