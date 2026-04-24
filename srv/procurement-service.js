const cds = require('@sap/cds');

module.exports = cds.service.impl(async function () {
    const { Shipments, AuditLogs, PriceLedger } = this.entities;

    // ─── Vendors: filter theo role ───
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

    // ─── Products từ S/4HANA ───
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

    // ─── PurchaseOrders ───
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

    // ─── SupplierInvoices ───
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

    // ─── MEDIA STREAM: Upload PDF Invoice ───
    this.on('PUT', 'Shipments', async (req, next) => {
        const contentType = req.headers?.['content-type'] || '';
        if (!contentType.includes('application/pdf')) {
            return next();
        }

        const shipmentId = req.params?.[0]?.ID || req.params?.[0];
        console.log('[MediaStream] Receiving PDF for shipment:', shipmentId);

        try {
            // CAP truyền binary data qua req.data trực tiếp (không phải async iterator)
            let pdfBuffer;
            if (Buffer.isBuffer(req.data)) {
                pdfBuffer = req.data;
            } else if (typeof req.data === 'string') {
                pdfBuffer = Buffer.from(req.data);
            } else if (req.data?.pipe) {
                // Là stream
                const chunks = [];
                await new Promise((resolve, reject) => {
                    req.data.on('data', chunk => chunks.push(chunk));
                    req.data.on('end', resolve);
                    req.data.on('error', reject);
                });
                pdfBuffer = Buffer.concat(chunks);
            } else {
                pdfBuffer = Buffer.from(JSON.stringify(req.data));
            }

            console.log('[MediaStream] PDF size:', pdfBuffer.length, 'bytes');

            // Lưu vào DB
            await UPDATE(Shipments)
                .set({ invoiceScan: pdfBuffer })
                .where({ ID: shipmentId });

            // Mock AI/OCR
            await new Promise(resolve => setTimeout(resolve, 50));
            const ocrResult = {
                trackingNumber : `TRK-${shipmentId?.substring(0, 8).toUpperCase()}`,
                batchId        : `BATCH-${Date.now()}`,
                extractedDate  : new Date().toISOString(),
                confidence     : 0.95,
                source         : 'mock-ai-ocr'
            };
            console.log('[MediaStream] OCR result:', ocrResult);

            // Audit log
            await INSERT.into(AuditLogs).entries({
                entityName : 'Shipments',
                entityId   : shipmentId,
                action     : 'INVOICE_UPLOADED',
                changedBy  : req.user?.id || 'system',
                changedAt  : new Date().toISOString(),
                newValue   : JSON.stringify(ocrResult)
            });

            return ocrResult;
        } catch (err) {
            console.error('[MediaStream] Error:', err.message);
            throw err;
        }
    });

    // ─── EARLY VALIDATION ───
    this.before('SAVE', 'Shipments', async (req) => {
        const { deliveryDate } = req.data;
        if (deliveryDate && new Date(deliveryDate) < new Date()) {
            req.error(400, 'Delivery date must be in the future');
        }
    });

    // ─── AUDIT LOGGING ───
    this.after('UPDATE', 'Shipments', async (data, req) => {
        await INSERT.into(AuditLogs).entries({
            entityName : 'Shipments',
            entityId   : data.ID,
            action     : 'UPDATE',
            changedBy  : req.user?.id || 'system',
            changedAt  : new Date().toISOString(),
            newValue   : JSON.stringify(data)
        });
    });

    this.before('CREATE', 'PriceLedger', async (req) => {
        await INSERT.into(AuditLogs).entries({
            entityName : 'PriceLedger',
            entityId   : req.data.ID,
            action     : 'PRICE_NEGOTIATION',
            changedBy  : req.user?.id || 'system',
            changedAt  : new Date().toISOString(),
            newValue   : JSON.stringify(req.data)
        });
    });
    this.before('*', (req) => {
  console.log('User:', req.user.id, req.user.roles)
})


    // ─── CRITICAL DELAY ACTION ───
    this.on('criticalDelay', async (req) => {
        const { shipmentId } = req.data;
        await UPDATE(Shipments)
            .set({ status: 'Exception' })
            .where({ ID: shipmentId });
        await INSERT.into(AuditLogs).entries({
            entityName : 'Shipments',
            entityId   : shipmentId,
            action     : 'CRITICAL_DELAY_FLAGGED',
            changedBy  : req.user?.id || 'system',
            changedAt  : new Date().toISOString(),
            newValue   : JSON.stringify({ status: 'Exception' })
        });
        return `Shipment ${shipmentId} flagged as critical delay`;
    });
});
