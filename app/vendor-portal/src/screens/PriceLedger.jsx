import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Title, Card, CardHeader, Button, BusyIndicator,
  FlexBox, FlexBoxDirection, FlexBoxWrap,
  Dialog, Form, FormItem, Input, Select, Option, Bar, Label,
  MessageStrip, AnalyticalTable,
} from '@ui5/webcomponents-react';
import { fetchPriceLedger, createPriceEntry, fetchProducts, fetchMe } from '../api/client';

// ── Savings badge ──────────────────────────────────────────────────────────
function SavingsBadge({ negotiated, base }) {
  if (!base || base === 0) return <span style={{ color: 'var(--sapContent_LabelColor)' }}>—</span>;
  const pct = ((1 - negotiated / base) * 100).toFixed(1);
  const savings = pct > 0;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '0.1rem 0.45rem', borderRadius: 999,
      fontSize: '0.75rem', fontWeight: 700,
      background: savings ? '#edf8e9' : '#fbeaea',
      color: savings ? '#256f3a' : '#aa0808',
    }}>
      {savings ? '▼' : '▲'} {Math.abs(pct)}%
    </span>
  );
}

// ── KPI mini-card ──────────────────────────────────────────────────────────
function MiniKpi({ label, value, color }) {
  return (
    <div style={{
      flex: 1, minWidth: 140,
      border: '1px solid var(--sapList_BorderColor)',
      borderRadius: 8, padding: '0.75rem 1rem',
    }}>
      <div style={{ fontSize: '1.6rem', fontWeight: 700, color: color || 'var(--sapTextColor)' }}>
        {value}
      </div>
      <div style={{ fontSize: '0.8rem', color: 'var(--sapContent_LabelColor)', marginTop: 2 }}>
        {label}
      </div>
    </div>
  );
}

