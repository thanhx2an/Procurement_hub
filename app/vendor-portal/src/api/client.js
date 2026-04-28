import axios from 'axios';

const BASE_URL = '/procurement';

const api = axios.create({
  baseURL: BASE_URL,
  headers: {
    'Authorization': `Basic ${btoa('alice:')}`,
    'Content-Type': 'application/json',
  },
});

export const fetchVendors = async () => {
  const { data } = await api.get('/Vendors');
  return data.value;
};

export const fetchProducts = async () => {
  const { data } = await api.get('/Products');
  return data.value;
};

export const fetchShipments = async () => {
  const { data } = await api.get('/Shipments?$expand=items');
  return data.value;
};

export const createShipment = async (payload) => {
  // vendorCode = S/4HANA BusinessPartner number (source of truth)
  const { data } = await api.post('/Shipments', payload);
  return data;
};

export const activateDraft = async (id) => {
  const { data } = await api.post(
    `/Shipments(ID=${id},IsActiveEntity=false)/ProcurementService.draftActivate`, {}
  );
  return data;
};

export const uploadInvoice = async (id, file) => {
  const { data } = await axios.put(
    `${BASE_URL}/Shipments(ID=${id},IsActiveEntity=true)/invoiceScan`,
    file,
    { headers: { 'Authorization': `Basic ${btoa('alice:')}`, 'Content-Type': 'application/pdf' } }
  );
  return data;
};

export const triggerCriticalDelay = async ({ shipmentId, reason }) => {
  const { data } = await api.post('/criticalDelay', { shipmentId, reason });
  return data;
};

export const approveException = async ({ shipmentId, newDeliveryDate }) => {
  const { data } = await api.post('/approveException', { shipmentId, newDeliveryDate });
  return data;
};

export const rejectException = async (shipmentId) => {
  const { data } = await api.post('/rejectException', { shipmentId });
  return data;
};

export const fetchPriceLedger = async () => {
  const { data } = await api.get('/PriceLedger?$orderby=validFrom desc');
  return data.value;
};

export const createPriceEntry = async (payload) => {
  const { data } = await api.post('/PriceLedger', payload);
  return data;
};

export const fetchPurchaseOrders = async () => {
  const { data } = await api.get('/PurchaseOrders');
  return data.value;
};

export const fetchAuditLogs = async () => {
  const { data } = await api.get('/AuditLogs?$orderby=changedAt desc');
  return data.value;
};
