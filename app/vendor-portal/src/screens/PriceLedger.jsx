import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Title, Card, CardHeader, Button, BusyIndicator,
  FlexBox, FlexBoxDirection, FlexBoxWrap,
  Dialog, Form, FormItem, Input, Select, Option, Bar, Label,
  MessageStrip, AnalyticalTable,
} from '@ui5/webcomponents-react';
import { fetchPriceLedger, createPriceEntry, fetchProducts, fetchMe } from '../api/client';

// ── Vertical Price Timeline ───────────────────────────────────────────────
function PriceTimeline({ entries }) {
  if (!entries.length) return (
    <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--sapContent_LabelColor)' }}>
      No price history for this product.
    </div>
  );

  const sorted = [...entries].sort((a, b) => new Date(b.validFrom) - new Date(a.validFrom));

  return (
    <div style={{ padding: '1.25rem 1.5rem' }}>
      {sorted.map((e, i) => {
        const savings = Number(e.basePrice) > 0 ? ((1 - e.negotiatedPrice / e.basePrice) * 100).toFixed(1) : null;
        const isSaving = savings !== null && Number(savings) > 0;
        const dotColor = isSaving ? '#256f3a' : savings !== null ? '#aa0808' : '#6e6e6e';
        const prev = sorted[i + 1];
        const priceChange = prev ? e.negotiatedPrice - prev.negotiatedPrice : null;

        return (
          <div key={e.ID} style={{ display: 'flex', gap: '1rem' }}>
            {/* Spine */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 28, flexShrink: 0 }}>
              <div style={{
                width: 14, height: 14, borderRadius: '50%', marginTop: 3, flexShrink: 0,
                background: dotColor,
                boxShadow: `0 0 0 3px ${isSaving ? '#edf8e9' : savings !== null ? '#fbeaea' : '#f2f2f2'}`,
              }} />
              {i < sorted.length - 1 && (
                <div style={{ width: 2, flex: 1, minHeight: 40, background: 'var(--sapList_BorderColor)', marginTop: 3 }} />
              )}
            </div>

            {/* Card content */}
            <div style={{
              flex: 1, marginBottom: '1rem',
              padding: '0.75rem 1rem',
              border: i === 0 ? 'none' : '1px solid var(--sapList_BorderColor)',
              borderRadius: 8,
              background: i === 0 ? '#0a6ed1' : 'var(--sapBaseColor)',
              borderLeft: i === 0 ? 'none' : `3px solid ${dotColor}`,
            }}>
              {/* Date + vendor row */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                <span style={{ fontSize: '0.75rem', color: i === 0 ? 'rgba(255,255,255,0.8)' : 'var(--sapContent_LabelColor)', fontWeight: 600 }}>
                  {e.validFrom
                    ? new Date(e.validFrom).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
                    : '—'}
                  {i === 0 && (
                    <span style={{
                      marginLeft: 8, padding: '0.05rem 0.4rem', borderRadius: 999,
                      background: 'rgba(255,255,255,0.25)', color: '#fff', fontSize: '0.65rem',
                    }}>CURRENT</span>
                  )}
                </span>
                {e.vendorCode && (
                  <span style={{ fontSize: '0.75rem', color: i === 0 ? 'rgba(255,255,255,0.8)' : 'var(--sapContent_LabelColor)' }}>
                    Vendor {e.vendorCode}
                  </span>
                )}
              </div>

              {/* Price row */}
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '1.2rem', fontWeight: 700, color: i === 0 ? '#fff' : 'var(--sapTextColor)' }}>
                  ${Number(e.negotiatedPrice).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </span>
                {e.basePrice > 0 && (
                  <span style={{ fontSize: '0.8rem', color: i === 0 ? 'rgba(255,255,255,0.6)' : 'var(--sapContent_LabelColor)', textDecoration: 'line-through' }}>
                    ${Number(e.basePrice).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                )}
                {savings !== null && (
                  <span style={{
                    padding: '0.1rem 0.45rem', borderRadius: 999,
                    fontSize: '0.72rem', fontWeight: 700,
                    background: i === 0 ? 'rgba(255,255,255,0.2)' : (isSaving ? '#edf8e9' : '#fbeaea'),
                    color: i === 0 ? '#fff' : (isSaving ? '#256f3a' : '#aa0808'),
                  }}>
                    {isSaving ? '▼' : '▲'} {Math.abs(savings)}% vs baseline
                  </span>
                )}
                {priceChange !== null && (
                  <span style={{
                    fontSize: '0.72rem',
                    color: i === 0 ? 'rgba(255,255,255,0.8)' : (priceChange < 0 ? '#256f3a' : priceChange > 0 ? '#aa0808' : '#6e6e6e'),
                  }}>
                    {priceChange < 0 ? '↓' : priceChange > 0 ? '↑' : '='} {Math.abs(priceChange).toFixed(2)} vs prev
                  </span>
                )}
              </div>

              {/* Valid period */}
              {e.validTo && new Date(e.validTo).getFullYear() < 9999 && (
                <div style={{ fontSize: '0.72rem', color: 'var(--sapContent_LabelColor)', marginTop: '0.3rem' }}>
                  Valid until {new Date(e.validTo).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Savings badge ──────────────────────────────────────────────────────────
function SavingsBadge({ negotiated, base }) {
  if (!(Number(base) > 0)) return <span style={{ color: 'var(--sapContent_LabelColor)' }}>—</span>;
  const pct = ((1 - Number(negotiated) / Number(base)) * 100).toFixed(1);
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
  const [selectedSku, setSelectedSku] = useState('');
  const [formState, setFormState] = useState({ productId: '', vendorId: '', price: '', basePrice: '', note: '' });
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
  const entriesWithBase = ledger.filter(e => Number(e.basePrice) > 0);
  const avgDiscount   = entriesWithBase.length > 0
    ? entriesWithBase.reduce((sum, e) => sum + (1 - e.negotiatedPrice / e.basePrice) * 100, 0) / entriesWithBase.length
    : 0;

  // ── SKU list for filter ──────────────────────────────────────────────────
  const skuList = [...new Set(ledger.map(e => e.materialId || e.product_ID).filter(Boolean))];
  const skuDescMap = {};
  ledger.forEach(e => {
    const key = e.materialId || e.product_ID;
    if (key && e.materialDesc) skuDescMap[key] = e.materialDesc;
  });
  const timelineEntries = selectedSku
    ? ledger.filter(e => (e.materialId || e.product_ID) === selectedSku)
    : ledger;

  const createMutation = useMutation({
    mutationFn: createPriceEntry,
    onSuccess: () => {
      queryClient.invalidateQueries(['priceLedger']);
      setDialogOpen(false);
      formRef.current = {};
      setFormState({ productId: '', vendorId: isVendor ? (me?.id || '') : '', price: '', basePrice: '', note: '' });
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
      setSuccessMsg('❌ Please fill in Product, Vendor Code, and Negotiated Price (per unit).');
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
      id: 'product',
      Cell: ({ row }) => {
        const r = row.original;
        const label = r.materialDesc || r.materialId || r.product_ID;
        const sub   = r.materialDesc && r.materialId ? r.materialId : null;
        return (
          <span>
            <strong>{label || '—'}</strong>
            {sub && <span style={{ color: 'var(--sapContent_LabelColor)', marginLeft: 4, fontSize: '0.75rem' }}>{sub}</span>}
          </span>
        );
      },
      width: 200,
    },
    {
      Header: 'Vendor',
      id: 'vendor',
      Cell: ({ row }) => row.original.vendorCode || row.original.vendor_ID || '—',
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
            <Button design="Emphasized" icon="add" onClick={() => {
              const vendorId = isVendor ? (me?.id || '') : '';
              formRef.current = { vendorId };
              setFormState({ productId: '', vendorId, price: '', basePrice: '', note: '' });
              setDialogOpen(true);
            }}>
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
            value={`${isFinite(avgDiscount) ? avgDiscount.toFixed(1) : '0.0'}%`}
            color={avgDiscount > 0 ? 'var(--sapPositiveColor)' : 'var(--sapCriticalColor)'}
          />
          <MiniKpi
            label="Total Savings"
            value={totalSavings.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            color={totalSavings > 0 ? 'var(--sapPositiveColor)' : undefined}
          />
        </FlexBox>

        {/* ── Price History Timeline — primary view ── */}
        <Card header={
          <CardHeader
            titleText="Price Negotiation Timeline"
            subtitleText="Price history per SKU — newest first"
            action={
              skuList.length > 0 && (
                <Select
                  style={{ minWidth: 200 }}
                  onChange={(e) => setSelectedSku(e.detail.selectedOption.value)}
                >
                  <Option value="">All SKUs ({ledger.length} entries)</Option>
                  {skuList.map(sku => (
                    <Option key={sku} value={sku}>
                      {skuDescMap[sku] || sku} ({ledger.filter(e => (e.materialId || e.product_ID) === sku).length} entries)
                    </Option>
                  ))}
                </Select>
              )
            }
          />
        }>
          {ledger.length === 0 ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--sapContent_LabelColor)' }}>
              No price entries yet. Click "New Price Entry" to record a negotiation.
            </div>
          ) : (
            <PriceTimeline entries={timelineEntries} />
          )}
        </Card>

        {/* ── Full data table — secondary view ── */}
        <Card header={
          <CardHeader
            titleText="Full Ledger"
            subtitleText={`${ledger.length} entries · compared vs S/4HANA baseline`}
          />
        }>
          {ledger.length === 0 ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--sapContent_LabelColor)' }}>
              No price entries yet.
            </div>
          ) : (
            <AnalyticalTable
              data={ledger}
              columns={columns}
              visibleRows={8}
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
            subtitleText="Live reference — click to pre-fill when recording a negotiation"
          />
        }>
          <div style={{ padding: '1rem', display: 'flex', flexWrap: 'wrap', gap: '0.6rem' }}>
            {products.filter(p => p.ProductType !== 'SERV').length === 0
              ? <span style={{ color: 'var(--sapContent_LabelColor)' }}>No materials loaded.</span>
              : products.filter(p => p.ProductType !== 'SERV').map(p => {
                  const recent = [...ledger]
                    .filter(l => l.materialId === p.Product || l.product_ID === p.Product)
                    .sort((a, b) => new Date(b.validFrom) - new Date(a.validFrom))[0];
                  const baseline = recent && Number(recent.basePrice) > 0
                    ? `$${Number(recent.basePrice).toFixed(2)} baseline`
                    : 'No baseline yet';
                  return (
                    <div key={p.Product} style={{
                      padding: '0.55rem 1rem',
                      border: '1px solid var(--sapList_BorderColor)',
                      borderRadius: 10,
                      fontSize: '0.82rem',
                      cursor: 'pointer',
                      minWidth: 160,
                      background: 'var(--sapBaseColor)',
                    }}
                      onClick={() => {
                        const productId = p.Product;
                        const vendorId = isVendor ? (me?.id || '') : '';
                        const bp = recent && Number(recent.basePrice) > 0 ? String(recent.basePrice) : '';
                        formRef.current = { productId, vendorId, basePrice: bp };
                        setFormState(f => ({ ...f, productId, vendorId, basePrice: bp }));
                        if (!dialogOpen) setDialogOpen(true);
                      }}
                      title="Click to pre-fill in new entry"
                    >
                      <div style={{ fontWeight: 600, marginBottom: 2 }}>
                        {p.ProductDescription || p.Product}
                      </div>
                      <div style={{ color: 'var(--sapContent_LabelColor)', fontSize: '0.75rem' }}>
                        {p.Product} · {p.BaseUnit} · {baseline}
                      </div>
                    </div>
                  );
                })
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
        onClose={() => { setDialogOpen(false); formRef.current = {}; setFormState({ productId: '', vendorId: isVendor ? (me?.id || '') : '', price: '', basePrice: '', note: '' }); }}
      >
        <div style={{ padding: '1.25rem', minWidth: 440, display: 'flex', flexDirection: 'column', gap: '1rem' }}>

          {/* Product */}
          <div>
            <label style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem', marginBottom: '0.35rem' }}>
              Product <span style={{ color: 'var(--sapErrorColor)' }}>*</span>
            </label>
            <Select
              style={{ width: '100%' }}
              onChange={(e) => {
                const productId = e.detail.selectedOption.value;
                formRef.current.productId = productId;
                // Auto-fill base price from most recent ledger entry for this product
                const recent = [...ledger]
                  .filter(l => l.materialId === productId || l.product_ID === productId)
                  .sort((a, b) => new Date(b.validFrom) - new Date(a.validFrom))[0];
                if (recent && Number(recent.basePrice) > 0) {
                  setFormState(f => ({ ...f, productId, basePrice: String(recent.basePrice) }));
                  formRef.current.basePrice = String(recent.basePrice);
                } else {
                  setFormState(f => ({ ...f, productId }));
                }
              }}
            >
              <Option value="" selected={!formState.productId}>— Select Product —</Option>
              {skuList.map(sku => (
                <Option key={sku} value={sku} selected={formState.productId === sku}>
                  {skuDescMap[sku] ? `${skuDescMap[sku]} (${sku})` : sku}
                </Option>
              ))}
            </Select>
          </div>

          {/* Last known price reference */}
          {formState.productId && (() => {
            const recent = [...ledger]
              .filter(l => l.materialId === formState.productId || l.product_ID === formState.productId)
              .sort((a, b) => new Date(b.validFrom) - new Date(a.validFrom))[0];
            if (!recent) return null;
            return (
              <div style={{
                padding: '0.6rem 0.75rem', borderRadius: 6,
                background: 'var(--sapNeutralBackground)',
                fontSize: '0.82rem', color: 'var(--sapContent_LabelColor)',
                border: '1px solid var(--sapList_BorderColor)',
              }}>
                Last recorded: <strong>${Number(recent.negotiatedPrice).toFixed(2)}</strong>
                {Number(recent.basePrice) > 0 && <> · Base: <strong>${Number(recent.basePrice).toFixed(2)}</strong></>}
                <span style={{ marginLeft: 8, color: 'var(--sapContent_LabelColor)' }}>
                  ({new Date(recent.validFrom).toLocaleDateString()})
                </span>
              </div>
            );
          })()}

          {/* Vendor Code */}
          <div>
            <label style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem', marginBottom: '0.35rem' }}>
              Vendor Code <span style={{ color: 'var(--sapErrorColor)' }}>*</span>
            </label>
            <Input
              placeholder="e.g. 1000000"
              value={isVendor ? (me?.id || '') : formState.vendorId}
              readonly={isVendor}
              onInput={(e) => { formRef.current.vendorId = e.target.value; setFormState(f => ({ ...f, vendorId: e.target.value })); }}
              style={{ width: '100%' }}
            />
          </div>

          {/* Negotiated Price */}
          <div>
            <label style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem', marginBottom: '0.35rem' }}>
              Negotiated Price (per unit) <span style={{ color: 'var(--sapErrorColor)' }}>*</span>
            </label>
            <Input
              type="Number"
              placeholder="e.g. 4.50"
              value={formState.price}
              onInput={(e) => { formRef.current.price = e.target.value; setFormState(f => ({ ...f, price: e.target.value })); }}
              style={{ width: '100%' }}
            />
          </div>

          {/* Base / List Price */}
          <div>
            <label style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem', marginBottom: '0.35rem' }}>
              Base / List Price <span style={{ fontSize: '0.78rem', fontWeight: 400, color: 'var(--sapContent_LabelColor)' }}>(optional — for savings calculation)</span>
            </label>
            <Input
              type="Number"
              placeholder="e.g. 5.00"
              value={formState.basePrice}
              onInput={(e) => { formRef.current.basePrice = e.target.value; setFormState(f => ({ ...f, basePrice: e.target.value })); }}
              style={{ width: '100%' }}
            />
          </div>

          {/* Note */}
          <div>
            <label style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem', marginBottom: '0.35rem' }}>
              Negotiation Note <span style={{ fontSize: '0.78rem', fontWeight: 400, color: 'var(--sapContent_LabelColor)' }}>(optional)</span>
            </label>
            <Input
              placeholder="e.g. Bulk discount for Q2 order"
              value={formState.note}
              onInput={(e) => { formRef.current.note = e.target.value; setFormState(f => ({ ...f, note: e.target.value })); }}
              style={{ width: '100%' }}
            />
          </div>
        </div>
      </Dialog>
    </>
  );
}