export default function PriceLedger() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [successMsg, setSuccessMsg]  = useState(null);
  const formRef = useRef({});

  const { data: me }              = useQuery({ queryKey: ['me'],          queryFn: fetchMe });
  const { data: ledger = [], isLoading } = useQuery({ queryKey: ['priceLedger'], queryFn: fetchPriceLedger });
  const { data: products = [] }   = useQuery({ queryKey: ['products'],    queryFn: fetchProducts });

  const isVendor    = me?.roles?.includes('VendorUser') || me?.roles?.includes('VendorAdmin');
  const isManager   = me?.roles?.includes('ProcurementManager');

  // ── Computed KPIs ────────────────────────────────────────────────────────
  const totalEntries  = ledger.length;
  const savingEntries = ledger.filter(e => e.negotiatedPrice < e.basePrice);
  const totalSavings  = savingEntries.reduce((sum, e) => sum + (e.basePrice - e.negotiatedPrice), 0);
  const avgDiscount   = totalEntries > 0
    ? (ledger.reduce((sum, e) => {
        if (!e.basePrice) return sum;
        return sum + (1 - e.negotiatedPrice / e.basePrice) * 100;
      }, 0) / ledger.filter(e => e.basePrice).length) || 0
    : 0;

  const createMutation = useMutation({
    mutationFn: createPriceEntry,
    onSuccess: () => {
      queryClient.invalidateQueries(['priceLedger']);
      setDialogOpen(false);
      formRef.current = {};
      setSuccessMsg('✅ Price entry recorded in temporal ledger!');
      setTimeout(() => setSuccessMsg(null), 4000);
    },
    onError: (err) => {
      setSuccessMsg(`❌ Error: ${err?.response?.data?.error?.message || err.message}`);
    },
  });

  const handleSave = () => {
    const { productId, vendorId, price, basePrice } = formRef.current;
    if (!productId || !vendorId || !price) {
      setSuccessMsg('❌ Please fill in Product, Vendor ID, and Negotiated Price.');
      return;
    }
    createMutation.mutate({
      product_ID:      productId,
      vendor_ID:       vendorId,
      vendorCode:      vendorId,
      negotiatedPrice: parseFloat(price) || 0,
      basePrice:       parseFloat(basePrice) || 0,
      validFrom:       new Date().toISOString(),
      validTo:         '9999-12-31T00:00:00Z',
    });
  };

  // ── Table columns ────────────────────────────────────────────────────────
  const columns = [
    {
      Header: 'Product',
      accessor: 'product_ID',
      Cell: ({ value }) => <strong>{value || '—'}</strong>,
      width: 160,
    },
    {
      Header: 'Vendor',
      accessor: 'vendor_ID',
      Cell: ({ value }) => value || '—',
      width: 120,
    },
    {
      Header: 'Negotiated Price',
      accessor: 'negotiatedPrice',
      Cell: ({ value }) => (
        <span style={{ fontWeight: 600, color: 'var(--sapPositiveColor)' }}>
          {value != null ? value.toLocaleString(undefined, { minimumFractionDigits: 2 }) : '—'}
        </span>
      ),
      width: 150,
    },
    {
      Header: 'Base Price (S/4)',
      accessor: 'basePrice',
      Cell: ({ value }) => value != null
        ? value.toLocaleString(undefined, { minimumFractionDigits: 2 })
        : <span style={{ color: 'var(--sapContent_LabelColor)' }}>—</span>,
      width: 150,
    },
    {
      Header: 'Savings vs Baseline',
      id: 'savings',
      Cell: ({ row }) => (
        <SavingsBadge
          negotiated={row.original.negotiatedPrice}
          base={row.original.basePrice}
        />
      ),
      width: 160,
    },
    {
      Header: 'Valid From',
      accessor: 'validFrom',
      Cell: ({ value }) => value ? new Date(value).toLocaleDateString() : '—',
      width: 120,
    },
    {
      Header: 'Valid To',
      accessor: 'validTo',
      Cell: ({ value }) => {
        if (!value) return '—';
        const d = new Date(value);
        return d.getFullYear() >= 9999
          ? <span style={{ color: 'var(--sapPositiveColor)', fontWeight: 600 }}>Open-ended</span>
          : d.toLocaleDateString();
      },
      width: 120,
    },
  ];

  if (isLoading) return <BusyIndicator active size="Large" style={{ marginTop: '4rem', width: '100%' }} />;

  return (
    <>
      <FlexBox direction={FlexBoxDirection.Column} style={{ gap: '1.5rem' }}>

        {/* Header row */}
        <FlexBox style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <Title level="H2">Price Negotiation Ledger</Title>
          {(isVendor || isManager) && (
            <Button design="Emphasized" icon="add" onClick={() => setDialogOpen(true)}>
              New Price Entry
            </Button>
          )}
        </FlexBox>

        {successMsg && (
          <MessageStrip
            design={successMsg.startsWith('✅') ? 'Positive' : 'Critical'}
            onClose={() => setSuccessMsg(null)}
          >
            {successMsg}
          </MessageStrip>
        )}

        <MessageStrip design="Information" hideCloseButton>
          Immutable temporal ledger — every negotiated price is stored with validFrom / validTo timestamps
          and compared against the S/4HANA product baseline price.
        </MessageStrip>

        {/* KPI row */}
        <FlexBox wrap={FlexBoxWrap.Wrap} style={{ gap: '0.75rem' }}>
          <MiniKpi label="Total Entries"    value={totalEntries} />
          <MiniKpi
            label="Below Baseline"
            value={savingEntries.length}
            color={savingEntries.length > 0 ? 'var(--sapPositiveColor)' : undefined}
          />
          <MiniKpi
            label="Avg Discount"
            value={`${avgDiscount.toFixed(1)}%`}
            color={avgDiscount > 0 ? 'var(--sapPositiveColor)' : 'var(--sapCriticalColor)'}
          />
          <MiniKpi
            label="Total Savings"
            value={totalSavings.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            color={totalSavings > 0 ? 'var(--sapPositiveColor)' : undefined}
          />
        </FlexBox>

        {/* Main table */}
        <Card header={
          <CardHeader
            titleText="Negotiation History"
            subtitleText={`${ledger.length} entries · compared vs S/4HANA baseline`}
          />
        }>
          {ledger.length === 0 ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--sapContent_LabelColor)' }}>
              No price entries yet. Click "New Price Entry" to record a negotiation.
            </div>
          ) : (
            <AnalyticalTable
              data={ledger}
              columns={columns}
              visibleRows={10}
              sortable
              filterable
              scaleWidthMode="Grow"
            />
          )}
        </Card>

        {/* Products from S/4HANA — reference panel */}
        <Card header={
          <CardHeader
            titleText="Product Master (S/4HANA)"
            subtitleText="Live reference — select a product above when recording a negotiation"
          />
        }>
          <div style={{ padding: '1rem', display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            {products.length === 0
              ? <span style={{ color: 'var(--sapContent_LabelColor)' }}>No products loaded.</span>
              : products.slice(0, 12).map(p => (
                  <div key={p.Product} style={{
                    padding: '0.45rem 0.85rem',
                    border: '1px solid var(--sapList_BorderColor)',
                    borderRadius: 8,
                    fontSize: '0.8rem',
                    cursor: 'pointer',
                  }}
                    onClick={() => {
                      formRef.current.productId = p.Product;
                      if (!dialogOpen) setDialogOpen(true);
                    }}
                    title="Click to pre-fill in new entry"
                  >
                    <strong>{p.Product}</strong>
                    <span style={{ color: 'var(--sapContent_LabelColor)', marginLeft: 6 }}>
                      {p.ProductType} · {p.BaseUnit}
                    </span>
                  </div>
                ))
            }
          </div>
        </Card>
      </FlexBox>

      {/* ── New Price Entry Dialog ───────────────────────────────────────── */}
      <Dialog
        open={dialogOpen}
        headerText="Record Price Negotiation"
        footer={
          <Bar endContent={
            <FlexBox style={{ gap: '0.5rem' }}>
              <Button onClick={() => { setDialogOpen(false); formRef.current = {}; }}>Cancel</Button>
              <Button
                design="Emphasized"
                disabled={createMutation.isPending}
                onClick={handleSave}
              >
                {createMutation.isPending ? 'Saving…' : 'Save to Ledger'}
              </Button>
            </FlexBox>
          } />
        }
        onClose={() => { setDialogOpen(false); formRef.current = {}; }}
      >
        <Form style={{ padding: '1rem', minWidth: 400 }}>

          <FormItem label={<Label required>Product (S/4HANA ID)</Label>}>
            <Select
              onChange={(e) => { formRef.current.productId = e.detail.selectedOption.value; }}
              style={{ width: '100%' }}
            >
              <Option value="">— Select Product —</Option>
              {products.map(p => (
                <Option key={p.Product} value={p.Product}>
                  {p.Product} · {p.ProductType}
                </Option>
              ))}
            </Select>
          </FormItem>

          <FormItem label={<Label required>Vendor ID</Label>}>
            <Input
              placeholder="e.g. 1000000"
              value={isVendor ? (me?.id || '') : ''}
              readonly={isVendor}
              onInput={(e) => { formRef.current.vendorId = e.target.value; }}
              style={{ width: '100%' }}
            />
          </FormItem>

          <FormItem label={<Label required>Negotiated Price</Label>}>
            <Input
              type="Number"
              placeholder="0.00"
              onInput={(e) => { formRef.current.price = e.target.value; }}
              style={{ width: '100%' }}
            />
          </FormItem>

          <FormItem label={<Label>Base Price (S/4HANA reference)</Label>}>
            <Input
              type="Number"
              placeholder="0.00 — fill for savings calculation"
              onInput={(e) => { formRef.current.basePrice = e.target.value; }}
              style={{ width: '100%' }}
            />
          </FormItem>

          <FormItem label={<Label>Note</Label>}>
            <Input
              placeholder="Negotiation context (optional)"
              onInput={(e) => { formRef.current.note = e.target.value; }}
              style={{ width: '100%' }}
            />
          </FormItem>
        </Form>
      </Dialog>
    </>
  );
}
