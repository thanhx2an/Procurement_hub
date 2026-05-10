using { hub.procurement as db } from '../db/schema';
using { API_PURCHASEORDER as PO } from './external/API_PURCHASEORDER';
using { API_SUPPLIERINVOICE as INV } from './external/API_SUPPLIERINVOICE';

service ProcurementService @(requires: 'authenticated-user') @(path: '/procurement') {

    // ─── Vendors: Manager thấy tất cả, Vendor chỉ thấy của mình ───
    // where clause bỏ vì Vendors lấy live từ S/4HANA, filter xử lý trong JS
    @(restrict: [
        { grant: 'READ', to: 'ProcurementManager' },
        { grant: 'READ', to: 'VendorUser' },
        { grant: 'READ', to: 'VendorAdmin' }
    ])
    entity Vendors as projection on db.Vendors;

    // ─── Products ───
    @readonly
    @(restrict: [
        { grant: 'READ', to: ['ProcurementManager', 'VendorUser', 'VendorAdmin', 'Auditor'] }
    ])
    entity Products as projection on db.Products;

    // ─── Shipments: dùng vendorCode (từ bạn bè) vì schema đã merge ───
    @odata.draft.enabled
    @(restrict: [
        { grant: ['READ', 'WRITE'], to: 'ProcurementManager' },
        { grant: ['READ', 'CREATE', 'UPDATE'], to: 'VendorUser',  where: 'vendorCode = $user.VendorID' },
        { grant: ['READ', 'CREATE', 'UPDATE'], to: 'VendorAdmin', where: 'vendorCode = $user.VendorID' },
        { grant: 'READ',            to: 'Auditor' }
    ])
    entity Shipments as projection on db.Shipments;

    // ─── ShipmentItems ───
    @(restrict: [
        { grant: ['READ', 'WRITE'], to: 'ProcurementManager' },
        { grant: ['READ', 'WRITE'], to: ['VendorUser', 'VendorAdmin'], where: 'parent.vendorCode = $user.VendorID' },
        { grant: 'READ',            to: 'Auditor' }
    ])
    entity ShipmentItems as projection on db.ShipmentItems;

    // ─── AssetAttachments ───
    @(restrict: [
        { grant: ['READ', 'WRITE'], to: 'ProcurementManager' },
        { grant: ['READ', 'WRITE'], to: ['VendorUser', 'VendorAdmin'], where: 'shipment.vendorCode = $user.VendorID' },
        { grant: 'READ',            to: 'Auditor' }
    ])
    entity AssetAttachments as projection on db.AssetAttachments;

    // ─── PriceLedger ───
    @(restrict: [
        { grant: 'READ',            to: ['ProcurementManager', 'Auditor'] },
        { grant: ['READ', 'WRITE'], to: ['VendorUser', 'VendorAdmin'], where: 'vendorCode = $user.VendorID' }
    ])
    entity PriceLedger as projection on db.PriceLedger;

    // ─── Contacts ───
    @(restrict: [
        { grant: ['READ', 'WRITE'], to: 'ProcurementManager' },
        { grant: ['READ', 'WRITE'], to: 'VendorAdmin', where: 'vendorCode = $user.VendorID' },
        { grant: 'READ',            to: 'VendorUser',  where: 'vendorCode = $user.VendorID' }
    ])
    entity Contacts as projection on db.Contacts;

    // ─── AuditLogs ───
    @readonly
    @(restrict: [
        { grant: 'READ', to: ['ProcurementManager', 'Auditor'] },
        { grant: 'READ', to: ['VendorUser', 'VendorAdmin'], where: 'changedBy = $user.id' }
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

    // ─── Current user info ───
    function me() returns {
        id       : String;
        roles    : array of String;
        vendorId : String;
    };

    // ─── Fetch PO line items from S/4HANA ───
    @(requires: ['VendorUser', 'VendorAdmin', 'ProcurementManager'])
    action fetchPOItems(purchaseOrderId: String) returns array of {
        purchaseOrderItem : String;
        material          : String;
        materialDesc      : String;
        orderQuantity     : Decimal;
        unit              : String;
        netPriceAmount    : Decimal;
        currency          : String;
        plant             : String;
    };

    // ─── Fetch contact persons from S/4HANA Business Partner ───
    @(requires: ['VendorUser', 'VendorAdmin', 'ProcurementManager'])
    action fetchBPContacts(vendorId: String) returns array of {
        businessPartnerPerson : String;
        firstName             : String;
        lastName              : String;
        department            : String;
        jobFunction           : String;
        phone                 : String;
        email                 : String;
    };

    // ─── Actions ───
    @(requires: ['VendorUser', 'VendorAdmin', 'ProcurementManager'])
    action criticalDelay(shipmentId: UUID, reason: String, proposedDeliveryDate: DateTime) returns String;

    @(requires: 'ProcurementManager')
    action approveException(shipmentId: UUID, newDeliveryDate: DateTime) returns String;

    @(requires: 'ProcurementManager')
    action rejectException(shipmentId: UUID) returns String;

    @(requires: ['VendorUser', 'VendorAdmin'])
    action markAsShipped(shipmentId: UUID) returns String;

    @(requires: 'ProcurementManager')
    action confirmDelivery(shipmentId: UUID, receivedDate: DateTime, receivedNote: String) returns String;

    @(requires: 'ProcurementManager')
    action flagNotReceived(shipmentId: UUID, reason: String) returns String;

    @(requires: ['VendorUser', 'VendorAdmin'])
    action reconfirmDelivery(shipmentId: UUID) returns String;

    @(requires: ['VendorUser', 'VendorAdmin', 'ProcurementManager'])
    action uploadInvoicePdf(shipmentId: UUID, content: LargeString, fileName: String, fileSize: Integer, mimeType: String) returns {
        trackingNumber : String;
        batchId        : String;
        confidence     : Decimal;
        storageUrl     : String;
    };
}