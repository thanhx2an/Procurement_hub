const cds = require('@sap/cds');

// ─── Side-effects: đăng ký cds.on('served', ...) cron job ────────────────
require('./utils/auto-deliver');

// ─── Handlers ─────────────────────────────────────────────────────────────
const registerVendorHandlers   = require('./handlers/vendors');
const registerShipmentHandlers = require('./handlers/shipments');
const registerInvoiceHandlers  = require('./handlers/invoice');
const registerS4Handlers       = require('./handlers/s4');

module.exports = cds.service.impl(async function () {
    const { Shipments, AuditLogs, PriceLedger, AssetAttachments, ShipmentItems } = this.entities;

    // ─── Debug: log every request ─────────────────────────────────────────
    this.before('*', (req) => {
        console.log('[Request]', req.method, req.entity, '| User:', req.user?.id, req.user?.roles);
    });

    // ─── GET /me — trả về user hiện tại + roles + vendorId ───────────────
    this.on('me', (req) => {
        const user  = req.user;
        const roles = ['ProcurementManager', 'VendorUser', 'VendorAdmin', 'Auditor']
            .filter(r => user.is(r));
        const raw      = user.attr?.VendorID;
        const vendorId = [].concat(raw ?? []).flat(Infinity)[0] ?? null;
        return { id: user.id, roles, vendorId };
    });

    // ─── Đăng ký các handler groups ───────────────────────────────────────
    registerVendorHandlers(this);
    registerShipmentHandlers(this, { Shipments, AuditLogs, PriceLedger, ShipmentItems });
    registerInvoiceHandlers(this,  { Shipments, AuditLogs, AssetAttachments });
    registerS4Handlers(this);
});
