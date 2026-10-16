import { KeyRound, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { Button } from '../../components/common/Button';
import { DataTable } from '../../components/common/DataTable';
import { Dialog } from '../../components/common/Dialog';
import { TextField } from '../../components/common/Field';
import { MessageStrip } from '../../components/common/MessageStrip';
import { invalidateCache } from '../../components/common/Pickers';
import { SampleFlag, Status } from '../../components/common/Status';
import { Tabs } from '../../components/common/Tabs';
import { FilterBar, PageHeader } from '../../components/layout/PageHeader';
import { useAction, useApi, useDebounced } from '../../hooks/useApi';
import { patch, post, qs } from '../../services/api';
import { formatDateTime } from '../../utils/format';

interface AdminUser {
  id: number; email: string; fullName: string; location: string | null; isActive: boolean; isSample: boolean; mustChangePassword: boolean;
  lastLoginAt: string | null; canSignIn: boolean; locked: boolean; roles: string[];
}
interface Role { id: number; code: string; name: string; description: string; permissions: string[]; userCount: number }

export function AdminUsersPage() {
  const { user: me } = useAuth();
  const [tab, setTab] = useState('users');
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 300);
  const users = useApi<{ items: AdminUser[] }>(`/admin/users${qs({ q: dq })}`);
  const roles = useApi<{ items: Role[]; permissions: { code: string; description: string }[] }>('/admin/roles');
  const [editing, setEditing] = useState<AdminUser | 'new' | null>(null);
  const [resetting, setResetting] = useState<AdminUser | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const roleName = (code: string) => roles.data?.items.find((r) => r.code === code)?.name ?? code;

  return (
    <>
      <PageHeader title="Users & Roles" subtitle="Accounts, role assignments and permissions. Role changes take effect immediately (affected users are signed out)."
        actions={<Button variant="emph" icon={<Plus size={16} />} onClick={() => setEditing('new')}>Create User</Button>}
        after={<Tabs label="Administration" value={tab} onChange={setTab} tabs={[{ id: 'users', label: 'Users' }, { id: 'roles', label: 'Roles & Permissions' }]} />}>
        {tab === 'users' && <FilterBar><TextField label="Search" className="wide" placeholder="Name or email" value={q} onChange={(e) => setQ(e.target.value)} /></FilterBar>}
      </PageHeader>
      <div className="page-content">
        {msg && <MessageStrip type="success" onClose={() => setMsg(null)}>{msg}</MessageStrip>}
        {tab === 'users' && (
          <section className="card">
            <DataTable caption="Users" rows={users.data?.items} loading={users.loading} error={users.error} onRetry={users.reload} rowKey={(u) => u.id} emptyTitle="No users"
              columns={[
                { key: 'name', header: 'User', render: (u) => <>{u.fullName} <SampleFlag show={u.isSample} /><span className="sub">{u.email}</span></> },
                { key: 'roles', header: 'Roles', render: (u) => u.roles.map(roleName).join(', ') || '—' },
                { key: 'signin', header: 'Sign-in', render: (u) => !u.isActive ? <Status value="Deactivated" tone="negative" /> : u.locked ? <Status value="Locked" tone="negative" />
                  : !u.canSignIn ? <Status value="No password" tone="neutral" /> : u.mustChangePassword ? <Status value="Temporary password" tone="critical" /> : <Status value="Active" tone="positive" /> },
                { key: 'last', header: 'Last sign-in', render: (u) => formatDateTime(u.lastLoginAt) },
                { key: 'act', header: '', align: 'right', render: (u) => (
                  <span className="row" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                    <Button size="sm" variant="transparent" onClick={() => setEditing(u)}>Edit</Button>
                    <Button size="sm" variant="transparent" icon={<KeyRound size={14} />} onClick={() => setResetting(u)}>Set password</Button>
                  </span>) },
              ]} />
          </section>
        )}
        {tab === 'roles' && (
          <section className="card">
            <DataTable caption="Roles" rows={roles.data?.items} loading={roles.loading} error={roles.error} onRetry={roles.reload} rowKey={(r) => r.id}
              columns={[
                { key: 'name', header: 'Role', render: (r) => <>{r.name}<span className="sub">{r.description}</span></> },
                { key: 'users', header: 'Users', align: 'right', render: (r) => r.userCount },
                { key: 'perms', header: 'Permissions', render: (r) => <span className="small">{r.code === 'ADMIN' ? 'All permissions' : r.permissions.join(', ')}</span> },
              ]} />
          </section>
        )}
      </div>
      <UserDialog open={editing !== null} existing={editing === 'new' ? undefined : editing ?? undefined} roles={roles.data?.items ?? []} selfId={me?.id}
        onClose={() => setEditing(null)} onSaved={(m) => { setEditing(null); setMsg(m); users.reload(); roles.reload(); invalidateCache('/users'); }} />
      <PasswordDialog user={resetting} onClose={() => setResetting(null)} onSaved={(m) => { setResetting(null); setMsg(m); users.reload(); }} />
    </>
  );
}

