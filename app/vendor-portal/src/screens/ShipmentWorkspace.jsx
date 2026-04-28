import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Title, Card, CardHeader, Button, Dialog, Form, FormItem,
  Input, Select, Option, BusyIndicator, MessageStrip,
  FlexBox, FlexBoxDirection, AnalyticalTable, Bar, Label, TextArea,
} from "@ui5/webcomponents-react";
import {
  fetchShipments, createShipment, activateDraft, uploadInvoice,
  triggerCriticalDelay, fetchVendors, approveException, rejectException,
} from "../api/client";

const STATUS_STYLES = {
  Draft:     { bg: "#e6f2ff", fg: "#0a6ed1" },
  Pending:   { bg: "#fff8db", fg: "#8b6f00" },
  Shipped:   { bg: "#e8f7f5", fg: "#0f766e" },
  Delivered: { bg: "#edf8e9", fg: "#256f3a" },
  Exception: { bg: "#fbeaea", fg: "#aa0808" },
};

function StatusPill({ value }) {
  const style = STATUS_STYLES[value] || { bg: "#f2f2f2", fg: "#32363a" };
  return (
    <span style={{
      display: "inline-block", padding: "0.15rem 0.5rem",
      borderRadius: 999, fontSize: "0.75rem", fontWeight: 600,
      background: style.bg, color: style.fg,
    }}>
      {value || "Unknown"}
    </span>
  );
}

