import { useQuery } from "@tanstack/react-query";
import {
  Title,
  Card,
  CardHeader,
  AnalyticalTable,
  BusyIndicator,
  MessageStrip,
  FlexBox,
  FlexBoxDirection,
  FlexBoxWrap,
} from "@ui5/webcomponents-react";
import {
  fetchShipments,
  fetchVendors,
  fetchPurchaseOrders,
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

function KpiCard({ title, value, unit, state, icon }) {
  return (
    <Card
      header={<CardHeader titleText={title} />}
      style={{ minWidth: 180, flex: 1 }}
    >
      <div style={{ padding: "1rem", textAlign: "center" }}>
        <div
          style={{
            fontSize: "2.5rem",
            fontWeight: 700,
            color:
              state === "critical"
                ? "var(--sapCriticalColor)"
                : state === "positive"
                  ? "var(--sapPositiveColor)"
                  : "var(--sapTextColor)",
          }}
        >
          {value}
        </div>
        <div
          style={{
            color: "var(--sapContent_LabelColor)",
            fontSize: "0.875rem",
          }}
        >
          {unit}
        </div>
      </div>
    </Card>
  );
}

export default function Dashboard() {
  const { data: shipments = [], isLoading: ls } = useQuery({
    queryKey: ["shipments"],
    queryFn: fetchShipments,
  });
  const { data: vendors = [], isLoading: lv } = useQuery({
    queryKey: ["vendors"],
    queryFn: fetchVendors,
  });
  const { data: pos = [], isLoading: lp } = useQuery({
    queryKey: ["purchaseOrders"],
    queryFn: fetchPurchaseOrders,
  });

  // Manager không cần thấy drafts
  const activeShipments = shipments.filter((s) => s.IsActiveEntity !== false);

  const exceptions = activeShipments.filter((s) => s.status === "Exception");
  const pending    = activeShipments.filter((s) => s.status === "Pending");
  const inTransit  = activeShipments.filter((s) => s.status === "Shipped");
  const delivered  = activeShipments.filter((s) => s.status === "Delivered");

  // At-Risk: Pending và delivery date trong vòng 7 ngày (hoặc đã qua)
  const now = new Date();
  const in7days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const atRisk = activeShipments.filter((s) => {
    if (s.status !== "Pending") return false;
    const d = s.deliveryDate ? new Date(s.deliveryDate) : null;
    return d && d <= in7days;
  });

  if (ls || lv || lp)
    return (
      <BusyIndicator
        active
        size="Large"
        style={{ marginTop: "4rem", width: "100%" }}
      />
    );

  return (
    <FlexBox direction={FlexBoxDirection.Column} style={{ gap: "1.5rem" }}>
      <Title level="H2">Executive Dashboard</Title>

      {exceptions.length > 0 && (
        <MessageStrip design="Critical" hideCloseButton>
          ⚠️ {exceptions.length} shipment(s) flagged as Exception!
        </MessageStrip>
      )}

      <FlexBox wrap={FlexBoxWrap.Wrap} style={{ gap: "1rem" }}>
        <KpiCard title="Total Vendors"  value={vendors.length}    unit="partners"   state="neutral" />
        <KpiCard title="Open POs"       value={pos.length}        unit="orders"     state="neutral" />
        <KpiCard title="Pending"        value={pending.length}    unit="shipments"  state={pending.length > 0 ? "neutral" : "neutral"} />
        <KpiCard title="In Transit"     value={inTransit.length}  unit="shipments"  state="neutral" />
        <KpiCard title="Delivered"      value={delivered.length}  unit="shipments"  state="positive" />
        <KpiCard title="Exceptions"     value={exceptions.length} unit="at-risk"    state={exceptions.length > 0 ? "critical" : "neutral"} />
        <KpiCard title="At-Risk"        value={atRisk.length}     unit="due soon"   state={atRisk.length > 0 ? "critical" : "positive"} />
      </FlexBox>

      {atRisk.length > 0 && (
        <Card header={<CardHeader titleText="⚠️ At-Risk Shipments" subtitleText="Pending — delivery due within 7 days" />}>
          <AnalyticalTable
            data={atRisk}
            columns={[
              { Header: "Vendor",        accessor: "vendor_ID",    Cell: ({ value }) => value || "—" },
              { Header: "Delivery Date", accessor: "deliveryDate", Cell: ({ value }) => value ? new Date(value).toLocaleDateString() : "—" },
              { Header: "Weight (kg)",   accessor: "totalWeight" },
              { Header: "Status",        accessor: "status",       Cell: ({ value }) => <StatusPill value={value} /> },
            ]}
            visibleRows={5}
          />
        </Card>
      )}

      <Card
        header={
          <CardHeader titleText="All Shipments" subtitleText="Local BTP DB" />
        }
      >
        {activeShipments.length === 0 ? (
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
            data={activeShipments}
            columns={[
              { Header: "Vendor", accessor: "vendor_ID" },
              {
                Header: "Delivery Date",
                accessor: "deliveryDate",
                Cell: ({ value }) =>
                  value ? new Date(value).toLocaleDateString() : "—",
              },
              { Header: "Weight (kg)", accessor: "totalWeight" },
              {
                Header: "Status",
                accessor: "status",
                Cell: ({ value }) => <StatusPill value={value} />,
              },
            ]}
            visibleRows={8}
            filterable
            sortable
          />
        )}
      </Card>

      <Card
        header={
          <CardHeader
            titleText="Purchase Orders"
            subtitleText="Live from S/4HANA"
          />
        }
      >
        <AnalyticalTable
          data={pos.slice(0, 5)}
          columns={[
            { Header: "PO Number", accessor: "PurchaseOrder" },
            { Header: "Type", accessor: "PurchaseOrderType" },
            { Header: "Supplier", accessor: "Supplier" },
            { Header: "Currency", accessor: "DocumentCurrency" },
          ]}
          visibleRows={5}
        />
      </Card>
    </FlexBox>
  );
}
