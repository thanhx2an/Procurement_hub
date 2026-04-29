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
import { fetchAuditLogs } from '../api/client';

const ACTION_STYLES = {
  UPDATE:  { bg: '#fff8db', fg: '#8b6f00' },
  CREATE:  { bg: '#e8f7f5', fg: '#0f766e' },
  DELETE:  { bg: '#fbeaea', fg: '#aa0808' },
  APPROVE: { bg: '#edf8e9', fg: '#256f3a' },
  REJECT:  { bg: '#fbeaea', fg: '#aa0808' },
};

function ActionPill({ value }) {
  const style = ACTION_STYLES[value] || { bg: '#f2f2f2', fg: '#32363a' };
  return (
    <span style={{
      display: 'inline-block',
      padding: '0.15rem 0.6rem',
      borderRadius: 999,
      fontSize: '0.75rem',
      fontWeight: 600,
      background: style.bg,
      color: style.fg,
    }}>
      {value || '—'}
    </span>
  );
}

export default function AuditLogs() {
  const [search, setSearch] = useState('');

  const { data: logs = [], isLoading } = useQuery({
    queryKey: ['auditLogs'],
    queryFn: fetchAuditLogs,
  });

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
      Cell: ({ value }) => value
        ? <span style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{value.substring(0, 12)}…</span>
        : '—',
      width: 130,
    },
    {
      Header: 'Action',
      accessor: 'action',
      Cell: ({ value }) => <ActionPill value={value} />,
      width: 100,
    },
    {
      Header: 'Changed By',
      accessor: 'changedBy',
      Cell: ({ value }) => value || '—',
      width: 140,
    },
    {
      Header: 'Old Value',
      accessor: 'oldValue',
      Cell: ({ value }) => value
        ? <span style={{ fontFamily: 'monospace', fontSize: '0.75rem', color: 'var(--sapCriticalColor)' }}>{value.substring(0, 60)}{value.length > 60 ? '…' : ''}</span>
        : <span style={{ color: 'var(--sapContent_LabelColor)' }}>—</span>,
    },
    {
      Header: 'New Value',
      accessor: 'newValue',
      Cell: ({ value }) => value
        ? <span style={{ fontFamily: 'monospace', fontSize: '0.75rem', color: 'var(--sapPositiveColor)' }}>{value.substring(0, 60)}{value.length > 60 ? '…' : ''}</span>
        : <span style={{ color: 'var(--sapContent_LabelColor)' }}>—</span>,
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
