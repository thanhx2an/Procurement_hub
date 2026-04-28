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
    vendor           : Association to Vendors;
    vendorCode       : String(10);
    status           : String enum {
                         Draft; Pending; Shipped; Delivered; Exception
                       } default 'Draft';
    deliveryDate     : DateTime;
    totalWeight      : Decimal(13,3);
    purchaseOrderId  : String(10);
    delayReason      : String(500);
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
}

entity ShipmentItems : cuid {
    parent          : Association to Shipments;
    product         : Association to Products;
    quantity        : Decimal(13,3);
    unit            : String(10);
    negotiatedPrice : Decimal(15,2);
}

entity PriceLedger : cuid, temporal {
    product         : Association to Products;
    vendor          : Association to Vendors;
    vendorCode      : String(10);
    validFrom       : DateTime;
    validTo         : DateTime;
    negotiatedPrice : Decimal(15,2);
    basePrice       : Decimal(15,2);
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