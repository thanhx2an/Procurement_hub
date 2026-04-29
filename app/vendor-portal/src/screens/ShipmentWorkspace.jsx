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
} from "@ui5/webcomponents-react";
import {
  fetchShipments,
  createShipment,
  activateDraft,
  uploadInvoice,
  triggerCriticalDelay,
  fetchVendors,
  approveException,
  rejectException,
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
  const formRef = useRef({});
  const approveRef = useRef({});

  const { data: shipments = [], isLoading } = useQuery({
    queryKey: ["shipments"],
    queryFn: fetchShipments,
  });
  const { data: vendors = [] } = useQuery({
    queryKey: ["vendors"],
    queryFn: fetchVendors,
  });

  const createMutation = useMutation({
    mutationFn: async (payload) => {
      const draft = await createShipment(payload);
      return activateDraft(draft.ID);
    },
    onSuccess: () => {
      queryClient.invalidateQueries(["shipments"]);
      setDialogOpen(false);
    },
  });

  const delayMutation = useMutation({
    mutationFn: triggerCriticalDelay,
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
      Cell: ({ value }) => <StatusPill value={value} />,
    },
    {
      Header: "Actions",
      id: "actions",
      Cell: ({ row }) => (
        <FlexBox style={{ gap: "0.5rem" }}>
          <Button
            design="Transparent"
            icon="alert"
            disabled={row.original.status === "Exception"}
            onClick={() => delayMutation.mutate(row.original.ID)}
          />
          <Button
            design="Transparent"
            icon="detail-view"
            onClick={() => setSelected(row.original)}
          />
        </FlexBox>
      ),
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
              data={shipments}
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
              {selected.status === "Exception" && (
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
                <input
                  type="file"
                  accept="application/pdf"
                  style={{ marginTop: "0.5rem" }}
                  onChange={(e) => handleFileUpload(e, selected.ID)}
                />
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
                  onClick={() =>
                    createMutation.mutate({
                      deliveryDate:
                        formRef.current.deliveryDate || "2026-12-31T00:00:00Z",
                      totalWeight: parseFloat(formRef.current.totalWeight) || 0,
                      vendor_ID: formRef.current.vendor_ID || null,
                      status: "Draft",
                    })
                  }
                  disabled={createMutation.isPending}
                >
                  {createMutation.isPending
                    ? "Creating..."
                    : "Create & Activate"}
                </Button>
              </FlexBox>
            }
          />
        }
        onClose={() => setDialogOpen(false)}
      >
        <Form style={{ padding: "1rem", minWidth: 400 }}>
          <FormItem label={<Label>Vendor</Label>}>
            <Select
              onChange={(e) =>
                (formRef.current.vendor_ID = e.detail.selectedOption.value)
              }
            >
              <Option value="">— Select Vendor —</Option>
              {vendors.map((v) => (
                <Option key={v.BusinessPartner} value={v.BusinessPartner}>
                  {v.BusinessPartnerFullName} ({v.BusinessPartner})
                </Option>
              ))}
            </Select>
          </FormItem>
          <FormItem label={<Label>Delivery Date</Label>}>
            <Input
              type="Date"
              onInput={(e) =>
                (formRef.current.deliveryDate = e.target.value + "T00:00:00Z")
              }
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

      {/* Approve Exception Dialog */}
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
                onClick={() => approveMutation.mutate({
                  shipmentId: selected?.ID,
                  purchaseOrderId: approveRef.current.poId || null,
                  newDeliveryDate: approveRef.current.newDeliveryDate || new Date().toISOString(),
                })}
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
          <FormItem label={<Label>PO Number (optional)</Label>}>
            <Input
              placeholder="e.g. 4500000001"
              onInput={(e) => (approveRef.current.poId = e.target.value)}
            />
          </FormItem>
          <FormItem label={<Label>New Delivery Date</Label>}>
            <Input
              type="Date"
              onInput={(e) =>
                (approveRef.current.newDeliveryDate = e.target.value + "T00:00:00Z")
              }
            />
          </FormItem>
        </Form>
      </Dialog>
    </>
  );
}
