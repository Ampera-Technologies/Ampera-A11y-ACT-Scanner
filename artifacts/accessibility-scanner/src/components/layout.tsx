import { Link, useLocation } from "wouter";
import {
  Accessibility,
  Activity,
  AlertCircle,
  AlertTriangle,
  BookOpen,
  Bell,
  Building2,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsRight,
  ArrowRight,
  ClipboardCheck,
  ExternalLink,
  FileCheck2,
  FileText,
  FolderOpen,
  GitCompare,
  Globe,
  History,
  KeyRound,
  Layers,
  Loader2,
  LogOut,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Star,
  TicketCheck,
  ListTodo,
  Users,
  UsersRound,
  XCircle,
  Flag,
  LayoutDashboard,
  Link2,
  SpellCheck,
  Map,
  Megaphone,
  Menu,
  Palette,
  UserRound,
  X,
  Home,
  Lightbulb,
  Inbox,
  CheckCheck,
  ScanSearch,
  Trash2,
} from "lucide-react";
import { AccessibilityModeControl } from "@/components/accessibility-mode";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import SettingsPage, {
  DEFAULT_LOGO_TEXT,
  DEFAULT_LOGO_SUBTITLE,
  DEFAULT_LOGO_SIZE,
  type LogoType,
  type Theme,
  applyAccentColor,
  getSavedAccentColor,
  getSavedTheme,
  applyTheme,
  THEME_LS_KEY,
  THEME_CHANGED_EVENT,
} from "@/pages/settings";
import {
  APP_UPDATES_VERSION,
  AppUpdatesContent,
} from "@/pages/app-updates";
import { useAuth, isAdmin, isSuperAdmin } from "@/contexts/auth";
import { useSite, type MySite } from "@/contexts/site";
import { usePageGroup } from "@/contexts/page-group";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { APP_WALKTHROUGH_EVENT } from "@/lib/walkthrough";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
export const OPEN_SETTINGS_EVENT = "a11y-open-settings";

function HeaderChevron({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block h-2 w-2 shrink-0 border-b-[1.5px] border-r-[1.5px] border-current text-muted-foreground [transform:rotate(45deg)_translate(-1px,-1px)] ${className}`}
    />
  );
}

const THEME_OPTIONS: { value: Theme; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
  { value: "glass-dark", label: "Glass Dark" },
  { value: "glass-light", label: "Glass Light" },
  { value: "glass-vision", label: "Vision Pro" },
  { value: "glass-vision-light", label: "Vision Pro Light" },
];

function HeaderThemeSwitcher() {
  const [currentTheme, setCurrentTheme] = useState<Theme>(() => getSavedTheme());

  useEffect(() => {
    const onThemeChanged = () => setCurrentTheme(getSavedTheme());
    window.addEventListener(THEME_CHANGED_EVENT, onThemeChanged);
    return () => window.removeEventListener(THEME_CHANGED_EVENT, onThemeChanged);
  }, []);

  const selectTheme = (value: Theme) => {
    setCurrentTheme(value);
    try {
      localStorage.setItem(THEME_LS_KEY, value);
    } catch {
      /* ignore */
    }
    applyTheme(value);
    window.dispatchEvent(new CustomEvent(THEME_CHANGED_EVENT, { detail: { theme: value } }));
  };

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              data-testid="button-header-theme"
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Switch theme"
            >
              <Palette className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="bg-slate-950 text-white shadow-lg">
          Theme
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {THEME_OPTIONS.map((opt) => (
          <DropdownMenuItem
            key={opt.value}
            data-testid={`menu-theme-${opt.value}`}
            onClick={() => selectTheme(opt.value)}
            className="flex items-center justify-between"
          >
            <span>{opt.label}</span>
            {currentTheme === opt.value && <Check className="h-4 w-4 text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AppLogo() {
  const BASE_URL = import.meta.env.BASE_URL as string;
  const BASE = BASE_URL.replace(/\/$/, "");
  const [logoType, setLogoType] = useState<LogoType>("image");
  const [imgUrl, setImgUrl] = useState(() => `${BASE_URL}act-logo.png`);
  const [text, setText] = useState(DEFAULT_LOGO_TEXT);
  const [subtitle, setSubtitle] = useState(DEFAULT_LOGO_SUBTITLE);
  const [size, setSize] = useState(DEFAULT_LOGO_SIZE);
  const [textColor, setTextColor] = useState("");
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    const applyData = (data: {
      type: string;
      imageUrl: string;
      text: string;
      subtitle?: string;
      size: number | null;
      textColor?: string;
    }) => {
      setLogoType(
        data.type === "text"
          ? "text"
          : data.type === "image-text"
            ? "image-text"
            : "image",
      );
      setImgUrl(data.imageUrl || `${BASE_URL}act-logo.png`);
      setText(data.text || DEFAULT_LOGO_TEXT);
      setSubtitle(data.subtitle || DEFAULT_LOGO_SUBTITLE);
      setSize(typeof data.size === "number" ? data.size : DEFAULT_LOGO_SIZE);
      setTextColor(data.textColor ?? "");
      setImgError(false);
    };

    const fetchLogo = () =>
      fetch(`${BASE}/api/logo`)
        .then((r) => r.json())
        .then(applyData)
        .catch(() => {});

    fetchLogo();

    const sync = (e: Event) => {
      const detail = (
        e as CustomEvent<{
          type: LogoType;
          imageUrl: string;
          text: string;
          subtitle?: string;
          size: number;
          textColor?: string;
        }>
      ).detail;
       if (detail) applyData({ ...detail, size: detail.size });
    };
    window.addEventListener("a11y-logo-changed", sync);

    const onVisibility = () => {
      if (document.visibilityState === "visible") fetchLogo();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.removeEventListener("a11y-logo-changed", sync);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [BASE, BASE_URL]);

  if (logoType === "image" && !imgError) {
    return (
      <span className="flex min-w-0 max-w-full items-center gap-2">
        <img
          src={imgUrl}
          alt=""
          style={{ height: size, maxWidth: size * 3.5 }}
          className="w-auto shrink-0 object-contain"
          onError={() => setImgError(true)}
          onLoad={() => setImgError(false)}
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="vision-header-logo-text break-words font-bold leading-tight" style={{ fontSize: `clamp(14px, 1.4vw, ${size * 0.55}px)` }}>
            {text}
          </span>
          <span className="vision-header-logo-subtitle break-words text-[10px] leading-tight text-muted-foreground">
            {subtitle}
          </span>
        </span>
      </span>
    );
  }

  if (logoType === "image-text") {
    return (
      <span className="flex min-w-0 max-w-full items-center gap-2">
        {!imgError && (
          <img
            src={imgUrl}
            alt=""
            style={{ height: size, maxWidth: size * 4 }}
            className="w-auto object-contain shrink-0"
            onError={() => setImgError(true)}
            onLoad={() => setImgError(false)}
          />
        )}
        <span className="flex min-w-0 flex-1 flex-col">
          <span
            className="vision-header-logo-text break-words font-bold leading-tight"
            style={{
              fontSize: `clamp(14px, 1.4vw, ${size * 0.55}px)`,
              color: textColor || undefined,
            }}
          >
            {text}
          </span>
          <span className="vision-header-logo-subtitle break-words text-[10px] leading-tight text-muted-foreground">
            {subtitle}
          </span>
        </span>
      </span>
    );
  }

  return (
      <span className="flex min-w-0 max-w-full items-center gap-2 font-bold text-foreground vision-header-logo-text">
      <Activity
        className="text-primary shrink-0"
        style={{ width: size * 0.6, height: size * 0.6 }}
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="break-words leading-tight" style={{ fontSize: `clamp(14px, 1.4vw, ${size * 0.55}px)` }}>
          {text}
        </span>
        <span className="vision-header-logo-subtitle break-words text-[10px] font-normal leading-tight text-muted-foreground">
          {subtitle}
        </span>
      </span>
    </span>
  );
}

function getUserInitials(name?: string) {
  const parts = (name ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "U";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function useSidebarCollapsed() {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem("sidebar-collapsed") === "true";
    } catch {
      return false;
    }
  });
  const toggle = () =>
    setCollapsed((v) => {
      const next = !v;
      try {
        localStorage.setItem("sidebar-collapsed", String(next));
      } catch {}
      return next;
    });
  return [collapsed, toggle] as const;
}

// Fetches the site(s) owned by the current logged-in user. Used to route
// "site customer" (regular `user` role) accounts straight to their own site.
function useMySites(enabled: boolean) {
  return useQuery<{ id: number; name: string }[]>({
    queryKey: ["my-sites-legacy"],
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/sites/my-sites`, {
        credentials: "include",
      });
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : (data.sites ?? []);
    },
  });
}

