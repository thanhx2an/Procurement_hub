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

export const fetchVendors = async () => {
  const { data } = await api.get("/Vendors");
  return data.value;
};
export const fetchProducts = async () => {
  const { data } = await api.get("/Products");
  return data.value;
};
export const fetchShipments = async () => {
  const { data } = await api.get("/Shipments?$expand=items");
  return data.value;
};
export const createShipment = async (payload) => {
  const { data } = await api.post("/Shipments", payload);
  return data;
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
export const triggerCriticalDelay = async (shipmentId, reason) => {
  const { data } = await api.post("/criticalDelay", { shipmentId, reason });
  return data;
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
