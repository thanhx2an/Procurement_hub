const cds = require('@sap/cds');

module.exports = (srv) => {

    // ─── Vendors: live from S/4HANA API_BUSINESS_PARTNER ──────────────────
    srv.on('READ', 'Vendors', async (req) => {
        try {
            const S4_BP = await cds.connect.to('API_BUSINESS_PARTNER');
            const { A_BusinessPartner, A_BusinessPartnerAddress } = S4_BP.entities;

            let query = SELECT.from(A_BusinessPartner)
                .columns(
                    'BusinessPartner', 'BusinessPartnerFullName', 'BusinessPartnerName',
                    'OrganizationBPName1', 'BusinessPartnerCategory', 'Industry',
                    'Supplier', 'LegalForm'
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
                console.warn('[Vendors] Address fetch failed:', addrErr.message);
                return bps;
            }
        } catch (err) {
            console.error('[Vendors]', err.message);
            throw err;
        }
    });

    // ─── Products: live from S/4HANA ──────────────────────────────────────
    srv.on('READ', 'Products', async (req) => {
        try {
            const S4 = await cds.connect.to('API_PRODUCT');
            const { A_Product, A_ProductDescription } = S4.entities;

            const [products, descriptions] = await Promise.all([
                S4.run(
                    SELECT.from(A_Product)
                        .columns('Product', 'ProductType', 'BaseUnit', 'ProductGroup')
                        .limit(50)
                ) ?? [],
                S4.run(
                    SELECT.from(A_ProductDescription)
                        .columns('Product', 'ProductDescription')
                        .where({ Language: 'EN' })
                        .limit(50)
                ) ?? [],
            ]);

            const descMap = {};
            for (const d of descriptions) descMap[d.Product] = d.ProductDescription;
            return products.map(p => ({
                ...p,
                ProductDescription: descMap[p.Product] || p.Product,
            }));
        } catch (err) {
            console.error('[Products]', err.message);
            throw err;
        }
    });

    // ─── PurchaseOrders: live from S/4HANA ────────────────────────────────
    srv.on('READ', 'PurchaseOrders', async (req) => {
        try {
            const S4_PO = await cds.connect.to('API_PURCHASEORDER');
            const { PurchaseOrder } = S4_PO.entities;
            const user = req.user;

            let headerQuery = SELECT.from(PurchaseOrder)
                .columns('PurchaseOrder', 'PurchaseOrderType', 'Supplier', 'DocumentCurrency')
                .limit(20);
            if (user.is('VendorUser') || user.is('VendorAdmin')) {
                const vendorID = user.attr?.VendorID;
                if (!vendorID) return req.error(403, 'No VendorID attribute assigned');
                headerQuery = headerQuery.where({ Supplier: vendorID });
            }
            return await S4_PO.run(headerQuery) ?? [];
        } catch (err) {
            console.error('[PurchaseOrders]', err.message);
            throw err;
        }
    });

    // ─── SupplierInvoices: live from S/4HANA ──────────────────────────────
    srv.on('READ', 'SupplierInvoices', async (req) => {
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

};
