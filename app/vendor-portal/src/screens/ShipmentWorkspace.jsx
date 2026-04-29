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
} from "@ui5/webcomponents-react";
import {
  fetchShipments,
  createShipment,
  activateDraft,
  uploadInvoice,
  triggerCriticalDelay,
  fetchVendors,
  fetchPurchaseOrders,
  fetchMe,
  approveException,
  rejectException,
  deleteDraft,
  fetchAttachments,
  deleteAttachment,
} from "../api/client";

const STATUS_STYLES = {
  Draft: { bg: "#e6f2ff", fg: "#0a6ed1" },
  Pending: { bg: "#fff8db", fg: "#8b6f00" },
  Shipped: { bg: "#e8f7f5", fg: "#0f766e" },
  Delivered: { bg: "#edf8e9", fg: "#256f3a" },
  Exception: { bg: "#fbeaea", fg: "#aa0808" },
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
  const formRef = useRef({});
  const approveRef = useRef({});
  const exceptionRef = useRef({});
  const deliveryDatePickerRef = useRef(null);
  const approveDatePickerRef = useRef(null);
  const exceptionDatePickerRef = useRef(null);

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
    },
  });

  const submitDraftMutation = useMutation({
    mutationFn: activateDraft,
    onSuccess: () => queryClient.invalidateQueries(["shipments"]),
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

  const columns = [
    {
      Header: "ID",
      accessor: "ID",
      Cell: ({ value }) => value?.substring(0, 8) + "...",
    },
    {
      Header: "Vendor",
      accessor: "vendor_ID",
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
        row.original.IsActiveEntity === false
          ? <StatusPill value="Draft" />
          : <StatusPill value={value} />,
    },
    {
      Header: "Actions",
      id: "actions",
      Cell: ({ row }) => {
        const isDraft = row.original.IsActiveEntity === false;
        return (
          <FlexBox style={{ gap: "0.5rem" }}>
            {isDraft ? (
              <>
                <Button
                  design="Emphasized"
                  disabled={submitDraftMutation.isPending}
                  onClick={() => submitDraftMutation.mutate(row.original.ID)}
                >
                  Activate
                </Button>
                <Button
                  design="Negative"
                  disabled={deleteDraftMutation.isPending}
                  onClick={() => deleteDraftMutation.mutate(row.original.ID)}
                >
                  Delete
                </Button>
              </>
            ) : (
              <Button
                design="Attention"
                disabled={row.original.status === "Exception"}
                onClick={() => {
                  setExceptionShipment(row.original);
                  setExceptionDialogOpen(true);
                }}
              >
                Flag Delay
              </Button>
            )}
            <Button
              design="Transparent"
              onClick={() => setSelected(row.original)}
            >
              Detail
            </Button>
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
          <Button
            design="Emphasized"
            icon="add"
            onClick={() => setDialogOpen(true)}
          >
            New Shipment
          </Button>
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
                titleText={`Detail — ${selected.ID?.substring(0, 8)}`}
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
              <div>
                <strong>Vendor:</strong> {selected.vendor_ID || "—"}
              </div>
              <div>
                <strong>Delivery:</strong>{" "}
                {selected.deliveryDate
                  ? new Date(selected.deliveryDate).toLocaleDateString()
                  : "—"}
              </div>
              <div>
                <strong>Weight:</strong> {selected.totalWeight} kg
              </div>
              <div>
                <strong>Status:</strong> <StatusPill value={selected.status} />
              </div>
              {selected.status === "Exception" && isManager && (
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

              <div style={{ marginTop: "1rem" }}>
                <strong>Upload Invoice PDF:</strong>
                <br />
                {selected.IsActiveEntity === false ? (
                  <MessageStrip
                    design="Warning"
                    hideCloseButton
                    style={{ marginTop: "0.5rem" }}
                  >
                    Submit the shipment first before uploading an invoice.
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
                <div
                  style={{
                    marginTop: "1rem",
                    padding: "1rem",
                    background: "var(--sapSuccessBackground)",
                    borderRadius: 8,
                  }}
                >
                  <div>
                    🤖 <strong>AI/OCR Result:</strong>
                  </div>
                  <div>
                    Tracking: <strong>{ocrResult.trackingNumber}</strong>
                  </div>
                  <div>
                    Batch ID: <strong>{ocrResult.batchId}</strong>
                  </div>
                  <div>
                    Confidence:{" "}
                    <strong>{(ocrResult.confidence * 100).toFixed(0)}%</strong>
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
        headerText="Create New Shipment"
        footer={
          <Bar
            endContent={
              <FlexBox style={{ gap: "0.5rem" }}>
                <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
                <Button
                  design="Emphasized"
                  onClick={() => {
                    // Fallback: đọc trực tiếp từ DOM nếu onChange chưa fire
                    if (!formRef.current.deliveryDate) {
                      const raw = deliveryDatePickerRef.current?.value;
                      if (raw) {
                        const parsed = new Date(raw);
                        if (!isNaN(parsed)) {
                          formRef.current.deliveryDate = parsed.toISOString().split('T')[0] + 'T00:00:00Z';
                        }
                      }
                    }
                    if (!formRef.current.deliveryDate) {
                      alert("Please select a delivery date.");
                      return;
                    }
                    createMutation.mutate({
                      deliveryDate: formRef.current.deliveryDate,
                      totalWeight: parseFloat(formRef.current.totalWeight) || 0,
                      vendor_ID: formRef.current.vendor_ID || null,
                      purchaseOrderId: formRef.current.purchaseOrderId || null,
                      status: "Draft",
                    })
                  }}
                  disabled={createMutation.isPending}
                >
                  {createMutation.isPending
                    ? "Saving..."
                    : "Save Draft"}
                </Button>
              </FlexBox>
            }
          />
        }
        onClose={() => { setDialogOpen(false); formRef.current = {}; }}
      >
        <Form style={{ padding: "1rem", minWidth: 400 }}>
          <FormItem label={<Label>Purchase Order</Label>}>
            <Select
              onChange={(e) => {
                const val = e.detail.selectedOption.value;
                const po = purchaseOrders.find(p => p.PurchaseOrder === val);
                formRef.current.purchaseOrderId = val;
                // Auto-fill vendor from PO's Supplier field
                if (po?.Supplier) formRef.current.vendor_ID = po.Supplier;
              }}
            >
              <Option value="">— Select Purchase Order —</Option>
              {purchaseOrders.map((po) => (
                <Option key={po.PurchaseOrder} value={po.PurchaseOrder}>
                  {po.PurchaseOrder} — {po.Supplier} ({po.DocumentCurrency})
                </Option>
              ))}
            </Select>
          </FormItem>
          <FormItem label={<Label>Delivery Date</Label>}>
            <DatePicker
              ref={deliveryDatePickerRef}
              minDate={new Date().toLocaleDateString('en-US')}
              onChange={(e) => {
                const val = e.detail?.value || e.target?.value;
                if (val) {
                  const [m, d, y] = val.split('/');
                  if (y && m && d) {
                    formRef.current.deliveryDate = `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}T00:00:00Z`;
                  }
                }
              }}
            />
          </FormItem>
          <FormItem label={<Label>Weight (kg)</Label>}>
            <Input
              type="Number"
              placeholder="0"
              onInput={(e) => (formRef.current.totalWeight = e.target.value)}
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
            <Input value={exceptionShipment?.ID?.substring(0, 8) + "…"} readonly />
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
            <Input value={selected?.ID?.substring(0, 8) + "…"} readonly />
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
    </>
  );
}