export default function ShipmentWorkspace() {
  const queryClient = useQueryClient();

  // Dialog states
  const [createDialogOpen, setCreateDialogOpen]   = useState(false);
  const [delayDialogOpen, setDelayDialogOpen]     = useState(false);
  const [approveDialogOpen, setApproveDialogOpen] = useState(false);
  const [targetShipment, setTargetShipment]       = useState(null);

  // Detail panel
  const [selected, setSelected]   = useState(null);
  const [uploadMsg, setUploadMsg] = useState(null);
  const [ocrResult, setOcrResult] = useState(null);
  const [actionMsg, setActionMsg] = useState(null);

  const createFormRef = useRef({});
  const delayReasonRef = useRef('');
  const newDateRef = useRef('');

  const { data: shipments = [], isLoading } = useQuery({
    queryKey: ["shipments"],
    queryFn: fetchShipments,
  });
  const { data: vendors = [] } = useQuery({
    queryKey: ["vendors"],
    queryFn: fetchVendors,
  });

  // ── Mutations ──────────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: async (payload) => {
      const draft = await createShipment(payload);
      return activateDraft(draft.ID);
    },
    onSuccess: () => {
      queryClient.invalidateQueries(["shipments"]);
      setCreateDialogOpen(false);
    },
  });

  const delayMutation = useMutation({
    mutationFn: triggerCriticalDelay,
    onSuccess: () => {
      queryClient.invalidateQueries(["shipments"]);
      setDelayDialogOpen(false);
      setTargetShipment(null);
      setActionMsg({ type: "Warning", text: "🚨 Delay flagged! Manager has been notified via email." });
      // Refresh selected if open
      if (selected) setSelected(s => ({ ...s, status: 'Exception' }));
    },
  });

  const approveMutation = useMutation({
    mutationFn: approveException,
    onSuccess: () => {
      queryClient.invalidateQueries(["shipments"]);
      setApproveDialogOpen(false);
      setTargetShipment(null);
      setActionMsg({ type: "Positive", text: "✅ Exception approved. S/4HANA PO updated." });
      if (selected) setSelected(s => ({ ...s, status: 'Shipped' }));
    },
  });

  const rejectMutation = useMutation({
    mutationFn: rejectException,
    onSuccess: () => {
      queryClient.invalidateQueries(["shipments"]);
      setActionMsg({ type: "Information", text: "↩️ Exception rejected. Shipment reverted to Pending." });
      if (selected) setSelected(s => ({ ...s, status: 'Pending' }));
    },
  });

  // ── File upload via useMutation (TanStack Query) ───────────────────────
  const uploadMutation = useMutation({
    mutationFn: ({ shipmentId, file }) => uploadInvoice(shipmentId, file),
    onMutate: () => {
      setUploadMsg({ type: "Information", text: "Uploading PDF and running AI/OCR..." });
    },
    onSuccess: (result) => {
      setOcrResult(result);
      setUploadMsg({ type: "Positive", text: `✅ PDF uploaded! Tracking: ${result?.trackingNumber}` });
      queryClient.invalidateQueries(["shipments"]);
    },
    onError: (err) => {
      setUploadMsg({ type: "Negative", text: `Upload failed: ${err.message}` });
    },
  });

  const handleFileUpload = (e, shipmentId) => {
    const file = e.target.files?.[0];
    if (!file) return;
    uploadMutation.mutate({ shipmentId, file });
  };

  // ── Table columns ──────────────────────────────────────────────────────
  const columns = [
    { Header: "ID",          accessor: "ID",           Cell: ({ value }) => value?.substring(0, 8) + "…" },
    { Header: "Vendor",      accessor: "vendorCode",    Cell: ({ value }) => value || "—" },
    { Header: "PO Ref",      accessor: "purchaseOrderId", Cell: ({ value }) => value || "—" },
    { Header: "Delivery",    accessor: "deliveryDate", Cell: ({ value }) => value ? new Date(value).toLocaleDateString() : "—" },
    { Header: "Weight (kg)", accessor: "totalWeight" },
    { Header: "Status",      accessor: "status",       Cell: ({ value }) => <StatusPill value={value} /> },
    {
      Header: "Actions", id: "actions",
      Cell: ({ row }) => {
        const s = row.original;
        const isException = s.status === "Exception";
        return (
          <FlexBox style={{ gap: "0.4rem" }}>
            {/* Vendor: flag delay (only for non-exception shipments) */}
            {!isException && (
              <Button design="Transparent" icon="alert" tooltip="Flag Critical Delay"
                onClick={() => { setTargetShipment(s); setDelayDialogOpen(true); }} />
            )}
            {/* Manager: approve exception */}
            {isException && (
              <Button design="Positive" icon="accept" tooltip="Approve Exception"
                onClick={() => { setTargetShipment(s); setApproveDialogOpen(true); }} />
            )}
            {/* Manager: reject exception */}
            {isException && (
              <Button design="Negative" icon="decline" tooltip="Reject Exception"
                disabled={rejectMutation.isPending}
                onClick={() => rejectMutation.mutate(s.ID)} />
            )}
            {/* Detail view */}
            <Button design="Transparent" icon="detail-view"
              onClick={() => { setSelected(s); setOcrResult(null); setUploadMsg(null); }} />
          </FlexBox>
        );
      },
    },
  ];

  if (isLoading) return <BusyIndicator active size="Large" style={{ marginTop: "4rem", width: "100%" }} />;

  return (
    <>
      <FlexBox direction={FlexBoxDirection.Column} style={{ gap: "1.5rem" }}>

        {/* ── Header ── */}
        <FlexBox style={{ justifyContent: "space-between", alignItems: "center" }}>
          <Title level="H2">Shipment Workspace</Title>
          <Button design="Emphasized" icon="add" onClick={() => setCreateDialogOpen(true)}>
            New Shipment
          </Button>
        </FlexBox>

        {/* ── Action feedback messages ── */}
        {actionMsg && (
          <MessageStrip design={actionMsg.type} onClose={() => setActionMsg(null)}>
            {actionMsg.text}
          </MessageStrip>
        )}
        {uploadMsg && (
          <MessageStrip design={uploadMsg.type} onClose={() => setUploadMsg(null)}>
            {uploadMsg.text}
          </MessageStrip>
        )}

        {/* ── Exception banner ── */}
        {shipments.filter(s => s.status === 'Exception').length > 0 && (
          <MessageStrip design="Critical" hideCloseButton>
            ⚠️ {shipments.filter(s => s.status === 'Exception').length} shipment(s) flagged as Exception — review and Approve or Reject below.
          </MessageStrip>
        )}

        {/* ── Shipments table ── */}
        <Card header={<CardHeader titleText="All Shipments" subtitleText="Draft-enabled OData V4" />}>
          {shipments.length === 0
            ? <div style={{ padding: "2rem", textAlign: "center", color: "var(--sapContent_LabelColor)" }}>No shipments yet.</div>
            : <AnalyticalTable data={shipments} columns={columns} visibleRows={10} filterable sortable />
          }
        </Card>

        {/* ── Detail panel ── */}
        {selected && (
          <Card header={
            <CardHeader
              titleText={`Detail — ${selected.ID?.substring(0, 8)}`}
              subtitleText={selected.status === 'Exception' ? '⚠️ This shipment has been flagged as delayed' : undefined}
              action={
                <Button design="Transparent" icon="decline"
                  onClick={() => { setSelected(null); setOcrResult(null); }} />
              }
            />
          }>
            <div style={{ padding: "1rem", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
              <div><strong>Vendor:</strong> {selected.vendorCode || "—"}</div>
              <div><strong>PO Ref:</strong> {selected.purchaseOrderId || "—"}</div>
              <div><strong>Delivery:</strong> {selected.deliveryDate ? new Date(selected.deliveryDate).toLocaleDateString() : "—"}</div>
              <div><strong>Weight:</strong> {selected.totalWeight} kg</div>
              <div style={{ gridColumn: "span 2" }}>
                <strong>Status:</strong> <StatusPill value={selected.status} />
              </div>
              {selected.delayReason && (
                <div style={{ gridColumn: "span 2", padding: "0.75rem", background: "var(--sapErrorBackground)", borderRadius: 8 }}>
                  <strong>Delay Reason:</strong> {selected.delayReason}
                </div>
              )}

              {/* Exception action buttons in detail panel */}
              {selected.status === 'Exception' && (
                <div style={{ gridColumn: "span 2", display: "flex", gap: "0.75rem", marginTop: "0.5rem" }}>
                  <Button design="Positive" icon="accept"
                    onClick={() => { setTargetShipment(selected); setApproveDialogOpen(true); }}>
                    Approve Exception
                  </Button>
                  <Button design="Negative" icon="decline" disabled={rejectMutation.isPending}
                    onClick={() => rejectMutation.mutate(selected.ID)}>
                    Reject Exception
                  </Button>
                </div>
              )}

              {/* PDF Upload */}
              <div style={{ gridColumn: "span 2", marginTop: "0.75rem" }}>
                <strong>Upload Invoice PDF:</strong><br />
                <input type="file" accept="application/pdf" style={{ marginTop: "0.5rem" }}
                  disabled={uploadMutation.isPending}
                  onChange={(e) => handleFileUpload(e, selected.ID)} />
                {uploadMutation.isPending && (
                  <span style={{ marginLeft: "0.5rem", fontSize: "0.8rem", color: "var(--sapContent_LabelColor)" }}>
                    ⏳ Uploading to Supabase Storage...
                  </span>
                )}
              </div>

              {ocrResult && (
                <div style={{ gridColumn: "span 2", padding: "1rem", background: "var(--sapSuccessBackground)", borderRadius: 8 }}>
                  <div>🤖 <strong>AI/OCR Result:</strong></div>
                  <div>Tracking: <strong>{ocrResult.trackingNumber}</strong></div>
                  <div>Batch ID: <strong>{ocrResult.batchId}</strong></div>
                  <div>Confidence: <strong>{(ocrResult.confidence * 100).toFixed(0)}%</strong></div>
                  {ocrResult.storageUrl && (
                    <div style={{ marginTop: "0.5rem" }}>
                      📎 <a href={ocrResult.storageUrl} target="_blank" rel="noreferrer"
                        style={{ color: "var(--sapLinkColor)" }}>
                        View uploaded PDF in Supabase Storage
                      </a>
                    </div>
                  )}
                </div>
              )}
            </div>
          </Card>
        )}
      </FlexBox>

      {/* ── Dialog: Create New Shipment ── */}
      <Dialog open={createDialogOpen} headerText="Create New Shipment"
        footer={<Bar endContent={
          <FlexBox style={{ gap: "0.5rem" }}>
            <Button onClick={() => setCreateDialogOpen(false)}>Cancel</Button>
            <Button design="Emphasized" disabled={createMutation.isPending}
              onClick={() => createMutation.mutate({
                deliveryDate:    createFormRef.current.deliveryDate || "2026-12-31T00:00:00Z",
                totalWeight:     parseFloat(createFormRef.current.totalWeight) || 0,
                vendorCode:       createFormRef.current.vendorCode || null,
                purchaseOrderId: createFormRef.current.purchaseOrderId || null,
                status:          "Draft",
              })}>
              {createMutation.isPending ? "Creating..." : "Create & Activate"}
            </Button>
          </FlexBox>
        } />}
        onClose={() => setCreateDialogOpen(false)}>
        <Form style={{ padding: "1rem", minWidth: 420 }}>
          <FormItem label={<Label>Vendor</Label>}>
            <Select onChange={e => createFormRef.current.vendorCode = e.detail.selectedOption.value}>
              <Option value="">— Select Vendor —</Option>
              {vendors.map(v => (
                <Option key={v.BusinessPartner} value={v.BusinessPartner}>
                  {v.BusinessPartnerFullName} ({v.BusinessPartner})
                </Option>
              ))}
            </Select>
          </FormItem>
          <FormItem label={<Label>Purchase Order #</Label>}>
            <Input placeholder="e.g. 4500000123"
              onInput={e => createFormRef.current.purchaseOrderId = e.target.value} />
          </FormItem>
          <FormItem label={<Label>Delivery Date</Label>}>
            <Input type="Date"
              onInput={e => createFormRef.current.deliveryDate = e.target.value + "T00:00:00Z"} />
          </FormItem>
          <FormItem label={<Label>Weight (kg)</Label>}>
            <Input type="Number" placeholder="0"
              onInput={e => createFormRef.current.totalWeight = e.target.value} />
          </FormItem>
        </Form>
      </Dialog>

      {/* ── Dialog: Flag Critical Delay ── */}
      <Dialog open={delayDialogOpen} headerText="⚠️ Flag Critical Delay"
        footer={<Bar endContent={
          <FlexBox style={{ gap: "0.5rem" }}>
            <Button onClick={() => { setDelayDialogOpen(false); setTargetShipment(null); }}>Cancel</Button>
            <Button design="Negative" disabled={delayMutation.isPending}
              onClick={() => delayMutation.mutate({
                shipmentId: targetShipment?.ID,
                reason:     delayReasonRef.current,
              })}>
              {delayMutation.isPending ? "Sending..." : "Confirm & Notify Manager"}
            </Button>
          </FlexBox>
        } />}
        onClose={() => { setDelayDialogOpen(false); setTargetShipment(null); }}>
        <div style={{ padding: "1rem", minWidth: 420 }}>
          <MessageStrip design="Warning" hideCloseButton style={{ marginBottom: "1rem" }}>
            This will flag the shipment as <strong>Exception</strong> and send an email alert to the Procurement Manager.
          </MessageStrip>
          <Form>
            <FormItem label={<Label>Shipment ID</Label>}>
              <Input value={targetShipment?.ID?.substring(0, 8) + "…"} readonly />
            </FormItem>
            <FormItem label={<Label>Reason for Delay *</Label>}>
              <TextArea
                rows={4} placeholder="Describe why the delivery will be delayed…"
                onInput={e => delayReasonRef.current = e.target.value}
                style={{ width: "100%" }}
              />
            </FormItem>
          </Form>
        </div>
      </Dialog>

      {/* ── Dialog: Approve Exception ── */}
      <Dialog open={approveDialogOpen} headerText="✅ Approve Delay Exception"
        footer={<Bar endContent={
          <FlexBox style={{ gap: "0.5rem" }}>
            <Button onClick={() => { setApproveDialogOpen(false); setTargetShipment(null); }}>Cancel</Button>
            <Button design="Positive" disabled={approveMutation.isPending}
              onClick={() => approveMutation.mutate({
                shipmentId:      targetShipment?.ID,
                newDeliveryDate: newDateRef.current ? newDateRef.current + "T00:00:00Z" : undefined,
              })}>
              {approveMutation.isPending ? "Approving…" : "Approve & Update S/4HANA PO"}
            </Button>
          </FlexBox>
        } />}
        onClose={() => { setApproveDialogOpen(false); setTargetShipment(null); }}>
        <div style={{ padding: "1rem", minWidth: 420 }}>
          <MessageStrip design="Information" hideCloseButton style={{ marginBottom: "1rem" }}>
            Approving will set the shipment to <strong>Shipped</strong> and PATCH the Statistical Delivery Date on the S/4HANA Purchase Order.
          </MessageStrip>
          {targetShipment?.delayReason && (
            <div style={{ padding: "0.75rem", background: "var(--sapErrorBackground)", borderRadius: 8, marginBottom: "1rem", fontSize: "0.875rem" }}>
              <strong>Vendor reason:</strong> {targetShipment.delayReason}
            </div>
          )}
          <Form>
            <FormItem label={<Label>PO Reference</Label>}>
              <Input value={targetShipment?.purchaseOrderId || "Not linked"} readonly />
            </FormItem>
            <FormItem label={<Label>New Delivery Date</Label>}>
              <Input type="Date"
                placeholder="Leave blank to keep original date"
                onInput={e => newDateRef.current = e.target.value} />
            </FormItem>
          </Form>
        </div>
      </Dialog>
    </>
  );
}
