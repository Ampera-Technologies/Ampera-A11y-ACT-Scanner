// @refresh reset
import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";

export interface UserPermissions {
  canScan: boolean;
  canExport: boolean;
  canViewAllScans: boolean;
  canEditScan: boolean;
  canDeleteScan: boolean;
  canManageScan: boolean;
  canCreateProject: boolean;
  canDeleteProject: boolean;
  canDisableJs: boolean;
  canSmartAnalysis: boolean;
  canSwitchSite: boolean;
  canCreateCrawl: boolean;
  canDeleteCrawl: boolean;
  canViewCrawlHistory: boolean;
  canViewQualityAssurance: boolean;
  canViewSiteAccessibilityDashboard: boolean;
  canManageSites: boolean;
  canManageSiteTargetScore: boolean;
  canViewIssues: boolean;
  canCreateIssue: boolean;
  canEditIssue: boolean;
  canCommentIssue: boolean;
  canManageIssues: boolean;
  canViewHtmlReplay: boolean;
}

const DEFAULT_PERMISSIONS: UserPermissions = {
  canScan: true,
  canExport: true,
  canViewAllScans: false,
  canEditScan: true,
  canDeleteScan: true,
  canManageScan: true,
  canCreateProject: true,
  canDeleteProject: true,
  canDisableJs: false,
  canSmartAnalysis: false,
  canSwitchSite: false,
  canCreateCrawl: true,
  canDeleteCrawl: true,
  canViewCrawlHistory: true,
  canViewQualityAssurance: true,
  canViewSiteAccessibilityDashboard: true,
  canManageSites: false,
  canManageSiteTargetScore: false,
  canViewIssues: true,
  canCreateIssue: true,
  canEditIssue: true,
  canCommentIssue: true,
  canManageIssues: true,
  canViewHtmlReplay: false,
};

export interface AuthUser {
  id: number;
  username: string;
  email: string;
  fullName: string;
  profileImageUrl?: string | null;
  role: string;
  mustResetPassword: boolean;
  permissions: UserPermissions;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    try {
      const [userRes, permsRes] = await Promise.all([
        fetch(`${BASE}/api/auth/me`, { credentials: "include" }),
        fetch(`${BASE}/api/auth/my-permissions`, { credentials: "include" }),
      ]);
      if (userRes.ok) {
        const userData = await userRes.json();
        const perms = permsRes.ok ? await permsRes.json() : DEFAULT_PERMISSIONS;
        setUser({ ...userData, permissions: perms });
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    refreshUser().finally(() => setLoading(false));
  }, [refreshUser]);

  const login = useCallback(async (username: string, password: string) => {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Login failed");
    }
    const userData = await res.json();
    const permsRes = await fetch(`${BASE}/api/auth/my-permissions`, { credentials: "include" });
    const perms = permsRes.ok ? await permsRes.json() : DEFAULT_PERMISSIONS;
    setUser({ ...userData, permissions: perms });
  }, []);

  const logout = useCallback(async () => {
    await fetch(`${BASE}/api/auth/logout`, { method: "POST", credentials: "include" });
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

export function isAdmin(user: AuthUser | null): boolean {
  return user?.role === "super_admin" || user?.role === "admin";
}

export function isSuperAdmin(user: AuthUser | null): boolean {
  return user?.role === "super_admin";
}
