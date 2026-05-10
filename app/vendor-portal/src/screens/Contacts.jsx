import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Title, Card, CardHeader, Button, BusyIndicator,
  FlexBox, FlexBoxDirection,
  Dialog, Form, FormItem, Input, CheckBox, Bar, Label,
  MessageStrip, AnalyticalTable, Select, Option,
} from '@ui5/webcomponents-react';
import { fetchContacts, createContact, updateContact, deleteContact, fetchMe, fetchVendors } from '../api/client';

const EMPTY_FORM = {
  firstName: '', lastName: '', email: '', phone: '',
  mobile: '', department: '', jobFunction: '', vendorCode: '', isPrimary: false,
};

export default function Contacts() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen]       = useState(false);
  const [editTarget, setEditTarget]       = useState(null);
  const [successMsg, setSuccessMsg]       = useState(null);
  const [form, setForm]                   = useState({ ...EMPTY_FORM });

  const { data: me } = useQuery({ queryKey: ['me'], queryFn: fetchMe });
  const { data: contacts = [], isLoading } = useQuery({ queryKey: ['contacts'], queryFn: fetchContacts });
  const { data: vendors = [] } = useQuery({ queryKey: ['vendors'], queryFn: fetchVendors });

  const isVendorAdmin  = me?.roles?.includes('VendorAdmin');
  const isManager      = me?.roles?.includes('ProcurementManager');
  const canWrite       = isVendorAdmin || isManager;

  const notify = (msg) => { setSuccessMsg(msg); setTimeout(() => setSuccessMsg(null), 4000); };

  const setField = (key) => (e) => setForm(prev => ({ ...prev, [key]: e.target.value }));
  const setCheck = (key) => (e) => setForm(prev => ({ ...prev, [key]: e.target.checked }));

  const createMut = useMutation({
    mutationFn: createContact,
    onSuccess: () => { queryClient.invalidateQueries(['contacts']); closeDialog(); notify('✅ Contact created.'); },
    onError:   (e) => notify(`❌ ${e?.response?.data?.error?.message || e.message}`),
  });

  const updateMut = useMutation({
    mutationFn: updateContact,
    onSuccess: () => { queryClient.invalidateQueries(['contacts']); closeDialog(); notify('✅ Contact updated.'); },
    onError:   (e) => notify(`❌ ${e?.response?.data?.error?.message || e.message}`),
  });

  const deleteMut = useMutation({
    mutationFn: deleteContact,
    onSuccess: () => { queryClient.invalidateQueries(['contacts']); notify('✅ Contact deleted.'); },
    onError:   (e) => notify(`❌ ${e?.response?.data?.error?.message || e.message}`),
  });


  const openCreate = () => {
    setForm({ ...EMPTY_FORM, vendorCode: isVendorAdmin ? (me?.vendorId || '') : '' });
    setEditTarget(null);
    setDialogOpen(true);
  };

  const openEdit = (contact) => {
    setForm({ ...contact });
    setEditTarget(contact);
    setDialogOpen(true);
  };

  const closeDialog = () => { setDialogOpen(false); setEditTarget(null); };

  const handleSave = () => {
    if (!form.firstName || !form.lastName || !form.email) {
      notify('❌ First name, last name and email are required.');
      return;
    }
    if (editTarget) {
      updateMut.mutate({ id: editTarget.ID, ...form });
    } else {
      createMut.mutate(form);
    }
  };

  const columns = [
    {
      Header: 'Name',
      id: 'name',
      Cell: ({ row }) => (
        <FlexBox style={{ alignItems: 'center', gap: '0.5rem' }}>
          <strong>{row.original.firstName} {row.original.lastName}</strong>
          {row.original.isPrimary && (
            <span style={{
              fontSize: '0.65rem', fontWeight: 700,
              background: 'var(--sapPositiveColor)', color: '#fff',
              padding: '0.1rem 0.4rem', borderRadius: 999,
            }}>Primary</span>
          )}
        </FlexBox>
      ),
      width: 200,
    },
    {
      Header: 'Department',
      accessor: 'department',
      Cell: ({ value }) => value || <span style={{ color: 'var(--sapContent_LabelColor)' }}>—</span>,
      width: 150,
    },
    {
      Header: 'Function',
      accessor: 'jobFunction',
      Cell: ({ value }) => value || <span style={{ color: 'var(--sapContent_LabelColor)' }}>—</span>,
      width: 150,
    },
    {
      Header: 'Email',
      accessor: 'email',
      Cell: ({ value }) => (
        <a href={`mailto:${value}`} style={{ color: 'var(--sapLinkColor)' }}>{value}</a>
      ),
      width: 220,
    },
    {
      Header: 'Phone',
      accessor: 'phone',
      Cell: ({ value }) => value || <span style={{ color: 'var(--sapContent_LabelColor)' }}>—</span>,
      width: 130,
    },
    {
      Header: 'Mobile',
      accessor: 'mobile',
      Cell: ({ value }) => value || <span style={{ color: 'var(--sapContent_LabelColor)' }}>—</span>,
      width: 130,
    },
    {
      Header: 'Vendor',
      accessor: 'vendorCode',
      Cell: ({ value }) => value || '—',
      width: 100,
    },
    ...(canWrite ? [{
      Header: 'Actions',
      id: 'actions',
      Cell: ({ row }) => (
        <FlexBox style={{ gap: '0.4rem' }}>
          <Button design="Transparent" icon="edit" onClick={() => openEdit(row.original)} />
          <Button
            design="Transparent"
            icon="delete"
            style={{ color: 'var(--sapCriticalColor)' }}
            onClick={() => { if (window.confirm('Delete this contact?')) deleteMut.mutate(row.original.ID); }}
          />
        </FlexBox>
      ),
      width: 100,
    }] : []),
  ];

  if (isLoading) return <BusyIndicator active size="Large" style={{ marginTop: '4rem', width: '100%' }} />;

  return (
    <>
      <FlexBox direction={FlexBoxDirection.Column} style={{ gap: '1.5rem' }}>

        <FlexBox style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <Title level="H2">Vendor Contacts</Title>
          <FlexBox style={{ gap: '0.5rem' }}>
            {canWrite && (
              <Button design="Emphasized" icon="add" onClick={openCreate}>
                New Contact
              </Button>
            )}
          </FlexBox>
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
          {isVendorAdmin
            ? 'Manage contacts for your company. Mark one contact as Primary for escalation notifications.'
            : 'Directory of all vendor contacts. Primary contacts are notified on critical delay alerts.'}
        </MessageStrip>

        <Card header={
          <CardHeader
            titleText="Contact Directory"
            subtitleText={`${contacts.length} contact${contacts.length !== 1 ? 's' : ''}`}
          />
        }>
          {contacts.length === 0 ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--sapContent_LabelColor)' }}>
              {canWrite ? 'No contacts yet. Click "New Contact" to add one.' : 'No contacts found.'}
            </div>
          ) : (
            <AnalyticalTable
              data={contacts}
              columns={columns}
              visibleRows={12}
              sortable
              filterable
              scaleWidthMode="Grow"
            />
          )}
        </Card>
      </FlexBox>

      {/* ── Create / Edit Dialog ─────────────────────────────────────────── */}
      <Dialog
        open={dialogOpen}
        headerText={editTarget ? 'Edit Contact' : 'New Contact'}
        footer={
          <Bar endContent={
            <FlexBox style={{ gap: '0.5rem' }}>
              <Button onClick={closeDialog}>Cancel</Button>
              <Button
                design="Emphasized"
                disabled={createMut.isPending || updateMut.isPending}
                onClick={handleSave}
              >
                {createMut.isPending || updateMut.isPending ? 'Saving…' : 'Save'}
              </Button>
            </FlexBox>
          } />
        }
        onClose={closeDialog}
      >
        <Form style={{ padding: '1rem', minWidth: 420, display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>

          <FlexBox style={{ gap: '1rem' }}>
            <FormItem label={<Label required>First Name</Label>} style={{ flex: 1 }}>
              <Input
                value={form.firstName}
                placeholder="First name"
                onInput={setField('firstName')}
                style={{ width: '100%' }}
              />
            </FormItem>
            <FormItem label={<Label required>Last Name</Label>} style={{ flex: 1 }}>
              <Input
                value={form.lastName}
                placeholder="Last name"
                onInput={setField('lastName')}
                style={{ width: '100%' }}
              />
            </FormItem>
          </FlexBox>

          <FormItem label={<Label required>Email</Label>}>
            <Input
              type="Email"
              value={form.email}
              placeholder="contact@company.com"
              onInput={setField('email')}
              style={{ width: '100%' }}
            />
          </FormItem>

          <FlexBox style={{ gap: '1rem' }}>
            <FormItem label={<Label>Phone</Label>} style={{ flex: 1 }}>
              <Input
                value={form.phone}
                placeholder="+84 xxx xxx xxx"
                onInput={setField('phone')}
                style={{ width: '100%' }}
              />
            </FormItem>
            <FormItem label={<Label>Mobile</Label>} style={{ flex: 1 }}>
              <Input
                value={form.mobile}
                placeholder="+84 xxx xxx xxx"
                onInput={setField('mobile')}
                style={{ width: '100%' }}
              />
            </FormItem>
          </FlexBox>

          <FlexBox style={{ gap: '1rem' }}>
            <FormItem label={<Label>Department</Label>} style={{ flex: 1 }}>
              <Input
                value={form.department}
                placeholder="e.g. Logistics"
                onInput={setField('department')}
                style={{ width: '100%' }}
              />
            </FormItem>
            <FormItem label={<Label>Function / Title</Label>} style={{ flex: 1 }}>
              <Input
                value={form.jobFunction}
                placeholder="e.g. Shipment Manager"
                onInput={setField('jobFunction')}
                style={{ width: '100%' }}
              />
            </FormItem>
          </FlexBox>

          <FormItem label={<Label>Vendor</Label>}>
            {isVendorAdmin ? (
              <Input
                value={me?.id || ''}
                readonly
                style={{ width: '100%' }}
              />
            ) : (
              <Select
                onChange={(e) => setForm(prev => ({ ...prev, vendorCode: e.detail.selectedOption.value }))}
                style={{ width: '100%' }}
              >
                <Option value="">— Select Vendor —</Option>
                {vendors.map(v => (
                  <Option
                    key={v.BusinessPartner}
                    value={v.BusinessPartner}
                    selected={form.vendorCode === v.BusinessPartner}
                  >
                    {v.BusinessPartner} · {v.BusinessPartnerFullName || v.OrganizationBPName1 || v.BusinessPartnerName || v.BusinessPartner}
                    {v.CityName ? ` (${v.CityName}${v.Country ? ', ' + v.Country : ''})` : ''}
                  </Option>
                ))}
              </Select>
            )}
          </FormItem>

          <FormItem label={<Label>Primary Contact</Label>}>
            <CheckBox
              checked={form.isPrimary}
              text="Mark as primary contact for notifications"
              onChange={setCheck('isPrimary')}
            />
          </FormItem>

        </Form>
      </Dialog>
    </>
  );
}
