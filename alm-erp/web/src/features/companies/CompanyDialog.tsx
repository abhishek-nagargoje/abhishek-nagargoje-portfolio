import { useEffect, useState } from 'react';
import { Button } from '../../components/common/Button';
import { Dialog } from '../../components/common/Dialog';
import { SelectField, TextField } from '../../components/common/Field';
import { MessageStrip } from '../../components/common/MessageStrip';
import { invalidateCache } from '../../components/common/Pickers';
import { useAction } from '../../hooks/useApi';
import { patch, post } from '../../services/api';
import type { Company } from '../../types';

const blank = { type: 'Customer', name: '', industry: '', addressLine: '', city: '', state: '', postalCode: '', gstin: '', contactName: '', email: '', phone: '',
  paymentTerms: 'Net 30', creditLimit: '0', vendorRating: '0', status: 'Active' };

export function CompanyDialog({ open, onClose, onSaved, existing }: { open: boolean; onClose: () => void; onSaved: (id: number) => void; existing?: Company }) {
  const act = useAction();
  const [f, setF] = useState(blank);
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (!open) return;
    setTouched(false);
    act.setError(null);
    setF(existing ? {
      type: existing.type, name: existing.name, industry: existing.industry, addressLine: existing.addressLine, city: existing.city, state: existing.state,
      postalCode: existing.postalCode, gstin: existing.gstin ?? '', contactName: existing.contactName ?? '', email: existing.email ?? '', phone: existing.phone ?? '',
      paymentTerms: existing.paymentTerms, creditLimit: existing.creditLimit ?? '0', vendorRating: String(existing.vendorRating), status: existing.status,
    } : blank);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, existing]);

  const errs = {
    name: !f.name.trim() ? 'Name is required.' : null,
    gstin: f.gstin && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(f.gstin.toUpperCase()) ? 'GSTIN must have the 15-character Indian format.' : null,
    email: f.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email) ? 'Enter a valid email address.' : null,
    postalCode: f.postalCode && !/^\d{6}$/.test(f.postalCode) ? 'PIN code must be 6 digits.' : null,
    creditLimit: !/^\d{1,13}(\.\d{1,2})?$/.test(f.creditLimit) ? 'Enter a valid amount.' : null,
  };
  const save = async () => {
    setTouched(true);
    if (Object.values(errs).some(Boolean)) return;
    const { type, vendorRating, gstin, ...rest } = f;
    const body = { ...rest, gstin: gstin ? gstin.toUpperCase() : null, vendorRating: Number(vendorRating), ...(existing ? {} : { type }) };
    // Sensitive fields come back null for restricted users; never send them back.
    if (existing?.restricted) for (const k of ['contactName', 'email', 'phone', 'creditLimit', 'gstin']) delete (body as Record<string, unknown>)[k];
    const c = await act.run(() => existing ? patch<Company>(`/companies/${existing.id}`, body) : post<Company>('/companies', body));
    if (c) { invalidateCache('/companies'); onSaved(c.id); }
  };
  const e = (k: keyof typeof errs) => (touched ? errs[k] : null);
  const restricted = existing?.restricted;

  return (
    <Dialog open={open} onClose={onClose} size="lg" title={existing ? `Edit ${existing.code}` : 'Create Customer or Vendor'} busy={act.pending}
      footer={<><Button variant="emph" busy={act.pending} onClick={() => void save()}>{existing ? 'Save' : 'Create'}</Button><Button variant="transparent" onClick={onClose}>Cancel</Button></>}>
      {act.error && <MessageStrip type="error">{act.error}</MessageStrip>}
      <form className="form-grid" onSubmit={(ev) => { ev.preventDefault(); void save(); }}>
        {!existing && <SelectField label="Type" required value={f.type} options={['Customer', 'Vendor']} onChange={(ev) => setF({ ...f, type: ev.target.value })} />}
        <TextField label="Company name" required className={existing ? 'full' : undefined} value={f.name} error={e('name')} data-autofocus onChange={(ev) => setF({ ...f, name: ev.target.value })} />
        <TextField label="Industry" value={f.industry} onChange={(ev) => setF({ ...f, industry: ev.target.value })} />
        <SelectField label="Payment terms" value={f.paymentTerms} options={['Immediate', 'Net 15', 'Net 30', 'Net 45', 'Net 60']} onChange={(ev) => setF({ ...f, paymentTerms: ev.target.value })} />
        <SelectField label="Status" value={f.status} options={['Active', 'Blocked']} onChange={(ev) => setF({ ...f, status: ev.target.value })} />
        <TextField label="Address" className="full" value={f.addressLine} onChange={(ev) => setF({ ...f, addressLine: ev.target.value })} />
        <TextField label="City" value={f.city} onChange={(ev) => setF({ ...f, city: ev.target.value })} />
        <TextField label="State" value={f.state} onChange={(ev) => setF({ ...f, state: ev.target.value })} />
        <TextField label="PIN code" inputMode="numeric" value={f.postalCode} error={e('postalCode')} onChange={(ev) => setF({ ...f, postalCode: ev.target.value })} />
        {!restricted && <>
          <TextField label="GSTIN" value={f.gstin} error={e('gstin')} hint="Optional. Validated for format only." onChange={(ev) => setF({ ...f, gstin: ev.target.value })} />
          <TextField label="Contact person" value={f.contactName} onChange={(ev) => setF({ ...f, contactName: ev.target.value })} />
          <TextField label="Email" type="email" value={f.email} error={e('email')} onChange={(ev) => setF({ ...f, email: ev.target.value })} />
          <TextField label="Phone" type="tel" value={f.phone} onChange={(ev) => setF({ ...f, phone: ev.target.value })} />
          {(existing?.type ?? f.type) === 'Customer' && <TextField label="Credit limit (₹)" inputMode="decimal" value={f.creditLimit} error={e('creditLimit')} onChange={(ev) => setF({ ...f, creditLimit: ev.target.value })} />}
        </>}
        {(existing?.type ?? f.type) === 'Vendor' && <SelectField label="Vendor rating" value={f.vendorRating} options={['0', '1', '2', '3', '4', '5']} onChange={(ev) => setF({ ...f, vendorRating: ev.target.value })} />}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
