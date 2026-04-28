import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Title, Card, CardHeader, Button, BusyIndicator, FlexBox, FlexBoxDirection, Dialog, Form, FormItem, Input, Select, Option, Bar, Label, MessageStrip, Timeline, TimelineItem } from '@ui5/webcomponents-react';
import { fetchPriceLedger, createPriceEntry, fetchProducts } from '../api/client';

export default function PriceLedger() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [successMsg, setSuccessMsg] = useState(null);
  const formRef = useRef({});

  const { data: ledger = [],   isLoading } = useQuery({ queryKey: ['priceLedger'], queryFn: fetchPriceLedger });
  const { data: products = [] }            = useQuery({ queryKey: ['products'],    queryFn: fetchProducts });

  const createMutation = useMutation({
    mutationFn: createPriceEntry,
    onSuccess: () => {
      queryClient.invalidateQueries(['priceLedger']);
      setDialogOpen(false);
      setSuccessMsg('✅ Price entry recorded in temporal ledger!');
      setTimeout(() => setSuccessMsg(null), 4000);
    },
  });

  if (isLoading) return <BusyIndicator active size="Large" style={{ marginTop:'4rem', width:'100%' }} />;

  return (
    <>
      <FlexBox direction={FlexBoxDirection.Column} style={{ gap:'1.5rem' }}>
        <FlexBox style={{ justifyContent:'space-between', alignItems:'center' }}>
          <Title level="H2">Price Negotiation Ledger</Title>
          <Button design="Emphasized" icon="add" onClick={() => setDialogOpen(true)}>New Price Entry</Button>
        </FlexBox>

        {successMsg && <MessageStrip design="Positive" onClose={() => setSuccessMsg(null)}>{successMsg}</MessageStrip>}

        <MessageStrip design="Information" hideCloseButton>
          Temporal data: every price negotiation is immutably recorded with validFrom/validTo timestamps.
        </MessageStrip>

        <Card header={<CardHeader titleText="Price History Timeline" subtitleText={`${ledger.length} negotiation(s) recorded`} />}>
          {ledger.length === 0
            ? <div style={{ padding:'2rem', textAlign:'center', color:'var(--sapContent_LabelColor)' }}>No price entries yet.</div>
            : <div style={{ padding:'1rem' }}>
                <Timeline>
                  {ledger.map(entry => (
                    <TimelineItem key={entry.ID}
                      titleText={`Price: ${entry.negotiatedPrice}`}
                      subtitleText={`Valid from: ${entry.validFrom ? new Date(entry.validFrom).toLocaleDateString() : '—'}`}
                      icon="money-bills"
                      name={entry.product_ID || 'Unknown Product'}>
                      <div style={{ padding:'0.5rem 0' }}>
                        <div>Product: <strong>{entry.product_ID || '—'}</strong></div>
                        <div>Vendor: <strong>{entry.vendorCode || '—'}</strong></div>
                        <div>Negotiated: <strong style={{ color:'var(--sapPositiveColor)' }}>{entry.negotiatedPrice}</strong></div>
                        {entry.basePrice && (
                          <div>Base: <strong>{entry.basePrice}</strong>
                            {entry.negotiatedPrice < entry.basePrice
                              ? <span style={{ color:'var(--sapPositiveColor)', marginLeft:8 }}>▼ {((1 - entry.negotiatedPrice/entry.basePrice)*100).toFixed(1)}% savings</span>
                              : <span style={{ color:'var(--sapCriticalColor)', marginLeft:8 }}>▲ {((entry.negotiatedPrice/entry.basePrice - 1)*100).toFixed(1)}% above base</span>
                            }
                          </div>
                        )}
                      </div>
                    </TimelineItem>
                  ))}
                </Timeline>
              </div>
          }
        </Card>

        <Card header={<CardHeader titleText="Products from S/4HANA" subtitleText="Live product master" />}>
          <div style={{ padding:'1rem', display:'flex', flexWrap:'wrap', gap:'0.5rem' }}>
            {products.slice(0,10).map(p => (
              <div key={p.Product} style={{ padding:'0.5rem 1rem', border:'1px solid var(--sapList_BorderColor)', borderRadius:8, fontSize:'0.875rem' }}>
                <strong>{p.Product}</strong>
                <span style={{ color:'var(--sapContent_LabelColor)', marginLeft:8 }}>{p.ProductType} · {p.BaseUnit}</span>
              </div>
            ))}
          </div>
        </Card>
      </FlexBox>

      <Dialog open={dialogOpen} headerText="Record Price Negotiation"
        footer={<Bar endContent={
          <FlexBox style={{ gap:'0.5rem' }}>
            <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button design="Emphasized" disabled={createMutation.isPending}
              onClick={() => createMutation.mutate({
                product_ID: formRef.current.productId,
                vendorCode: formRef.current.vendorId,
                negotiatedPrice: parseFloat(formRef.current.price) || 0,
                basePrice: parseFloat(formRef.current.basePrice) || 0,
                validFrom: new Date().toISOString(),
                validTo: '9999-12-31T00:00:00Z',
              })}>
              {createMutation.isPending ? 'Saving...' : 'Save to Ledger'}
            </Button>
          </FlexBox>
        } />}
        onClose={() => setDialogOpen(false)}>
        <Form style={{ padding:'1rem', minWidth:400 }}>
          <FormItem label={<Label>Product</Label>}>
            <Select onChange={(e) => formRef.current.productId = e.detail.selectedOption.value}>
              <Option value="">— Select Product —</Option>
              {products.map(p => <Option key={p.Product} value={p.Product}>{p.Product} · {p.ProductType}</Option>)}
            </Select>
          </FormItem>
          <FormItem label={<Label>Vendor ID</Label>}>
            <Input placeholder="e.g. 1000000" onInput={(e) => formRef.current.vendorId = e.target.value} />
          </FormItem>
          <FormItem label={<Label>Negotiated Price</Label>}>
            <Input type="Number" placeholder="0.00" onInput={(e) => formRef.current.price = e.target.value} />
          </FormItem>
          <FormItem label={<Label>Base Price</Label>}>
            <Input type="Number" placeholder="0.00" onInput={(e) => formRef.current.basePrice = e.target.value} />
          </FormItem>
        </Form>
      </Dialog>
    </>
  );
}
