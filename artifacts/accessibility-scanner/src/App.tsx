import { Switch, Route, Redirect, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { Layout } from "@/components/layout";
import Home from "@/pages/home";
import ScanList from "@/pages/scan-list";
import ScanDetail from "@/pages/scan-detail";
import PageReport from "@/pages/page-report";
import ScanReport from "@/pages/scan-report";
import ScanCompare from "@/pages/scan-compare";
import Documentation from "@/pages/documentation";
import AppUpdates from "@/pages/app-updates";
import LoginPage from "@/pages/login";
import ResetPasswordPage from "@/pages/reset-password";
import ChangePasswordPage from "@/pages/change-password";
import ProfileSettingsPage from "@/pages/profile-settings";
import SettingsPage from "@/pages/settings";
import AdminUsersPage from "@/pages/admin/users";
import AdminGroupsPage from "@/pages/admin/groups";
import AdminDashboardPage from "@/pages/admin/dashboard";
import AdminPermissionsPage from "@/pages/admin/permissions";
import AdminSettingsPage from "@/pages/admin/settings";
import TicketsPage from "@/pages/tickets";
import IssuesPage from "@/pages/issues";
import FeatureRequestPage from "@/pages/feature-request";
import AdminInboxPage from "@/pages/admin/inbox";
import CrawlerListPage from "@/pages/crawler-list";
import CrawlerNewPage from "@/pages/crawler-new";
import CrawlerDetailPage from "@/pages/crawler-detail";
import SitesPage from "@/pages/sites";
import SiteManagementPage from "@/pages/site-management";
import SiteDashboard from "@/pages/site-dashboard";
import SitePageGroups from "@/pages/site-page-groups";
import SiteIssues from "@/pages/site-issues";
import SitePotentialIssues from "@/pages/site-potential-issues";
import SiteComplianceWcag from "@/pages/site-compliance-wcag";
import SiteComplianceEaa from "@/pages/site-compliance-eaa";
import SiteComplianceAda from "@/pages/site-compliance-ada";
import SiteIssueDetail from "@/pages/site-issue-detail";
import SiteRulePageReport from "@/pages/site-rule-page-report";
import QualityAssurancePage from "@/pages/quality-assurance";
import QABrokenLinksPage from "@/pages/qa-broken-links";
import QAInventoryPagesPage from "@/pages/qa-page-inventory";
import QACheckHistoryPage from "@/pages/qa-check-history";
import QAStubPage from "@/pages/qa-stub";
import ActivityPage from "@/pages/activity";
import QALinksOverviewPage from "@/pages/qa-links-overview";
import QAInventorySummaryPage from "@/pages/qa-inventory-summary";
import {
  QAInventoryLinksPage,
  QAInventoryDocumentsPage,
  QAInventoryMediaPage,
  QAInventoryEmailPage,
  QAInventoryPhonesPage,
  QAInventoryJavascriptPage,
  QAInventoryCSSPage,
} from "@/pages/qa-link-inventory";
import QALinkTextPage from "@/pages/qa-link-text";
import QAMetaTagsPage from "@/pages/qa-meta-tags";
import QAPriorityPagesPage from "@/pages/qa-priority-pages";
import QAIssuesPage from "@/pages/qa-issues";
import QAPagesWithBrokenPage from "@/pages/qa-pages-with-broken";
import QAUnsafeLinksPage from "@/pages/qa-unsafe-links";
import QASitemapPage from "@/pages/qa-sitemap";
import QAWordInventoryPage from "@/pages/qa-word-inventory";
import { AuthProvider, useAuth } from "@/contexts/auth";
import { SiteProvider } from "@/contexts/site";
import { PageGroupProvider } from "@/contexts/page-group";
import AdminSiteManagerPage from "@/pages/admin/site-manager";
import ManageProjectsPage from "@/pages/manage-projects";
import { AppStatusProvider, useAppStatus } from "@/contexts/app-status";
import MaintenancePage from "@/pages/maintenance";
import WelcomePage from "@/pages/welcome";
import { Loader2 } from "lucide-react";
import { useEffect } from "react";

const queryClient = new QueryClient();
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function AppStatusGate({ children }: { children: React.ReactNode }) {
  const { status } = useAppStatus();
  // Checking is deliberately non-blocking. The first probe and transient
  // retries must not replace an otherwise usable application shell.
  if (status === "offline") {
    return <MaintenancePage />;
  }
  return <>{children}</>;
}

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const [location] = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) {
    return <Redirect to="/login" />;
  }

  if (user.mustResetPassword && location !== "/change-password") {
    return <Redirect to="/change-password" />;
  }

  return <>{children}</>;
}

