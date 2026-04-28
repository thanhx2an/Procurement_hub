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
    
    @Core.MediaType  : invoiceScan_mediaType
    invoiceScan      : LargeBinary;
    
    @Core.IsMediaType: true
    invoiceScan_mediaType : String;
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
