using { hub.procurement as db } from '../db/schema';
using { API_PURCHASEORDER as PO } from './external/API_PURCHASEORDER';
using { API_SUPPLIERINVOICE as INV } from './external/API_SUPPLIERINVOICE';

service ProcurementService @(requires: 'authenticated-user') @(path: '/procurement') {

    // ─── Vendors: Manager thấy tất cả, Vendor chỉ thấy của mình ───
    @(restrict: [
        { grant: 'READ', to: 'ProcurementManager' },
        
        { grant: 'READ', to: 'VendorUser', where: 'BusinessPartner = $user.VendorID' },
        { grant: 'READ', to: 'VendorAdmin', where: 'BusinessPartner = $user.VendorID' }
    ])
    entity Vendors as projection on db.Vendors;

    // ─── Products: tất cả roles đều đọc được ───
    @readonly
    @(restrict: [
        { grant: 'READ', to: ['ProcurementManager', 'VendorUser', 'VendorAdmin', 'Auditor'] }
    ])
    entity Products as projection on db.Products;

    // ─── Shipments: Draft enabled, Vendor chỉ thấy shipment của mình ───
    @odata.draft.enabled
    @(restrict: [
        { grant: ['READ', 'WRITE'], to: 'ProcurementManager' },
        { grant: ['READ', 'WRITE'], to: 'VendorUser',  where: 'vendor_BusinessPartner = $user.VendorID' },
        { grant: ['READ', 'WRITE'], to: 'VendorAdmin', where: 'vendor_BusinessPartner = $user.VendorID' },
        { grant: 'READ',            to: 'Auditor' }
    ])
    entity Shipments as projection on db.Shipments;

    // ─── ShipmentItems: theo Shipment ───
    @(restrict: [
        { grant: ['READ', 'WRITE'], to: 'ProcurementManager' },
        { grant: ['READ', 'WRITE'], to: ['VendorUser', 'VendorAdmin'] },
        { grant: 'READ',            to: 'Auditor' }
    ])
    entity ShipmentItems as projection on db.ShipmentItems;

    // ─── PriceLedger: Vendor write, Manager + Auditor read ───
    @(restrict: [
        { grant: 'READ',            to: ['ProcurementManager', 'Auditor'] },
        { grant: ['READ', 'WRITE'], to: ['VendorUser', 'VendorAdmin'] }
    ])
    entity PriceLedger as projection on db.PriceLedger;

    // ─── AuditLogs: chỉ Auditor và Manager đọc ───
    @readonly
    @(restrict: [
        { grant: 'READ', to: ['ProcurementManager', 'Auditor'] }
    ])
    entity AuditLogs as projection on db.AuditLogs;

    // ─── PurchaseOrders từ S/4HANA ───
    @readonly
    @(restrict: [
        { grant: 'READ', to: 'ProcurementManager' },
        { grant: 'READ', to: ['VendorUser', 'VendorAdmin'], where: 'Supplier = $user.VendorID' }
    ])
    entity PurchaseOrders as projection on PO.PurchaseOrder;

    // ─── SupplierInvoices từ S/4HANA ───
    @readonly
    @(restrict: [
        { grant: 'READ', to: ['ProcurementManager', 'Auditor'] },
        { grant: 'READ', to: ['VendorUser', 'VendorAdmin'] }
    ])
    entity SupplierInvoices as projection on INV.A_SupplierInvoice;

    // ─── criticalDelay: chỉ Manager ───
    @(requires: 'ProcurementManager')
    action criticalDelay(shipmentId: UUID) returns String;
}
