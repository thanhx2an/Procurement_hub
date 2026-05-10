namespace hub.procurement;
using { managed, cuid, temporal } from '@sap/cds/common';

entity Vendors : cuid, managed {
    name        : String(100);
    taxId       : String(50);
    country     : String(3);
    shipments   : Association to many Shipments on shipments.vendor = $self;
}

entity Products : cuid, managed {
    extProductId : String(40);
    name         : String(100);
    basePrice    : Decimal(15,2);
    unit         : String(10);
}

entity Shipments : cuid, managed {
    shipmentNumber   : String(20);  // e.g. SHP-2026-00001, auto-generated on activation
    vendor           : Association to Vendors;
    vendorCode       : String(10);
    status           : String enum {
                         Draft; Pending; Shipped; Delivered; Exception
                       } default 'Draft';
    deliveryDate     : DateTime;
    totalWeight      : Decimal(13,3);
    purchaseOrderId       : String(10);
    purchaseOrderItem     : String(5);   // PO line item number (e.g. '00010') — needed to PATCH S/4HANA schedule line
    deliveryAddress       : String(500);
    notes                 : String(1000);
    delayReason           : String(500);
    proposedDeliveryDate  : DateTime;
    exceptionType         : String enum { VENDOR_DELAY; NOT_RECEIVED };
    trackingNumber        : String(100); // Carrier tracking number (from AI/OCR on delivery note)
    items            : Composition of many ShipmentItems on items.parent = $self;
    attachments      : Composition of many AssetAttachments on attachments.shipment = $self;

    // ⚠️ Giữ invoiceScan nếu muốn backward compatible
    // Bỏ nếu chuyển hoàn toàn sang AssetAttachments
    @Core.MediaType  : invoiceScan_mediaType
    invoiceScan      : LargeBinary;
    @Core.IsMediaType: true
    invoiceScan_mediaType : String;
}

entity AssetAttachments : cuid {
    shipment    : Association to Shipments;
    fileName    : String(255);
    mimeType    : String(100);
    storageUrl  : String(1000);
    fileSize    : Integer;
    uploadedAt  : DateTime;
    uploadedBy  : String(100);
    // AI/OCR extracted fields (from delivery note scan)
    batchId     : String(100);
    vendorName  : String(200);
    totalAmount : Decimal(15,2);
    aiConfidence: Decimal(3,2);
}

entity ShipmentItems : cuid {
    parent          : Association to Shipments;
    product         : Association to Products;
    // Direct S/4HANA material reference (no dependency on CAP Products entity)
    materialId      : String(18);
    materialDesc    : String(100);
    quantity        : Decimal(13,3);
    orderedQuantity : Decimal(13,3);
    unit            : String(10);
    negotiatedPrice : Decimal(15,2);
    poItem          : String(5);
}

entity PriceLedger : cuid, temporal {
    product         : Association to Products;
    vendor          : Association to Vendors;
    vendorCode      : String(10);
    // S/4HANA material reference (auto-populated from ShipmentItems)
    materialId      : String(18);
    materialDesc    : String(100);
    sourceShipment  : Association to Shipments;
    validFrom       : DateTime;
    validTo         : DateTime;
    negotiatedPrice : Decimal(15,2);
    basePrice       : Decimal(15,2);
}

entity Contacts : cuid, managed {
    vendor      : Association to Vendors;
    vendorCode  : String(10);
    firstName   : String(40);
    lastName    : String(40);
    email       : String(241);
    phone       : String(30);
    mobile      : String(30);
    department  : String(40);
    jobFunction : String(40);
    isPrimary   : Boolean default false;
}

entity AuditLogs : cuid {
    entityName  : String(100);
    entityId    : UUID;
    action      : String(50);
    changedBy   : String(100);
    changedAt   : DateTime;
    oldValue    : LargeString;
    newValue    : LargeString;
}