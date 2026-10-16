import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, onAuthProblem, post, setCsrfToken } from '../services/api';
import type { SessionUser } from '../types';

interface AuthState {
  user: SessionUser | null;
  status: 'loading' | 'ready';
  sessionExpired: boolean;
  login: (email: string, password: string) => Promise<SessionUser>;
  logout: () => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  can: (permission: string) => boolean;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

interface SessionResponse { user: SessionUser | null; csrfToken: string | null }

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready'>('loading');
  const [sessionExpired, setSessionExpired] = useState(false);

  const apply = useCallback((s: SessionResponse) => {
    setCsrfToken(s.csrfToken);
    setUser(s.user);
  }, []);

  const refresh = useCallback(async () => {
    try {
      apply(await api<SessionResponse>('/auth/session'));
    } catch {
      apply({ user: null, csrfToken: null });
    } finally {
      setStatus('ready');
    }
  }, [apply]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(
    () =>
      onAuthProblem((code) => {
        if (code === 'UNAUTHENTICATED') {
          setSessionExpired(true);
          apply({ user: null, csrfToken: null });
        } else {
          setUser((u) => (u ? { ...u, mustChangePassword: true } : u));
        }
      }),
    [apply],
  );

  const login = useCallback(async (email: string, password: string) => {
    const s = await post<SessionResponse>('/auth/login', { email, password });
    apply(s);
    setSessionExpired(false);
    return s.user!;
  }, [apply]);

  const logout = useCallback(async () => {
    try {
      await post('/auth/logout');
    } finally {
      apply({ user: null, csrfToken: null });
    }
  }, [apply]);

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    apply(await post<SessionResponse>('/auth/change-password', { currentPassword, newPassword }));
  }, [apply]);

  const can = useCallback((p: string) => !!user?.permissions.includes(p), [user]);

  const value = useMemo(
    () => ({ user, status, sessionExpired, login, logout, changePassword, can, refresh }),
    [user, status, sessionExpired, login, logout, changePassword, can, refresh],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
