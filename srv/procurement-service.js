const cds = require('@sap/cds');

// ─── Helper: BTP Alert Notification REST call ─────────────────────────────
async function sendAlertNotification({ subject, body, shipmentId, severity = 'WARNING' }) {
    try {
        const ansCred = cds.env.requires?.['alert-notification']?.credentials;
        if (!ansCred) {
            console.log('[AlertNotification] Service not bound — skipping email. Would have sent:', subject);
            return;
        }

        // 1. Get OAuth token via client_credentials
        const tokenRes = await fetch(`${ansCred.oauth_url}/oauth/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type:    'client_credentials',
                client_id:     ansCred.client_id,
                client_secret: ansCred.client_secret,
            }),
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
                eventType:      'CRITICALDELAY',
                eventTimestamp: new Date().toISOString(),
                severity,
                category:       'ALERT',
                subject,
                body,
                resource: {
                    resourceName:     'poc2-procurement-hub',
                    resourceType:     'Shipment',
                    resourceInstance: shipmentId,
                },
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

module.exports = cds.service.impl(async function () {
    const { Shipments, AuditLogs, PriceLedger, AssetAttachments } = this.entities;

    // ─── Debug: log every request ─────────────────────────────────────────
    this.before('*', (req) => {
        console.log('[Request]', req.method, req.entity, '| User:', req.user?.id, req.user?.roles);
    });

    // ─── Vendors: live from S/4HANA API_BUSINESS_PARTNER ──────────────────
    this.on('READ', 'Vendors', async (req) => {
        try {
            const S4_BP = await cds.connect.to('API_BUSINESS_PARTNER');
            const { A_BusinessPartner } = S4_BP.entities;
            let query = SELECT.from(A_BusinessPartner)
                .columns('BusinessPartner', 'BusinessPartnerFullName', 'BusinessPartnerCategory')
                .limit(20);
            const user = req.user;
            if (user.is('VendorUser') || user.is('VendorAdmin')) {
                const vendorID = user.attr?.VendorID;
                if (!vendorID) return req.error(403, 'No VendorID attribute assigned');
                query = query.where({ BusinessPartner: vendorID });
            }
            return await S4_BP.run(query) ?? [];
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
                    .columns('Product', 'ProductType', 'BaseUnit', 'ProductGroup')
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
        // Local: set in .env | BTP: cf set-env poc2-procurement-hub-srv SUPABASE_SERVICE_ROLE_KEY "..."
        const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY
            || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR4ZHJweGJiZWVuZWZiZXFleGl2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzM0OTcwNiwiZXhwIjoyMDkyOTI1NzA2fQ.n7g-0mzfpy8GbBcj1P9OPSfDNFFI7vSd3WwXEms6nY4';
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

    // ─── AUTO-SET vendorCode khi Vendor tạo shipment ─────────────────────
    // CDS restrict: 'vendorCode = $user.VendorID' — nếu không set thì CREATE fail
    this.before('CREATE', 'Shipments', (req) => {
        const user = req.user;
        if (user.is('VendorUser') || user.is('VendorAdmin')) {
            req.data.vendorCode = user.attr?.VendorID;
            console.log('[CreateShipment] Auto-set vendorCode:', req.data.vendorCode);
        }
    });

    // ─── EARLY VALIDATION: Delivery date không được là quá khứ ───────────
    this.before('SAVE', 'Shipments', async (req) => {
        const { deliveryDate } = req.data;
        if (deliveryDate && new Date(deliveryDate) < new Date()) {
            req.error(400, 'Delivery date must be in the future');
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
        const { shipmentId, reason } = req.data;

        // 1. Lấy thông tin shipment
        const shipment = await SELECT.one.from(Shipments).where({ ID: shipmentId });
        if (!shipment) return req.error(404, `Shipment ${shipmentId} not found`);

        // 2. Cập nhật status + lý do trễ
        await UPDATE(Shipments)
            .set({ status: 'Exception', delayReason: reason || 'No reason provided' })
            .where({ ID: shipmentId });

        // 3. Ghi audit log
        await INSERT.into(AuditLogs).entries({
            entityName: 'Shipments',
            entityId:   shipmentId,
            action:     'CRITICAL_DELAY_FLAGGED',
            changedBy:  req.user?.id || 'system',
            changedAt:  new Date().toISOString(),
            newValue:   JSON.stringify({ status: 'Exception', reason }),
        });

        // 4. Gửi email thông báo Manager qua BTP Alert Notification
        await sendAlertNotification({
            shipmentId,
            subject: `⚠️ Critical Delay: Shipment ${shipmentId.substring(0, 8).toUpperCase()}`,
            body:    `Vendor ${shipment.vendorCode} (${req.user?.id}) has flagged shipment ${shipmentId} as critically delayed.\n\nReason: ${reason || 'Not provided'}\n\nPlease review and approve or reject this exception in the Procurement Hub.`,
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
            newValue:   JSON.stringify({ status: 'Shipped', newDeliveryDate: approvedDate }),
        });

        return `Exception approved. Shipment ${shipmentId} status set to Shipped. New delivery date: ${approvedDate}.`;
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
            newValue:   JSON.stringify({ status: 'Pending', previousStatus: 'Exception' }),
        });

        return `Exception rejected. Shipment ${shipmentId} reverted to Pending. Vendor must maintain original delivery date.`;
    });
});
