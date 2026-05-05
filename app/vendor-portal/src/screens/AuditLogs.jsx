import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Title,
  Card,
  CardHeader,
  BusyIndicator,
  FlexBox,
  FlexBoxDirection,
  AnalyticalTable,
  MessageStrip,
  Input,
  Label,
} from '@ui5/webcomponents-react';
import { fetchAuditLogs, fetchShipments } from '../api/client';

const ACTION_META = {
  SHIPMENT_ACTIVATED:     { label: 'Shipment submitted',   bg: '#e6f2ff', fg: '#0a6ed1' },
  CRITICAL_DELAY_FLAGGED: { label: 'Delay reported',       bg: '#fff8db', fg: '#8b6f00' },
  EXCEPTION_APPROVED:     { label: 'Delay approved',       bg: '#edf8e9', fg: '#256f3a' },
  EXCEPTION_REJECTED:     { label: 'Delay rejected',       bg: '#fbeaea', fg: '#aa0808' },
  DELIVERY_CONFIRMED:     { label: 'Delivery confirmed',   bg: '#edf8e9', fg: '#256f3a' },
  MARKED_AS_SHIPPED:      { label: 'Marked as shipped',    bg: '#e8f7f5', fg: '#0f766e' },
  INVOICE_UPLOADED:       { label: 'Invoice uploaded',     bg: '#e6f2ff', fg: '#0a6ed1' },
  PRICE_NEGOTIATION:      { label: 'Price negotiated',     bg: '#f3e8ff', fg: '#7c3aed' },
  NOT_RECEIVED_FLAGGED:   { label: 'Not received (mgr)',   bg: '#fbeaea', fg: '#aa0808' },
  DELIVERY_RECONFIRMED:   { label: 'Delivery reconfirmed', bg: '#e8f7f5', fg: '#0f766e' },
  AUTO_DELIVERED:         { label: 'Auto-delivered',       bg: '#edf8e9', fg: '#256f3a' },
  UPDATE:                 { label: 'Shipment updated',     bg: '#fff8db', fg: '#8b6f00' },
};

function ActionPill({ value }) {
  const meta = ACTION_META[value] || { label: value, bg: '#f2f2f2', fg: '#32363a' };
  return (
    <span style={{
      display: 'inline-block',
      padding: '0.15rem 0.6rem',
      borderRadius: 999,
      fontSize: '0.75rem',
      fontWeight: 600,
      background: meta.bg,
      color: meta.fg,
      whiteSpace: 'nowrap',
    }}>
      {meta.label}
    </span>
  );
}

const fmt = (dateStr) => dateStr ? new Date(dateStr).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : null;

function formatOld(action, raw) {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    switch (action) {
      case 'SHIPMENT_ACTIVATED':
        return 'Draft (unsubmitted)';
      case 'CRITICAL_DELAY_FLAGGED':
        return v.deliveryDate ? `Delivery: ${fmt(v.deliveryDate)}` : 'Pending';
      case 'EXCEPTION_APPROVED':
        return [
          v.deliveryDate ? `Original date: ${fmt(v.deliveryDate)}` : null,
          v.proposedDeliveryDate ? `Vendor proposed: ${fmt(v.proposedDeliveryDate)}` : null,
          v.reason ? `"${v.reason}"` : null,
        ].filter(Boolean).join(' · ');
      case 'EXCEPTION_REJECTED':
        return [
          'Exception',
          v.reason ? `"${v.reason}"` : null,
          v.proposedDeliveryDate ? `Proposed: ${fmt(v.proposedDeliveryDate)}` : null,
        ].filter(Boolean).join(' · ');
      case 'DELIVERY_CONFIRMED':
        return v.expectedDelivery ? `Expected: ${fmt(v.expectedDelivery)}` : 'Shipped';
      case 'MARKED_AS_SHIPPED':
        return v.deliveryDate ? `Pending · Due ${fmt(v.deliveryDate)}` : 'Pending';
      case 'INVOICE_UPLOADED':
        return 'No invoice';
      case 'PRICE_NEGOTIATION':
        return null;
      default:
        return null;
    }
  } catch { return null; }
}

function formatNew(action, raw) {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    switch (action) {
      case 'SHIPMENT_ACTIVATED':
        return [
          v.shipmentNumber || null,
          v.vendorCode ? `Vendor ${v.vendorCode}` : null,
          'Status → Pending',
        ].filter(Boolean).join(' · ');
      case 'CRITICAL_DELAY_FLAGGED':
        return [
          v.reason ? `"${v.reason}"` : null,
          v.proposedDeliveryDate ? `Proposed: ${fmt(v.proposedDeliveryDate)}` : null,
        ].filter(Boolean).join(' · ');
      case 'EXCEPTION_APPROVED':
        return v.newDeliveryDate ? `Approved · New date: ${fmt(v.newDeliveryDate)}` : 'Approved';
      case 'EXCEPTION_REJECTED':
        return v.deliveryDate ? `Reverted to Pending · Original date: ${fmt(v.deliveryDate)}` : 'Reverted to Pending';
      case 'DELIVERY_CONFIRMED':
        return [
          v.confirmedAt ? `Received ${fmt(v.confirmedAt)}` : 'Delivered',
          v.receivedNote ? `"${v.receivedNote}"` : null,
        ].filter(Boolean).join(' · ');
      case 'MARKED_AS_SHIPPED':
        return 'Shipped';
      case 'INVOICE_UPLOADED':
        return [
          v.trackingNumber ? `Tracking: ${v.trackingNumber}` : null,
          v.confidence != null ? `Confidence: ${(v.confidence * 100).toFixed(0)}%` : null,
          v.fileName || null,
        ].filter(Boolean).join(' · ');
      case 'PRICE_NEGOTIATION':
        return [
          v.materialId ? `Material ${v.materialId}` : null,
          v.negotiatedPrice != null ? `Price: ${Number(v.negotiatedPrice).toLocaleString()}` : null,
        ].filter(Boolean).join(' · ');
      case 'UPDATE':
        if (v.status) return `Status → ${v.status}`;
        return `${Object.keys(v).length} field(s) updated`;
      default:
        if (v.status) return `Status → ${v.status}`;
        return null;
    }
  } catch {
    return raw.length > 80 ? raw.substring(0, 80) + '…' : raw;
  }
}

