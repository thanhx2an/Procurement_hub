import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Title,
  Card,
  CardHeader,
  Button,
  Dialog,
  Form,
  FormItem,
  Input,
  Select,
  Option,
  BusyIndicator,
  MessageStrip,
  FlexBox,
  FlexBoxDirection,
  AnalyticalTable,
  Bar,
  Label,
  DatePicker,
  Toast,
} from "@ui5/webcomponents-react";
import {
  fetchShipments,
  createShipment,
  activateDraft,
  createEmptyDraft,
  updateDraft,
  addDraftItem,
  updateDraftItem,
  deleteDraftItem,
  uploadInvoice,
  triggerCriticalDelay,
  fetchVendors,
  fetchPurchaseOrders,
  fetchPOItems,
  fetchMe,
  approveException,
  rejectException,
  confirmDelivery,
  markAsShipped,
  deleteDraft,
  fetchAttachments,
  deleteAttachment,
  flagNotReceived,
  reconfirmDelivery,
} from "../api/client";

const STATUS_STYLES = {
  Draft: { bg: "#e6f2ff", fg: "#0a6ed1" },
  Pending: { bg: "#fff8db", fg: "#8b6f00" },
  Shipped: { bg: "#e8f7f5", fg: "#0f766e" },
  Delivered: { bg: "#edf8e9", fg: "#256f3a" },
  Exception: { bg: "#fbeaea", fg: "#aa0808" },
};

const isOverdue = (shipment) => {
  if (shipment.status !== 'Shipped' || !shipment.deliveryDate) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const delivery = new Date(shipment.deliveryDate);
  delivery.setHours(0, 0, 0, 0);
  return delivery < today;
};

function StatusPill({ value }) {
  const style = STATUS_STYLES[value] || { bg: "#f2f2f2", fg: "#32363a" };
  return (
    <span
      style={{
        display: "inline-block",
        padding: "0.15rem 0.5rem",
        borderRadius: 999,
        fontSize: "0.75rem",
        fontWeight: 600,
        background: style.bg,
        color: style.fg,
      }}
    >
      {value || "Unknown"}
    </span>
  );
}

