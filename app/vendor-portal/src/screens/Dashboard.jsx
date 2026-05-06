import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
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
  Button,
} from "@ui5/webcomponents-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, Legend,
} from "recharts";
import {
  fetchShipmentStats,
  fetchAtRiskShipments,
  fetchShipmentChart,
  fetchVendors,
  fetchPurchaseOrders,
  fetchActionRequired,
  fetchMe,
} from "../api/client";

const STATUS_COLORS = {
  Draft:     "#0a6ed1",
  Pending:   "#e9730c",
  Shipped:   "#0f766e",
  Delivered: "#256f3a",
  Exception: "#aa0808",
};

function ShipmentChart({ shipments }) {
  // Group by status
  const byStatus = ["Draft","Pending","Shipped","Delivered","Exception"].map(s => ({
    status: s,
    count: shipments.filter(sh => sh.status === s).length,
  }));

  // Group by month (last 6 months)
  const monthMap = {};
  shipments.forEach(sh => {
    if (!sh.deliveryDate) return;
    const d = new Date(sh.deliveryDate);
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    if (!monthMap[key]) monthMap[key] = { month: key, Pending: 0, Shipped: 0, Delivered: 0, Exception: 0 };
    if (monthMap[key][sh.status] !== undefined) monthMap[key][sh.status]++;
  });
  const byMonth = Object.values(monthMap).sort((a,b) => a.month.localeCompare(b.month)).slice(-6);

  return (
    <FlexBox style={{ gap: '1rem', flexWrap: 'wrap' }}>
      {/* Status distribution */}
      <Card header={<CardHeader titleText="Shipments by Status" subtitleText="Current distribution" />}
        style={{ flex: 1, minWidth: 300 }}>
        <div style={{ padding: '1rem', height: 220 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={byStatus} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <XAxis dataKey="status" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="count" radius={[4,4,0,0]}>
                {byStatus.map(entry => (
                  <Cell key={entry.status} fill={STATUS_COLORS[entry.status] || '#888'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Delivery trends by month */}
      {byMonth.length > 0 && (
        <Card header={<CardHeader titleText="Delivery Trends" subtitleText="By expected delivery month" />}
          style={{ flex: 1, minWidth: 320 }}>
          <div style={{ padding: '1rem', height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byMonth} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="Pending"   stackId="a" fill={STATUS_COLORS.Pending}   radius={0} />
                <Bar dataKey="Shipped"   stackId="a" fill={STATUS_COLORS.Shipped}   radius={0} />
                <Bar dataKey="Delivered" stackId="a" fill={STATUS_COLORS.Delivered} radius={[4,4,0,0]} />
                <Bar dataKey="Exception" stackId="a" fill={STATUS_COLORS.Exception} radius={0} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}
    </FlexBox>
  );
}

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
  const navigate = useNavigate();

  // ── Server-side aggregation — each query is targeted, minimal payload ──────
  const { data: stats = {}, isLoading: ls } = useQuery({
    queryKey: ["shipmentStats"],
    queryFn: fetchShipmentStats,
    staleTime: 60000,
  });
  const { data: atRisk = [], isLoading: lar } = useQuery({
    queryKey: ["atRiskShipments"],
    queryFn: fetchAtRiskShipments,
    staleTime: 60000,
  });
  const { data: chartData = [], isLoading: lc } = useQuery({
    queryKey: ["shipmentChart"],
    queryFn: fetchShipmentChart,
    staleTime: 60000,
  });
  const { data: vendors = [], isLoading: lv } = useQuery({
    queryKey: ["vendors"],
    queryFn: fetchVendors,
  });
  const { data: pos = [], isLoading: lp } = useQuery({
    queryKey: ["purchaseOrders"],
    queryFn: fetchPurchaseOrders,
  });
  const { data: me = {} } = useQuery({ queryKey: ['me'], queryFn: fetchMe });
  const { data: actionItems = [] } = useQuery({
    queryKey: ['actionRequired'],
    queryFn: fetchActionRequired,
    staleTime: 30000,
  });

  const isManager = me?.roles?.includes('ProcurementManager');
  const isVendor  = me?.roles?.includes('VendorUser') || me?.roles?.includes('VendorAdmin');

  // Filter action items by role
  const myActions = actionItems.filter(s => {
    if (isManager) {
      return s.status === 'Shipped' ||
        (s.status === 'Exception' && s.exceptionType === 'VENDOR_DELAY');
    }
    if (isVendor) {
      return s.status === 'Pending' ||
        (s.status === 'Exception' && s.exceptionType === 'NOT_RECEIVED');
    }
    return false;
  });

  const actionLabel = (s) => {
    if (isManager) {
      if (s.status === 'Shipped')    return { text: 'Awaiting receipt confirmation', badge: 'Confirm Received', color: '#0f766e' };
      if (s.status === 'Exception')  return { text: 'Vendor reported a delay',       badge: 'Approve / Reject', color: '#aa0808' };
    }
    if (isVendor) {
      if (s.status === 'Pending')    return { text: 'Ready to ship?',                badge: 'Mark as Shipped', color: '#8b6f00' };
      if (s.status === 'Exception' && s.exceptionType === 'NOT_RECEIVED')
        return { text: 'Manager flagged goods not received', badge: 'Reconfirm or Flag Delay', color: '#aa0808' };
    }
    return { text: '', badge: '', color: '#6e6e6e' };
  };

  const [poVisible, setPoVisible] = useState(5);

  if (ls || lar || lc || lv || lp)
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

      {(stats['Exception'] || 0) > 0 && (
        <MessageStrip design="Critical" hideCloseButton>
          ⚠️ {stats['Exception']} shipment(s) flagged as Exception!
        </MessageStrip>
      )}

      <FlexBox wrap={FlexBoxWrap.Wrap} style={{ gap: "1rem" }}>
        <KpiCard title="Total Vendors"  value={vendors.length}          unit="partners"  state="neutral" />
        <KpiCard title="Open POs"       value={pos.length}              unit="orders"    state="neutral" />
        <KpiCard title="Pending"        value={stats['Pending']  || 0}  unit="shipments" state="neutral" />
        <KpiCard title="In Transit"     value={stats['Shipped']  || 0}  unit="shipments" state="neutral" />
        <KpiCard title="Delivered"      value={stats['Delivered']|| 0}  unit="shipments" state="positive" />
        <KpiCard title="Exceptions"     value={stats['Exception']|| 0}  unit="at-risk"   state={(stats['Exception'] || 0) > 0 ? "critical" : "neutral"} />
        <KpiCard title="At-Risk"        value={atRisk.length}           unit="due soon"  state={atRisk.length > 0 ? "critical" : "positive"} />
      </FlexBox>

      {/* ── Action Required ── */}
      {myActions.length > 0 && (
        <Card header={
          <CardHeader
            titleText={`🔔 Action Required (${myActions.length})`}
            subtitleText="Shipments waiting for your action"
          />
        }>
          <div style={{ padding: '0.75rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {myActions.map(s => {
              const { text, badge, color } = actionLabel(s);
              return (
                <div key={s.ID} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '0.75rem 1rem',
                  border: `1px solid ${color}22`,
                  borderLeft: `4px solid ${color}`,
                  borderRadius: 8,
                  background: `${color}07`,
                  gap: '1rem',
                }}>
                  {/* Left: shipment info */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>
                        {s.shipmentNumber || s.ID?.substring(0, 8)}
                      </span>
                      {s.vendorCode && (
                        <span style={{
                          fontSize: '0.75rem', padding: '0.1rem 0.5rem',
                          borderRadius: 999, background: 'var(--sapNeutralBackground)',
                          color: 'var(--sapContent_LabelColor)',
                        }}>
                          {s.vendorCode}
                        </span>
                      )}
                      {s.deliveryDate && (
                        <span style={{ fontSize: '0.75rem', color: 'var(--sapContent_LabelColor)' }}>
                          Due {new Date(s.deliveryDate).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: '0.8rem', color: 'var(--sapContent_LabelColor)' }}>{text}</span>
                      <span style={{
                        fontSize: '0.75rem', fontWeight: 600,
                        padding: '0.15rem 0.55rem', borderRadius: 999,
                        background: `${color}18`, color,
                      }}>
                        {badge}
                      </span>
                    </div>
                  </div>
                  {/* Right: Go button */}
                  <Button design="Transparent" icon="arrow-right"
                    onClick={() => navigate('/shipments')}
                    style={{ flexShrink: 0 }}
                  >
                    Go
                  </Button>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <ShipmentChart shipments={chartData} />

      {atRisk.length > 0 && (
        <Card header={<CardHeader titleText="⚠️ At-Risk Shipments" subtitleText="Pending — delivery due within 7 days" />}>
          <AnalyticalTable
            data={atRisk}
            columns={[
              { Header: "Vendor",        accessor: "vendorCode",   Cell: ({ value }) => value || "—" },
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
        {chartData.length === 0 ? (
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
            data={chartData}
            columns={[
              { Header: "Vendor", accessor: "vendorCode", Cell: ({ value }) => value || "—" },
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
            subtitleText={`Live from S/4HANA · showing ${Math.min(poVisible, pos.length)} of ${pos.length}`}
          />
        }
      >
        <AnalyticalTable
          data={pos.slice(0, poVisible)}
          columns={[
            { Header: "PO Number", accessor: "PurchaseOrder" },
            { Header: "Type", accessor: "PurchaseOrderType" },
            { Header: "Supplier", accessor: "Supplier" },
            { Header: "Currency", accessor: "DocumentCurrency" },
          ]}
          visibleRows={Math.min(poVisible, pos.length)}
        />
        {poVisible < pos.length && (
          <div style={{ padding: '0.75rem 1rem', textAlign: 'center' }}>
            <Button
              design="Transparent"
              icon="down"
              onClick={() => setPoVisible(v => v + 5)}
            >
              Load more ({pos.length - poVisible} remaining)
            </Button>
          </div>
        )}
      </Card>
    </FlexBox>
  );
}