export default function AuditLogs() {
  const [search, setSearch] = useState('');

  const { data: logs = [], isLoading } = useQuery({
    queryKey: ['auditLogs'],
    queryFn: fetchAuditLogs,
  });

  const { data: shipments = [] } = useQuery({
    queryKey: ['shipments'],
    queryFn: fetchShipments,
  });
  // Map: shipment UUID → shipmentNumber (for resolving entityId in audit rows)
  const shipmentMap = Object.fromEntries(
    shipments.map(s => [s.ID, s.shipmentNumber]).filter(([id, num]) => id && num)
  );

  const filtered = logs.filter(log => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      log.entityName?.toLowerCase().includes(q) ||
      log.action?.toLowerCase().includes(q) ||
      log.changedBy?.toLowerCase().includes(q) ||
      log.entityId?.toLowerCase().includes(q)
    );
  });

  const columns = [
    {
      Header: 'Time',
      accessor: 'changedAt',
      Cell: ({ value }) => value
        ? new Date(value).toLocaleString()
        : '—',
      width: 170,
    },
    {
      Header: 'Entity',
      accessor: 'entityName',
      Cell: ({ value }) => value || '—',
      width: 140,
    },
    {
      Header: 'Entity ID',
      accessor: 'entityId',
      Cell: ({ value }) => value ? (
        <span style={{
          display: 'inline-block',
          padding: '0.1rem 0.4rem',
          borderRadius: 4,
          background: 'var(--sapNeutralBackground)',
          color: 'var(--sapContent_LabelColor)',
          fontSize: '0.75rem',
          letterSpacing: '0.02em',
        }}>
          {value.substring(0, 8)}
        </span>
      ) : '—',
      width: 110,
    },
    {
      Header: 'Shipment #',
      id: 'shipmentNumber',
      Cell: ({ row }) => {
        const shpNum = shipmentMap[row.original.entityId];
        return shpNum
          ? <span style={{ fontWeight: 600, fontSize: '0.82rem' }}>{shpNum}</span>
          : <span style={{ color: 'var(--sapContent_LabelColor)' }}>—</span>;
      },
      width: 150,
    },
    {
      Header: 'Action',
      accessor: 'action',
      Cell: ({ value }) => <ActionPill value={value} />,
      width: 160,
    },
    {
      Header: 'Changed By',
      accessor: 'changedBy',
      Cell: ({ value }) => value
        ? <span style={{ fontSize: '0.85rem' }}>{value}</span>
        : '—',
      width: 150,
    },
    {
      Header: 'Before',
      accessor: 'oldValue',
      Cell: ({ value, row }) => {
        const text = formatOld(row.original.action, value);
        return text
          ? <span style={{ fontSize: '0.85rem', color: 'var(--sapCriticalColor)' }}>{text}</span>
          : <span style={{ color: 'var(--sapContent_LabelColor)' }}>—</span>;
      },
    },
    {
      Header: 'After',
      accessor: 'newValue',
      Cell: ({ value, row }) => {
        const text = formatNew(row.original.action, value);
        return text
          ? <span style={{ fontSize: '0.85rem', color: 'var(--sapPositiveColor)' }}>{text}</span>
          : <span style={{ color: 'var(--sapContent_LabelColor)' }}>—</span>;
      },
    },
  ];

  if (isLoading) return (
    <BusyIndicator active size="Large" style={{ marginTop: '4rem', width: '100%' }} />
  );

  return (
    <FlexBox direction={FlexBoxDirection.Column} style={{ gap: '1.5rem' }}>
      <FlexBox style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <Title level="H2">Audit Logs</Title>
        <span style={{ color: 'var(--sapContent_LabelColor)', fontSize: '0.875rem' }}>
          {filtered.length} record(s)
        </span>
      </FlexBox>

      <MessageStrip design="Information" hideCloseButton>
        Immutable audit trail — all changes to Shipments and Price Ledger are recorded automatically.
      </MessageStrip>

      <Card header={<CardHeader titleText="Search & Filter" />}>
        <div style={{ padding: '1rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <Label>Search:</Label>
          <Input
            placeholder="Entity, action, user…"
            value={search}
            onInput={(e) => setSearch(e.target.value)}
            style={{ width: 280 }}
          />
        </div>
      </Card>

      <Card header={
        <CardHeader
          titleText="Change History"
          subtitleText="Ordered by most recent"
        />
      }>
        {filtered.length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--sapContent_LabelColor)' }}>
            {logs.length === 0 ? 'No audit entries yet.' : 'No results match your search.'}
          </div>
        ) : (
          <AnalyticalTable
            data={filtered}
            columns={columns}
            visibleRows={15}
            sortable
            scaleWidthMode="Grow"
          />
        )}
      </Card>
    </FlexBox>
  );
}