export default function ShipmentWorkspace() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [uploadMsg, setUploadMsg] = useState(null);
  const [ocrResult, setOcrResult] = useState(null);
  const [actionMsg, setActionMsg] = useState(null);
  const [approveDialogOpen, setApproveDialogOpen] = useState(false);
  const [exceptionDialogOpen, setExceptionDialogOpen] = useState(false);
  const [exceptionShipment, setExceptionShipment] = useState(null);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [notReceivedDialogOpen, setNotReceivedDialogOpen] = useState(false);
  const notReceivedRef = useRef({});
  const confirmRef = useRef({});
  const confirmDatePickerRef = useRef(null);
  // New Shipment form state
  const [poItems, setPoItems] = useState([]);
  const [poItemsLoading, setPoItemsLoading] = useState(false);
  const [shipQtys, setShipQtys] = useState({});   // { poItem: qty }
  const todayISO = () => new Date().toISOString().split('T')[0] + 'T00:00:00Z';
  const [newForm, setNewForm] = useState({ purchaseOrderId: '', deliveryDate: todayISO(), deliveryAddress: '', notes: '', totalWeight: '' });
  const formRef = useRef({});
  // Draft auto-save state
  const [activeDraftId, setActiveDraftId] = useState(null);  // UUID of draft being edited
  const [draftItems, setDraftItems] = useState([]);           // items already saved to DB
  const patchDebounceRef = useRef(null);
  const approveRef = useRef({});
  const exceptionRef = useRef({});
  const deliveryDatePickerRef = useRef(null);
  const approveDatePickerRef = useRef(null);
  const exceptionDatePickerRef = useRef(null);
  const toastRef = useRef(null);
  const [toastMsg, setToastMsg] = useState("");

  const { data: shipments = [], isLoading } = useQuery({
    queryKey: ["shipments"],
    queryFn: fetchShipments,
  });
  const { data: vendors = [] } = useQuery({
    queryKey: ["vendors"],
    queryFn: fetchVendors,
  });
  const { data: purchaseOrders = [] } = useQuery({
    queryKey: ["purchaseOrders"],
    queryFn: fetchPurchaseOrders,
  });
  const { data: me = {} } = useQuery({
    queryKey: ["me"],
    queryFn: fetchMe,
  });
  const isManager = me.roles?.includes('ProcurementManager');
  const visibleShipments = isManager
    ? shipments.filter((s) => s.IsActiveEntity !== false)
    : shipments;

  const createMutation = useMutation({
    mutationFn: createShipment,
    onSuccess: () => {
      queryClient.invalidateQueries(["shipments"]);
      setDialogOpen(false);
      setPoItems([]);
      setShipQtys({});
      setNewForm({ purchaseOrderId: '', deliveryDate: todayISO(), deliveryAddress: '', notes: '', totalWeight: '' });
    },
    onError: (err) => {
      const msg = err?.response?.data?.error?.message || err.message || 'Unknown error';
      setActionMsg({ type: 'Negative', text: `❌ Create failed: ${msg}` });
    },
  });

  const submitDraftMutation = useMutation({
    mutationFn: activateDraft,
    onSuccess: () => {
      queryClient.invalidateQueries(["shipments"]);
      setDialogOpen(false);
      setActiveDraftId(null);
      setDraftItems([]);
      setPoItems([]);
      setShipQtys({});
      setNewForm({ purchaseOrderId: '', deliveryDate: todayISO(), deliveryAddress: '', notes: '', totalWeight: '' });
    },
    onError: (err) => {
      const msg = err?.response?.data?.error?.message || err.message || 'Unknown error';
      setActionMsg({ type: 'Negative', text: `❌ Activate failed: ${msg}` });
    },
  });

  const delayMutation = useMutation({
    mutationFn: triggerCriticalDelay,
    onSuccess: () => {
      queryClient.invalidateQueries(["shipments"]);
      setExceptionDialogOpen(false);
      setExceptionShipment(null);
    },
  });

  const deleteDraftMutation = useMutation({
    mutationFn: deleteDraft,
    onSuccess: () => queryClient.invalidateQueries(["shipments"]),
  });

  const approveMutation = useMutation({
    mutationFn: approveException,
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries(["shipments"]);
      setApproveDialogOpen(false);
      setActionMsg({ type: "Positive", text: "✅ Exception approved — shipment set to Shipped." });
      setSelected((prev) => prev ? { ...prev, status: "Shipped" } : prev);
      setTimeout(() => setActionMsg(null), 4000);
    },
    onError: (err) => setActionMsg({ type: "Negative", text: `Approve failed: ${err.message}` }),
  });

  const rejectMutation = useMutation({
    mutationFn: rejectException,
    onSuccess: () => {
      queryClient.invalidateQueries(["shipments"]);
      setActionMsg({ type: "Information", text: "↩️ Exception rejected — shipment set back to Pending." });
      setSelected((prev) => prev ? { ...prev, status: "Pending" } : prev);
      setTimeout(() => setActionMsg(null), 4000);
    },
    onError: (err) => setActionMsg({ type: "Negative", text: `Reject failed: ${err.message}` }),
  });

  const confirmMutation = useMutation({
    mutationFn: confirmDelivery,
    onSuccess: () => {
      queryClient.invalidateQueries(["shipments"]);
      setConfirmDialogOpen(false);
      setActionMsg({ type: "Positive", text: "✅ Delivery confirmed — shipment marked as Delivered." });
      setSelected((prev) => prev ? { ...prev, status: "Delivered" } : prev);
      setTimeout(() => setActionMsg(null), 4000);
    },
    onError: (err) => setActionMsg({ type: "Negative", text: `Confirm failed: ${err?.response?.data?.error?.message || err.message}` }),
  });

  const flagNotReceivedMutation = useMutation({
    mutationFn: flagNotReceived,
    onSuccess: () => {
      queryClient.invalidateQueries(["shipments"]);
      setNotReceivedDialogOpen(false);
      setSelected((prev) => prev ? { ...prev, status: "Exception", exceptionType: "NOT_RECEIVED" } : prev);
      setActionMsg({ type: "Warning", text: "⚠️ Flagged as not received — vendor will be notified." });
      setTimeout(() => setActionMsg(null), 4000);
    },
    onError: (err) => setActionMsg({ type: "Negative", text: `Failed: ${err?.response?.data?.error?.message || err.message}` }),
  });

  const reconfirmMutation = useMutation({
    mutationFn: reconfirmDelivery,
    onSuccess: () => {
      queryClient.invalidateQueries(["shipments"]);
      setSelected((prev) => prev ? { ...prev, status: "Delivered", exceptionType: null } : prev);
      setActionMsg({ type: "Positive", text: "✅ Delivery reconfirmed — shipment marked as Delivered." });
      setTimeout(() => setActionMsg(null), 4000);
    },
    onError: (err) => setActionMsg({ type: "Negative", text: `Failed: ${err?.response?.data?.error?.message || err.message}` }),
  });

  const markShippedMutation = useMutation({
    mutationFn: markAsShipped,
    onSuccess: () => {
      queryClient.invalidateQueries(["shipments"]);
      setSelected((prev) => prev ? { ...prev, status: "Shipped" } : prev);
      setToastMsg("✅ Shipment marked as Shipped! The procurement team has been notified.");
      toastRef.current?.show?.() ?? toastRef.current?.getDomRef()?.show?.();
    },
    onError: (err) => setActionMsg({ type: "Negative", text: `Failed: ${err?.response?.data?.error?.message || err.message}` }),
  });

  const isActiveShipment = selected && selected.IsActiveEntity !== false;
  const { data: attachments = [], isLoading: attachmentsLoading } = useQuery({
    queryKey: ["attachments", selected?.ID],
    queryFn: () => fetchAttachments(selected.ID),
    enabled: !!isActiveShipment,
  });

  const deleteAttachmentMutation = useMutation({
    mutationFn: deleteAttachment,
    onSuccess: () => {
      queryClient.invalidateQueries(["attachments", selected?.ID]);
      setActionMsg({ type: "Positive", text: "🗑️ PDF deleted successfully." });
      setTimeout(() => setActionMsg(null), 3000);
    },
    onError: (err) => setActionMsg({ type: "Negative", text: `Delete failed: ${err.message}` }),
  });

  const handleFileUpload = async (e, shipmentId) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadMsg({
      type: "Information",
      text: "Uploading PDF and running AI/OCR...",
    });
    try {
      const result = await uploadInvoice(shipmentId, file);
      setOcrResult(result);
      setUploadMsg({
        type: "Positive",
        text: `✅ PDF uploaded! Tracking: ${result?.trackingNumber}`,
      });
      queryClient.invalidateQueries(["shipments"]);
    } catch (err) {
      setUploadMsg({ type: "Negative", text: `Upload failed: ${err.message}` });
    }
  };

  const handlePOSelect = async (poId) => {
    setNewForm(f => ({ ...f, purchaseOrderId: poId }));
    patchDraftField({ purchaseOrderId: poId });
    setPoItems([]);
    setShipQtys({});
    if (!poId) return;
    setPoItemsLoading(true);
    try {
      // Delete existing draft items first (allow re-selecting PO)
      if (activeDraftId && draftItems.length > 0) {
        for (const di of draftItems) {
          await deleteDraftItem({ shipmentId: activeDraftId, itemId: di.ID }).catch(() => {});
        }
        setDraftItems([]);
      }

      const items = await fetchPOItems(poId);
      setPoItems(items);
      const qtys = {};
      items.forEach(i => { qtys[i.purchaseOrderItem] = i.orderQuantity; });
      setShipQtys(qtys);

      // Auto-save items into the draft immediately
      if (activeDraftId) {
        const added = [];
        for (const item of items) {
          try {
            const res = await addDraftItem({
              shipmentId: activeDraftId,
              item: {
                materialId:      item.material,
                materialDesc:    item.materialDesc,
                quantity:        parseFloat(item.orderQuantity) || 0,
                orderedQuantity: parseFloat(item.orderQuantity) || 0,
                unit:            item.unit,
                negotiatedPrice: item.netPriceAmount || 0,
                poItem:          item.purchaseOrderItem,
              },
            });
            added.push({ ...res, poItem: item.purchaseOrderItem });
          } catch (e) {
            console.warn('[draft] Failed to add item:', e.message);
          }
        }
        setDraftItems(added);
      }
    } catch (e) {
      setActionMsg({ type: 'Negative', text: `Failed to load PO items: ${e.message}` });
    } finally {
      setPoItemsLoading(false);
    }
  };

  const handleCreateShipment = () => {
    if (!newForm.deliveryDate) { alert('Please select a delivery date.'); return; }
    const items = poItems.map(i => ({
      materialId:      i.material,
      materialDesc:    i.materialDesc,
      quantity:        parseFloat(shipQtys[i.purchaseOrderItem]) || 0,
      orderedQuantity: i.orderQuantity,
      unit:            i.unit,
      negotiatedPrice: i.netPriceAmount || 0,
      poItem:          i.purchaseOrderItem,
    }));
    createMutation.mutate({
      deliveryDate:     newForm.deliveryDate,
      totalWeight:      parseFloat(newForm.totalWeight) || 0,
      purchaseOrderId:  newForm.purchaseOrderId || null,
      deliveryAddress:  newForm.deliveryAddress || null,
      notes:            newForm.notes || null,
      status:           'Draft',
      items,
    });
  };

  // ── Gmail-style draft helpers ─────────────────────────────────────────────

  // Schedule a debounced PATCH on the active draft (700ms)
  const patchDraftField = (payload) => {
    if (!activeDraftId) return;
    if (patchDebounceRef.current) clearTimeout(patchDebounceRef.current);
    patchDebounceRef.current = setTimeout(() => {
      updateDraft({ id: activeDraftId, payload }).catch(() => {});
    }, 700);
  };

  // Click "New Shipment" → create empty draft immediately, then open dialog
  const handleOpenNewShipment = async () => {
    try {
      const draft = await createEmptyDraft();
      setActiveDraftId(draft.ID);
      setDraftItems([]);
      setPoItems([]);
      setShipQtys({});
      setNewForm({ purchaseOrderId: '', deliveryDate: todayISO(), deliveryAddress: '', notes: '', totalWeight: '' });
      setDialogOpen(true);
      queryClient.invalidateQueries(["shipments"]);
    } catch (err) {
      setActionMsg({ type: 'Negative', text: `Failed to create draft: ${err?.response?.data?.error?.message || err.message}` });
    }
  };

  // Click "Edit" on existing draft → load data, open dialog
  const handleEditDraft = (draft) => {
    setActiveDraftId(draft.ID);
    setDraftItems(draft.items || []);
    setPoItems([]);
    setShipQtys({});
    setNewForm({
      purchaseOrderId: draft.purchaseOrderId || '',
      deliveryDate:    draft.deliveryDate || todayISO(),
      deliveryAddress: draft.deliveryAddress || '',
      notes:           draft.notes || '',
      totalWeight:     draft.totalWeight != null ? String(draft.totalWeight) : '',
    });
    setDialogOpen(true);
  };

  // Close dialog without activating — draft stays in DB
  const handleCloseDialog = () => {
    if (patchDebounceRef.current) clearTimeout(patchDebounceRef.current);
    setDialogOpen(false);
    setActiveDraftId(null);
    setDraftItems([]);
    setPoItems([]);
    setShipQtys({});
    setNewForm({ purchaseOrderId: '', deliveryDate: todayISO(), deliveryAddress: '', notes: '', totalWeight: '' });
    queryClient.invalidateQueries(["shipments"]);
  };

  const columns = [
    {
      Header: "Shipment #",
      accessor: "shipmentNumber",
      Cell: ({ value, row }) => value || row.original.ID?.substring(0, 8) + "…",
    },
    {
      Header: "Vendor",
      accessor: "vendorCode",
      Cell: ({ value }) => value || "—",
    },
    {
      Header: "Delivery Date",
      accessor: "deliveryDate",
      Cell: ({ value }) => (value ? new Date(value).toLocaleDateString() : "—"),
    },
    { Header: "Weight (kg)", accessor: "totalWeight" },
    {
      Header: "Status",
      accessor: "status",
      Cell: ({ value, row }) =>
        row.original.IsActiveEntity === false ? (
          <StatusPill value="Draft" />
        ) : (
          <FlexBox style={{ gap: '0.4rem', alignItems: 'center' }}>
            <StatusPill value={value} />
            {isOverdue(row.original) && (
              <span style={{
                fontSize: '0.7rem', fontWeight: 700,
                background: '#fbeaea', color: '#aa0808',
                padding: '0.1rem 0.4rem', borderRadius: 999,
                border: '1px solid #f5c0c0',
              }}>
                OVERDUE
              </span>
            )}
          </FlexBox>
        ),
    },
    {
      Header: "Actions",
      id: "actions",
      width: 240,
      minWidth: 240,
      Cell: ({ row }) => {
        const isDraft = row.original.IsActiveEntity === false;
        const s = row.original;
        return (
          <FlexBox style={{ gap: "0.4rem", alignItems: "center" }}>
            {isDraft ? (
              <>
                <Button design="Default" icon="edit" onClick={() => handleEditDraft(s)}>
                  Edit
                </Button>
                <Button
                  design="Emphasized"
                  disabled={submitDraftMutation.isPending}
                  onClick={() => submitDraftMutation.mutate(s.ID)}
                >
                  Activate
                </Button>
                <Button
                  design="Negative"
                  icon="delete"
                  disabled={deleteDraftMutation.isPending}
                  onClick={() => {
                    if (window.confirm('Delete this draft?')) deleteDraftMutation.mutate(s.ID);
                  }}
                />
              </>
            ) : (
              <>
                {!isManager && (
                  <Button
                    design="Attention"
                    disabled={s.status === "Exception" || s.status === "Delivered"}
                    onClick={() => {
                      setExceptionShipment(s);
                      const existingDate = s.deliveryDate ? new Date(s.deliveryDate) : new Date();
                      exceptionRef.current = {
                        proposedDeliveryDate: existingDate.toISOString().split('T')[0] + 'T00:00:00Z',
                      };
                      setExceptionDialogOpen(true);
                    }}
                  >
                    Flag Delay
                  </Button>
                )}
                <Button
                  design="Transparent"
                  onClick={() => setSelected(s)}
                >
                  Detail
                </Button>
              </>
            )}
          </FlexBox>
        );
      },
    },
  ];

  if (isLoading)
    return (
      <BusyIndicator
        active
        size="Large"
        style={{ marginTop: "4rem", width: "100%" }}
      />
    );

  return (
    <>
      <FlexBox direction={FlexBoxDirection.Column} style={{ gap: "1.5rem" }}>
        <FlexBox
          style={{ justifyContent: "space-between", alignItems: "center" }}
        >
          <Title level="H2">Shipment Workspace</Title>
          {!isManager && (
            <Button
              design="Emphasized"
              icon="add"
              onClick={handleOpenNewShipment}
            >
              New Shipment
            </Button>
          )}
        </FlexBox>

        {uploadMsg && (
          <MessageStrip
            design={uploadMsg.type}
            onClose={() => setUploadMsg(null)}
          >
            {uploadMsg.text}
          </MessageStrip>
        )}

        {actionMsg && (
          <MessageStrip
            design={actionMsg.type}
            onClose={() => setActionMsg(null)}
          >
            {actionMsg.text}
          </MessageStrip>
        )}

        <Card
          header={
            <CardHeader
              titleText="All Shipments"
              subtitleText="Draft-enabled OData V4"
            />
          }
        >
          {shipments.length === 0 ? (
            <div
              style={{
                padding: "2rem",
                textAlign: "center",
                color: "var(--sapContent_LabelColor)",
              }}
            >
              No shipments yet.
            </div>
          ) : (
            <AnalyticalTable
              data={visibleShipments}
              columns={columns}
              visibleRows={10}
              filterable
              sortable
            />
          )}
        </Card>

        {selected && (
          <Card
            header={
              <CardHeader
                titleText={`Detail — ${selected.shipmentNumber || selected.ID?.substring(0, 8)}`}
                action={
                  <Button
                    design="Transparent"
                    icon="decline"
                    onClick={() => {
                      setSelected(null);
                      setOcrResult(null);
                    }}
                  />
                }
              />
            }
          >
            <div style={{ padding: "1rem" }}>
              {/* ── Basic Info ── */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem 1.5rem', marginBottom: '0.75rem' }}>
                <div><strong>Vendor:</strong> {selected.vendorCode || "—"}</div>
                <div><strong>Status:</strong> <StatusPill value={selected.status} /></div>
                <div><strong>Delivery:</strong>{" "}{selected.deliveryDate ? new Date(selected.deliveryDate).toLocaleDateString() : "—"}</div>
                <div><strong>Weight:</strong> {selected.totalWeight ?? "—"} kg</div>
                {selected.purchaseOrderId && (
                  <div><strong>PO#:</strong> {selected.purchaseOrderId}</div>
                )}
                {selected.deliveryAddress && (
                  <div style={{ gridColumn: '1 / -1' }}><strong>Delivery Address:</strong> {selected.deliveryAddress}</div>
                )}
                {selected.notes && (
                  <div style={{ gridColumn: '1 / -1' }}><strong>Notes:</strong> {selected.notes}</div>
                )}
                {selected.status === 'Exception' && selected.delayReason && (
                  <div style={{ gridColumn: '1 / -1' }}><strong>Delay Reason:</strong> {selected.delayReason}</div>
                )}
                {selected.status === 'Exception' && selected.proposedDeliveryDate && (
                  <div><strong>Proposed Date:</strong> {new Date(selected.proposedDeliveryDate).toLocaleDateString()}</div>
                )}
              </div>

              {/* ── Shipment Items ── */}
              {selected.items?.length === 0 && (
                <div style={{ marginBottom: '0.75rem' }}>
                  <strong style={{ display: 'block', marginBottom: '0.4rem' }}>📦 Items</strong>
                  <div style={{ padding: '0.5rem', color: 'var(--sapContent_LabelColor)', fontSize: '0.82rem' }}>No items linked to this shipment.</div>
                </div>
              )}
              {selected.items?.length > 0 && (
                <div style={{ marginBottom: '0.75rem' }}>
                  <strong style={{ display: 'block', marginBottom: '0.4rem' }}>📦 Items</strong>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                    <thead>
                      <tr style={{ background: 'var(--sapList_HeaderBackground)', color: 'var(--sapList_HeaderTextColor)' }}>
                        <th style={{ padding: '0.3rem 0.5rem', textAlign: 'left', border: '1px solid var(--sapList_BorderColor)' }}>Material</th>
                        <th style={{ padding: '0.3rem 0.5rem', textAlign: 'left', border: '1px solid var(--sapList_BorderColor)' }}>Description</th>
                        <th style={{ padding: '0.3rem 0.5rem', textAlign: 'right', border: '1px solid var(--sapList_BorderColor)' }}>Ordered</th>
                        <th style={{ padding: '0.3rem 0.5rem', textAlign: 'right', border: '1px solid var(--sapList_BorderColor)' }}>Shipped</th>
                        <th style={{ padding: '0.3rem 0.5rem', textAlign: 'center', border: '1px solid var(--sapList_BorderColor)' }}>Unit</th>
                        <th style={{ padding: '0.3rem 0.5rem', textAlign: 'right', border: '1px solid var(--sapList_BorderColor)' }}>Price</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.items.map((item, idx) => (
                        <tr key={item.ID || idx} style={{ background: idx % 2 === 0 ? 'transparent' : 'var(--sapList_AlternatingBackground)' }}>
                          <td style={{ padding: '0.3rem 0.5rem', border: '1px solid var(--sapList_BorderColor)' }}>{item.materialId || "—"}</td>
                          <td style={{ padding: '0.3rem 0.5rem', border: '1px solid var(--sapList_BorderColor)' }}>{item.materialDesc || "—"}</td>
                          <td style={{ padding: '0.3rem 0.5rem', textAlign: 'right', border: '1px solid var(--sapList_BorderColor)' }}>{item.orderedQuantity ?? "—"}</td>
                          <td style={{ padding: '0.3rem 0.5rem', textAlign: 'right', border: '1px solid var(--sapList_BorderColor)' }}>{item.quantity ?? "—"}</td>
                          <td style={{ padding: '0.3rem 0.5rem', textAlign: 'center', border: '1px solid var(--sapList_BorderColor)' }}>{item.unit || "—"}</td>
                          <td style={{ padding: '0.3rem 0.5rem', textAlign: 'right', border: '1px solid var(--sapList_BorderColor)' }}>{item.negotiatedPrice != null ? Number(item.negotiatedPrice).toLocaleString() : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {selected.status === "Exception" && isManager && selected.exceptionType === "VENDOR_DELAY" && (
                <div style={{
                  marginTop: "1rem",
                  padding: "1rem",
                  background: "var(--sapErrorBackground)",
                  borderRadius: 8,
                  border: "1px solid var(--sapErrorBorderColor)",
                }}>
                  <div style={{ fontWeight: 600, marginBottom: "0.75rem", color: "var(--sapCriticalColor)" }}>
                    ⚠️ Exception Management
                  </div>
                  <FlexBox style={{ gap: "0.5rem" }}>
                    <Button
                      design="Positive"
                      icon="accept"
                      onClick={() => setApproveDialogOpen(true)}
                      disabled={approveMutation.isPending}
                    >
                      Approve Exception
                    </Button>
                    <Button
                      design="Negative"
                      icon="decline"
                      onClick={() => rejectMutation.mutate(selected.ID)}
                      disabled={rejectMutation.isPending}
                    >
                      {rejectMutation.isPending ? "Rejecting…" : "Reject Exception"}
                    </Button>
                  </FlexBox>
                </div>
              )}

              {isOverdue(selected) && (
                <div style={{
                  marginTop: "1rem",
                  padding: "0.75rem 1rem",
                  background: "#fbeaea",
                  borderRadius: 8,
                  border: "1px solid #f5c0c0",
                  display: 'flex', alignItems: 'center', gap: '0.5rem',
                }}>
                  <span style={{ fontWeight: 700, color: '#aa0808' }}>OVERDUE</span>
                  <span style={{ fontSize: '0.85rem', color: '#aa0808' }}>
                    Expected delivery {new Date(selected.deliveryDate).toLocaleDateString()} has passed but goods not yet confirmed received.
                  </span>
                </div>
              )}

              {/* ── Mark as Shipped — Vendor only, when Pending ── */}
              {selected.status === "Pending" && !isManager && (
                <div style={{
                  marginTop: "1rem",
                  padding: "1rem",
                  background: "var(--sapInformationBackground)",
                  borderRadius: 8,
                  border: "1px solid var(--sapInformationBorderColor)",
                }}>
                  <div style={{ fontWeight: 600, marginBottom: "0.5rem" }}>
                    Ready to Ship?
                  </div>
                  <div style={{ fontSize: "0.85rem", color: "var(--sapContent_LabelColor)", marginBottom: "0.75rem" }}>
                    Click below when goods have left your warehouse to notify the procurement team.
                  </div>
                  <Button
                    design="Emphasized"
                    icon="shipping-status"
                    onClick={() => markShippedMutation.mutate(selected.ID)}
                    disabled={markShippedMutation.isPending}
                  >
                    {markShippedMutation.isPending ? "Processing…" : "Mark as Shipped"}
                  </Button>
                </div>
              )}

              {/* ── Manager: Goods Receipt — Received / Not Received ── */}
              {selected.status === "Shipped" && isManager && (
                <div style={{
                  marginTop: "1rem", padding: "1rem",
                  background: "var(--sapSuccessBackground)",
                  borderRadius: 8, border: "1px solid var(--sapSuccessBorderColor)",
                }}>
                  <div style={{ fontWeight: 600, marginBottom: "0.25rem" }}>Goods Receipt</div>
                  <div style={{ fontSize: "0.85rem", color: "var(--sapContent_LabelColor)", marginBottom: "0.75rem" }}>
                    Have the goods been physically received?
                  </div>
                  <FlexBox style={{ gap: "0.5rem" }}>
                    <Button design="Positive" icon="complete"
                      onClick={() => setConfirmDialogOpen(true)}
                      disabled={confirmMutation.isPending}
                    >
                      Received
                    </Button>
                    <Button design="Negative" icon="decline"
                      onClick={() => { notReceivedRef.current = {}; setNotReceivedDialogOpen(true); }}
                      disabled={flagNotReceivedMutation.isPending}
                    >
                      Not Received
                    </Button>
                  </FlexBox>
                </div>
              )}

              {/* ── Vendor: NOT_RECEIVED banner + Reconfirm / Flag Delay ── */}
              {selected.status === "Exception" && selected.exceptionType === "NOT_RECEIVED" && !isManager && (
                <div style={{
                  marginTop: "1rem", padding: "1rem",
                  background: "#fff8db", borderRadius: 8,
                  border: "1px solid #f0c030",
                }}>
                  <div style={{ fontWeight: 600, marginBottom: "0.25rem", color: "#8b6f00" }}>
                    ⚠️ Procurement team reports goods not yet received
                  </div>
                  {selected.delayReason && (
                    <div style={{ fontSize: "0.85rem", color: "var(--sapContent_LabelColor)", marginBottom: "0.75rem" }}>
                      Reason: {selected.delayReason}
                    </div>
                  )}
                  <div style={{ fontSize: "0.85rem", marginBottom: "0.75rem" }}>
                    Please reconfirm delivery or flag a delay with a new date.
                  </div>
                  <FlexBox style={{ gap: "0.5rem" }}>
                    <Button design="Emphasized" icon="shipping-status"
                      onClick={() => reconfirmMutation.mutate(selected.ID)}
                      disabled={reconfirmMutation.isPending}
                    >
                      {reconfirmMutation.isPending ? "Processing…" : "Reconfirm Delivered"}
                    </Button>
                    <Button design="Attention"
                      onClick={() => {
                        setExceptionShipment(selected);
                        const existingDate = selected.deliveryDate ? new Date(selected.deliveryDate) : new Date();
                        exceptionRef.current = {
                          proposedDeliveryDate: existingDate.toISOString().split('T')[0] + 'T00:00:00Z',
                        };
                        setExceptionDialogOpen(true);
                      }}
                    >
                      Flag Delay
                    </Button>
                  </FlexBox>
                </div>
              )}

              <div style={{ marginTop: "1rem" }}>
                <strong>Upload Delivery Note PDF:</strong>
                <br />
                {selected.IsActiveEntity === false ? (
                  <MessageStrip design="Warning" hideCloseButton style={{ marginTop: "0.5rem" }}>
                    Submit the shipment first before uploading a delivery note.
                  </MessageStrip>
                ) : selected.status !== 'Shipped' ? (
                  <MessageStrip design="Information" hideCloseButton style={{ marginTop: "0.5rem" }}>
                    Delivery note upload is only available when shipment status is <strong>Shipped</strong>.
                  </MessageStrip>
                ) : (
                  <input
                    type="file"
                    accept="application/pdf"
                    style={{ marginTop: "0.5rem" }}
                    onChange={(e) => handleFileUpload(e, selected.ID)}
                  />
                )}
              </div>
              {ocrResult && (
                <div style={{ marginTop: "1rem", padding: "1rem", background: "var(--sapSuccessBackground)", borderRadius: 8, border: "1px solid var(--sapSuccessBorderColor)" }}>
                  <div style={{ fontWeight: 600, marginBottom: "0.5rem" }}>
                    🤖 AI/OCR Result
                    {ocrResult.confidence > 0 && ocrResult.confidence < 0.7 && (
                      <span style={{ marginLeft: "0.5rem", color: "var(--sapWarningColor)", fontWeight: 400, fontSize: "0.85rem" }}>
                        ⚠️ Low confidence ({(ocrResult.confidence * 100).toFixed(0)}%) — please verify
                      </span>
                    )}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "0.25rem 1rem", fontSize: "0.875rem" }}>
                    {ocrResult.trackingNumber && <><span style={{ color: "var(--sapContent_LabelColor)" }}>Tracking:</span><strong>{ocrResult.trackingNumber}</strong></>}
                    {ocrResult.batchId && <><span style={{ color: "var(--sapContent_LabelColor)" }}>Batch ID:</span><strong>{ocrResult.batchId}</strong></>}
                    {ocrResult.vendorName && <><span style={{ color: "var(--sapContent_LabelColor)" }}>Vendor:</span><strong>{ocrResult.vendorName}</strong></>}
                    {ocrResult.totalAmount != null && <><span style={{ color: "var(--sapContent_LabelColor)" }}>Total:</span><strong>{Number(ocrResult.totalAmount).toLocaleString()}</strong></>}
                    {!ocrResult.trackingNumber && !ocrResult.batchId && !ocrResult.vendorName && (
                      <span style={{ gridColumn: "1/-1", color: "var(--sapContent_LabelColor)" }}>No data extracted — PDF may not contain readable text.</span>
                    )}
                  </div>
                </div>
              )}

              {/* ── PDF Attachment List ── */}
              {isActiveShipment && (
                <div style={{ marginTop: "1.25rem" }}>
                  <strong>📎 Uploaded Invoices:</strong>
                  {attachmentsLoading ? (
                    <div style={{ marginTop: "0.5rem", color: "var(--sapContent_LabelColor)" }}>
                      Loading…
                    </div>
                  ) : attachments.length === 0 ? (
                    <div style={{
                      marginTop: "0.5rem",
                      padding: "0.75rem",
                      background: "var(--sapNeutralBackground)",
                      borderRadius: 6,
                      color: "var(--sapContent_LabelColor)",
                      fontSize: "0.875rem",
                    }}>
                      No invoices uploaded yet.
                    </div>
                  ) : (
                    <div style={{ marginTop: "0.5rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                      {attachments.map((att) => (
                        <div key={att.ID} style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: "0.6rem 0.75rem",
                          background: "var(--sapNeutralBackground)",
                          borderRadius: 6,
                          border: "1px solid var(--sapNeutralBorderColor)",
                        }}>
                          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                            <a
                              href={att.storageUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ fontWeight: 600, fontSize: "0.875rem", color: "var(--sapLinkColor)" }}
                            >
                              📄 {att.fileName}
                            </a>
                            <span style={{ fontSize: "0.75rem", color: "var(--sapContent_LabelColor)" }}>
                              {att.uploadedAt ? new Date(att.uploadedAt).toLocaleString() : "—"}
                              {att.fileSize ? ` · ${(att.fileSize / 1024).toFixed(1)} KB` : ""}
                              {att.uploadedBy ? ` · by ${att.uploadedBy}` : ""}
                            </span>
                          </div>
                          <Button
                            design="Negative"
                            icon="delete"
                            disabled={deleteAttachmentMutation.isPending}
                            onClick={() => {
                              if (window.confirm(`Delete "${att.fileName}"?`)) {
                                deleteAttachmentMutation.mutate(att.ID);
                              }
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </Card>
        )}
      </FlexBox>

      <Dialog
        open={dialogOpen}
        headerText={activeDraftId && (draftItems.length > 0 || newForm.purchaseOrderId) ? "Edit Draft Shipment" : "New Shipment"}
        style={{ '--_ui5-dialog-max-height': '90vh' }}
        footer={
          <Bar endContent={
            <FlexBox style={{ gap: "0.5rem", alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
              <Button
                design="Negative"
                icon="delete"
                disabled={deleteDraftMutation.isPending || !activeDraftId}
                onClick={() => {
                  if (activeDraftId && window.confirm('Delete this draft? This cannot be undone.')) {
                    deleteDraftMutation.mutate(activeDraftId);
                    handleCloseDialog();
                  }
                }}
              >
                Delete Draft
              </Button>
              <FlexBox style={{ gap: "0.5rem", alignItems: 'center' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--sapContent_LabelColor)' }}>
                  💾 Saved automatically
                </span>
                <Button onClick={handleCloseDialog}>Close</Button>
                <Button
                  design="Emphasized"
                  disabled={submitDraftMutation.isPending || !activeDraftId}
                  onClick={() => {
                    if (!newForm.deliveryDate) {
                      setActionMsg({ type: 'Negative', text: '❌ Please select a delivery date before submitting.' });
                      return;
                    }
                    if (draftItems.length === 0 && poItems.length === 0) {
                      setActionMsg({ type: 'Negative', text: '❌ Please select a Purchase Order with items before submitting.' });
                      return;
                    }
                    activeDraftId && submitDraftMutation.mutate(activeDraftId);
                  }}
                >
                  {submitDraftMutation.isPending ? "Submitting..." : "Submit Shipment"}
                </Button>
              </FlexBox>
            </FlexBox>
          } />
        }
        onClose={handleCloseDialog}
      >
        <div style={{ padding: "1rem", minWidth: 560, maxWidth: 680, display: 'flex', flexDirection: 'column', gap: '1rem' }}>

          {/* ── Step 1: Select PO (always visible — re-selecting clears old items) ── */}
          <div>
            <Label style={{ fontWeight: 600, marginBottom: '0.4rem', display: 'block' }}>
              Purchase Order <span style={{ color: 'var(--sapErrorColor)' }}>*</span>
            </Label>
            <Select
              style={{ width: '100%' }}
              onChange={(e) => handlePOSelect(e.detail.selectedOption.value)}
            >
              <Option value="">— Select Purchase Order —</Option>
              {purchaseOrders.map((po) => (
                <Option key={po.PurchaseOrder} value={po.PurchaseOrder}>
                  {po.PurchaseOrder} · Supplier: {po.Supplier} · {po.DocumentCurrency}
                </Option>
              ))}
            </Select>
          </div>

          {/* ── Existing items (when editing saved draft) ── */}
          {draftItems.length > 0 && (
            <div style={{ border: '1px solid var(--sapList_BorderColor)', borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ padding: '0.6rem 1rem', background: 'var(--sapList_HeaderBackground)', fontWeight: 600, fontSize: '0.85rem', borderBottom: '1px solid var(--sapList_BorderColor)' }}>
                📦 Shipment Items ({draftItems.length})
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                <thead>
                  <tr style={{ background: 'var(--sapList_HeaderBackground)' }}>
                    {['Material', 'Description', 'Ordered', 'Unit', 'Qty to Ship'].map(h => (
                      <th key={h} style={{ padding: '0.4rem 0.6rem', textAlign: 'left', fontWeight: 600, color: 'var(--sapContent_LabelColor)', borderBottom: '1px solid var(--sapList_BorderColor)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {draftItems.map((item, idx) => (
                    <tr key={item.ID || idx} style={{ background: idx % 2 === 0 ? 'transparent' : 'var(--sapList_AlternatingRowBackground)' }}>
                      <td style={{ padding: '0.4rem 0.6rem', fontWeight: 600 }}>{item.materialId || '—'}</td>
                      <td style={{ padding: '0.4rem 0.6rem', color: 'var(--sapContent_LabelColor)' }}>{item.materialDesc || '—'}</td>
                      <td style={{ padding: '0.4rem 0.6rem' }}>{item.orderedQuantity != null ? Math.round(item.orderedQuantity) : '—'}</td>
                      <td style={{ padding: '0.4rem 0.6rem' }}>{item.unit || '—'}</td>
                      <td style={{ padding: '0.4rem 0.6rem' }}>
                        <input
                          type="number" min="0" step="1"
                          defaultValue={Math.round(item.quantity ?? 0)}
                          style={{ width: 80, padding: '0.25rem 0.4rem', border: '1px solid var(--sapField_BorderColor)', borderRadius: 4, fontSize: '0.82rem' }}
                          onChange={(e) => {
                            const qty = parseInt(e.target.value) || 0;
                            if (activeDraftId && item.ID) {
                              updateDraftItem({ shipmentId: activeDraftId, itemId: item.ID, qty }).catch(() => {});
                            }
                          }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── PO Items panel (new draft, PO selected, items being added) ── */}
          {draftItems.length === 0 && newForm.purchaseOrderId && (
            <div style={{
              border: '1px solid var(--sapList_BorderColor)',
              borderRadius: 8,
              overflow: 'hidden',
            }}>
              <div style={{
                padding: '0.6rem 1rem',
                background: 'var(--sapList_HeaderBackground)',
                fontWeight: 600,
                fontSize: '0.85rem',
                borderBottom: '1px solid var(--sapList_BorderColor)',
              }}>
                PO Items — specify qty to ship in this shipment
              </div>
              {poItemsLoading ? (
                <div style={{ padding: '1rem', textAlign: 'center' }}>
                  <BusyIndicator active size="Small" />
                </div>
              ) : poItems.length === 0 ? (
                <div style={{ padding: '1rem', color: 'var(--sapContent_LabelColor)', fontSize: '0.85rem' }}>
                  No items found for this PO.
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                  <thead>
                    <tr style={{ background: 'var(--sapList_HeaderBackground)' }}>
                      {['Material', 'Description', 'Ordered', 'Unit', 'Price', 'Qty to Ship'].map(h => (
                        <th key={h} style={{ padding: '0.4rem 0.6rem', textAlign: 'left', fontWeight: 600, color: 'var(--sapContent_LabelColor)', borderBottom: '1px solid var(--sapList_BorderColor)' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {poItems.map((item, idx) => (
                      <tr key={item.purchaseOrderItem} style={{ background: idx % 2 === 0 ? 'transparent' : 'var(--sapList_AlternatingRowBackground)' }}>
                        <td style={{ padding: '0.4rem 0.6rem', fontWeight: 600 }}>{item.material || '—'}</td>
                        <td style={{ padding: '0.4rem 0.6rem', color: 'var(--sapContent_LabelColor)' }}>{item.materialDesc || '—'}</td>
                        <td style={{ padding: '0.4rem 0.6rem' }}>{item.orderQuantity != null ? Math.round(item.orderQuantity) : '—'}</td>
                        <td style={{ padding: '0.4rem 0.6rem' }}>{item.unit}</td>
                        <td style={{ padding: '0.4rem 0.6rem' }}>
                          {item.netPriceAmount != null
                            ? `${item.currency} ${Number(item.netPriceAmount).toLocaleString(undefined, { minimumFractionDigits: 2 })}`
                            : '—'}
                        </td>
                        <td style={{ padding: '0.4rem 0.6rem' }}>
                          <input
                            type="number"
                            min="0"
                            max={Math.round(item.orderQuantity)}
                            step="1"
                            value={Math.round(shipQtys[item.purchaseOrderItem] ?? item.orderQuantity)}
                            onChange={(e) => setShipQtys(prev => ({ ...prev, [item.purchaseOrderItem]: e.target.value }))}
                            style={{
                              width: 80, padding: '0.25rem 0.4rem',
                              border: '1px solid var(--sapField_BorderColor)',
                              borderRadius: 4, fontSize: '0.82rem',
                            }}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* ── Delivery details ── */}
          <FlexBox style={{ gap: '1rem' }}>
            <div style={{ flex: 1 }}>
              <Label style={{ fontWeight: 600, marginBottom: '0.4rem', display: 'block' }}>
                Delivery Date <span style={{ color: 'var(--sapErrorColor)' }}>*</span>
              </Label>
              <DatePicker
                key={activeDraftId || 'new'}
                ref={deliveryDatePickerRef}
                style={{ width: '100%' }}
                value={newForm.deliveryDate
                  ? new Date(newForm.deliveryDate).toLocaleDateString('en-US')
                  : new Date().toLocaleDateString('en-US')}
                minDate={new Date().toLocaleDateString('en-US')}
                onChange={(e) => {
                  const val = e.detail?.value || e.target?.value;
                  if (val) {
                    const parsed = new Date(val);
                    if (!isNaN(parsed.getTime())) {
                      const iso = parsed.toISOString().split('T')[0] + 'T00:00:00Z';
                      setNewForm(f => ({ ...f, deliveryDate: iso }));
                      patchDraftField({ deliveryDate: iso });
                    }
                  }
                }}
              />
            </div>
            <div style={{ flex: 1 }}>
              <Label style={{ fontWeight: 600, marginBottom: '0.4rem', display: 'block' }}>Total Weight (kg)</Label>
              <Input
                key={activeDraftId || 'new'}
                type="Number"
                placeholder="0.000"
                value={newForm.totalWeight}
                style={{ width: '100%' }}
                onInput={(e) => {
                  const val = e.target.value;
                  setNewForm(f => ({ ...f, totalWeight: val }));
                  patchDraftField({ totalWeight: parseFloat(val) || 0 });
                }}
              />
            </div>
          </FlexBox>

          <div>
            <Label style={{ fontWeight: 600, marginBottom: '0.4rem', display: 'block' }}>Delivery Address</Label>
            <Input
              key={activeDraftId || 'new'}
              placeholder="Street, City, Country"
              value={newForm.deliveryAddress}
              style={{ width: '100%' }}
              onInput={(e) => {
                const val = e.target.value;
                setNewForm(f => ({ ...f, deliveryAddress: val }));
                patchDraftField({ deliveryAddress: val });
              }}
            />
          </div>

          <div>
            <Label style={{ fontWeight: 600, marginBottom: '0.4rem', display: 'block' }}>Notes</Label>
            <Input
              key={activeDraftId || 'new'}
              placeholder="Carrier info, special instructions..."
              value={newForm.notes}
              style={{ width: '100%' }}
              onInput={(e) => {
                const val = e.target.value;
                setNewForm(f => ({ ...f, notes: val }));
                patchDraftField({ notes: val });
              }}
            />
          </div>
        </div>
      </Dialog>

      {/* Confirm Delivery Dialog — Manager */}
      <Dialog
        open={confirmDialogOpen}
        headerText="Confirm Delivery — Goods Receipt"
        footer={
          <Bar endContent={
            <FlexBox style={{ gap: "0.5rem" }}>
              <Button onClick={() => setConfirmDialogOpen(false)}>Cancel</Button>
              <Button
                design="Positive"
                disabled={confirmMutation.isPending}
                onClick={() => {
                  if (!confirmRef.current.receivedDate) {
                    const raw = confirmDatePickerRef.current?.value;
                    if (raw) {
                      const parsed = new Date(raw);
                      if (!isNaN(parsed)) {
                        confirmRef.current.receivedDate = parsed.toISOString().split('T')[0] + 'T00:00:00Z';
                      }
                    }
                  }
                  confirmMutation.mutate({
                    shipmentId:   selected?.ID,
                    receivedDate: confirmRef.current.receivedDate || new Date().toISOString(),
                    receivedNote: confirmRef.current.receivedNote || '',
                  });
                }}
              >
                {confirmMutation.isPending ? "Confirming…" : "Confirm Receipt"}
              </Button>
            </FlexBox>
          } />
        }
        onClose={() => setConfirmDialogOpen(false)}
      >
        <Form style={{ padding: "1rem", minWidth: 380 }}>
          <FormItem label={<Label>Shipment</Label>}>
            <Input value={selected?.shipmentNumber || selected?.ID?.substring(0, 8) + "…"} readonly />
          </FormItem>
          <FormItem label={<Label>Vendor</Label>}>
            <Input value={selected?.vendorCode || "—"} readonly />
          </FormItem>
          <FormItem label={<Label>Date Received</Label>}>
            <DatePicker
              ref={confirmDatePickerRef}
              value={new Date().toLocaleDateString('en-US')}
              onChange={(e) => {
                const val = e.detail?.value || e.target?.value;
                if (val) {
                  const parsed = new Date(val);
                  if (!isNaN(parsed)) {
                    confirmRef.current.receivedDate = parsed.toISOString().split('T')[0] + 'T00:00:00Z';
                  }
                }
              }}
            />
          </FormItem>
          <FormItem label={<Label>Receipt Note (optional)</Label>}>
            <Input
              placeholder="e.g. Goods received in good condition"
              onInput={(e) => (confirmRef.current.receivedNote = e.target.value)}
            />
          </FormItem>
        </Form>
      </Dialog>

      {/* Raise Exception Dialog — Vendor */}
      <Dialog
        open={exceptionDialogOpen}
        headerText="Flag Delay — Request Delivery Extension"
        footer={
          <Bar endContent={
            <FlexBox style={{ gap: "0.5rem" }}>
              <Button onClick={() => setExceptionDialogOpen(false)}>Cancel</Button>
              <Button
                design="Attention"
                disabled={delayMutation.isPending}
                onClick={() => {
                  if (!exceptionRef.current.proposedDeliveryDate) {
                    const raw = exceptionDatePickerRef.current?.value;
                    if (raw) {
                      const parsed = new Date(raw);
                      if (!isNaN(parsed)) {
                        exceptionRef.current.proposedDeliveryDate = parsed.toISOString().split('T')[0] + 'T00:00:00Z';
                      }
                    }
                  }
                  delayMutation.mutate({
                    shipmentId: exceptionShipment?.ID,
                    reason: exceptionRef.current.reason || '',
                    proposedDeliveryDate: exceptionRef.current.proposedDeliveryDate || null,
                  });
                }}
              >
                {delayMutation.isPending ? "Submitting…" : "Submit Exception"}
              </Button>
            </FlexBox>
          } />
        }
        onClose={() => setExceptionDialogOpen(false)}
      >
        <Form style={{ padding: "1rem", minWidth: 400 }}>
          <FormItem label={<Label>Shipment</Label>}>
            <Input
              value={exceptionShipment?.shipmentNumber || (exceptionShipment?.ID?.substring(0, 8) + "…")}
              readonly
            />
          </FormItem>
          <FormItem label={<Label>Current Delivery Date</Label>}>
            <Input
              value={exceptionShipment?.deliveryDate
                ? new Date(exceptionShipment.deliveryDate).toLocaleDateString()
                : "—"}
              readonly
            />
          </FormItem>
          <FormItem label={<Label>Reason for Delay</Label>}>
            <Input
              placeholder="e.g. Port congestion, customs hold..."
              onInput={(e) => (exceptionRef.current.reason = e.target.value)}
            />
          </FormItem>
          <FormItem label={<Label>Proposed New Delivery Date</Label>}>
            <DatePicker
              ref={exceptionDatePickerRef}
              minDate={new Date().toLocaleDateString('en-US')}
              value={exceptionShipment?.deliveryDate
                ? new Date(exceptionShipment.deliveryDate).toLocaleDateString('en-US')
                : new Date().toLocaleDateString('en-US')}
              onChange={(e) => {
                const val = e.detail?.value || e.target?.value;
                if (val) {
                  const parsed = new Date(val);
                  if (!isNaN(parsed)) {
                    exceptionRef.current.proposedDeliveryDate = parsed.toISOString().split('T')[0] + 'T00:00:00Z';
                  }
                }
              }}
            />
          </FormItem>
        </Form>
      </Dialog>

      {/* Toast notification — Mark as Shipped */}
      <Toast ref={toastRef} duration={4000} placement="BottomCenter">
        {toastMsg}
      </Toast>

      {/* Approve Exception Dialog — Manager */}
      <Dialog
        open={approveDialogOpen}
        headerText="Approve Exception"
        footer={
          <Bar endContent={
            <FlexBox style={{ gap: "0.5rem" }}>
              <Button onClick={() => setApproveDialogOpen(false)}>Cancel</Button>
              <Button
                design="Positive"
                disabled={approveMutation.isPending}
                onClick={() => {
                  // Fallback: đọc từ DOM nếu onChange chưa fire
                  if (!approveRef.current.newDeliveryDate) {
                    const raw = approveDatePickerRef.current?.value;
                    if (raw) {
                      const parsed = new Date(raw);
                      if (!isNaN(parsed)) {
                        approveRef.current.newDeliveryDate = parsed.toISOString().split('T')[0] + 'T00:00:00Z';
                      }
                    }
                  }
                  const finalDate = approveRef.current.newDeliveryDate
                    || selected?.proposedDeliveryDate;
                  if (!finalDate) {
                    alert("Please select a new delivery date.");
                    return;
                  }
                  approveMutation.mutate({ shipmentId: selected?.ID, newDeliveryDate: finalDate });
                }}
              >
                {approveMutation.isPending ? "Approving…" : "Confirm Approve"}
              </Button>
            </FlexBox>
          } />
        }
        onClose={() => setApproveDialogOpen(false)}
      >
        <Form style={{ padding: "1rem", minWidth: 380 }}>
          <FormItem label={<Label>Shipment</Label>}>
            <Input value={selected?.shipmentNumber || selected?.ID?.substring(0, 8) + "…"} readonly />
          </FormItem>
          <FormItem label={<Label>Vendor's Reason</Label>}>
            <Input value={selected?.delayReason || "—"} readonly />
          </FormItem>
          <FormItem label={<Label>Vendor's Proposed Date</Label>}>
            <Input
              value={selected?.proposedDeliveryDate
                ? new Date(selected.proposedDeliveryDate).toLocaleDateString()
                : "Not specified"}
              readonly
            />
          </FormItem>
          <FormItem label={<Label>New Delivery Date (modify if needed)</Label>}>
            <DatePicker
              ref={approveDatePickerRef}
              minDate={new Date().toLocaleDateString('en-US')}
              value={selected?.proposedDeliveryDate
                ? new Date(selected.proposedDeliveryDate).toLocaleDateString('en-US')
                : ''}
              onChange={(e) => {
                const val = e.detail?.value || e.target?.value;
                if (val) {
                  const parsed = new Date(val);
                  if (!isNaN(parsed)) {
                    approveRef.current.newDeliveryDate = parsed.toISOString().split('T')[0] + 'T00:00:00Z';
                  }
                }
              }}
            />
          </FormItem>
        </Form>
      </Dialog>

      {/* Not Received Dialog — Manager */}
      <Dialog
        open={notReceivedDialogOpen}
        headerText="Flag — Goods Not Received"
        footer={
          <Bar endContent={
            <FlexBox style={{ gap: "0.5rem" }}>
              <Button onClick={() => setNotReceivedDialogOpen(false)}>Cancel</Button>
              <Button
                design="Negative"
                disabled={flagNotReceivedMutation.isPending}
                onClick={() => {
                  flagNotReceivedMutation.mutate({
                    shipmentId: selected?.ID,
                    reason: notReceivedRef.current.reason || '',
                  });
                }}
              >
                {flagNotReceivedMutation.isPending ? "Flagging…" : "Confirm Not Received"}
              </Button>
            </FlexBox>
          } />
        }
        onClose={() => setNotReceivedDialogOpen(false)}
      >
        <Form style={{ padding: "1rem", minWidth: 380 }}>
          <FormItem label={<Label>Shipment</Label>}>
            <Input value={selected?.shipmentNumber || selected?.ID?.substring(0, 8) + "…"} readonly />
          </FormItem>
          <FormItem label={<Label>Reason</Label>}>
            <Select
              style={{ width: "100%" }}
              onChange={(e) => { notReceivedRef.current.reason = e.detail.selectedOption.value; }}
            >
              <Option value="Goods not arrived">Goods not arrived</Option>
              <Option value="Wrong items delivered">Wrong items delivered</Option>
              <Option value="Damaged goods">Damaged goods</Option>
              <Option value="Incomplete shipment">Incomplete shipment</Option>
              <Option value="Other">Other</Option>
            </Select>
          </FormItem>
          <FormItem label={<Label>Note (optional)</Label>}>
            <Input
              placeholder="Additional details..."
              onInput={(e) => {
                notReceivedRef.current.reason = (notReceivedRef.current.reason || '') + (e.target.value ? ` — ${e.target.value}` : '');
              }}
              style={{ width: "100%" }}
            />
          </FormItem>
        </Form>
      </Dialog>
    </>
  );
}
