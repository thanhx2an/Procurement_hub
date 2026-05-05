import axios from "axios";

// Luôn dùng relative URL để đi qua AppRouter (cả DEV lẫn production)
// DEV: Vite proxy forward /procurement → localhost:4004
// Production: AppRouter forward /procurement → poc2-procurement-hub-srv với JWT token
const BASE_URL = import.meta.env.VITE_PROCUREMENT_BASE_URL || "/procurement";

const api = axios.create({
  baseURL: BASE_URL,
  headers: { "Content-Type": "application/json" },
  withCredentials: true,
});

export const fetchMe = async () => {
  const { data } = await api.get("/me()");
  return data;
};
export const fetchVendors = async () => {
  const { data } = await api.get("/Vendors");
  return data.value;
};
export const fetchProducts = async () => {
  const { data } = await api.get("/Products");
  return data.value;
};
export const fetchShipments = async () => {
  // Fetch active entities + new drafts (HasActiveEntity=false = draft chưa được submit)
  const [activeRes, draftRes] = await Promise.all([
    api.get("/Shipments?$expand=items"),
    api.get("/Shipments?$filter=IsActiveEntity eq false and HasActiveEntity eq false&$expand=items"),
  ]);
  const active = activeRes.data.value || [];
  const drafts = draftRes.data.value || [];
  return [...active, ...drafts];
};
export const createShipment = async ({ items = [], ...payload }) => {
  const { data } = await api.post("/Shipments", payload);
  const shipmentId = data.ID;
  // Create shipment items after draft is created
  for (const item of items) {
    await api.post(`/Shipments(ID=${shipmentId},IsActiveEntity=false)/items`, item);
  }
  return data;
};
export const fetchPOItems = async (purchaseOrderId) => {
  const { data } = await api.post("/fetchPOItems", { purchaseOrderId });
  return data?.value ?? data ?? [];
};
export const activateDraft = async (id) => {
  const { data } = await api.post(
    `/Shipments(ID=${id},IsActiveEntity=false)/ProcurementService.draftActivate`,
    {},
  );
  return data;
};
export const uploadInvoice = async (id, file) => {
  // Convert to base64 — CAP backend sẽ upload lên Supabase sau khi check role
  const base64 = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  const { data } = await api.post("/uploadInvoicePdf", {
    shipmentId: id,
    content: base64,
    fileName: file.name,
    fileSize: file.size,
  });
  return data;
};
export const triggerCriticalDelay = async ({ shipmentId, reason, proposedDeliveryDate }) => {
  const { data } = await api.post("/criticalDelay", { shipmentId, reason, proposedDeliveryDate });
  return data;
};
export const deleteDraft = async (id) => {
  await api.delete(`/Shipments(ID=${id},IsActiveEntity=false)`);
};
export const fetchAttachments = async (shipmentId) => {
  const { data } = await api.get(
    `/AssetAttachments?$filter=shipment_ID eq ${shipmentId}&$orderby=uploadedAt desc`
  );
  return data.value;
};
export const deleteAttachment = async (id) => {
  await api.delete(`/AssetAttachments(${id})`);
};
export const fetchPriceLedger = async () => {
  const { data } = await api.get("/PriceLedger?$orderby=validFrom desc");
  return data.value;
};
export const createPriceEntry = async (payload) => {
  const { data } = await api.post("/PriceLedger", payload);
  return data;
};
export const fetchPurchaseOrders = async () => {
  const { data } = await api.get("/PurchaseOrders");
  return data.value;
};
export const fetchContacts = async () => {
  const { data } = await api.get("/Contacts?$orderby=lastName asc");
  return data.value;
};
export const createContact = async (payload) => {
  const { data } = await api.post("/Contacts", payload);
  return data;
};
export const updateContact = async ({ id, ...payload }) => {
  const { data } = await api.patch(`/Contacts(${id})`, payload);
  return data;
};
export const deleteContact = async (id) => {
  await api.delete(`/Contacts(${id})`);
};
// ── Dashboard aggregation queries ────────────────────────────────────────────

// KPI counts via OData $apply — backend aggregates, only counts returned
export const fetchShipmentStats = async () => {
  const { data } = await api.get(
    "/Shipments?$apply=filter(IsActiveEntity eq true)/groupby((status),aggregate($count as count))"
  );
  // Returns [{ status: 'Pending', count: 5 }, { status: 'Shipped', count: 3 }, ...]
  const result = {};
  (data.value || []).forEach(row => { result[row.status] = row.count; });
  return result;
};

// At-risk: Pending shipments due within 7 days — $select limits payload
export const fetchAtRiskShipments = async () => {
  const in7days = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await api.get(
    `/Shipments?$filter=IsActiveEntity eq true and status eq 'Pending' and deliveryDate le ${in7days}&$select=ID,shipmentNumber,vendorCode,deliveryDate,status,totalWeight&$orderby=deliveryDate asc`
  );
  return data.value || [];
};

// Chart data: only status + date, no items expand
export const fetchShipmentChart = async () => {
  const { data } = await api.get(
    "/Shipments?$filter=IsActiveEntity eq true&$select=ID,status,deliveryDate,vendorCode,totalWeight"
  );
  return data.value || [];
};

export const fetchActionRequired = async () => {
  const { data } = await api.get(
    "/Shipments?$filter=IsActiveEntity eq true and (status eq 'Shipped' or status eq 'Exception' or status eq 'Pending')&$select=ID,shipmentNumber,vendorCode,status,deliveryDate,exceptionType,delayReason&$orderby=deliveryDate asc"
  );
  return data.value || [];
};

export const fetchAuditLogs = async () => {
  const { data } = await api.get("/AuditLogs?$orderby=changedAt desc");
  return data.value;
};
export const approveException = async ({ shipmentId, newDeliveryDate }) => {
  const { data } = await api.post("/approveException", { shipmentId, newDeliveryDate });
  return data;
};
export const rejectException = async (shipmentId) => {
  const { data } = await api.post("/rejectException", { shipmentId });
  return data;
};
export const markAsShipped = async (shipmentId) => {
  const { data } = await api.post("/markAsShipped", { shipmentId });
  return data;
};
export const confirmDelivery = async ({ shipmentId, receivedDate, receivedNote }) => {
  const { data } = await api.post("/confirmDelivery", { shipmentId, receivedDate, receivedNote });
  return data;
};
export const flagNotReceived = async ({ shipmentId, reason }) => {
  const { data } = await api.post("/flagNotReceived", { shipmentId, reason });
  return data;
};
export const reconfirmDelivery = async (shipmentId) => {
  const { data } = await api.post("/reconfirmDelivery", { shipmentId });
  return data;
};
export const fetchBPContacts = async (vendorId) => {
  const { data } = await api.post("/fetchBPContacts", { vendorId: vendorId || null });
  return data?.value ?? data ?? [];
};
