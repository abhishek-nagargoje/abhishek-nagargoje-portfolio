import { Eye, EyeOff } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { Button } from '../../components/common/Button';
import { Field } from '../../components/common/Field';
import { MessageStrip } from '../../components/common/MessageStrip';
import { useDocumentTitle } from '../../hooks/useApi';

/** Only allow same-site relative paths as post-login redirect targets. */
function safeNext(next: string | null): string {
  // Reject protocol-relative ("//host") and backslash ("/\\host") forms that browsers treat as off-site.
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('\\') || next.startsWith('/login')) return '/';
  return next;
}

export function LoginPage() {
  useDocumentTitle('Sign in');
  const { user, status, login, sessionExpired } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => { emailRef.current?.focus(); }, []);

  if (status === 'ready' && user && !pending) return <Navigate to={safeNext(params.get('next'))} replace />;

  const emailError = touched && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim()) ? 'Enter a valid email address.' : null;
  const passwordError = touched && !password ? 'Enter your password.' : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (pending || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim()) || !password) return;
    setPending(true);
    setError(null);
    try {
      const u = await login(email.trim(), password);
      setPassword('');
      navigate(u.mustChangePassword ? '/account' : safeNext(params.get('next')), { replace: true });
    } catch (err) {
      setError((err as Error).message);
      setPending(false);
    }
  };

  return (
    <div className="login-page">
      <aside className="login-aside" aria-hidden>
        <div className="row"><span className="shell-logo"><svg width="16" height="16" viewBox="0 0 32 32"><path d="M5 25V7h4.2l6.8 9.5L22.8 7H27v18h-4.4V14.4L16 23.5l-6.6-9.1V25z" fill="#fff" /></svg></span><strong>Meridian ALM</strong></div>
        <div>
          <h2>Run the implementation and the operation in one place.</h2>
          <ul>
            <li>Requirements, tasks, tests and defects with full traceability</li>
            <li>Procurement, inventory, sales and delivery transactions</li>
            <li>Approvals, deployments and monitoring with an audit trail</li>
          </ul>
        </div>
        <span className="small">ABC Manufacturing workspace</span>
      </aside>
      <main className="login-main">
        <div className="login-brand">
          <span className="shell-logo"><svg width="20" height="20" viewBox="0 0 32 32"><path d="M5 25V7h4.2l6.8 9.5L22.8 7H27v18h-4.4V14.4L16 23.5l-6.6-9.1V25z" fill="#fff" /></svg></span>
          <strong>Meridian ALM</strong>
        </div>
        <h1>Sign in</h1>
        <p className="muted">Use your company account.</p>
        {sessionExpired && !error && <MessageStrip type="info">Your session has ended. Please sign in again.</MessageStrip>}
        {error && <MessageStrip type="error">{error}</MessageStrip>}
        <form className="login-form" onSubmit={submit} noValidate aria-label="Sign in">
          <Field label="Email" required error={emailError}>
            {(p) => <input {...p} ref={emailRef} className="input" type="email" autoComplete="username" value={email}
              onChange={(e) => setEmail(e.target.value)} disabled={pending} />}
          </Field>
          <Field label="Password" required error={passwordError}>
            {(p) => (
              <div className="pw-field">
                <input {...p} className="input" type={show ? 'text' : 'password'} autoComplete="current-password" value={password}
                  onChange={(e) => setPassword(e.target.value)} disabled={pending} />
                <button type="button" className="pw-toggle" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}>
                  {show ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            )}
          </Field>
          <Button type="submit" variant="emph" busy={pending}>{pending ? 'Signing in…' : 'Sign in'}</Button>
        </form>
        <p className="login-foot">Accounts are created by your administrator. Forgotten passwords are reset by an administrator.</p>
      </main>
    </div>
  );
}
