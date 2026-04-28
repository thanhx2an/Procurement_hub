namespace hub.procurement;
using { managed, cuid, temporal } from '@sap/cds/common';

entity Vendors : cuid, managed {
    name        : String(100);
    taxId       : String(50);
    country     : String(3);
}

entity Products : cuid, managed {
    extProductId : String(40);   // S/4HANA reference
    name         : String(100);
    basePrice    : Decimal(15,2);
    unit         : String(10);
}

entity Shipments : cuid, managed {
    vendorCode       : String(10);   // S/4HANA BusinessPartner number (source of truth)
    status           : String enum {
                         Draft; Pending; Shipped; Delivered; Exception
                       } default 'Draft';
    deliveryDate     : DateTime;
    totalWeight      : Decimal(13,3);
    purchaseOrderId  : String(10);   // S/4HANA PO reference for PATCH-back
    delayReason      : String(500);  // Vendor's reason when flagging a delay
    items            : Composition of many ShipmentItems on items.parent = $self;
    attachments      : Composition of many AssetAttachments on attachments.shipment = $self;

    // Legacy media stream endpoint — kept for OData PUT route compatibility.
    // Actual binary is stored in Supabase Storage; HANA only holds metadata.
    @Core.MediaType  : invoiceScan_mediaType
    invoiceScan      : LargeBinary;
    @Core.IsMediaType: true
    invoiceScan_mediaType : String;
}

// Stores PDF/document metadata; actual file lives in Supabase Storage
entity AssetAttachments : cuid {
    shipment    : Association to Shipments;
    fileName    : String(255);
    mimeType    : String(100);
    storageUrl  : String(1000);   // Public Supabase Storage URL
    fileSize    : Integer;        // bytes
    uploadedAt  : DateTime;
    uploadedBy  : String(100);
}

entity ShipmentItems : cuid {
    parent       : Association to Shipments;
    product      : Association to Products;
    quantity     : Decimal(13,3);
    unit         : String(10);
    negotiatedPrice : Decimal(15,2);
}

entity PriceLedger : cuid, temporal {
    product         : Association to Products;
    vendorCode      : String(10);   // S/4HANA BusinessPartner number
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
