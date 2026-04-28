import axios from "axios";

const BASE_URL =
  import.meta.env.VITE_PROCUREMENT_BASE_URL ||
  (import.meta.env.DEV
    ? "/procurement"
    : "https://1aae4b04trial-dev-poc2-procurement-hub-srv.cfapps.us10-001.hana.ondemand.com/procurement");

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
  const { data } = await axios.put(
    `${BASE_URL}/Shipments(ID=${id},IsActiveEntity=true)/invoiceScan`,
    file,
    { headers: { "Content-Type": "application/pdf" }, withCredentials: true },
  );
  return data;
};
export const triggerCriticalDelay = async (shipmentId) => {
  const { data } = await api.post("/criticalDelay", { shipmentId });
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