function AdminGuard({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (!user || (user.role !== "super_admin" && user.role !== "admin")) {
    return <Redirect to="/scans" />;
  }
  return <>{children}</>;
}

function PermissionGuard({
  permission,
  children,
}: {
  permission:
    | "canCreateCrawl"
    | "canDeleteCrawl"
    | "canViewCrawlHistory"
    | "canViewQualityAssurance"
    | "canViewSiteAccessibilityDashboard"
    | "canManageSites"
    | "canManageSiteTargetScore"
    | "canViewIssues";
  children: React.ReactNode;
}) {
  const { user } = useAuth();
  if (!user?.permissions?.[permission]) {
    return <Redirect to="/welcome" />;
  }
  return <>{children}</>;
}

function ProjectManagementGuard({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const permissions = user?.permissions;
  if (!permissions?.canCreateProject && !permissions?.canDeleteProject) {
    return <Redirect to="/welcome" />;
  }
  return <>{children}</>;
}

function QARoute({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <PermissionGuard permission="canViewQualityAssurance">
        <Layout>{children}</Layout>
      </PermissionGuard>
    </AuthGuard>
  );
}

function SuperAdminGuard({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (!user || user.role !== "super_admin") {
    return <Redirect to="/scans" />;
  }
  return <>{children}</>;
}

function Router() {
  return (
    <Switch>
      {/* Public routes */}
      <Route path="/login">
        <LoginPage />
      </Route>
      <Route path="/reset-password">
        <ResetPasswordPage />
      </Route>

      {/* Password change (requires auth but no layout) */}
      <Route path="/change-password">
        <AuthGuard>
          <ChangePasswordPage />
        </AuthGuard>
      </Route>
      <Route path="/profile-settings">
        <AuthGuard>
          <Layout><ProfileSettingsPage /></Layout>
        </AuthGuard>
      </Route>
      <Route path="/settings">
        <AuthGuard>
          <Layout><SettingsPage /></Layout>
        </AuthGuard>
      </Route>

      {/* Protected app routes */}
      <Route path="/">
        <AuthGuard><Redirect to="/welcome" /></AuthGuard>
      </Route>
      <Route path="/welcome">
        <AuthGuard><Layout><WelcomePage /></Layout></AuthGuard>
      </Route>
      <Route path="/new">
        <AuthGuard><Layout><Home /></Layout></AuthGuard>
      </Route>
      <Route path="/projects">
        <AuthGuard>
          <ProjectManagementGuard>
            <Layout><ManageProjectsPage /></Layout>
          </ProjectManagementGuard>
        </AuthGuard>
      </Route>
      <Route path="/scans/:scanId/pages/:pageId/report">
        <AuthGuard><PageReport /></AuthGuard>
      </Route>
      <Route path="/sites/:siteId/page-report/:pageId">
        <AuthGuard>
          <PermissionGuard permission="canViewSiteAccessibilityDashboard">
            <SiteRulePageReport />
          </PermissionGuard>
        </AuthGuard>
      </Route>
      <Route path="/scans/:id/report">
        <AuthGuard><Layout><ScanReport /></Layout></AuthGuard>
      </Route>
      <Route path="/scans/:id">
        <AuthGuard><Layout><ScanDetail /></Layout></AuthGuard>
      </Route>
      <Route path="/scans">
        <AuthGuard><Layout><ScanList /></Layout></AuthGuard>
      </Route>
      <Route path="/compare">
        <AuthGuard><Layout><ScanCompare /></Layout></AuthGuard>
      </Route>
      <Route path="/documentation">
        <AuthGuard><Layout><Documentation /></Layout></AuthGuard>
      </Route>
      <Route path="/app-updates">
        <AuthGuard><Layout><AppUpdates /></Layout></AuthGuard>
      </Route>
      <Route path="/issues">
        <AuthGuard><PermissionGuard permission="canViewIssues"><Layout><IssuesPage /></Layout></PermissionGuard></AuthGuard>
      </Route>
      <Route path="/app-walkthrough">
        <AuthGuard><Redirect to="/app-updates" /></AuthGuard>
      </Route>
      <Route path="/tickets">
        <AuthGuard><Layout><TicketsPage /></Layout></AuthGuard>
      </Route>
      <Route path="/feature-request">
        <AuthGuard><Layout><FeatureRequestPage /></Layout></AuthGuard>
      </Route>
      <Route path="/activity">
        <AuthGuard><Layout><ActivityPage /></Layout></AuthGuard>
      </Route>
      <Route path="/crawler/new">
        <AuthGuard>
          <PermissionGuard permission="canCreateCrawl">
            <Layout><CrawlerNewPage /></Layout>
          </PermissionGuard>
        </AuthGuard>
      </Route>
      <Route path="/crawler/manage">
        <AuthGuard>
          <PermissionGuard permission="canManageSites">
            <Layout><SiteManagementPage /></Layout>
          </PermissionGuard>
        </AuthGuard>
      </Route>
      <Route path="/crawler/sites/:siteId/manage">
        <AuthGuard>
          <PermissionGuard permission="canManageSites">
            <Layout><SiteManagementPage /></Layout>
          </PermissionGuard>
        </AuthGuard>
      </Route>
      <Route path="/crawler/sites">
        <AuthGuard>
          <PermissionGuard permission="canManageSites">
            <Layout><SitesPage /></Layout>
          </PermissionGuard>
        </AuthGuard>
      </Route>
      {/* Quality Assurance — functional routes */}
      <Route path="/quality-assurance/check-history">
        <QARoute><QACheckHistoryPage /></QARoute>
      </Route>
      <Route path="/quality-assurance/links/broken">
        <QARoute><QABrokenLinksPage /></QARoute>
      </Route>
      <Route path="/quality-assurance/links/overview">
        <QARoute><QALinksOverviewPage /></QARoute>
      </Route>
      <Route path="/quality-assurance/inventory/pages">
        <QARoute><QAInventoryPagesPage /></QARoute>
      </Route>
      <Route path="/quality-assurance">
        <QARoute><QualityAssurancePage /></QARoute>
      </Route>
      {/* Quality Assurance — stub routes */}
      <Route path="/quality-assurance/priority-pages">
        <QARoute><QAPriorityPagesPage /></QARoute>
      </Route>
      <Route path="/quality-assurance/single-page-check">
        <QARoute><QAStubPage /></QARoute>
      </Route>
      <Route path="/quality-assurance/inventory">
        <QARoute><QAInventorySummaryPage /></QARoute>
      </Route>
      <Route path="/quality-assurance/inventory/links">
        <QARoute><QAInventoryLinksPage /></QARoute>
      </Route>
      <Route path="/quality-assurance/inventory/link-text">
        <QARoute><QALinkTextPage /></QARoute>
      </Route>
      <Route path="/quality-assurance/inventory/documents">
        <QARoute><QAInventoryDocumentsPage /></QARoute>
      </Route>
      <Route path="/quality-assurance/inventory/media">
        <QARoute><QAInventoryMediaPage /></QARoute>
      </Route>
      <Route path="/quality-assurance/inventory/email">
        <QARoute><QAInventoryEmailPage /></QARoute>
      </Route>
      <Route path="/quality-assurance/inventory/phones">
        <QARoute><QAInventoryPhonesPage /></QARoute>
      </Route>
      <Route path="/quality-assurance/inventory/ssn">
        <QARoute><QAStubPage /></QARoute>
      </Route>
      <Route path="/quality-assurance/inventory/javascript">
        <QARoute><QAInventoryJavascriptPage /></QARoute>
      </Route>
      <Route path="/quality-assurance/inventory/css">
        <QARoute><QAInventoryCSSPage /></QARoute>
      </Route>
      <Route path="/quality-assurance/inventory/meta-tags">
        <QARoute><QAMetaTagsPage /></QARoute>
      </Route>
      <Route path="/quality-assurance/inventory/sitemap">
        <QARoute><QASitemapPage /></QARoute>
      </Route>
      <Route path="/quality-assurance/issues">
        <QARoute><QAIssuesPage /></QARoute>
      </Route>
      <Route path="/quality-assurance/issues/resolved">
        <QARoute><QAStubPage /></QARoute>
      </Route>
      <Route path="/quality-assurance/links/pages-with-broken">
        <QARoute><QAPagesWithBrokenPage /></QARoute>
      </Route>
      <Route path="/quality-assurance/links/pdfs-broken">
        <QARoute><QAStubPage /></QARoute>
      </Route>
      <Route path="/quality-assurance/links/broken-in-pdfs">
        <QARoute><QAStubPage /></QARoute>
      </Route>
      <Route path="/quality-assurance/links/unsafe">
        <QARoute><QAUnsafeLinksPage /></QARoute>
      </Route>
      <Route path="/quality-assurance/spelling/pages">
        <QARoute><QAStubPage /></QARoute>
      </Route>
      <Route path="/quality-assurance/spelling/misspellings">
        <QARoute><QAStubPage /></QARoute>
      </Route>
      <Route path="/quality-assurance/spelling/word-inventory">
        <QARoute><QAWordInventoryPage /></QARoute>
      </Route>
      <Route path="/quality-assurance/spelling/decisions">
        <QARoute><QAStubPage /></QARoute>
      </Route>
      <Route path="/quality-assurance/spelling/progress">
        <QARoute><QAStubPage /></QARoute>
      </Route>
      <Route path="/sites/:siteId/issues/:ruleId">
        {(params: { siteId: string; ruleId: string }) => (
          <AuthGuard>
            <PermissionGuard permission="canViewSiteAccessibilityDashboard">
              <Layout>
                <SiteIssueDetail
                  siteId={parseInt(params.siteId)}
                  ruleId={decodeURIComponent(params.ruleId)}
                />
              </Layout>
            </PermissionGuard>
          </AuthGuard>
        )}
      </Route>
      <Route path="/sites/:id/page-groups">
        {(params: { id: string }) => (
          <AuthGuard>
            <PermissionGuard permission="canViewSiteAccessibilityDashboard">
              <Layout><SitePageGroups siteId={parseInt(params.id)} /></Layout>
            </PermissionGuard>
          </AuthGuard>
        )}
      </Route>
      <Route path="/sites/:id/issues">
        {(params: { id: string }) => (
          <AuthGuard>
            <PermissionGuard permission="canViewSiteAccessibilityDashboard">
              <Layout><SiteIssues siteId={parseInt(params.id)} /></Layout>
            </PermissionGuard>
          </AuthGuard>
        )}
      </Route>
      <Route path="/sites/:id/potential-issues">
        {(params: { id: string }) => (
          <AuthGuard>
            <PermissionGuard permission="canViewSiteAccessibilityDashboard">
              <Layout><SitePotentialIssues siteId={parseInt(params.id)} /></Layout>
            </PermissionGuard>
          </AuthGuard>
        )}
      </Route>
      <Route path="/sites/:id/compliance/wcag">
        {(params: { id: string }) => (
          <AuthGuard>
            <PermissionGuard permission="canViewSiteAccessibilityDashboard">
              <Layout><SiteComplianceWcag siteId={parseInt(params.id)} /></Layout>
            </PermissionGuard>
          </AuthGuard>
        )}
      </Route>
      <Route path="/sites/:id/compliance/eaa">
        {(params: { id: string }) => (
          <AuthGuard>
            <PermissionGuard permission="canViewSiteAccessibilityDashboard">
              <Layout><SiteComplianceEaa siteId={parseInt(params.id)} /></Layout>
            </PermissionGuard>
          </AuthGuard>
        )}
      </Route>
      <Route path="/sites/:id/compliance/ada">
        {(params: { id: string }) => (
          <AuthGuard>
            <PermissionGuard permission="canViewSiteAccessibilityDashboard">
              <Layout><SiteComplianceAda siteId={parseInt(params.id)} /></Layout>
            </PermissionGuard>
          </AuthGuard>
        )}
      </Route>
      <Route path="/sites/:id">
        {(params: { id: string }) => (
          <AuthGuard>
            <PermissionGuard permission="canViewSiteAccessibilityDashboard">
              <Layout><SiteDashboard siteId={parseInt(params.id)} /></Layout>
            </PermissionGuard>
          </AuthGuard>
        )}
      </Route>
      <Route path="/crawler/:id">
        <AuthGuard>
          <PermissionGuard permission="canViewCrawlHistory">
            <Layout><CrawlerDetailPage /></Layout>
          </PermissionGuard>
        </AuthGuard>
      </Route>
      <Route path="/crawler">
        <AuthGuard>
          <PermissionGuard permission="canViewCrawlHistory">
            <Layout><CrawlerListPage /></Layout>
          </PermissionGuard>
        </AuthGuard>
      </Route>

      {/* Admin-only routes */}
      <Route path="/admin/inbox">
        <AuthGuard><AdminGuard><Layout><AdminInboxPage /></Layout></AdminGuard></AuthGuard>
      </Route>
      <Route path="/admin/dashboard">
        <AuthGuard><AdminGuard><Layout><AdminDashboardPage /></Layout></AdminGuard></AuthGuard>
      </Route>
      <Route path="/admin/users">
        <AuthGuard><AdminGuard><Layout><AdminUsersPage /></Layout></AdminGuard></AuthGuard>
      </Route>
      <Route path="/admin/groups">
        <AuthGuard><AdminGuard><Layout><AdminGroupsPage /></Layout></AdminGuard></AuthGuard>
      </Route>
      <Route path="/admin/site-manager">
        <AuthGuard><AdminGuard><Layout><AdminSiteManagerPage /></Layout></AdminGuard></AuthGuard>
      </Route>

      {/* Super-admin-only routes */}
      <Route path="/admin/permissions">
        <AuthGuard><SuperAdminGuard><Layout><AdminPermissionsPage /></Layout></SuperAdminGuard></AuthGuard>
      </Route>
      <Route path="/admin/settings">
        <AuthGuard><SuperAdminGuard><Layout><AdminSettingsPage /></Layout></SuperAdminGuard></AuthGuard>
      </Route>

      <Route component={NotFound} />
    </Switch>
  );
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// Ping the health endpoint every 3.5 minutes to prevent Azure App Service
// from putting the worker process to sleep during idle periods.
// Azure's idle-process timeout is ~20 minutes without "Always On", but Azure
// Application Gateway also drops connections with no traffic after ~4 minutes,
// so a sub-4-minute interval keeps both the process and any open connections alive.
function useKeepAlive() {
  useEffect(() => {
    const id = setInterval(() => {
      fetch(`${BASE}/api/healthz`, { credentials: "include" }).catch(() => {});
    }, 3.5 * 60 * 1000);
    return () => clearInterval(id);
  }, []);
}

type OverlayScrollbarEntry = {
  element: HTMLElement;
  thumb: HTMLDivElement;
  orientation: "vertical" | "horizontal";
  onScroll: () => void;
  onPointerDown: (event: PointerEvent) => void;
};

function AppOverlayScrollbars() {
  useEffect(() => {
    const entries = new Map<string, OverlayScrollbarEntry>();
    let scanTimer: number | undefined;
    let frame: number | undefined;

    const isRadixViewport = (element: HTMLElement) =>
      Boolean(element.closest("[data-radix-scroll-area-viewport]"));

    const canScroll = (element: HTMLElement, orientation: "vertical" | "horizontal") => {
      const style = getComputedStyle(element);
      const overflow = orientation === "vertical" ? style.overflowY : style.overflowX;
      if (!["auto", "scroll", "overlay"].includes(overflow)) return false;
      return orientation === "vertical"
        ? element.scrollHeight > element.clientHeight + 1
        : element.scrollWidth > element.clientWidth + 1;
    };

    const createThumb = (
      element: HTMLElement,
      orientation: "vertical" | "horizontal",
      key: string,
    ) => {
      const thumb = document.createElement("div");
      thumb.className = "app-overlay-scrollbar-thumb";
      thumb.dataset.orientation = orientation;
      thumb.dataset.scrollbarKey = key;
      thumb.setAttribute("aria-hidden", "true");
      document.body.appendChild(thumb);

      const onScroll = () => scheduleUpdate();
      const onPointerDown = (event: PointerEvent) => {
        event.preventDefault();
        event.stopPropagation();

        const startPointer = orientation === "vertical" ? event.clientY : event.clientX;
        const startScroll = orientation === "vertical" ? element.scrollTop : element.scrollLeft;
        const viewport = orientation === "vertical" ? element.clientHeight : element.clientWidth;
        const content = orientation === "vertical" ? element.scrollHeight : element.scrollWidth;
        const thumbSize = Math.max(28, (viewport * viewport) / content);
        const travel = Math.max(1, viewport - thumbSize - 6);
        const scrollRange = Math.max(1, content - viewport);

        const onPointerMove = (moveEvent: PointerEvent) => {
          const pointer = orientation === "vertical" ? moveEvent.clientY : moveEvent.clientX;
          const nextScroll = startScroll + ((pointer - startPointer) / travel) * scrollRange;
          if (orientation === "vertical") {
            element.scrollTop = nextScroll;
          } else {
            element.scrollLeft = nextScroll;
          }
          scheduleUpdate();
        };
        const onPointerUp = () => {
          window.removeEventListener("pointermove", onPointerMove);
          window.removeEventListener("pointerup", onPointerUp);
        };

        window.addEventListener("pointermove", onPointerMove);
        window.addEventListener("pointerup", onPointerUp, { once: true });
      };

      thumb.addEventListener("pointerdown", onPointerDown);
      element.addEventListener("scroll", onScroll, { passive: true });
      entries.set(key, { element, thumb, orientation, onScroll, onPointerDown });
    };

    const removeEntry = (key: string) => {
      const entry = entries.get(key);
      if (!entry) return;
      entry.element.removeEventListener("scroll", entry.onScroll);
      entry.thumb.removeEventListener("pointerdown", entry.onPointerDown);
      entry.thumb.remove();
      entries.delete(key);
    };

    const scan = () => {
      const candidates: HTMLElement[] = [];
      if (document.scrollingElement instanceof HTMLElement) {
        candidates.push(document.scrollingElement);
      }
      document.querySelectorAll<HTMLElement>("*").forEach((element) => {
        if (!isRadixViewport(element) && !element.matches("[data-app-overlay-scrollbar-thumb]")) {
          candidates.push(element);
        }
      });

      const activeKeys = new Set<string>();
      candidates.forEach((element) => {
        (["vertical", "horizontal"] as const).forEach((orientation) => {
          const key = `${orientation}:${element === document.scrollingElement ? "document" : element.dataset.scrollbarId || ""}`;
          if (element !== document.scrollingElement && !element.dataset.scrollbarId) {
            element.dataset.scrollbarId = `scroll-${Math.random().toString(36).slice(2)}`;
          }
          const resolvedKey =
            element === document.scrollingElement
              ? key
              : `${orientation}:${element.dataset.scrollbarId}`;
          if (canScroll(element, orientation)) {
            activeKeys.add(resolvedKey);
            if (!entries.has(resolvedKey)) createThumb(element, orientation, resolvedKey);
          }
        });
      });

      Array.from(entries.keys()).forEach((key) => {
        if (!activeKeys.has(key)) removeEntry(key);
      });
      scheduleUpdate();
    };

    const update = () => {
      frame = undefined;
      entries.forEach(({ element, thumb, orientation }) => {
        const isDocument = element === document.scrollingElement;
        const rect = isDocument
          ? { top: 0, left: 0, right: window.innerWidth, bottom: window.innerHeight }
          : element.getBoundingClientRect();
        const viewport = orientation === "vertical" ? element.clientHeight : element.clientWidth;
        const content = orientation === "vertical" ? element.scrollHeight : element.scrollWidth;
        const scroll = orientation === "vertical" ? element.scrollTop : element.scrollLeft;
        const thumbSize = Math.max(28, (viewport * viewport) / content);
        const trackSize = Math.max(0, viewport - thumbSize - 6);
        const scrollRange = Math.max(1, content - viewport);
        const offset = (scroll / scrollRange) * trackSize;

        if (orientation === "vertical") {
          thumb.style.top = `${Math.max(rect.top + 3, rect.top + 3 + offset)}px`;
          thumb.style.left = `${rect.right - 10}px`;
          thumb.style.height = `${Math.min(viewport - 6, thumbSize)}px`;
          thumb.style.width = "6px";
        } else {
          thumb.style.left = `${Math.max(rect.left + 3, rect.left + 3 + offset)}px`;
          thumb.style.top = `${rect.bottom - 10}px`;
          thumb.style.width = `${Math.min(viewport - 6, thumbSize)}px`;
          thumb.style.height = "6px";
        }
      });
    };

    const scheduleUpdate = () => {
      if (frame === undefined) frame = window.requestAnimationFrame(update);
    };

    const scheduleScan = () => {
      if (scanTimer !== undefined) window.clearTimeout(scanTimer);
      scanTimer = window.setTimeout(scan, 80);
    };

    const observer = new MutationObserver(scheduleScan);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    window.addEventListener("resize", scheduleScan);
    window.addEventListener("scroll", scheduleUpdate, true);
    scan();

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", scheduleScan);
      window.removeEventListener("scroll", scheduleUpdate, true);
      if (scanTimer !== undefined) window.clearTimeout(scanTimer);
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      Array.from(entries.keys()).forEach(removeEntry);
    };
  }, []);

  return null;
}

function App() {
  useKeepAlive();
  return (
    <WouterRouter base={basePath}>
      <QueryClientProvider client={queryClient}>
        <AppStatusProvider>
          <AppStatusGate>
            <AuthProvider>
              <SiteProvider>
                <PageGroupProvider>
                  <TooltipProvider>
                    <AppOverlayScrollbars />
                    <Router />
                    <Toaster />
                  </TooltipProvider>
                </PageGroupProvider>
              </SiteProvider>
            </AuthProvider>
          </AppStatusGate>
        </AppStatusProvider>
      </QueryClientProvider>
    </WouterRouter>
  );
}

export default App;