function SiteSelector() {
  const { sites, activeSite, setActiveSite } = useSite();
  const { user } = useAuth();
  const superAdmin = isSuperAdmin(user);
  const canSwitchSite = user?.permissions?.canSwitchSite ?? false;
  const [location, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [favorites, setFavorites] = useState<number[]>(() => {
    try {
      const stored = localStorage.getItem("site-favorites");
      return stored ? (JSON.parse(stored) as number[]) : [];
    } catch {
      return [];
    }
  });

  // Switching is an explicit capability. Keep the selector available even
  // when a user currently has one accessible site so the control does not
  // disappear when their site access changes.
  if (!superAdmin && !canSwitchSite) return null;

  const toggleFavorite = (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setFavorites((prev) => {
      const next = prev.includes(id)
        ? prev.filter((x) => x !== id)
        : [...prev, id];
      try {
        localStorage.setItem("site-favorites", JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  const filtered = sites
    .filter(
      (s) =>
        search === "" ||
        s.name.toLowerCase().includes(search.toLowerCase()) ||
        s.baseUrl.toLowerCase().includes(search.toLowerCase()),
    )
    .sort((a, b) => {
      const aFav = favorites.includes(a.id) ? 0 : 1;
      const bFav = favorites.includes(b.id) ? 0 : 1;
      if (aFav !== bFav) return aFav - bFav;
      return a.name.localeCompare(b.name);
    });

  const triggerName = activeSite ? activeSite.name : "All sites";
  const triggerUrl = activeSite?.baseUrl ?? "";

  const selectSite = (site: MySite | null) => {
    setActiveSite(site);
    setOpen(false);
    setSearch("");

    // Site dashboards derive their data from the route. Move the route with
    // the header selection so the dashboard does not immediately re-activate
    // the site encoded in the old URL.
    if (site) {
      const siteRoute = location.match(/^\/sites\/\d+(\/.*)?$/);
      if (siteRoute) {
        navigate(`/sites/${site.id}${siteRoute[1] ?? ""}`);
      }
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) setSearch("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className="ampera-site-selector-trigger h-auto w-[540px] max-w-full justify-start gap-2 rounded-xl border-border/75 bg-card/70 px-3 py-1.5 text-left shadow-sm backdrop-blur-xl transition-all hover:border-primary/35 hover:bg-card/90 data-[state=open]:border-primary/45 data-[state=open]:ring-4 data-[state=open]:ring-primary/10"
          aria-label={`Switch site. Current site: ${triggerName}`}
        >
          <Globe className="w-4 h-4 shrink-0 text-muted-foreground" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold leading-tight truncate">
              {triggerName}
            </div>
            {triggerUrl && (
              <div className="text-xs text-muted-foreground truncate leading-tight">
                {triggerUrl}
              </div>
            )}
          </div>
          <HeaderChevron />
        </Button>
      </PopoverTrigger>

      <PopoverContent
        className="w-[540px] overflow-hidden rounded-2xl border-border/80 bg-popover/95 p-0 shadow-[0_24px_70px_rgba(15,23,42,0.2)] backdrop-blur-2xl"
        align="center"
        sideOffset={8}
      >
        {/* Header: site count + search */}
        <div className="flex items-center gap-3 px-4 py-3 border-b">
          <span className="text-sm text-muted-foreground whitespace-nowrap font-medium">
            Sites: {sites.length}
          </span>
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search for site"
              aria-label="Search accessible sites"
              className="pl-8 h-8 text-sm"
              autoFocus
            />
          </div>
        </div>

        {/* Column headers */}
        <div className="flex items-center gap-2 px-4 py-2 border-b bg-muted/40 text-xs text-muted-foreground font-medium">
          <Star className="w-3.5 h-3.5 shrink-0" />
          <span className="flex-1">Site</span>
          <span className="w-16 text-right">Pages</span>
        </div>

        {/* Site list */}
        <ScrollArea className="h-[400px] max-h-[calc(100vh-220px)] py-1">
          {/* Only Superadmin can view data across every site. */}
          {superAdmin && (
            <button
              type="button"
              onClick={() => selectSite(null)}
              className={`site-selector-row w-[calc(100%-16px)] mx-2 my-1 flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-accent text-left transition-colors ${!activeSite ? "bg-primary/5" : ""}`}
            >
              <span className="w-4 shrink-0" />
              <div className="relative w-9 h-9 rounded border bg-muted/60 flex items-center justify-center shrink-0">
                <Globe className="w-4 h-4 text-muted-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <div
                  className={`text-sm font-semibold ${!activeSite ? "text-primary" : ""}`}
                >
                  All sites
                </div>
                <div className="text-xs text-muted-foreground">
                  View data across all sites
                </div>
              </div>
              <span className="w-4 shrink-0 flex justify-center">
                {!activeSite && <Check className="w-4 h-4 text-primary" />}
              </span>
            </button>
          )}

          {filtered.map((site) => {
            const isActive = activeSite?.id === site.id;
            const isFav = favorites.includes(site.id);
            return (
              <div
                key={site.id}
                onClick={() => selectSite(site)}
                className={`site-selector-row w-[calc(100%-16px)] mx-2 my-1 flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-accent text-left transition-colors ${isActive ? "bg-primary/5" : ""}`}
              >
                {/* Favorite */}
                <button
                  type="button"
                  onClick={(e) => toggleFavorite(site.id, e)}
                  className="w-4 h-4 shrink-0 text-muted-foreground hover:text-yellow-500 transition-colors"
                  aria-label={
                    isFav ? "Remove from favorites" : "Add to favorites"
                  }
                >
                  <Star
                    className={`w-3.5 h-3.5 ${isFav ? "fill-yellow-400 text-yellow-400" : ""}`}
                  />
                </button>

                {/* Site icon placeholder. Keep the fallback in the same
                    row-relative box and remove it when the favicon loads so
                    it cannot drift into the next scrolled row. */}
                <div className="site-selector-icon relative w-9 h-9 rounded border bg-muted/60 flex items-center justify-center shrink-0 overflow-hidden">
                  <img
                    src={`${site.baseUrl}/favicon.ico`}
                    alt=""
                    className="w-5 h-5 object-contain"
                    onLoad={(e) => {
                      const icon = e.currentTarget.parentElement;
                      icon?.classList.add("has-favicon");
                    }}
                    onError={(e) => {
                      const image = e.currentTarget as HTMLImageElement;
                      image.style.display = "none";
                      image.parentElement?.classList.remove("has-favicon");
                    }}
                  />
                  <Globe
                    aria-hidden="true"
                    className="site-selector-fallback-icon pointer-events-none absolute inset-0 m-auto w-4 h-4 text-muted-foreground"
                  />
                </div>

                {/* Name + URL */}
                <div className="flex-1 min-w-0">
                  <div
                    className={`text-sm font-medium leading-tight truncate ${isActive ? "text-primary" : ""}`}
                  >
                    {site.name}
                  </div>
                  <div className="text-xs text-muted-foreground truncate leading-tight">
                    {site.baseUrl}
                  </div>
                </div>

                {/* External link */}
                <a
                  href={site.baseUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="shrink-0 text-muted-foreground hover:text-foreground transition-colors p-1 rounded hover:bg-muted"
                  aria-label={`Open ${site.name}`}
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>

                {/* Page count */}
                <span className="w-12 text-right text-sm tabular-nums text-muted-foreground shrink-0">
                  {site.pageCount.toLocaleString()}
                </span>

                {/* Active check */}
                <span className="w-4 shrink-0 flex justify-center">
                  {isActive && <Check className="w-4 h-4 text-primary" />}
                </span>
              </div>
            );
          })}

          {filtered.length === 0 && (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">
              No sites match "{search}"
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

function PageGroupSelector() {
  const { user } = useAuth();
  const { activeSite } = useSite();
  const { selectedGroup, setSelectedGroup, groups, isLoading, isError } = usePageGroup();
  const [open, setOpen] = useState(false);

  // Only show when a site is selected and the user may view the dashboard.
  if (!activeSite) return null;
  if (!user?.permissions?.canViewSiteAccessibilityDashboard) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          disabled={isLoading}
          className="h-auto w-[210px] max-w-full justify-start gap-2 rounded-xl border-border/75 bg-card/70 px-3 py-1.5 text-left shadow-sm backdrop-blur-xl transition-all hover:border-primary/35 hover:bg-card/90 data-[state=open]:border-primary/45 data-[state=open]:ring-4 data-[state=open]:ring-primary/10"
          aria-label={`Filter by page group. Current: ${selectedGroup?.name ?? "All page groups"}`}
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          <Layers className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold leading-tight">
            {isLoading
              ? <span className="flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />Loading…</span>
              : (selectedGroup?.name ?? "All page groups")}
          </span>
          <HeaderChevron />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="center"
        sideOffset={8}
        className="w-[250px] rounded-2xl border-border/80 bg-popover/95 p-1.5 shadow-[0_24px_70px_rgba(15,23,42,0.2)] backdrop-blur-2xl"
        role="listbox"
        aria-label="Page groups"
      >
        <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Page group
        </p>

        {isError ? (
          <p className="px-2.5 py-3 text-xs text-destructive">Failed to load page groups.</p>
        ) : isLoading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />
          </div>
        ) : (
          <>
            <button
              type="button"
              role="option"
              aria-selected={selectedGroup === null}
              className={`flex w-full items-center rounded-xl px-2.5 py-2 text-left text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${selectedGroup === null ? "bg-primary/10 font-semibold text-primary" : ""}`}
              onClick={() => { setSelectedGroup(null); setOpen(false); }}
            >
              All page groups
              {selectedGroup === null && <Check className="ml-auto h-4 w-4" aria-hidden="true" />}
            </button>
            {groups.length > 0 && <div className="my-1 border-t border-border/60" aria-hidden="true" />}
            {groups.map((group) => {
              const isSelected = selectedGroup?.id === group.id;
              return (
                <button
                  key={group.id}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  className={`flex w-full items-center rounded-xl px-2.5 py-2 text-left text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${isSelected ? "bg-primary/10 font-semibold text-primary" : ""}`}
                  onClick={() => { setSelectedGroup(group); setOpen(false); }}
                >
                  <span className="truncate">{group.name}</span>
                  {isSelected && <Check className="ml-auto h-4 w-4 shrink-0" aria-hidden="true" />}
                </button>
              );
            })}
            {groups.length === 0 && (
              <p className="px-2.5 py-3 text-xs text-muted-foreground">
                No page groups have been configured for this site.
              </p>
            )}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

interface NavItemProps {
  href: string;
  icon: React.ReactNode;
  label: string;
  active: boolean;
  collapsed: boolean;
  indent?: boolean;
  badge?: React.ReactNode;
  tourId?: string;
}

function NavItem({
  href,
  icon,
  label,
  active,
  collapsed,
  indent,
  badge,
  tourId,
}: NavItemProps) {
  const tourKey =
    tourId ??
    `nav-${href.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
  const btn = (
    <Button
      variant={active ? "secondary" : "ghost"}
      className={`sidebar-nav-item w-full transition-all duration-200 ${
        collapsed
          ? "justify-center px-0"
          : `justify-start gap-2 ${indent ? "pl-8 h-8 text-[13px]" : ""}`
      }`}
      data-sidebar-active={active ? "true" : "false"}
      asChild
      data-tour={tourKey}
      data-tour-title={label}
      data-tour-description={`Open ${label} from the application navigation.`}
    >
      <Link href={href}>
        {icon}
        {!collapsed && <span className="truncate">{label}</span>}
        {!collapsed && badge}
      </Link>
    </Button>
  );

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{btn}</TooltipTrigger>
        <TooltipContent side="right">{label}</TooltipContent>
      </Tooltip>
    );
  }
  return btn;
}

interface NavGroupProps {
  id: string;
  icon: React.ReactNode;
  label: string;
  active: boolean;
  collapsed: boolean;
  defaultOpen?: boolean;
  fallbackHref?: string;
  children: React.ReactNode;
}

function useGroupOpen(id: string, defaultOpen: boolean, forceOpen: boolean) {
  const key = `sidebar-group-${id}`;
  const [open, setOpen] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored !== null ? stored === "true" : defaultOpen;
    } catch {
      return defaultOpen;
    }
  });

  useEffect(() => {
    if (forceOpen) setOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forceOpen]);

  const toggle = () =>
    setOpen((v) => {
      const next = !v;
      try {
        localStorage.setItem(key, String(next));
      } catch {}
      return next;
    });

  return [open, toggle] as const;
}

function NavGroup({
  id,
  icon,
  label,
  active,
  collapsed,
  defaultOpen = false,
  fallbackHref,
  children,
}: NavGroupProps) {
  const [open, toggle] = useGroupOpen(id, defaultOpen, active);

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={active ? "secondary" : "ghost"}
            className="sidebar-nav-item w-full justify-center px-0"
            asChild
            data-sidebar-active={active ? "true" : "false"}
            data-tour={`menu-${id}`}
            data-tour-title={label}
            data-tour-description={`Open the ${label} navigation menu.`}
          >
            <Link href={fallbackHref ?? "#"}>{icon}</Link>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">{label}</TooltipContent>
      </Tooltip>
    );
  }

  const contentId = `sidebar-group-content-${id}`;

  return (
    <div role="group" aria-label={label}>
      <Button
        variant="ghost"
        onClick={toggle}
          className="sidebar-nav-item w-full justify-start gap-2 font-semibold text-xs uppercase tracking-wider text-muted-foreground hover:text-foreground"
        aria-expanded={open}
        aria-controls={contentId}
        data-tour={`menu-${id}`}
        data-tour-title={label}
        data-tour-description={`Expand or collapse the ${label} navigation menu.`}
      >
        {icon}
        <span className="flex-1 text-left truncate">{label}</span>
        <ChevronDown
          className={`w-3.5 h-3.5 shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </Button>
      {open && (
        <div
          id={contentId}
          role="group"
          aria-label={`${label} items`}
          className="mt-0.5 space-y-0.5 pl-2 border-l border-border/60 ml-3.5"
        >
          {children}
        </div>
      )}
    </div>
  );
}

function QASidebarContent({
  collapsed,
  location,
  onBack,
}: {
  collapsed: boolean;
  location: string;
  onBack: () => void;
}) {
  const { user } = useAuth();
  if (!user?.permissions?.canViewQualityAssurance) return null;
  const dot = (
    <span className="w-1.5 h-1.5 rounded-full bg-current opacity-50 shrink-0 ml-0.5" />
  );
  return (
    <div className="space-y-1">
      {!collapsed ? (
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2 text-muted-foreground hover:text-foreground font-normal mb-1 h-8 text-sm"
          onClick={onBack}
        >
          <ChevronLeft className="w-3.5 h-3.5 shrink-0" />
          Back to main menu
        </Button>
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="w-full flex justify-center mb-1 h-8"
              onClick={onBack}
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">Back to main menu</TooltipContent>
        </Tooltip>
      )}
      {!collapsed && (
        <div className="flex items-center gap-2 px-2 py-1 mb-1 border-b border-border/40 pb-2">
          <ClipboardCheck className="w-4 h-4 text-primary shrink-0" />
          <span className="text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/70">
            Quality Assurance
          </span>
        </div>
      )}
      <NavItem
        href="/quality-assurance"
        icon={<ClipboardCheck className="w-4 h-4 shrink-0" />}
        label="Overview"
        active={location === "/quality-assurance"}
        collapsed={collapsed}
      />
      <NavItem
        href="/quality-assurance/priority-pages"
        icon={<Flag className="w-4 h-4 shrink-0" />}
        label="Priority pages"
        active={location === "/quality-assurance/priority-pages"}
        collapsed={collapsed}
      />
      <NavItem
        href="/quality-assurance/check-history"
        icon={<History className="w-4 h-4 shrink-0" />}
        label="Check history"
        active={location === "/quality-assurance/check-history"}
        collapsed={collapsed}
      />
      <NavItem
        href="/quality-assurance/single-page-check"
        icon={<Search className="w-4 h-4 shrink-0" />}
        label="Single page check"
        active={location === "/quality-assurance/single-page-check"}
        collapsed={collapsed}
      />
      <NavGroup
        id="qa-inventory"
        icon={<Layers className="w-4 h-4 shrink-0" />}
        label="Inventory"
        active={location.startsWith("/quality-assurance/inventory")}
        collapsed={collapsed}
        fallbackHref="/quality-assurance/inventory"
        defaultOpen={location.startsWith("/quality-assurance/inventory")}
      >
        <NavItem
          href="/quality-assurance/inventory"
          icon={dot}
          label="Summary"
          active={location === "/quality-assurance/inventory"}
          collapsed={collapsed}
          indent
        />
        <NavItem
          href="/quality-assurance/inventory/pages"
          icon={dot}
          label="Pages"
          active={location === "/quality-assurance/inventory/pages"}
          collapsed={collapsed}
          indent
        />
        <NavItem
          href="/quality-assurance/inventory/links"
          icon={dot}
          label="Links"
          active={location === "/quality-assurance/inventory/links"}
          collapsed={collapsed}
          indent
        />
        <NavItem
          href="/quality-assurance/inventory/link-text"
          icon={dot}
          label="Link text"
          active={location === "/quality-assurance/inventory/link-text"}
          collapsed={collapsed}
          indent
        />
        <NavItem
          href="/quality-assurance/inventory/documents"
          icon={dot}
          label="Documents"
          active={location === "/quality-assurance/inventory/documents"}
          collapsed={collapsed}
          indent
        />
        <NavItem
          href="/quality-assurance/inventory/media"
          icon={dot}
          label="Media files"
          active={location === "/quality-assurance/inventory/media"}
          collapsed={collapsed}
          indent
        />
        <NavItem
          href="/quality-assurance/inventory/email"
          icon={dot}
          label="Email addresses"
          active={location === "/quality-assurance/inventory/email"}
          collapsed={collapsed}
          indent
        />
        <NavItem
          href="/quality-assurance/inventory/phones"
          icon={dot}
          label="Phone numbers"
          active={location === "/quality-assurance/inventory/phones"}
          collapsed={collapsed}
          indent
        />
        <NavItem
          href="/quality-assurance/inventory/ssn"
          icon={dot}
          label="Social Security Numbers"
          active={location === "/quality-assurance/inventory/ssn"}
          collapsed={collapsed}
          indent
        />
        <NavItem
          href="/quality-assurance/inventory/javascript"
          icon={dot}
          label="JavaScript files"
          active={location === "/quality-assurance/inventory/javascript"}
          collapsed={collapsed}
          indent
        />
        <NavItem
          href="/quality-assurance/inventory/css"
          icon={dot}
          label="CSS"
          active={location === "/quality-assurance/inventory/css"}
          collapsed={collapsed}
          indent
        />
        <NavItem
          href="/quality-assurance/inventory/meta-tags"
          icon={dot}
          label="Meta tags"
          active={location === "/quality-assurance/inventory/meta-tags"}
          collapsed={collapsed}
          indent
        />
        <NavItem
          href="/quality-assurance/inventory/sitemap"
          icon={dot}
          label="Sitemap"
          active={location === "/quality-assurance/inventory/sitemap"}
          collapsed={collapsed}
          indent
        />
      </NavGroup>
      <NavGroup
        id="qa-issues"
        icon={<AlertTriangle className="w-4 h-4 shrink-0" />}
        label="Issues"
        active={location.startsWith("/quality-assurance/issues")}
        collapsed={collapsed}
        fallbackHref="/quality-assurance/issues"
        defaultOpen={location.startsWith("/quality-assurance/issues")}
      >
        <NavItem
          href="/quality-assurance/issues"
          icon={dot}
          label="Issues"
          active={location === "/quality-assurance/issues"}
          collapsed={collapsed}
          indent
        />
        <NavItem
          href="/quality-assurance/issues/resolved"
          icon={dot}
          label="Resolved issues"
          active={location === "/quality-assurance/issues/resolved"}
          collapsed={collapsed}
          indent
        />
      </NavGroup>
      <NavGroup
        id="qa-links"
        icon={<Link2 className="w-4 h-4 shrink-0" />}
        label="Links"
        active={location.startsWith("/quality-assurance/links")}
        collapsed={collapsed}
        fallbackHref="/quality-assurance/links/broken"
        defaultOpen={location.startsWith("/quality-assurance/links")}
      >
        <NavItem
          href="/quality-assurance/links/overview"
          icon={dot}
          label="Links overview"
          active={location === "/quality-assurance/links/overview"}
          collapsed={collapsed}
          indent
        />
        <NavItem
          href="/quality-assurance/links/broken"
          icon={dot}
          label="Broken links"
          active={location === "/quality-assurance/links/broken"}
          collapsed={collapsed}
          indent
        />
        <NavItem
          href="/quality-assurance/links/pages-with-broken"
          icon={dot}
          label="Pages with broken links"
          active={location === "/quality-assurance/links/pages-with-broken"}
          collapsed={collapsed}
          indent
        />
        <NavItem
          href="/quality-assurance/links/pdfs-broken"
          icon={dot}
          label="PDFs with broken links"
          active={location === "/quality-assurance/links/pdfs-broken"}
          collapsed={collapsed}
          indent
        />
        <NavItem
          href="/quality-assurance/links/broken-in-pdfs"
          icon={dot}
          label="Broken links in PDFs"
          active={location === "/quality-assurance/links/broken-in-pdfs"}
          collapsed={collapsed}
          indent
        />
        <NavItem
          href="/quality-assurance/links/unsafe"
          icon={dot}
          label="Links to unsafe domains"
          active={location === "/quality-assurance/links/unsafe"}
          collapsed={collapsed}
          indent
        />
      </NavGroup>
      <NavGroup
        id="qa-spelling"
        icon={<SpellCheck className="w-4 h-4 shrink-0" />}
        label="Spelling"
        active={location.startsWith("/quality-assurance/spelling")}
        collapsed={collapsed}
        fallbackHref="/quality-assurance/spelling/misspellings"
        defaultOpen={location.startsWith("/quality-assurance/spelling")}
      >
        <NavItem
          href="/quality-assurance/spelling/pages"
          icon={dot}
          label="Pages with misspellings"
          active={location === "/quality-assurance/spelling/pages"}
          collapsed={collapsed}
          indent
        />
        <NavItem
          href="/quality-assurance/spelling/misspellings"
          icon={dot}
          label="Misspellings"
          active={location === "/quality-assurance/spelling/misspellings"}
          collapsed={collapsed}
          indent
        />
        <NavItem
          href="/quality-assurance/spelling/word-inventory"
          icon={dot}
          label="Word inventory"
          active={location === "/quality-assurance/spelling/word-inventory"}
          collapsed={collapsed}
          indent
        />
        <NavItem
          href="/quality-assurance/spelling/decisions"
          icon={dot}
          label="Spelling decisions"
          active={location === "/quality-assurance/spelling/decisions"}
          collapsed={collapsed}
          indent
        />
        <NavItem
          href="/quality-assurance/spelling/progress"
          icon={dot}
          label="Progress and trends"
          active={location === "/quality-assurance/spelling/progress"}
          collapsed={collapsed}
          indent
        />
      </NavGroup>
    </div>
  );
}

type Section =
  | "accessibility"
  | "issues"
  | "quality-assurance"
  | "seo"
  | "admin"
  | "site-management";

function SectionBackButton({
  collapsed,
  onBack,
}: {
  collapsed: boolean;
  onBack: () => void;
}) {
  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="w-full flex justify-center mb-1 h-8"
            onClick={onBack}
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">Back to main menu</TooltipContent>
      </Tooltip>
    );
  }
  return (
    <Button
      variant="ghost"
      size="sm"
      className="w-full justify-start gap-2 text-muted-foreground hover:text-foreground font-normal mb-1 h-8 text-sm"
      onClick={onBack}
    >
      <ChevronLeft className="w-3.5 h-3.5 shrink-0" />
      Back to main menu
    </Button>
  );
}

function getShellBreadcrumb(location: string): {
  parentHref: string;
  parentLabel: string;
  current: string;
} | null {
  const qaLabels: Array<[string, string]> = [
    ["/quality-assurance/links/broken", "Broken links"],
    ["/quality-assurance/links/pages-with-broken", "Pages with broken links"],
    ["/quality-assurance/links/unsafe", "Unsafe links"],
    ["/quality-assurance/links/overview", "Links overview"],
    ["/quality-assurance/inventory/pages", "Pages"],
    ["/quality-assurance/inventory/links", "Links"],
    ["/quality-assurance/inventory/link-text", "Link text"],
    ["/quality-assurance/inventory/documents", "Documents"],
    ["/quality-assurance/inventory/media", "Media files"],
    ["/quality-assurance/inventory/email", "Email addresses"],
    ["/quality-assurance/inventory/phones", "Phone numbers"],
    ["/quality-assurance/inventory/javascript", "JavaScript files"],
    ["/quality-assurance/inventory/css", "CSS"],
    ["/quality-assurance/inventory/meta-tags", "Meta tags"],
    ["/quality-assurance/inventory/sitemap", "Sitemap"],
    ["/quality-assurance/inventory", "Inventory"],
    ["/quality-assurance/issues/resolved", "Resolved issues"],
    ["/quality-assurance/issues", "Issues"],
    ["/quality-assurance/priority-pages", "Priority pages"],
    ["/quality-assurance/check-history", "Check history"],
    ["/quality-assurance/single-page-check", "Single page check"],
    ["/quality-assurance/spelling/word-inventory", "Word inventory"],
    ["/quality-assurance/spelling/pages", "Pages with misspellings"],
    ["/quality-assurance/spelling/misspellings", "Misspellings"],
    ["/quality-assurance/spelling/decisions", "Spelling decisions"],
    ["/quality-assurance/spelling/progress", "Progress and trends"],
    ["/quality-assurance", "Quality Assurance"],
  ];
  const qaMatch = qaLabels.find(([path]) => location === path);
  if (qaMatch) {
    const [path, current] = qaMatch;
    if (path === "/quality-assurance") {
      return { parentHref: "/welcome", parentLabel: "Home", current };
    }
    if (path.startsWith("/quality-assurance/inventory/")) {
      return { parentHref: "/quality-assurance/inventory", parentLabel: "Inventory", current };
    }
    if (path === "/quality-assurance/inventory") {
      return { parentHref: "/quality-assurance", parentLabel: "Quality Assurance", current };
    }
    if (path.startsWith("/quality-assurance/links/")) {
      return { parentHref: "/quality-assurance/links/overview", parentLabel: "Links overview", current };
    }
    if (path.startsWith("/quality-assurance/spelling/")) {
      return { parentHref: "/quality-assurance", parentLabel: "Quality Assurance", current };
    }
    return { parentHref: "/quality-assurance", parentLabel: "Quality Assurance", current };
  }

  const scanReportMatch = location.match(/^\/scans\/([^/]+)\/report$/);
  if (scanReportMatch) {
    return { parentHref: `/scans/${scanReportMatch[1]}`, parentLabel: "Scan details", current: "Report" };
  }
  const scanPageReportMatch = location.match(/^\/scans\/([^/]+)\/pages\/([^/]+)\/report$/);
  if (scanPageReportMatch) {
    return {
      parentHref: `/scans/${scanPageReportMatch[1]}`,
      parentLabel: "Scan details",
      current: "Page report",
    };
  }
  const scanMatch = location.match(/^\/scans\/([^/]+)$/);
  if (scanMatch) {
    return { parentHref: "/scans", parentLabel: "Scan history", current: "Scan details" };
  }
  if (location === "/scans") return { parentHref: "/welcome", parentLabel: "Home", current: "Scan history" };
  if (location === "/compare") return { parentHref: "/scans", parentLabel: "Scan history", current: "Compare scans" };
  if (location === "/documentation") return { parentHref: "/welcome", parentLabel: "Home", current: "Documentation" };
  if (location === "/activity") return { parentHref: "/welcome", parentLabel: "Home", current: "Activity" };
  if (location === "/tickets") return { parentHref: "/welcome", parentLabel: "Home", current: "Tickets" };
  if (location === "/feature-request") return { parentHref: "/tickets", parentLabel: "Support", current: "Feature request" };
  if (location === "/admin/inbox") return { parentHref: "/admin/dashboard", parentLabel: "Admin", current: "Inbox" };

  if (location === "/crawler") return { parentHref: "/welcome", parentLabel: "Home", current: "Crawler" };
  if (location === "/crawler/new") return { parentHref: "/crawler", parentLabel: "Crawler", current: "New crawl" };
  if (location === "/crawler/sites") return { parentHref: "/crawler", parentLabel: "Crawler", current: "Sites" };
  const crawlerSiteManageMatch = location.match(/^\/crawler\/sites\/([^/]+)\/manage$/);
  if (crawlerSiteManageMatch) {
    return { parentHref: "/crawler/sites", parentLabel: "Crawler sites", current: "Site management" };
  }
  const crawlerDetailMatch = location.match(/^\/crawler\/([^/]+)$/);
  if (crawlerDetailMatch && crawlerDetailMatch[1] !== "sites") {
    return { parentHref: "/crawler", parentLabel: "Crawler", current: "Crawl details" };
  }

  const sitePageReportMatch = location.match(/^\/sites\/([^/]+)\/page-report\/([^/]+)$/);
  if (sitePageReportMatch) {
    return {
      parentHref: `/sites/${sitePageReportMatch[1]}`,
      parentLabel: "Accessibility dashboard",
      current: "Page report",
    };
  }
  const siteChildRoutes: Array<[string, string]> = [
    ["compliance/wcag", "WCAG compliance"],
    ["compliance/eaa", "EAA compliance"],
    ["compliance/ada", "ADA compliance"],
  ];
  const siteChildMatch = location.match(/^\/sites\/([^/]+)\/(.+)$/);
  if (siteChildMatch) {
    const route = siteChildRoutes.find(([suffix]) => suffix === siteChildMatch[2]);
    if (route) {
      return {
        parentHref: `/sites/${siteChildMatch[1]}`,
        parentLabel: "Accessibility dashboard",
        current: route[1],
      };
    }
  }

  if (location === "/page-report") return { parentHref: "/scans", parentLabel: "Scan history", current: "Page report" };

  return null;
}

function SectionHeader({
  collapsed,
  icon,
  label,
}: {
  collapsed: boolean;
  icon: React.ReactNode;
  label: string;
}) {
  if (collapsed) return null;
  return (
    <div className="flex items-center gap-2 px-2 py-1 mb-1 border-b border-border/40 pb-2">
      {icon}
      <span className="text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/70">
        {label}
      </span>
    </div>
  );
}

type MainMenuItem = {
  label: string;
  icon: React.ReactNode;
  href: string;
  color: string;
  section?: Section;
  isMenuOnly?: boolean;
  createItems?: {
    label: string;
    href: string;
    description?: string;
    icon?: React.ReactNode;
    keywords?: string[];
  }[];
  flyoutSections: {
    label?: string;
    items: {
      label: string;
      href: string;
      icon?: React.ReactNode;
      badge?: string;
      children?: {
        label: string;
        href: string;
        icon?: React.ReactNode;
        badge?: string;
      }[];
    }[];
  }[];
};

function CollapsedMainMenuItem({
  item,
  active,
  dataTour,
  showFlyout,
  flyoutActive,
  onActivate,
  onDeactivate,
}: {
  item: MainMenuItem;
  active: boolean;
  dataTour: string;
  showFlyout: boolean;
  flyoutActive: boolean;
  onActivate: () => void;
  onDeactivate: () => void;
}) {
  const [flyoutMounted, setFlyoutMounted] = useState(false);
  const [flyoutOpen, setFlyoutOpen] = useState(false);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [createQuery, setCreateQuery] = useState("");
  const [submenuOpen, setSubmenuOpen] = useState<string | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmountTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuKey = item.label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const flyoutId = `sidebar-flyout-${menuKey}`;
  useEffect(() => {
    if (flyoutActive) return;
    if (closeTimer.current) clearTimeout(closeTimer.current);
    if (unmountTimer.current) clearTimeout(unmountTimer.current);
    setFlyoutOpen(false);
    setFlyoutMounted(false);
    setCreateMenuOpen(false);
    setCreateQuery("");
    setSubmenuOpen(null);
  }, [flyoutActive]);

  const openFlyout = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    if (unmountTimer.current) clearTimeout(unmountTimer.current);
    if (!showFlyout) return;

    onActivate();
    setFlyoutMounted(true);
    requestAnimationFrame(() => setFlyoutOpen(true));
  };
  const scheduleClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => {
      setFlyoutOpen(false);
      onDeactivate();
      unmountTimer.current = setTimeout(() => setFlyoutMounted(false), 150);
    }, 160);
  };
  const closeFlyoutImmediately = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    if (unmountTimer.current) clearTimeout(unmountTimer.current);
    setFlyoutOpen(false);
    setFlyoutMounted(false);
    setCreateMenuOpen(false);
    setCreateQuery("");
    setSubmenuOpen(null);
    onDeactivate();
  };

  const matchingCreateItems = (item.createItems ?? []).filter((createItem) => {
    const query = createQuery.trim().toLowerCase();
    if (!query) return true;
    return [createItem.label, createItem.description, ...(createItem.keywords ?? [])]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(query);
  });

  return (
    <div
      className="sidebar-rail-menu relative"
      onMouseEnter={openFlyout}
      onMouseLeave={scheduleClose}
      onFocus={openFlyout}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          scheduleClose();
        }
      }}
    >
      <Button
        variant="ghost"
        className="sidebar-rail-item w-full justify-center px-0"
        asChild={!item.isMenuOnly}
        data-sidebar-active={active ? "true" : "false"}
        data-tour={dataTour}
        data-tour-title={item.label}
        data-tour-description={`Open the ${item.label} area of the application.`}
        aria-label={`Open ${item.label} menu`}
        aria-haspopup="menu"
        aria-expanded={showFlyout && flyoutActive && flyoutOpen}
        aria-controls={flyoutId}
        ref={triggerRef}
        onClick={
          item.isMenuOnly
            ? (event) => {
                event.preventDefault();
                if (flyoutActive && flyoutOpen) {
                  closeFlyoutImmediately();
                } else {
                  openFlyout();
                }
              }
            : undefined
        }
      >
        {item.isMenuOnly ? (
          <span className={`sidebar-rail-icon ${item.color}`}>{item.icon}</span>
        ) : (
          <Link href={item.href}>
            <span className={`sidebar-rail-icon ${item.color}`}>{item.icon}</span>
          </Link>
        )}
      </Button>
      {showFlyout && flyoutActive && flyoutMounted && (
        <div
          className={`sidebar-flyout ${item.isMenuOnly ? "sidebar-flyout-main-menu" : ""} ${flyoutOpen ? "is-open" : "is-closing"}`}
          id={flyoutId}
          role="menu"
          aria-label={`${item.label} menu`}
          onMouseEnter={openFlyout}
          onMouseLeave={scheduleClose}
          onFocus={openFlyout}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              closeFlyoutImmediately();
              triggerRef.current?.focus();
            }
          }}
        >
          <div className="sidebar-flyout-header">
            <div className="sidebar-flyout-heading">
              <span className="sidebar-flyout-heading-icon">{item.icon}</span>
              <span>{item.label}</span>
            </div>
            {item.createItems && item.createItems.length > 0 && (
              <div className="relative shrink-0">
                <button
                  type="button"
                  className="sidebar-flyout-create"
                  aria-haspopup="menu"
                  aria-expanded={createMenuOpen}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setCreateMenuOpen((open) => !open);
                    setCreateQuery("");
                  }}
                >
                  <Plus className="h-4 w-4" />
                  Create
                </button>
                {createMenuOpen && (
                  <div
                    className="sidebar-flyout-create-menu"
                    role="menu"
                    aria-label="Create"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <div className="sidebar-flyout-create-search">
                      <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <Input
                        autoFocus
                        value={createQuery}
                        onChange={(event) => setCreateQuery(event.target.value)}
                        placeholder="Choose an action"
                        aria-label="Search create actions"
                      />
                    </div>
                    <div className="sidebar-flyout-create-label">Create</div>
                    {matchingCreateItems.length > 0 ? (
                      matchingCreateItems.map((createItem) => (
                        <Link
                          key={createItem.href}
                          href={createItem.href}
                          role="menuitem"
                          className="sidebar-flyout-create-item"
                          onClick={closeFlyoutImmediately}
                        >
                          <span className="sidebar-flyout-create-item-icon">
                            {createItem.icon ?? <Plus className="h-4 w-4" />}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate">{createItem.label}</span>
                            {createItem.description && (
                              <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                                {createItem.description}
                              </span>
                            )}
                          </span>
                        </Link>
                      ))
                    ) : (
                      <div className="px-4 py-4 text-sm text-muted-foreground">
                        No actions found
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="sidebar-flyout-body">
            {item.flyoutSections.map((section, sectionIndex) => (
              <div
                key={`${item.label}-section-${section.label ?? sectionIndex}`}
                className="sidebar-flyout-section"
              >
                {section.label && (
                  <div className="sidebar-flyout-section-label">{section.label}</div>
                )}
                {section.items.map((subItem) => {
                  const hasChildren = Boolean(subItem.children?.length);
                  if (!hasChildren) {
                    return (
                      <Link
                        key={`${item.label}-${subItem.href}`}
                        href={subItem.href}
                        role="menuitem"
                        className="sidebar-flyout-item"
                        onClick={closeFlyoutImmediately}
                      >
                        <span className="sidebar-flyout-item-leading">
                          {subItem.icon ?? <Activity className="h-4 w-4" />}
                          <span>{subItem.label}</span>
                          {subItem.badge && (
                            <span className="sidebar-flyout-badge">{subItem.badge}</span>
                          )}
                        </span>
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
                      </Link>
                    );
                  }

                  const nestedOpen = submenuOpen === subItem.label;
                  const submenuId = `${menuKey}-${subItem.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-submenu`;
                  return (
                    <div
                      key={`${item.label}-${subItem.label}`}
                      className="sidebar-flyout-nested"
                      onMouseEnter={item.isMenuOnly ? undefined : () => setSubmenuOpen(subItem.label)}
                      onMouseLeave={item.isMenuOnly ? undefined : () => setSubmenuOpen(null)}
                      onFocus={item.isMenuOnly ? undefined : () => setSubmenuOpen(subItem.label)}
                    >
                      <button
                        type="button"
                        role="menuitem"
                        className="sidebar-flyout-item w-full"
                        aria-haspopup="menu"
                        aria-expanded={nestedOpen}
                        aria-controls={submenuId}
                        aria-label={`${subItem.label} submenu`}
                        onClick={() => setSubmenuOpen((current) => current === subItem.label ? null : subItem.label)}
                      >
                        <span className="sidebar-flyout-item-leading">
                          {subItem.icon ?? <Activity className="h-4 w-4" />}
                          <span>{subItem.label}</span>
                        </span>
                        {nestedOpen ? (
                          <ChevronDown
                            className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50"
                            aria-hidden="true"
                          />
                        ) : (
                          <ChevronRight
                            className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50"
                            aria-hidden="true"
                          />
                        )}
                      </button>
                      {nestedOpen && (
                        <div
                          className={`sidebar-flyout-nested-menu ${item.isMenuOnly ? "is-inline" : ""}`}
                          id={submenuId}
                          role="menu"
                          aria-label={`${subItem.label} submenu`}
                          hidden={!nestedOpen}
                        >
                          {subItem.children!.map((child) => (
                            <Link
                              key={`${subItem.label}-${child.href}`}
                              href={child.href}
                              role="menuitem"
                              className="sidebar-flyout-item"
                              onClick={closeFlyoutImmediately}
                            >
                              <span className="sidebar-flyout-item-leading">
                                {child.icon ?? <Activity className="h-4 w-4" />}
                                <span>{child.label}</span>
                                {child.badge && (
                                  <span className="sidebar-flyout-badge">{child.badge}</span>
                                )}
                              </span>
                              <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
                            </Link>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
                {sectionIndex < item.flyoutSections.length - 1 && (
                  <div className="sidebar-flyout-divider" />
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MainMenuContent({
  collapsed,
  adminUser,
  canManageSites,
  location,
  showFlyouts = collapsed,
  onSelectSection,
}: {
  collapsed: boolean;
  adminUser: boolean;
  canManageSites: boolean;
  location: string;
  showFlyouts?: boolean;
  onSelectSection?: (section: Section) => void;
}) {
  const { user } = useAuth();
  const { activeSite } = useSite();
  const canManageProjects =
    user != null &&
    (user.permissions?.canCreateProject !== false ||
      user.permissions?.canDeleteProject !== false);
  const canViewCrawlHistory = user?.permissions?.canViewCrawlHistory ?? false;
  const urlSiteId = location.match(/^\/sites\/(\d+)/)?.[1];
  const accessibilityOverviewHref = activeSite?.id
    ? `/sites/${activeSite.id}`
    : urlSiteId
      ? `/sites/${urlSiteId}`
      : "/crawler/sites";
  const pageGroupsHref = activeSite?.id
    ? `/sites/${activeSite.id}/page-groups`
    : urlSiteId
      ? `/sites/${urlSiteId}/page-groups`
      : "/crawler/sites";
  const [activeFlyout, setActiveFlyout] = useState<string | null>(null);
  const activeFlyoutTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mainItems: MainMenuItem[] = [
    {
      label: "Accessibility",
      icon: <Accessibility className="w-5 h-5 shrink-0" />,
      href: "/scans",
      color: "text-blue-500",
      section: "accessibility",
      flyoutSections: [
        {
          items: [
            { label: "Overview", href: accessibilityOverviewHref, icon: <LayoutDashboard className="h-4 w-4" /> },
            { label: "Activity", href: "/activity", icon: <Activity className="h-4 w-4" /> },
              ...(user?.permissions?.canViewSiteAccessibilityDashboard && (activeSite?.id || urlSiteId)
                ? [{ label: "Page Groups", href: pageGroupsHref, icon: <Layers className="h-4 w-4" /> }]
                : []),
          ],
        },
        {
          label: "Manual scanning",
          items: [
            { label: "New Scan", href: "/new", icon: <Plus className="h-4 w-4" /> },
            { label: "Scan History", href: "/scans", icon: <History className="h-4 w-4" /> },
            { label: "Compare Scans", href: "/compare", icon: <GitCompare className="h-4 w-4" /> },
          ],
        },
        {
          label: "Crawler scanning",
          items: [
            ...(user?.permissions?.canCreateCrawl
              ? [{ label: "New crawler scan", href: "/crawler/new", icon: <Plus className="h-4 w-4" /> }]
              : []),
            ...(user?.permissions?.canViewCrawlHistory
              ? [{ label: "Crawler Scan History", href: "/crawler", icon: <Globe className="h-4 w-4" /> }]
              : []),
            ...(canManageSites
              ? [{ label: "Manage Sites", href: "/crawler/sites", icon: <Building2 className="h-4 w-4" /> }]
              : []),
          ],
        },
      ],
    },
    ...(user?.permissions?.canViewIssues ? [{
      label: "Issues",
      icon: <ListTodo className="w-5 h-5 shrink-0" />,
      href: "/issues",
      color: "text-amber-500",
      section: "issues" as Section,
      flyoutSections: [{
        items: [
          { label: "All issues", href: "/issues", icon: <ListTodo className="h-4 w-4" /> },
          { label: "Create issue", href: "/issues?create=1", icon: <Plus className="h-4 w-4" /> },
        ],
      }],
    }] : []),
    ...(user?.permissions?.canViewQualityAssurance ? [{
      label: "Quality Assurance",
      icon: <ClipboardCheck className="w-5 h-5 shrink-0" />,
      href: "/quality-assurance",
      color: "text-violet-500",
      section: "quality-assurance" as Section,
      flyoutSections: [
        {
          items: [
            { label: "Overview", href: "/quality-assurance", icon: <ClipboardCheck className="h-4 w-4" /> },
            { label: "Priority Pages", href: "/quality-assurance/priority-pages", icon: <Star className="h-4 w-4" /> },
            { label: "Check History", href: "/quality-assurance/check-history", icon: <History className="h-4 w-4" /> },
            { label: "Single Page Check", href: "/quality-assurance/single-page-check", icon: <Search className="h-4 w-4" /> },
          ],
        },
        {
          label: "Inventory",
          items: [
            { label: "Content Inventory", href: "/quality-assurance/inventory", icon: <Layers className="h-4 w-4" /> },
            { label: "Broken Links", href: "/quality-assurance/links/broken", icon: <Link2 className="h-4 w-4" /> },
          ],
        },
      ],
    }] : []),
    //  { label: "SEO", icon: <Search className="w-5 h-5 shrink-0" />, href: "/seo", color: "text-emerald-500" },*/}
    ...(adminUser
      ? [
          {
            label: "Admin Settings",
            icon: <ShieldCheck className="w-5 h-5 shrink-0" />,
            href: "/admin/dashboard",
            color: "text-amber-500",
            section: "admin" as Section,
            flyoutSections: [
              {
                items: [
                  { label: "Inbox", href: "/admin/inbox", icon: <Inbox className="h-4 w-4" /> },
                  { label: "Dashboard", href: "/admin/dashboard", icon: <LayoutDashboard className="h-4 w-4" /> },
                  { label: "Users", href: "/admin/users", icon: <Users className="h-4 w-4" /> },
                  { label: "Groups", href: "/admin/groups", icon: <UsersRound className="h-4 w-4" /> },
                  { label: "Settings", href: "/admin/settings", icon: <Settings className="h-4 w-4" /> },
                ],
              },
              {
                label: "Access control",
                items: [
                  { label: "Permissions", href: "/admin/permissions", icon: <ShieldCheck className="h-4 w-4" /> },
                  { label: "Site manager", href: "/admin/site-manager", icon: <Building2 className="h-4 w-4" /> },
                ],
              },
            ],
          },
        ]
      : []),
    ...(canManageSites || canManageProjects
      ? [
          {
            label: "Site Management",
            icon: <Building2 className="w-5 h-5 shrink-0" />,
            href: canManageSites ? "/crawler/sites" : "/projects",
            color: "text-amber-500",
            section: "site-management" as Section,
            flyoutSections: [
              {
                items: [
                  ...(canManageSites
                    ? [{ label: "Manage Sites", href: "/crawler/sites", icon: <Building2 className="h-4 w-4" /> }]
                    : []),
                  ...(canManageProjects
                    ? [{ label: "Manage Projects", href: "/projects", icon: <FolderOpen className="h-4 w-4" /> }]
                    : []),
                  ...(canManageSites
                    ? [{ label: "Manage Crawl", href: "/crawler/manage", icon: <Globe className="h-4 w-4" /> }]
                    : []),
                  ...(canViewCrawlHistory
                    ? [{ label: "Crawler Scan History", href: "/crawler", icon: <History className="h-4 w-4" /> }]
                    : []),
                ],
              },
            ],
          },
        ]
      : []),
  ];
  const homeItem: MainMenuItem = {
    label: "Main menu",
    icon: <Menu className="w-5 h-5 shrink-0" />,
    href: "/welcome",
    color: "text-slate-500",
    isMenuOnly: true,
    createItems: [
      {
        label: "New manual scan",
        href: "/new",
        description: "Run an accessibility scan",
        icon: <Accessibility className="h-4 w-4" />,
        keywords: ["new scan", "manual scan", "accessibility"],
      },
      ...(user?.permissions?.canCreateCrawl
        ? [{
            label: "New crawler scan",
            href: "/crawler/new",
            description: "Discover and scan a site",
            icon: <Globe className="h-4 w-4" />,
            keywords: ["new crawler", "crawler scan", "scan site"],
          }]
        : []),
      ...(canManageSites
        ? [{
            label: "New site",
            href: "/crawler/sites?create=1",
            description: "Add a site for crawler scans",
            icon: <Building2 className="h-4 w-4" />,
            keywords: ["new site", "add site", "crawler"],
          }]
        : []),
      ...(adminUser
        ? [
            {
              label: "New user",
              href: "/admin/users?create=1",
              description: "Add a user account",
              icon: <UserRound className="h-4 w-4" />,
              keywords: ["new user", "add user", "invite user"],
            },
            {
              label: "New group",
              href: "/admin/groups?create=1",
              description: "Create a user group",
              icon: <UsersRound className="h-4 w-4" />,
              keywords: ["new group", "add group", "user group"],
            },
          ]
        : []),
      ...(user?.permissions?.canCreateIssue ? [{
        label: "New issue",
        href: "/issues?create=1",
        description: "Create a task, story, or bug for your team",
        icon: <ListTodo className="h-4 w-4" />,
        keywords: ["new issue", "task", "story", "bug", "work item"],
      }] : []),
      {
        label: "New support ticket",
        href: "/tickets?create=1",
        description: "Ask for help from support",
        icon: <TicketCheck className="h-4 w-4" />,
        keywords: ["new support ticket", "new ticket", "support", "help"],
      },
      {
        label: "Feature request",
        href: "/feature-request",
        description: "Suggest a new feature or improvement",
        icon: <Lightbulb className="h-4 w-4" />,
        keywords: ["feature request", "suggestion", "idea", "improve"],
      },
    ],
    flyoutSections: [
      {
        items: mainItems.map((item) => ({
          label: item.label,
          href: item.href,
          icon: item.icon,
          children: item.flyoutSections.flatMap((section) => section.items),
        })),
      },
    ],
  };
  const items = [homeItem, ...mainItems];

  const activateFlyout = (label: string) => {
    if (activeFlyoutTimer.current) clearTimeout(activeFlyoutTimer.current);
    setActiveFlyout(label);
  };

  const deactivateFlyout = (label: string) => {
    if (activeFlyoutTimer.current) clearTimeout(activeFlyoutTimer.current);
    activeFlyoutTimer.current = setTimeout(() => {
      setActiveFlyout((current) => (current === label ? null : current));
    }, 160);
  };

  if (collapsed) {
    return (
      <div className="space-y-1.5">
        {items.map((item) => {
            const active =
              item.isMenuOnly
                ? false
              : item.href === "/scans"
              ? location.startsWith("/scans") ||
                location === "/new" ||
                location.startsWith("/compare") ||
                location.startsWith("/crawler") ||
                location.startsWith("/sites/")
              : item.href === "/quality-assurance"
                ? location.startsWith("/quality-assurance")
              : item.href === "/admin/dashboard"
                  ? location.startsWith("/admin")
                  : item.href === "/crawler/sites"
                    ? location.startsWith("/crawler/sites") || location === "/projects"
                    : false;
          return (
            <CollapsedMainMenuItem
              key={item.label}
              item={item}
              active={active}
              dataTour={`main-${item.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
              showFlyout={showFlyouts}
              flyoutActive={activeFlyout === item.label}
              onActivate={() => activateFlyout(item.label)}
              onDeactivate={() => deactivateFlyout(item.label)}
            />
          );
        })}
      </div>
    );
  }

  return (
    <div className="space-y-0.5">
      {mainItems.map((item) => (
        <Button
          key={item.label}
          variant="ghost"
          className="sidebar-nav-item w-full justify-start gap-3 h-10 px-3 text-sm font-medium rounded-lg"
          asChild
          data-sidebar-active={
            item.href === "/scans"
              ? (location.startsWith("/scans") ||
                  location === "/new" ||
                  location.startsWith("/compare") ||
                  location.startsWith("/crawler") ||
                  location.startsWith("/sites/")) ? "true" : "false"
              : item.href === "/admin/dashboard"
                ? location.startsWith("/admin") ? "true" : "false"
                : item.href === "/crawler/sites"
                  ? location.startsWith("/crawler/sites") || location === "/projects" ? "true" : "false"
                  : "false"
          }
          data-tour={`main-${item.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
          data-tour-title={item.label}
          data-tour-description={`Open the ${item.label} area of the application.`}
        >
          <Link
            href={item.href}
            onClick={() => {
              if (!collapsed && item.section) onSelectSection?.(item.section);
            }}
          >
            <span className={item.color}>{item.icon}</span>
            <span className="flex-1 text-left">{item.label}</span>
            <ChevronRight className="w-4 h-4 text-muted-foreground/50 shrink-0" />
          </Link>
        </Button>
      ))}
    </div>
  );
}

function AccessibilitySidebarContent({
  collapsed,
  location,
  adminUser,
  showSiteNav,
  effectiveSiteId,
  onBack,
}: {
  collapsed: boolean;
  location: string;
  adminUser: boolean;
  showSiteNav: boolean;
  effectiveSiteId: number | undefined;
  onBack: () => void;
}) {
  const dot = (
    <span className="w-1.5 h-1.5 rounded-full bg-current opacity-50 shrink-0 ml-0.5" />
  );
  const { activeSite: dropdownSite } = useSite();
  const { user } = useAuth();
  const canCreateCrawl = user?.permissions?.canCreateCrawl ?? false;
  const canManageSites = user?.permissions?.canManageSites ?? false;
  const canManageProjects =
    user != null &&
    (user.permissions?.canCreateProject !== false ||
      user.permissions?.canDeleteProject !== false);
  const canViewCrawlHistory = user?.permissions?.canViewCrawlHistory ?? false;
  const canViewSiteAccessibilityDashboard =
    user?.permissions?.canViewSiteAccessibilityDashboard ?? false;
  // Overview uses the dropdown-selected site first, then falls back to URL-derived ID (for non-admin users)
  const overviewSiteId = dropdownSite?.id ?? effectiveSiteId;
  const siteDashboardHref =
    overviewSiteId !== undefined ? `/sites/${overviewSiteId}` : null;
  const sitePageGroupsHref =
    effectiveSiteId !== undefined
      ? `/sites/${effectiveSiteId}/page-groups`
      : "/crawler/sites";
  const siteIssuesHref =
    effectiveSiteId !== undefined
      ? `/sites/${effectiveSiteId}/issues`
      : "/crawler/sites";
  const sitePotentialIssuesHref =
    effectiveSiteId !== undefined
      ? `/sites/${effectiveSiteId}/potential-issues`
      : "/crawler/sites";
  const siteComplianceWcagHref =
    effectiveSiteId !== undefined
      ? `/sites/${effectiveSiteId}/compliance/wcag`
      : "/crawler/sites";
  const siteComplianceEaaHref =
    effectiveSiteId !== undefined
      ? `/sites/${effectiveSiteId}/compliance/eaa`
      : "/crawler/sites";
  const siteComplianceAdaHref =
    effectiveSiteId !== undefined
      ? `/sites/${effectiveSiteId}/compliance/ada`
      : "/crawler/sites";
  const onSiteDashboard =
    location.startsWith("/sites/") &&
    effectiveSiteId !== undefined &&
    location.startsWith(`/sites/${effectiveSiteId}`);
  const onSiteDashboardExact =
    onSiteDashboard && location === siteDashboardHref;
  const onSitePageGroups = onSiteDashboard && location === sitePageGroupsHref;
  const onSiteIssues = onSiteDashboard && location === siteIssuesHref;
  const onSitePotentialIssues =
    onSiteDashboard && location === sitePotentialIssuesHref;
  const onSiteComplianceWcag =
    onSiteDashboard && location === siteComplianceWcagHref;
  const onSiteComplianceEaa =
    onSiteDashboard && location === siteComplianceEaaHref;
  const onSiteComplianceAda =
    onSiteDashboard && location === siteComplianceAdaHref;
  const issuesActive = onSiteIssues || onSitePotentialIssues;
  const complianceActive =
    onSiteComplianceWcag || onSiteComplianceEaa || onSiteComplianceAda;
  const manualScanActive =
    location === "/new" ||
    location === "/advanced" ||
    location.startsWith("/scans") ||
    location.startsWith("/compare");
  const crawlerScanActive =
    location.startsWith("/crawler/new") ||
    location.startsWith("/crawler/sites") ||
    (location.startsWith("/crawler") && !location.startsWith("/crawler/sites"));

  return (
    <div className="space-y-1">
      <SectionBackButton collapsed={collapsed} onBack={onBack} />
      <SectionHeader
        collapsed={collapsed}
        icon={<Accessibility className="w-4 h-4 text-primary shrink-0" />}
        label="Accessibility"
      />
      {siteDashboardHref !== null && canViewSiteAccessibilityDashboard && (
        <NavItem
          href={siteDashboardHref}
          icon={<LayoutDashboard className="w-3.5 h-3.5 shrink-0" />}
          label="Overview"
          active={onSiteDashboardExact}
          collapsed={collapsed}
        />
      )}
      {showSiteNav && canViewSiteAccessibilityDashboard && (
        <>
          <NavGroup
            id="acc-issues"
            icon={<AlertCircle className="w-3.5 h-3.5 shrink-0" />}
            label="Issues"
            active={issuesActive}
            collapsed={collapsed}
            defaultOpen={issuesActive}
          >
            <NavItem
              href={siteIssuesHref}
              icon={dot}
              label="Issues"
              active={onSiteIssues}
              collapsed={collapsed}
              indent
            />
            <NavItem
              href={sitePotentialIssuesHref}
              icon={dot}
              label="Potential Issues"
              active={onSitePotentialIssues}
              collapsed={collapsed}
              indent
            />
          </NavGroup>
          <NavGroup
            id="acc-compliance"
            icon={<FileCheck2 className="w-3.5 h-3.5 shrink-0" />}
            label="Compliance"
            active={complianceActive}
            collapsed={collapsed}
            defaultOpen={complianceActive}
          >
            <NavItem
              href={siteComplianceWcagHref}
              icon={dot}
              label="WCAG guidelines"
              active={onSiteComplianceWcag}
              collapsed={collapsed}
              indent
            />
            <NavItem
              href={siteComplianceEaaHref}
              icon={dot}
              label="European Accessibility Act"
              active={onSiteComplianceEaa}
              collapsed={collapsed}
              indent
            />
            <NavItem
              href={siteComplianceAdaHref}
              icon={dot}
              label="ADA Title II"
              active={onSiteComplianceAda}
              collapsed={collapsed}
              indent
            />
          </NavGroup>
        </>
      )}
      {canManageProjects && (
        <NavItem
          href="/projects"
          icon={<FolderOpen className="w-3.5 h-3.5 shrink-0" />}
          label="Manage Projects"
          active={location === "/projects"}
          collapsed={collapsed}
        />
      )}
      <NavItem
        href="/activity"
        icon={<Activity className="w-3.5 h-3.5 shrink-0" />}
        label="Activity"
        active={location === "/activity"}
        collapsed={collapsed}
      />
      {showSiteNav && canViewSiteAccessibilityDashboard && (
        <NavItem
          href={sitePageGroupsHref}
          icon={<Layers className="w-3.5 h-3.5 shrink-0" />}
          label="Page Groups"
          active={onSitePageGroups}
          collapsed={collapsed}
        />
      )}
      <NavGroup
        id="manual-scan"
        icon={<Plus className="w-3.5 h-3.5 shrink-0" />}
        label="Manual Scan"
        active={manualScanActive}
        collapsed={collapsed}
        defaultOpen={manualScanActive}
      >
        <NavItem
          href="/new"
          icon={dot}
          label="New Scan"
          active={location === "/new"}
          collapsed={collapsed}
          indent
        />
        <NavItem
          href="/scans"
          icon={dot}
          label="Scan History"
          active={location.startsWith("/scans")}
          collapsed={collapsed}
          indent
        />
        {/*  <NavItem
          href="/advanced"
          icon={dot}
          label="Advanced Scan"
          active={location.startsWith("/advanced")}
          collapsed={collapsed}
          indent
        />*/}
        <NavItem
          href="/compare"
          icon={dot}
          label="Compare Scans"
          active={location.startsWith("/compare")}
          collapsed={collapsed}
          indent
        />
      </NavGroup>
      {(canCreateCrawl || canViewCrawlHistory || canManageSites || adminUser) && (
        <NavGroup
          id="crawler-scan"
          icon={<Globe className="w-3.5 h-3.5 shrink-0" />}
          label="Crawler Scan"
          active={crawlerScanActive}
          collapsed={collapsed}
          defaultOpen={crawlerScanActive}
        >
          {canCreateCrawl && (
            <NavItem
              href="/crawler/new"
              icon={dot}
              label="New Scan"
              active={location === "/crawler/new"}
              collapsed={collapsed}
              indent
            />
          )}
          {canViewCrawlHistory && (
            <NavItem
              href="/crawler"
              icon={dot}
              label="Crawler Scan History"
              active={
                location.startsWith("/crawler") &&
                !location.startsWith("/crawler/new") &&
                !location.startsWith("/crawler/sites")
              }
              collapsed={collapsed}
              indent
            />
          )}
          {canManageSites && (
            <NavItem
              href="/crawler/sites"
              icon={dot}
              label="Manage Sites"
              active={location.startsWith("/crawler/sites")}
              collapsed={collapsed}
              indent
            />
          )}
          {adminUser && (
            <NavItem
              href="/crawler/manage"
              icon={dot}
              label="Manage Crawl"
              active={location === "/crawler/manage" || location.startsWith("/crawler/sites/")}
              collapsed={collapsed}
              indent
            />
          )}
        </NavGroup>
      )}
    </div>
  );
}

function SEOSidebarContent({
  collapsed,
  location,
  onBack,
}: {
  collapsed: boolean;
  location: string;
  onBack: () => void;
}) {
  return (
    <div className="space-y-1">
      <SectionBackButton collapsed={collapsed} onBack={onBack} />
      <SectionHeader
        collapsed={collapsed}
        icon={<Search className="w-4 h-4 text-primary shrink-0" />}
        label="SEO"
      />
      <NavItem
        href="/seo"
        icon={<Search className="w-4 h-4 shrink-0" />}
        label="Overview"
        active={location === "/seo"}
        collapsed={collapsed}
      />
    </div>
  );
}

function AdminSidebarContent({
  collapsed,
  location,
  adminUser,
  superAdminUser,
  canManageSites,
  canManageProjects = false,
  onBack,
}: {
  collapsed: boolean;
  location: string;
  adminUser: boolean;
  superAdminUser: boolean;
  canManageSites: boolean;
  canManageProjects?: boolean;
  onBack: () => void;
}) {
  const dot = (
    <span className="w-1.5 h-1.5 rounded-full bg-current opacity-50 shrink-0 ml-0.5" />
  );
  const usersGroupActive =
    location === "/admin/users" || location === "/admin/groups";
  return (
    <div className="space-y-1">
      <SectionBackButton collapsed={collapsed} onBack={onBack} />
      <SectionHeader
        collapsed={collapsed}
        icon={
          adminUser ? (
            <ShieldCheck className="w-4 h-4 text-primary shrink-0" />
          ) : (
            <Building2 className="w-4 h-4 text-primary shrink-0" />
          )
        }
        label={adminUser ? "Admin Settings" : "Site Management"}
      />
      {adminUser && (
        <NavItem
          href="/admin/inbox"
          icon={<Inbox className="w-4 h-4 shrink-0" />}
          label="Inbox"
          active={location === "/admin/inbox"}
          collapsed={collapsed}
        />
      )}
      {adminUser && (
        <NavItem
          href="/admin/dashboard"
          icon={<ShieldCheck className="w-4 h-4 shrink-0" />}
          label="Admin Dashboard"
          active={location === "/admin/dashboard"}
          collapsed={collapsed}
        />
      )}
      {(superAdminUser || canManageSites) && (
        <NavItem
          href="/crawler/sites"
          icon={<Building2 className="w-4 h-4 shrink-0" />}
          label="Manage Sites"
          active={location.startsWith("/crawler/sites")}
          collapsed={collapsed}
        />
      )}
      {canManageProjects && (
        <NavItem
          href="/projects"
          icon={<FolderOpen className="w-4 h-4 shrink-0" />}
          label="Manage Projects"
          active={location === "/projects"}
          collapsed={collapsed}
        />
      )}
      {adminUser && (
        <NavItem
          href="/admin/site-manager"
          icon={<UsersRound className="w-4 h-4 shrink-0" />}
          label="Site Manager"
          active={location === "/admin/site-manager"}
          collapsed={collapsed}
        />
      )}
      {adminUser && (
        <NavGroup
          id="admin-users"
          icon={<Users className="w-4 h-4 shrink-0" />}
          label="Users"
          active={usersGroupActive}
          collapsed={collapsed}
          defaultOpen={usersGroupActive}
        >
          <NavItem
            href="/admin/users"
            icon={dot}
            label="User Management"
            active={location === "/admin/users"}
            collapsed={collapsed}
            indent
          />
          <NavItem
            href="/admin/groups"
            icon={dot}
            label="User Groups"
            active={location === "/admin/groups"}
            collapsed={collapsed}
            indent
          />
        </NavGroup>
      )}
      {superAdminUser && (
        <NavItem
          href="/admin/permissions"
          icon={<KeyRound className="w-4 h-4 shrink-0" />}
          label="Permissions"
          active={location === "/admin/permissions"}
          collapsed={collapsed}
        />
      )}
      {superAdminUser && (
        <NavItem
          href="/admin/settings"
          icon={<Settings className="w-4 h-4 shrink-0" />}
          label="System Settings"
          active={location === "/admin/settings"}
          collapsed={collapsed}
        />
      )}
    </div>
  );
}

interface AppNotif {
  id: number;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  actorName: string | null;
  createdAt: string;
  isRead: boolean;
}

function notifTimeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function Layout({ children }: { children: React.ReactNode }) {
  const [location, navigate] = useLocation();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [updatesOpen, setUpdatesOpen] = useState(false);
  const [sidebarSearch, setSidebarSearch] = useState("");
  const [collapsed, toggleCollapsed] = useSidebarCollapsed();
  const { user, logout } = useAuth();
  const adminUser = isAdmin(user);
  const superAdminUser = user?.role === "super_admin";
  const canManageSites = user?.permissions?.canManageSites ?? false;

  // ── Notifications ─────────────────────────────────────────────────
  const [notifs, setNotifs] = useState<AppNotif[]>([]);
  const [notifLoading, setNotifLoading] = useState(false);
  const [notifClearing, setNotifClearing] = useState(false);

  useEffect(() => {
    if (!user) {
      setNotifs([]);
      return;
    }
    async function loadNotifs(quiet = false) {
      if (!quiet) setNotifLoading(true);
      try {
        const res = await fetch(`${BASE}/api/notifications`, { credentials: "include" });
        if (res.ok) setNotifs(await res.json());
      } catch {}
      if (!quiet) setNotifLoading(false);
    }
    loadNotifs();
    const id = setInterval(() => loadNotifs(true), 30_000);
    return () => clearInterval(id);
  }, [user?.id]);

  async function markOneRead(id: number) {
    try {
      await fetch(`${BASE}/api/notifications/${id}/read`, { method: "PUT", credentials: "include" });
      setNotifs((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
    } catch {}
  }

  async function markAllRead() {
    try {
      await fetch(`${BASE}/api/notifications/read-all`, { method: "PUT", credentials: "include" });
      setNotifs((prev) => prev.map((n) => ({ ...n, isRead: true })));
    } catch {}
  }

  async function clearAllNotifications() {
    if (notifs.length === 0 || notifClearing) return;
    if (!window.confirm("Clear all notifications from your list? This cannot be undone.")) return;
    setNotifClearing(true);
    try {
      const res = await fetch(`${BASE}/api/notifications/clear-all`, {
        method: "DELETE",
        credentials: "include",
      });
      if (res.ok) setNotifs([]);
    } catch {}
    setNotifClearing(false);
  }

  const unreadNotifs = notifs.filter((n) => !n.isRead);
  const canManageProjects =
    user != null &&
    (user.permissions?.canCreateProject !== false ||
      user.permissions?.canDeleteProject !== false);
  const isSiteCustomer = !!user && user.role === "user";

  useEffect(() => {
    applyAccentColor(getSavedAccentColor());
  }, []);

  useEffect(() => {
    const openSettings = () => setSettingsOpen(true);
    window.addEventListener(OPEN_SETTINGS_EVENT, openSettings);
    return () => window.removeEventListener(OPEN_SETTINGS_EVENT, openSettings);
  }, []);

  // Show the current release once per user. Keeping the key user-scoped means
  // a shared browser can still introduce each account to the release, while a
  // returning user is not interrupted on every navigation or refresh.
  useEffect(() => {
    if (!user) return;
    const seenKey = `app-updates-seen:${user.id}:${APP_UPDATES_VERSION}`;
    try {
      if (localStorage.getItem(seenKey) === "true") return;
      localStorage.setItem(seenKey, "true");
      setUpdatesOpen(true);
    } catch {
      // If storage is unavailable, still show the release notes in this
      // authenticated session. The dialog will close normally.
      setUpdatesOpen(true);
    }
  }, [user]);
  // The contextual site nav (Dashboard/Issues/Compliance) is for site-specific
  // users — regular `user` accounts tied to their own site, and `admin`
  // accounts while they're actively managing a specific site. `super_admin`
  // manages the whole platform and never gets this contextual nav.
  const isNonSuperAdminRole = !!user && user.role !== "super_admin";

  const mySitesQ = useMySites(isSiteCustomer);
  const mySites = mySitesQ.data ?? [];
  const mySiteId = mySites.length >= 1 ? mySites[0].id : undefined;

  // `admin` (non-super) doesn't have a single "my site" — instead, show the
  // contextual site nav whenever they're actively viewing a specific site's pages.
  const siteIdFromUrlMatch = location.match(/^\/sites\/(\d+)/);
  const siteIdFromUrl = siteIdFromUrlMatch
    ? parseInt(siteIdFromUrlMatch[1], 10)
    : undefined;
  const effectiveSiteId = !isNonSuperAdminRole
    ? undefined
    : isSiteCustomer
      ? mySiteId
      : siteIdFromUrl;
  const showSiteNav = effectiveSiteId !== undefined;

  const siteDashboardHref =
    effectiveSiteId !== undefined
      ? `/sites/${effectiveSiteId}`
      : "/crawler/sites";
  const siteIssuesHref =
    effectiveSiteId !== undefined
      ? `/sites/${effectiveSiteId}/issues`
      : "/crawler/sites";
  const sitePotentialIssuesHref =
    effectiveSiteId !== undefined
      ? `/sites/${effectiveSiteId}/potential-issues`
      : "/crawler/sites";
  const siteComplianceWcagHref =
    effectiveSiteId !== undefined
      ? `/sites/${effectiveSiteId}/compliance/wcag`
      : "/crawler/sites";
  const siteComplianceEaaHref =
    effectiveSiteId !== undefined
      ? `/sites/${effectiveSiteId}/compliance/eaa`
      : "/crawler/sites";
  const siteComplianceAdaHref =
    effectiveSiteId !== undefined
      ? `/sites/${effectiveSiteId}/compliance/ada`
      : "/crawler/sites";
  const onSiteDashboard =
    location.startsWith("/sites/") &&
    effectiveSiteId !== undefined &&
    location.startsWith(`/sites/${effectiveSiteId}`);
  const onSiteDashboardExact =
    onSiteDashboard && location === siteDashboardHref;
  const onSiteIssues = onSiteDashboard && location === siteIssuesHref;
  const onSitePotentialIssues =
    onSiteDashboard && location === sitePotentialIssuesHref;
  const onSiteComplianceWcag =
    onSiteDashboard && location === siteComplianceWcagHref;
  const onSiteComplianceEaa =
    onSiteDashboard && location === siteComplianceEaaHref;
  const onSiteComplianceAda =
    onSiteDashboard && location === siteComplianceAdaHref;

  const accessibilityActive =
    onSiteDashboard ||
    location === "/new" ||
    location === "/advanced" ||
    location.startsWith("/scans") ||
    location.startsWith("/compare") ||
    location.startsWith("/crawler");

  const manualScanActive =
    location === "/new" ||
    location === "/advanced" ||
    location.startsWith("/scans") ||
    location.startsWith("/compare");
  const crawlerScanActive =
    location.startsWith("/crawler/new") ||
    (location.startsWith("/crawler") && !location.startsWith("/crawler/sites"));
  const issuesActive = onSiteIssues || onSitePotentialIssues;
  const complianceActive =
    onSiteComplianceWcag || onSiteComplianceEaa || onSiteComplianceAda;
  const adminSettingsActive = location.startsWith("/admin");
  const siteManagementActive = location.startsWith("/crawler/sites");
  const inQA = location.startsWith("/quality-assurance");
  const seoActive = location.startsWith("/seo");

  const urlSection: Section | null = inQA
    ? "quality-assurance"
    : seoActive
      ? "seo"
    : siteManagementActive || location === "/projects"
        ? "site-management"
        : adminSettingsActive
        ? "admin"
        : accessibilityActive
          ? "accessibility"
          : null;

  const [sidebarSection, setSidebarSection] = useState<Section | null>(
    urlSection,
  );
  const [tourTargets, setTourTargets] = useState<
    { id: string; title: string; description: string }[]
  >([]);
  const [tourStep, setTourStep] = useState<number | null>(null);
  const [tourRect, setTourRect] = useState<DOMRect | null>(null);
  const tourPanelRef = useRef<HTMLDivElement>(null);
  const tourPreviousFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (urlSection !== null) setSidebarSection(urlSection);
  }, [urlSection]);

  const onBack = () => setSidebarSection(null);

  const sidebarSearchItems = [
    { label: "Accessibility", href: "/scans" },
    { label: "Activity", href: "/activity" },
    { label: "New Scan", href: "/new" },
    { label: "Scan History", href: "/scans" },
    { label: "Compare Scans", href: "/compare" },
    { label: "Crawler Scan History", href: "/crawler" },
    { label: "Documentation", href: "/documentation" },
    { label: "App Updates", href: "/app-updates" },
    ...(user?.permissions?.canViewIssues ? [{ label: "Issues", href: "/issues" }] : []),
    { label: "Support", href: "/tickets" },
    ...(user?.permissions?.canViewQualityAssurance
      ? [
          { label: "Quality Assurance", href: "/quality-assurance" },
          { label: "Priority Pages", href: "/quality-assurance/priority-pages" },
          { label: "Check History", href: "/quality-assurance/check-history" },
        ]
      : []),
    ...(adminUser
      ? [
          { label: "Admin Inbox", href: "/admin/inbox" },
    { label: "Admin Dashboard", href: "/admin/dashboard" },
          { label: "Users", href: "/admin/users" },
          { label: "Groups", href: "/admin/groups" },
          { label: "Admin Settings", href: "/admin/settings" },
        ]
      : []),
    ...(canManageSites
      ? [{ label: "Manage Sites", href: "/crawler/sites" }]
      : []),
    ...(user?.permissions?.canCreateProject || user?.permissions?.canDeleteProject
      ? [{ label: "Manage Projects", href: "/projects" }]
      : []),
  ];
  const normalizedSidebarSearch = sidebarSearch.trim().toLowerCase();
  const filteredSidebarSearchItems = normalizedSidebarSearch
    ? sidebarSearchItems.filter((item) =>
        item.label.toLowerCase().includes(normalizedSidebarSearch),
      )
    : [];
  const closeWalkthrough = () => {
    const previousFocus = tourPreviousFocusRef.current;
    setTourStep(null);
    setTourTargets([]);
    setTourRect(null);
    tourPreviousFocusRef.current = null;
    window.requestAnimationFrame(() => {
      if (previousFocus?.isConnected) previousFocus.focus();
    });
  };

  useEffect(() => {
    const startWalkthrough = () => {
      tourPreviousFocusRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      window.requestAnimationFrame(() => {
        const seen = new Set<string>();
        const targets = Array.from(
          document.querySelectorAll<HTMLElement>("[data-tour]"),
        )
          .filter((element) => {
            const rect = element.getBoundingClientRect();
            const id = element.dataset.tour ?? "";
            return (
              rect.width > 0 &&
              rect.height > 0 &&
              getComputedStyle(element).visibility !== "hidden" &&
              getComputedStyle(element).opacity !== "0" &&
              !seen.has(id)
            );
          })
          .map((element) => {
            const id = element.dataset.tour ?? "";
            seen.add(id);
            return {
              id,
              title: element.dataset.tourTitle ?? "Application navigation",
              description:
                element.dataset.tourDescription ??
                "Use this control to explore the application.",
            };
          });
        setTourTargets(targets);
        setTourStep(targets.length > 0 ? 0 : null);
      });
    };

    window.addEventListener(APP_WALKTHROUGH_EVENT, startWalkthrough);
    return () => window.removeEventListener(APP_WALKTHROUGH_EVENT, startWalkthrough);
  }, []);

  useEffect(() => {
    if (tourStep === null || !tourTargets[tourStep]) return;

    const updateTourRect = () => {
      const element = Array.from(
        document.querySelectorAll<HTMLElement>("[data-tour]"),
      ).find((candidate) => candidate.dataset.tour === tourTargets[tourStep].id);
      if (!element) return;
      element.scrollIntoView({ block: "nearest", inline: "nearest" });
      setTourRect(element.getBoundingClientRect());
    };

    updateTourRect();
    window.addEventListener("resize", updateTourRect);
    window.addEventListener("scroll", updateTourRect, true);
    return () => {
      window.removeEventListener("resize", updateTourRect);
      window.removeEventListener("scroll", updateTourRect, true);
    };
  }, [tourStep, tourTargets]);

  useEffect(() => {
    if (tourStep === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeWalkthrough();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [tourStep]);

  useEffect(() => {
    if (tourStep === null || !tourRect) return;
    window.requestAnimationFrame(() => tourPanelRef.current?.focus());
  }, [tourStep, tourRect]);

  const activeTourTarget = tourStep === null ? undefined : tourTargets[tourStep];
  const tourPanelStyle =
    tourRect && activeTourTarget
      ? (() => {
          const panelWidth = 320;
          const left = Math.min(
            Math.max(16, tourRect.left),
            window.innerWidth - panelWidth - 16,
          );
          const placeBelow = tourRect.bottom + 190 < window.innerHeight;
          return {
            left,
            ...(placeBelow
              ? { top: Math.min(window.innerHeight - 190, tourRect.bottom + 14) }
              : { top: Math.max(16, tourRect.top - 190) }),
          };
        })()
      : undefined;

  return (
    <TooltipProvider delayDuration={300}>
      <div className="app-shell min-h-screen bg-background">
        <header className="ampera-header sticky top-0 z-50 border-b border-border/70 bg-background/90 shadow-[0_8px_32px_rgba(76,57,133,0.06)] backdrop-blur-2xl supports-[backdrop-filter]:bg-background/75">
          <div className="ampera-header-inner flex min-h-14 items-center justify-between gap-2 overflow-visible px-3 py-1.5 md:px-5">
            <div className="ampera-header-brand flex min-w-0 max-w-[55%] shrink items-center gap-2 overflow-visible">
              <Link href="/scans" className="flex min-w-0 items-center">
                <AppLogo />
              </Link>
              <Badge
                data-tour="version-badge"
                data-tour-title={`Version ${APP_UPDATES_VERSION}`}
                data-tour-description="This badge shows the current application release."
                variant="outline"
                className="vision-header-version h-6 border-primary/30 bg-primary/5 px-2 font-mono text-[10px] text-primary"
              >
                v{APP_UPDATES_VERSION}
              </Badge>
            </div>
            <div className="ampera-header-site flex min-w-0 flex-1 items-center justify-center gap-2 px-1 sm:px-2">
              <SiteSelector />
              <PageGroupSelector />
            </div>
            <div className="ampera-header-actions flex shrink-0 items-center gap-0.5 sm:gap-1">
              <HeaderThemeSwitcher />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link href="/tickets" className="hidden xl:inline-flex">
                    <Button
                      data-tour="header-support"
                      data-tour-title="Support"
                      data-tour-description="Open support tickets and request help from your team."
                      variant="ghost"
                      size="icon"
                      className={`h-8 w-8 rounded-lg hover:bg-muted ${location.startsWith("/tickets") ? "text-primary hover:text-primary" : "text-muted-foreground hover:text-foreground"}`}
                      aria-label="Support"
                    >
                      <TicketCheck className="w-4 h-4" />
                    </Button>
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="bg-slate-950 text-white shadow-lg">
                  Support
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link href="/app-updates" className="hidden xl:inline-flex">
                    <Button
                      data-testid="button-app-updates"
                      data-tour="header-app-updates"
                      data-tour-title="App Updates"
                      data-tour-description={`See what is new in version ${APP_UPDATES_VERSION}.`}
                      variant="ghost"
                      size="icon"
                      className={`relative h-8 w-8 rounded-lg hover:bg-muted ${location === "/app-updates" ? "text-primary hover:text-primary" : "text-muted-foreground hover:text-foreground"}`}
                      aria-label="App Updates"
                    >
                      <Megaphone className="h-4 w-4" />
                      <span
                        aria-label="New updates"
                        className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-fuchsia-500 shadow-[0_0_0_2px_hsl(var(--background)),0_0_10px_rgba(217,70,239,0.9)]"
                      />
                    </Button>
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="bg-slate-950 text-white shadow-lg">
                  App updates
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    data-testid="button-app-walkthrough"
                    data-tour="header-app-walkthrough"
                    data-tour-title="App Walkthrough"
                    data-tour-description="Start a guided tour of the platform navigation."
                    variant="ghost"
                    size="icon"
                    className="hidden h-8 w-8 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground xl:inline-flex"
                    aria-label="Start App Walkthrough"
                    onClick={() =>
                      window.dispatchEvent(new Event(APP_WALKTHROUGH_EVENT))
                    }
                  >
                    <Map className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="bg-slate-950 text-white shadow-lg">
                  Start app walkthrough
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link href="/documentation" className="hidden xl:inline-flex">
                    <Button
                      data-testid="button-documentation"
                      data-tour="header-documentation"
                      data-tour-title="Documentation"
                      data-tour-description="Read scanning guidance, rule descriptions, and WCAG references."
                      variant="ghost"
                      size="icon"
                      className={`h-8 w-8 rounded-lg hover:bg-muted ${location === "/documentation" ? "text-primary hover:text-primary" : "text-muted-foreground hover:text-foreground"}`}
                      aria-label="Documentation"
                    >
                      <BookOpen className="w-4 h-4" />
                    </Button>
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="bg-slate-950 text-white shadow-lg">
                  Documentation
                </TooltipContent>
              </Tooltip>
              <DropdownMenu modal={false}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <DropdownMenuTrigger asChild>
                      <Button
                        data-testid="button-notifications"
                        variant="ghost"
                        size="icon"
                        className="relative h-8 w-8 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
                        aria-label={unreadNotifs.length > 0 ? `Notifications — ${unreadNotifs.length} unread` : "Notifications"}
                      >
                        <Bell className="h-4 w-4" />
                        {unreadNotifs.length > 0 && (
                          <span className="pointer-events-none absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground">
                            {unreadNotifs.length > 99 ? "99+" : unreadNotifs.length}
                          </span>
                        )}
                      </Button>
                    </DropdownMenuTrigger>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="bg-slate-950 text-white shadow-lg">
                    Notifications
                  </TooltipContent>
                </Tooltip>
                <DropdownMenuContent
                  align="end"
                  sideOffset={8}
                  className="w-[340px] rounded-xl border-border/80 bg-popover/95 p-0 shadow-xl backdrop-blur"
                >
                  {/* Header */}
                  <div className="flex items-center justify-between px-3 py-2.5 border-b border-border/50">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Notifications</span>
                      {unreadNotifs.length > 0 && (
                        <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground">
                          {unreadNotifs.length}
                        </span>
                      )}
                    </div>
                    {notifs.length > 0 && (
                      <div className="flex items-center gap-2">
                        {unreadNotifs.length > 0 && (
                          <button
                            onClick={(e) => { e.preventDefault(); markAllRead(); }}
                            className="flex items-center gap-1 text-[11px] text-primary hover:underline underline-offset-2"
                            aria-label="Mark all notifications as read"
                          >
                            <CheckCheck className="h-3 w-3" /> Mark all read
                          </button>
                        )}
                        <button
                          onClick={(e) => { e.preventDefault(); clearAllNotifications(); }}
                          disabled={notifClearing}
                          className="flex items-center gap-1 text-[11px] text-destructive hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                          aria-label="Clear all notifications"
                        >
                          {notifClearing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                          Clear
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Notification list */}
                  <div className="max-h-[360px] overflow-y-auto divide-y divide-border/40">
                    {notifLoading && notifs.length === 0 ? (
                      <div className="flex justify-center py-8">
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      </div>
                    ) : notifs.length === 0 ? (
                      <div className="px-3 py-8 text-center">
                        <p className="text-sm font-semibold">No new notifications</p>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">You&apos;re all caught up.</p>
                      </div>
                    ) : (
                      notifs.slice(0, 8).map((n) => {
                        const icon =
                          n.type === "feature_request" ? <Lightbulb className="h-3.5 w-3.5 text-violet-500" /> :
                          n.type === "ticket"          ? <TicketCheck className="h-3.5 w-3.5 text-sky-500" /> :
                          n.type === "scan"            ? <ScanSearch className="h-3.5 w-3.5 text-emerald-500" /> :
                          n.type === "false_positive"  ? <Flag className="h-3.5 w-3.5 text-amber-500" /> :
                          n.type === "issue"           ? <ListTodo className="h-3.5 w-3.5 text-indigo-500" /> :
                                                         <Bell className="h-3.5 w-3.5 text-muted-foreground" />;
                        return (
                          <DropdownMenuItem
                            key={n.id}
                            asChild
                            className="cursor-pointer rounded-none px-3 py-2.5 hover:bg-muted/60 focus:bg-muted/60"
                            onClick={() => { if (!n.isRead) markOneRead(n.id); }}
                          >
                            <Link href={n.link ?? "/admin/inbox"}>
                              <div className="flex items-start gap-2.5 w-full">
                                <span className="mt-0.5 shrink-0">{icon}</span>
                                <div className="min-w-0 flex-1">
                                  <p className={`text-[13px] leading-tight ${n.isRead ? "font-normal text-foreground/75" : "font-semibold text-foreground"}`}>
                                    {n.title}
                                  </p>
                                  {n.body && (
                                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{n.body}</p>
                                  )}
                                  <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                                    {n.actorName && <span>{n.actorName}</span>}
                                    {n.actorName && <span>·</span>}
                                    <span>{notifTimeAgo(n.createdAt)}</span>
                                  </div>
                                </div>
                                {!n.isRead && (
                                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-label="Unread" />
                                )}
                              </div>
                            </Link>
                          </DropdownMenuItem>
                        );
                      })
                    )}
                  </div>

                  {/* Footer */}
                  <div className="border-t border-border/50 p-1.5">
                    {adminUser && (
                      <DropdownMenuItem asChild className="rounded-lg px-3 py-2">
                        <Link href="/admin/inbox">
                          <Inbox className="h-4 w-4 shrink-0 text-primary" />
                          <span className="text-[13px] font-medium">Open Admin Inbox</span>
                        </Link>
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem asChild className="items-start rounded-lg px-3 py-2">
                      <Link href="/app-updates">
                        <Megaphone className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                        <span>
                          <span className="block text-[13px] font-medium">View product updates</span>
                          <span className="block text-[11px] text-muted-foreground">v{APP_UPDATES_VERSION} release notes</span>
                        </span>
                      </Link>
                    </DropdownMenuItem>
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>
              {/* User menu */}
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <Button
                    data-tour="header-account"
                    data-tour-title="Account menu"
                    data-tour-description="Access account settings and sign out."
                    variant="ghost"
                    size="icon"
                    title="Account menu"
                  className="group relative ml-1 flex h-9 w-12 items-center justify-center gap-0.5 rounded-full p-0 hover:bg-muted vision-account-trigger"
                    aria-label="Open account menu"
                  >
                    <span className="vision-account-avatar relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[11px] font-semibold tracking-tight text-white shadow-sm ring-2 ring-background transition-transform group-data-[state=open]:scale-105 dark:bg-slate-100 dark:text-slate-900">
                      {user?.profileImageUrl ? (
                        <img
                          src={`${BASE}/api/storage/profile-image?v=${encodeURIComponent(user.profileImageUrl)}`}
                          alt=""
                          className="h-full w-full rounded-full object-cover"
                        />
                      ) : (
                        getUserInitials(user?.fullName || user?.username)
                      )}
                      <span
                        aria-hidden="true"
                        className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-background bg-emerald-500"
                      />
                    </span>
                    <HeaderChevron />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  sideOffset={8}
                  className="vision-account-menu relative max-h-[calc(100vh-4.5rem)] w-[340px] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-xl border-border/80 bg-popover/95 p-1.5 shadow-xl backdrop-blur before:absolute before:right-8 before:top-[-5px] before:h-2.5 before:w-2.5 before:rotate-45 before:border-l before:border-t before:border-border/80 before:bg-popover"
                >
                  <DropdownMenuLabel className="p-0 font-normal">
                    <div className="flex items-center gap-3 rounded-lg px-3 py-3">
                      <span className="vision-account-avatar relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-900 text-sm font-semibold text-white shadow-sm dark:bg-slate-100 dark:text-slate-900">
                        {user?.profileImageUrl ? (
                          <img
                            src={`${BASE}/api/storage/profile-image?v=${encodeURIComponent(user.profileImageUrl)}`}
                            alt=""
                            className="h-full w-full rounded-full object-cover"
                          />
                        ) : (
                          getUserInitials(user?.fullName || user?.username)
                        )}
                        <span
                          aria-hidden="true"
                          className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-popover bg-emerald-500"
                        />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-foreground">
                          {user?.fullName || user?.username || "Account"}
                        </span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          Online
                        </span>
                      </span>
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator className="my-1.5" />
                  <DropdownMenuItem
                    className="h-10 rounded-lg px-3 text-[14px] hover:bg-muted/70 hover:text-foreground focus:bg-muted/70 focus:text-foreground xl:hidden"
                    onSelect={() =>
                      window.dispatchEvent(new Event(APP_WALKTHROUGH_EVENT))
                    }
                  >
                    <Map className="h-4 w-4 text-muted-foreground" />
                    Start app walkthrough
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    asChild
                    className="h-10 rounded-lg px-3 text-[14px] hover:bg-muted/70 hover:text-foreground focus:bg-muted/70 focus:text-foreground"
                  >
                    <Link href="/feature-request">
                      <Lightbulb className="h-4 w-4 text-muted-foreground" />
                      Feature request
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    asChild
                    className="h-10 rounded-lg px-3 text-[14px] hover:bg-muted/70 hover:text-foreground focus:bg-muted/70 focus:text-foreground xl:hidden"
                  >
                    <Link href="/tickets">
                      <TicketCheck className="h-4 w-4 text-muted-foreground" />
                      Support
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    asChild
                    className="h-10 rounded-lg px-3 text-[14px] hover:bg-muted/70 hover:text-foreground focus:bg-muted/70 focus:text-foreground xl:hidden"
                  >
                    <Link href="/documentation">
                      <BookOpen className="h-4 w-4 text-muted-foreground" />
                      Documentation
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="my-1.5 xl:hidden" />
                  <DropdownMenuItem
                    asChild
                    className="h-10 rounded-lg px-3 text-[14px] hover:bg-muted/70 hover:text-foreground focus:bg-muted/70 focus:text-foreground"
                  >
                    <Link href="/profile-settings">
                      <UserRound className="h-4 w-4 text-muted-foreground" />
                      Profile settings
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setSettingsOpen(true)}
                    className="h-10 rounded-lg px-3 text-[14px] hover:bg-muted/70 hover:text-foreground focus:bg-muted/70 focus:text-foreground"
                  >
                    <Settings className="h-4 w-4 text-muted-foreground" />
                    Settings
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setSettingsOpen(true)}
                    className="h-10 rounded-lg px-3 text-[14px] hover:bg-muted/70 hover:text-foreground focus:bg-muted/70 focus:text-foreground"
                  >
                    <Palette className="h-4 w-4 text-muted-foreground" />
                    Themes
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="my-1.5" />
                  <DropdownMenuItem
                    className="h-10 rounded-lg px-3 text-[14px] text-destructive hover:bg-destructive/10 hover:text-destructive focus:bg-destructive/10 focus:text-destructive"
                    onClick={() => logout()}
                  >
                    <LogOut className="h-4 w-4" />
                    Sign Out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </header>

          <div className="flex h-[calc(100dvh-3.5rem)] min-h-0">
          {/* Sidebar */}
           <aside
             className={`sidebar-shell hidden md:flex ${
               collapsed ? "sidebar-shell-collapsed" : "sidebar-shell-expanded"
             }`}
           >
             <div className="sidebar-rail flex flex-col items-center gap-3 py-3">
               {collapsed && (
                 <Tooltip>
                   <TooltipTrigger asChild>
                     <Button
                       variant="ghost"
                       size="icon"
                       className="sidebar-rail-toggle"
                       onClick={toggleCollapsed}
                       aria-label="Open sidebar"
                     >
                       <ChevronsRight className="h-5 w-5" />
                     </Button>
                   </TooltipTrigger>
                   <TooltipContent side="right">Open sidebar</TooltipContent>
                 </Tooltip>
               )}
               <div className="h-px w-7 bg-white/25" />
               <MainMenuContent
                 collapsed
                  showFlyouts={collapsed}
                 location={location}
                 adminUser={adminUser}
                 canManageSites={user?.permissions?.canManageSites ?? false}
               />
             </div>

             <div
               className={
                 collapsed
                   ? "sidebar-panel sidebar-panel-collapsed"
                   : "sidebar-panel sidebar-panel-expanded"
               }
             >
              <div
                 className={`sidebar-panel-header overflow-hidden whitespace-nowrap ${
                   collapsed ? "hidden" : ""
                 }`}
              >
                  <div className="flex min-w-0 items-center gap-2">
                     <p className="text-sm font-normal text-muted-foreground">Main menu</p>
                   <div className="ml-auto flex items-center gap-1">
                     <Button
                       variant="ghost"
                       size="icon"
                       className="sidebar-panel-icon-button"
                       onClick={() => setSidebarSearch((value) => (value ? "" : " "))}
                       aria-label="Search your sidebar"
                     >
                       <Search className="h-4 w-4" />
                     </Button>
                     <Button
                       variant="ghost"
                       size="icon"
                       className="sidebar-panel-icon-button"
                       onClick={toggleCollapsed}
                       aria-label="Close sidebar"
                     >
                       <ChevronLeft className="h-4 w-4" />
                     </Button>
                   </div>
                </div>
                 <div
                   className={`sidebar-search-wrap ${
                     sidebarSearch || normalizedSidebarSearch ? "is-open" : ""
                   }`}
                 >
                   <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
                   <input
                     value={sidebarSearch.trim()}
                     onChange={(event) => setSidebarSearch(event.target.value)}
                     placeholder="Search sidebar..."
                     aria-label="Search your sidebar"
                     className="sidebar-search-input"
                   />
                   {sidebarSearch.trim() && (
                     <button
                       type="button"
                       className="sidebar-search-clear"
                       onClick={() => setSidebarSearch("")}
                       aria-label="Clear sidebar search"
                     >
                       <X className="h-3.5 w-3.5" />
                     </button>
                   )}
                 </div>
              </div>

              <nav
                className={`app-scrollbar flex-1 py-4 space-y-3 overflow-y-auto ${collapsed ? "px-1.5" : "px-4"} transition-[padding] duration-200`}
              >
                 {normalizedSidebarSearch ? (
                   <div className="sidebar-search-results space-y-1">
                     {filteredSidebarSearchItems.length > 0 ? (
                       filteredSidebarSearchItems.map((item) => (
                         <Link
                           key={`${item.label}-${item.href}`}
                           href={item.href}
                           className="sidebar-search-result"
                           onClick={() => setSidebarSearch("")}
                         >
                           <Search className="h-3.5 w-3.5 shrink-0 text-primary" />
                           <span className="truncate">{item.label}</span>
                         </Link>
                       ))
                     ) : (
                       <p className="px-2 py-4 text-sm text-muted-foreground">
                         No sidebar items found.
                       </p>
                     )}
                   </div>
                 ) : sidebarSection === null ? (
                  <MainMenuContent
                    collapsed={collapsed}
                    location={location}
                    adminUser={adminUser}
                    canManageSites={user?.permissions?.canManageSites ?? false}
                     onSelectSection={setSidebarSection}
                  />
                 ) : null}
                {sidebarSection === "accessibility" && (
                  <AccessibilitySidebarContent
                    collapsed={collapsed}
                    location={location}
                    adminUser={adminUser}
                    showSiteNav={showSiteNav}
                    effectiveSiteId={effectiveSiteId}
                    onBack={onBack}
                  />
                )}
                {sidebarSection === "quality-assurance" && (
                  <QASidebarContent
                    collapsed={collapsed}
                    location={location}
                    onBack={onBack}
                  />
                )}
                {sidebarSection === "seo" && (
                  <SEOSidebarContent
                    collapsed={collapsed}
                    location={location}
                    onBack={onBack}
                  />
                )}
                {sidebarSection === "admin" && adminUser && (
                  <AdminSidebarContent
                    collapsed={collapsed}
                    location={location}
                    adminUser={adminUser}
                    superAdminUser={superAdminUser}
                    canManageSites={canManageSites}
                    onBack={onBack}
                  />
                )}
                {sidebarSection === "site-management" && (canManageSites || canManageProjects) && (
                  <AdminSidebarContent
                    collapsed={collapsed}
                    location={location}
                    adminUser={false}
                    superAdminUser={false}
                    canManageSites={canManageSites}
                    canManageProjects={canManageProjects}
                    onBack={onBack}
                  />
                )}
              </nav>

              {!collapsed && (
                <div className="px-4 pb-4 mt-auto space-y-1">
                  <div className="sidebar-section-label px-2 pt-2">
                    Professional accessibility auditing tool.
                  </div>
                </div>
              )}
            </div>
           </aside>

          <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-20 focus:z-[100] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground focus:shadow-lg"
          >
            Skip to main content
          </a>
          <main
            id="main-content"
            tabIndex={-1}
              className={`flex-1 min-w-0 ${
              location === "/welcome"
                ? "flex flex-col overflow-hidden"
                : "overflow-auto app-scrollbar"
            }`}
          >
            <div
              className={`w-full p-6 md:p-8 ${
                location === "/welcome" ? "h-full min-h-0" : ""
              }`}
            >
              {location !== "/welcome" &&
                !/^\/scans\/\d+$/.test(location) &&
                ![
                  "/quality-assurance",
                  "/quality-assurance/links/broken",
                  "/quality-assurance/links/overview",
                  "/quality-assurance/inventory/pages",
                  "/quality-assurance/spelling/word-inventory",
                ].includes(location) &&
                (() => {
                const breadcrumb = getShellBreadcrumb(location);
                return breadcrumb ? (
                  <div className="mb-6">
                    <nav
                      aria-label="Breadcrumb"
                      className="flex items-center gap-1.5 text-xs text-muted-foreground"
                    >
                      <Link
                        href={breadcrumb.parentHref}
                        data-testid="link-back-to-previous"
                        className="inline-flex items-center gap-1 hover:text-foreground hover:underline"
                      >
                        <span aria-hidden="true">←</span>
                        {breadcrumb.parentLabel}
                      </Link>
                      <span aria-hidden="true">/</span>
                      <span className="font-medium text-foreground">{breadcrumb.current}</span>
                    </nav>
                  </div>
                ) : (
                  <Link
                    href="/welcome"
                    data-testid="link-back-to-home"
                    className="mb-6 inline-flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Home className="h-4 w-4" />
                    Back to Home
                  </Link>
                );
                })()}
              {children}
            </div>
          </main>
        </div>

        <AccessibilityModeControl />

        <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
          <DialogContent className="max-w-4xl w-[95vw] max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Settings</DialogTitle>
              <DialogDescription className="sr-only">
                Manage appearance, scan defaults, proxy configuration, and workspace tools.
              </DialogDescription>
            </DialogHeader>
            <div className="mt-2">
              <SettingsPage />
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={updatesOpen} onOpenChange={setUpdatesOpen}>
          <DialogContent className="max-w-5xl w-[95vw] max-h-[90vh] overflow-y-auto">
            <DialogHeader className="pr-8">
              <DialogTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                What&apos;s new in version {APP_UPDATES_VERSION}
              </DialogTitle>
              <DialogDescription>
                Here&apos;s what has been added recently to make scanning,
                crawling, reporting, and daily platform work more reliable.
              </DialogDescription>
            </DialogHeader>
            <div className="mt-2">
              <AppUpdatesContent compact />
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-4">
              <Button variant="outline" onClick={() => setUpdatesOpen(false)}>
                Continue to the app
              </Button>
              <Link href="/app-updates" onClick={() => setUpdatesOpen(false)}>
                <Button>
                  View full updates
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
            </div>
          </DialogContent>
        </Dialog>

        {tourStep !== null && activeTourTarget && tourRect && (
          <div
            className="pointer-events-auto fixed inset-0 z-[100]"
          >
            <div
              aria-hidden="true"
              className="absolute inset-0 bg-slate-950/35"
              onClick={closeWalkthrough}
            />
            <div
              aria-hidden="true"
              className="fixed rounded-lg border-2 border-primary bg-transparent shadow-[0_0_0_9999px_rgba(2,6,23,0.48),0_0_24px_rgba(99,102,241,0.7)] transition-all duration-200"
              style={{
                left: Math.max(4, tourRect.left - 4),
                top: Math.max(4, tourRect.top - 4),
                width: tourRect.width + 8,
                height: tourRect.height + 8,
              }}
            />
            <div
              ref={tourPanelRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="app-walkthrough-title"
              aria-describedby="app-walkthrough-description"
              tabIndex={-1}
              className="pointer-events-auto fixed w-[min(320px,calc(100vw-32px))] rounded-xl border bg-background p-4 shadow-2xl transition-all duration-200"
              style={tourPanelStyle}
              onKeyDown={(event) => {
                if (event.key !== "Tab") return;
                const focusable = Array.from(
                  event.currentTarget.querySelectorAll<HTMLElement>(
                    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
                  ),
                );
                if (focusable.length === 0) {
                  event.preventDefault();
                  return;
                }
                const first = focusable[0];
                const last = focusable[focusable.length - 1];
                if (
                  event.shiftKey &&
                  (document.activeElement === first ||
                    document.activeElement === event.currentTarget)
                ) {
                  event.preventDefault();
                  last.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                  event.preventDefault();
                  first.focus();
                }
              }}
            >
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">
                    App walkthrough
                  </p>
                  <h2 id="app-walkthrough-title" className="mt-1 text-sm font-semibold">
                    {activeTourTarget.title}
                  </h2>
                </div>
                <Button
                  data-testid="button-cancel-walkthrough"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  onClick={closeWalkthrough}
                  aria-label="Cancel walkthrough"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <p id="app-walkthrough-description" className="text-xs leading-5 text-muted-foreground">
                {activeTourTarget.description}
              </p>
              <div className="mt-4 flex items-center justify-between gap-3">
                <span className="text-[11px] font-medium text-muted-foreground">
                  {tourStep + 1} of {tourTargets.length}
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    data-testid="button-cancel-walkthrough-text"
                    variant="ghost"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={closeWalkthrough}
                  >
                    Cancel
                  </Button>
                  <Button
                    data-testid="button-previous-walkthrough"
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                    disabled={tourStep === 0}
                    onClick={() =>
                      setTourStep((step) =>
                        step === null ? null : Math.max(0, step - 1),
                      )
                    }
                  >
                    Back
                  </Button>
                  <Button
                    data-testid="button-next-walkthrough"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => {
                      if (tourStep >= tourTargets.length - 1) {
                        closeWalkthrough();
                      } else {
                        setTourStep((step) =>
                          step === null ? null : step + 1,
                        );
                      }
                    }}
                  >
                    {tourStep >= tourTargets.length - 1 ? "Finish" : "Next"}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
