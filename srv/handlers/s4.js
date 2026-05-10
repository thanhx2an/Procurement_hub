const cds = require('@sap/cds');

module.exports = (srv) => {

    // ─── fetchPOItems: pull line items for a PO from S/4HANA ─────────────
    srv.on('fetchPOItems', async (req) => {
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
    srv.on('fetchBPContacts', async (req) => {
        const user = req.user;
        let vendorId = req.data?.vendorId;

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

            const contacts = await S4_BP.run(
                SELECT.from(A_BusinessPartnerContact)
                    .columns('RelationshipNumber', 'BusinessPartnerCompany', 'BusinessPartnerPerson')
                    .where({ BusinessPartnerCompany: vendorId })
            ) ?? [];

            if (!contacts.length) return [];

            const personIds = contacts.map(c => c.BusinessPartnerPerson);

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

            const personMap = Object.fromEntries((persons ?? []).map(p => [p.BusinessPartner, p]));
            const phoneMap  = Object.fromEntries((phones  ?? []).map(p => [p.BusinessPartnerPerson, p.InternationalPhoneNumber]));
            const emailMap  = Object.fromEntries((emails  ?? []).map(e => [e.BusinessPartnerPerson, e.EmailAddress]));
            const funcMap   = Object.fromEntries((funcs   ?? []).map(f => [f.BusinessPartnerPerson, f]));

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

};