function UserDialog({ open, existing, roles, selfId, onClose, onSaved }: {
  open: boolean; existing?: AdminUser; roles: Role[]; selfId?: number; onClose: () => void; onSaved: (msg: string) => void;
}) {
  const act = useAction();
  const [f, setF] = useState({ email: '', fullName: '', location: '', roles: [] as string[], temporaryPassword: '', isActive: true });
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (!open) return;
    setTouched(false); act.setError(null);
    setF(existing ? { email: existing.email, fullName: existing.fullName, location: existing.location ?? '', roles: existing.roles, temporaryPassword: '', isActive: existing.isActive }
      : { email: '', fullName: '', location: '', roles: [], temporaryPassword: '', isActive: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, existing]);
  const toggle = (code: string) => setF({ ...f, roles: f.roles.includes(code) ? f.roles.filter((r) => r !== code) : [...f.roles, code] });
  const save = async () => {
    setTouched(true);
    if (!f.fullName.trim() || !f.roles.length || (!existing && (!f.email.trim() || !f.temporaryPassword))) return;
    const ok = await act.run(async () => {
      if (existing) await patch(`/admin/users/${existing.id}`, { fullName: f.fullName.trim(), location: f.location.trim() || null, roles: f.roles, isActive: f.isActive });
      else await post('/admin/users', { email: f.email.trim(), fullName: f.fullName.trim(), location: f.location.trim() || undefined, roles: f.roles, temporaryPassword: f.temporaryPassword });
      return true;
    });
    if (ok) onSaved(existing ? `${f.fullName} updated.` : `${f.email} created. Share the temporary password through a secure channel; it must be changed at first sign-in.`);
  };
  const unlock = async () => { if (await act.run(() => patch(`/admin/users/${existing!.id}`, { unlock: true }))) onSaved(`${existing!.fullName} unlocked.`); };
  return (
    <Dialog open={open} onClose={onClose} size="lg" title={existing ? `Edit ${existing.fullName}` : 'Create User'} busy={act.pending}
      footer={<>{existing?.locked && <Button onClick={() => void unlock()}>Unlock account</Button>}<span className="spacer" />
        <Button variant="emph" busy={act.pending} onClick={() => void save()}>{existing ? 'Save' : 'Create user'}</Button><Button variant="transparent" onClick={onClose}>Cancel</Button></>}>
      {act.error && <MessageStrip type="error">{act.error}</MessageStrip>}
      <div className="form-grid">
        <TextField label="Email" required type="email" disabled={!!existing} value={f.email} data-autofocus autoComplete="off"
          error={touched && !existing && !f.email.trim() ? 'Email is required.' : null} onChange={(e) => setF({ ...f, email: e.target.value })} />
        <TextField label="Full name" required value={f.fullName} error={touched && !f.fullName.trim() ? 'Name is required.' : null} onChange={(e) => setF({ ...f, fullName: e.target.value })} />
        <TextField label="Location" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} />
        {!existing && <TextField label="Temporary password" required type="password" autoComplete="new-password" value={f.temporaryPassword}
          hint="At least 10 characters with three of: lowercase, uppercase, digit, symbol." error={touched && !f.temporaryPassword ? 'Required.' : null}
          onChange={(e) => setF({ ...f, temporaryPassword: e.target.value })} />}
        {existing && existing.id !== selfId && (
          <label className="checkbox"><input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /> Account active</label>
        )}
      </div>
      <fieldset style={{ border: 0, padding: 0, margin: '16px 0 0' }}>
        <legend className="field-label">Roles <span className="req" aria-hidden>*</span></legend>
        {touched && !f.roles.length && <p className="field-error" role="alert">Assign at least one role.</p>}
        <div className="form-grid" style={{ marginTop: 8 }}>
          {roles.map((r) => (
            <label key={r.code} className="checkbox" title={r.description}>
              <input type="checkbox" checked={f.roles.includes(r.code)} onChange={() => toggle(r.code)} disabled={existing?.id === selfId && r.code === 'ADMIN'} /> {r.name}
            </label>
          ))}
        </div>
      </fieldset>
    </Dialog>
  );
}

function PasswordDialog({ user, onClose, onSaved }: { user: AdminUser | null; onClose: () => void; onSaved: (m: string) => void }) {
  const act = useAction();
  const resetError = act.setError;
  const [pw, setPw] = useState('');
  useEffect(() => { setPw(''); resetError(null); }, [user, resetError]);
  const save = async () => {
    if (await act.run(async () => { await post(`/admin/users/${user!.id}/reset-password`, { temporaryPassword: pw }); return true; })) {
      onSaved(`Temporary password set for ${user!.email}. The user must change it at next sign-in; existing sessions were ended.`);
    }
  };
  return (
    <Dialog open={!!user} onClose={onClose} size="sm" title={`Set temporary password – ${user?.fullName ?? ''}`} busy={act.pending}
      footer={<><Button variant="emph" busy={act.pending} disabled={!pw} onClick={() => void save()}>Set password</Button><Button variant="transparent" onClick={onClose}>Cancel</Button></>}>
      {act.error && <MessageStrip type="error">{act.error}</MessageStrip>}
      <TextField label="Temporary password" required type="password" autoComplete="new-password" value={pw} data-autofocus onChange={(e) => setPw(e.target.value)}
        hint="Enables sign-in for sample team members too. The user must choose a new password at first sign-in." />
    </Dialog>
  );
}
