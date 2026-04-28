import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Title,
  Card,
  CardHeader,
  BusyIndicator,
  FlexBox,
  FlexBoxDirection,
  MessageStrip,
  Select,
  Option,
  Label,
  Input,
} from '@ui5/webcomponents-react';
import { fetchAuditLogs } from '../api/client';

const ACTION_STYLES = {
  UPDATE:                 { bg: '#e6f2ff', fg: '#0a6ed1', icon: '✏️' },
  PRICE_NEGOTIATION:      { bg: '#fff8db', fg: '#8b6f00', icon: '💰' },
  INVOICE_UPLOADED:       { bg: '#e8f7f5', fg: '#0f766e', icon: '📄' },
  CRITICAL_DELAY_FLAGGED: { bg: '#fbeaea', fg: '#aa0808', icon: '🚨' },
};

function ActionBadge({ action }) {
  const style = ACTION_STYLES[action] || { bg: '#f2f2f2', fg: '#32363a', icon: '🔹' };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
      padding: '0.2rem 0.6rem', borderRadius: 999,
      fontSize: '0.75rem', fontWeight: 600,
      background: style.bg, color: style.fg,
    }}>
      {style.icon} {action?.replace(/_/g, ' ')}
    </span>
  );
}

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString();
}

function tryParse(str) {
  try { return JSON.parse(str); } catch { return str; }
}

export default function AuditLogs() {
  const [filterAction, setFilterAction] = useState('');
  const [filterEntity, setFilterEntity] = useState('');
  const [search, setSearch]             = useState('');

  const { data: logs = [], isLoading, isError } = useQuery({
    queryKey: ['auditLogs'],
    queryFn: fetchAuditLogs,
    refetchInterval: 30000,
  });

  const filtered = logs.filter(log => {
    if (filterAction && log.action !== filterAction) return false;
    if (filterEntity && log.entityName !== filterEntity) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        log.changedBy?.toLowerCase().includes(q) ||
        log.entityId?.toLowerCase().includes(q) ||
        log.action?.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const uniqueActions  = [...new Set(logs.map(l => l.action).filter(Boolean))];
  const uniqueEntities = [...new Set(logs.map(l => l.entityName).filter(Boolean))];

  if (isLoading) return <BusyIndicator active size="Large" style={{ marginTop: '4rem', width: '100%' }} />;

  return (
    <FlexBox direction={FlexBoxDirection.Column} style={{ gap: '1.5rem' }}>
      <Title level="H2">Audit Logs</Title>

      <MessageStrip design="Information" hideCloseButton>
        Immutable compliance trail — every create, update, and action is recorded with user identity and timestamp.
      </MessageStrip>

      {isError && (
        <MessageStrip design="Negative">Failed to load audit logs. Check your role — only Auditor and Procurement Manager can access this.</MessageStrip>
      )}

      {/* ─── Filters ─── */}
      <Card header={<CardHeader titleText="Filters" />}>
        <FlexBox style={{ gap: '1rem', padding: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <div>
            <Label style={{ display: 'block', marginBottom: '0.25rem' }}>Action</Label>
            <Select style={{ minWidth: 200 }} onChange={e => setFilterAction(e.detail.selectedOption.value)}>
              <Option value="">All Actions</Option>
              {uniqueActions.map(a => <Option key={a} value={a}>{a.replace(/_/g, ' ')}</Option>)}
            </Select>
          </div>
          <div>
            <Label style={{ display: 'block', marginBottom: '0.25rem' }}>Entity</Label>
            <Select style={{ minWidth: 180 }} onChange={e => setFilterEntity(e.detail.selectedOption.value)}>
              <Option value="">All Entities</Option>
              {uniqueEntities.map(e => <Option key={e} value={e}>{e}</Option>)}
            </Select>
          </div>
          <div>
            <Label style={{ display: 'block', marginBottom: '0.25rem' }}>Search</Label>
            <Input
              placeholder="User, entity ID, action…"
              style={{ minWidth: 220 }}
              onInput={e => setSearch(e.target.value)}
            />
          </div>
        </FlexBox>
      </Card>

      {/* ─── Summary KPIs ─── */}
      <FlexBox style={{ gap: '1rem', flexWrap: 'wrap' }}>
        {[
          { label: 'Total Events',     value: logs.length,                                         color: 'var(--sapTextColor)' },
          { label: 'Price Changes',    value: logs.filter(l => l.action === 'PRICE_NEGOTIATION').length,      color: 'var(--sapCriticalColor)' },
          { label: 'Invoice Uploads',  value: logs.filter(l => l.action === 'INVOICE_UPLOADED').length,       color: 'var(--sapPositiveColor)' },
          { label: 'Critical Delays',  value: logs.filter(l => l.action === 'CRITICAL_DELAY_FLAGGED').length, color: 'var(--sapNegativeColor)' },
        ].map(kpi => (
          <Card key={kpi.label} style={{ flex: 1, minWidth: 140 }}>
            <div style={{ padding: '1rem', textAlign: 'center' }}>
              <div style={{ fontSize: '2rem', fontWeight: 700, color: kpi.color }}>{kpi.value}</div>
              <div style={{ fontSize: '0.8rem', color: 'var(--sapContent_LabelColor)', marginTop: '0.25rem' }}>{kpi.label}</div>
            </div>
          </Card>
        ))}
      </FlexBox>

      {/* ─── Log Entries ─── */}
      <Card header={
        <CardHeader
          titleText="Change Log"
          subtitleText={`${filtered.length} of ${logs.length} event(s) — auto-refreshes every 30s`}
        />
      }>
        {filtered.length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--sapContent_LabelColor)' }}>
            No audit log entries found.
          </div>
        ) : (
          <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {filtered.map(log => {
              const newVal = log.newValue ? tryParse(log.newValue) : null;
              return (
                <div key={log.ID} style={{
                  border: '1px solid var(--sapList_BorderColor)',
                  borderRadius: 8,
                  padding: '0.875rem 1rem',
                  background: 'var(--sapBackgroundColor)',
                  display: 'grid',
                  gridTemplateColumns: '1fr auto',
                  gap: '0.5rem',
                }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                    <FlexBox style={{ gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                      <ActionBadge action={log.action} />
                      <span style={{ fontSize: '0.8rem', color: 'var(--sapContent_LabelColor)' }}>
                        <strong>{log.entityName}</strong>
                        {log.entityId && <> · <code style={{ fontSize: '0.75rem' }}>{log.entityId?.substring(0, 8)}…</code></>}
                      </span>
                    </FlexBox>

                    {newVal && typeof newVal === 'object' && (
                      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginTop: '0.25rem' }}>
                        {Object.entries(newVal).slice(0, 5).map(([k, v]) => (
                          <span key={k} style={{ fontSize: '0.78rem', color: 'var(--sapTextColor)' }}>
                            <span style={{ color: 'var(--sapContent_LabelColor)' }}>{k}:</span>{' '}
                            <strong>{String(v).substring(0, 40)}</strong>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div style={{ textAlign: 'right', fontSize: '0.78rem', color: 'var(--sapContent_LabelColor)', whiteSpace: 'nowrap' }}>
                    <div style={{ fontWeight: 600, color: 'var(--sapTextColor)' }}>{log.changedBy || 'system'}</div>
                    <div>{formatDate(log.changedAt)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </FlexBox>
  );
}
