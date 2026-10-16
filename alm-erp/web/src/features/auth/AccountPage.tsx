import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { Button } from '../../components/common/Button';
import { Card } from '../../components/common/Card';
import { TextField } from '../../components/common/Field';
import { MessageStrip } from '../../components/common/MessageStrip';
import { PageHeader } from '../../components/layout/PageHeader';
import { useAction } from '../../hooks/useApi';

export function AccountPage() {
  const { user, changePassword } = useAuth();
  const navigate = useNavigate();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);
  const act = useAction();
  const forced = !!user?.mustChangePassword;
  const mismatch = confirm && next !== confirm ? 'The passwords do not match.' : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (mismatch || !current || !next) return;
    const ok = await act.run(async () => { await changePassword(current, next); return true; });
    if (ok) {
      setCurrent(''); setNext(''); setConfirm(''); setDone(true);
      if (forced) navigate('/', { replace: true });
    }
  };

  return (
    <>
      <PageHeader title="Account settings" subtitle={user?.email} />
      <div className="page-content">
        <div className="card-grid fixed" style={{ maxWidth: 1100 }}>
          <Card title="Profile">
            <dl className="object-attrs" style={{ marginTop: 0 }}>
              <div><dt>Name</dt><dd>{user?.fullName}</dd></div>
              <div><dt>Email</dt><dd>{user?.email}</dd></div>
              <div><dt>Location</dt><dd>{user?.location ?? '—'}</dd></div>
              <div><dt>Roles</dt><dd>{user?.roles.map((r) => r.name).join(', ')}</dd></div>
            </dl>
          </Card>
          <Card title="Change password" className="span-2">
            {forced && <MessageStrip type="warning">You signed in with a temporary password. Choose a new password to continue.</MessageStrip>}
            {done && <MessageStrip type="success" onClose={() => setDone(false)}>Your password was changed. Other sessions were signed out.</MessageStrip>}
            {act.error && <MessageStrip type="error">{act.error}</MessageStrip>}
            <form className="form-grid" onSubmit={submit} noValidate>
              <TextField label="Current password" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
              <TextField label="New password" type="password" autoComplete="new-password" required value={next} onChange={(e) => setNext(e.target.value)}
                hint="At least 10 characters with three of: lowercase, uppercase, digit, symbol." />
              <TextField label="Confirm new password" type="password" autoComplete="new-password" required value={confirm}
                onChange={(e) => setConfirm(e.target.value)} error={mismatch} />
              <div className="full"><Button type="submit" variant="emph" busy={act.pending} disabled={!current || !next || !!mismatch}>Change password</Button></div>
            </form>
          </Card>
        </div>
      </div>
    </>
  );
}
