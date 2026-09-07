import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  BookOpen,
  Camera,
  ChevronRight,
  Hash,
  Image as ImageIcon,
  Lightbulb,
  Search,
  Shield,
  Monitor,
  FileText,
  BarChart3,
  Globe,
  Bug,
  Settings,
  Wrench,
  Trash2,
  CheckCircle2,
  Clock,
  RefreshCw,
} from "lucide-react";
import { useAuth } from "@/contexts/auth";
import ACT_RULES from "@/lib/actRules";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── Screenshot definitions ────────────────────────────────────────────────────
const SCREENSHOT_DEFS = [
  { key: "interface-overview",   label: "Interface overview",      path: "/scans",               section: "interface" },
  { key: "create-manual-scan",   label: "New scan wizard",         path: "/new",                 section: "manual-scan" },
  { key: "scan-configuration",   label: "Scan configuration",      path: "/new",                 section: "scan-config" },
  { key: "scan-results",         label: "Scan results",            path: "/scans",               section: "scan-results" },
  { key: "scan-report",          label: "Scan report view",        path: "/scans",               section: "reports" },
  { key: "site-dashboard",       label: "Site dashboard",          path: "/sites",               section: "site-dashboard" },
  { key: "crawler-list",         label: "Crawler history",         path: "/crawler",             section: "crawler" },
  { key: "crawler-live",         label: "Crawler live overview",   path: "/crawler",             section: "crawler" },
  { key: "qa-overview",          label: "QA overview",             path: "/quality-assurance",   section: "qa" },
] as const;

type ScreenshotKey = (typeof SCREENSHOT_DEFS)[number]["key"];

// ── Rule/manual data ──────────────────────────────────────────────────────────
const ruleReferences = Object.entries(ACT_RULES).map(([id, rule]) => ({
  id,
  title: rule.title,
  detail: rule.detail,
  deprecated: rule.deprecated,
  deprecatedReason: rule.deprecatedReason,
  relatedRules: rule.relatedRules,
  wcagCriteria: rule.wcagCriteria,
  wcagLevel: rule.wcagLevel,
  eaa: rule.eaa,
  ada: rule.ada,
  ruleType: rule.ruleType,
}));

const manualOnlyCriteria = [
  ["1.2.4", "Captions (Live)", "AA"],
  ["1.3.2", "Meaningful Sequence", "A"],
  ["1.3.3", "Sensory Characteristics", "A"],
  ["1.4.5", "Images of Text", "AA"],
  ["1.4.10", "Reflow", "AA"],
  ["1.4.11", "Non-text Contrast", "AA"],
  ["1.4.13", "Content on Hover or Focus", "AA"],
  ["2.1.2", "No Keyboard Trap", "A"],
  ["2.1.4", "Character Key Shortcuts", "A"],
  ["2.2.2", "Pause, Stop, Hide", "A"],
  ["2.3.1", "Three Flashes or Below Threshold", "A"],
  ["2.4.3", "Focus Order", "A"],
  ["2.4.5", "Multiple Ways", "AA"],
  ["2.5.1", "Pointer Gestures", "A"],
  ["2.5.2", "Pointer Cancellation", "A"],
  ["2.5.4", "Motion Actuation", "A"],
  ["3.2.1", "On Focus", "A"],
  ["3.2.2", "On Input", "A"],
  ["3.2.3", "Consistent Navigation", "AA"],
  ["3.2.4", "Consistent Identification", "AA"],
  ["3.3.2", "Labels or Instructions", "A"],
  ["3.3.3", "Error Suggestion", "AA"],
  ["3.3.4", "Error Prevention (Legal, Financial, Data)", "AA"],
  ["2.4.12", "Focus Not Obscured (Enhanced)", "AAA"],
  ["2.5.7", "Dragging Movements", "AA"],
  ["3.2.6", "Consistent Help", "A"],
  ["3.3.7", "Redundant Entry", "A"],
  ["3.3.8", "Accessible Authentication (Minimum)", "AA"],
  ["3.3.9", "Accessible Authentication (Enhanced)", "AAA"],
] as const;

const manualLevelStyles = {
  A: "border-sky-200/80 bg-sky-50/50 text-sky-700 dark:border-sky-800/80 dark:bg-sky-950/40 dark:text-sky-300",
  AA: "border-violet-200/80 bg-violet-50/50 text-violet-700 dark:border-violet-800/80 dark:bg-violet-950/40 dark:text-violet-300",
  AAA: "border-fuchsia-200/80 bg-fuchsia-50/50 text-fuchsia-700 dark:border-fuchsia-800/80 dark:bg-fuchsia-950/40 dark:text-fuchsia-300",
} as const;
type Level = keyof typeof manualLevelStyles;

// ── Sidebar / TOC config ──────────────────────────────────────────────────────
const SECTIONS = [
  {
    id: "guide", label: "User guide", icon: <BookOpen className="h-4 w-4" />,
    items: [
      { id: "getting-started",  label: "Getting started" },
      { id: "interface",        label: "Interface overview" },
      { id: "manual-scan",      label: "Creating a manual scan" },
      { id: "scan-config",      label: "Configuring scans" },
      { id: "scan-results",     label: "Viewing scan results" },
      { id: "reports",          label: "Reports" },
      { id: "site-dashboard",   label: "Site dashboard" },
      { id: "crawler",          label: "Crawler" },
      { id: "qa",               label: "Quality Assurance" },
    ],
  },
  {
    id: "reference", label: "Reference", icon: <Shield className="h-4 w-4" />,
    items: [
      { id: "scanner",    label: "Scanner capabilities" },
      { id: "act-rules",  label: "ACT Rules catalog" },
      { id: "manual",     label: "Manual criteria" },
    ],
  },
];

const ADMIN_SECTION = {
  id: "admin-tools", label: "Admin tools", icon: <Wrench className="h-4 w-4" />,
  items: [{ id: "screenshot-manager", label: "Screenshot manager" }],
};

const TOC: Record<string, string[]> = {
  "getting-started":  ["Add your targets", "Configure options", "Review results"],
  "interface":        ["Sidebar navigation", "Header controls", "Site context"],
  "manual-scan":      ["Enter URLs", "Name & project", "Start scan"],
  "scan-config":      ["WCAG levels", "Rule selection", "Scan delay"],
  "scan-results":     ["Issue summary", "Filtering results", "Element Viewer", "AI fixes"],
  "reports":          ["Full report", "Page-level report", "Export options", "Smart Analysis"],
  "site-dashboard":   ["Compliance score", "Issue trends", "Frameworks", "Page Groups"],
  "crawler":          ["Creating a crawl", "Phase 1 — Discovery", "Phase 2 — Scanning", "Live overview", "Advanced options"],
  "qa":               ["Broken links", "Inventory", "Spelling", "Single page check"],
  "scanner":          ["Rules coverage", "No cap on issue counts", "Element Viewer"],
};

// ── DocScreenshot component ───────────────────────────────────────────────────
function DocScreenshot({
  docKey,
  caption,
  defaultPath,
}: {
  docKey: ScreenshotKey;
  caption: string;
  defaultPath: string;
}) {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin" || user?.role === "super_admin";
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [showCapture, setShowCapture] = useState(false);
  const [capPath, setCapPath] = useState(defaultPath);
  const [capturing, setCapturing] = useState(false);
  const [cacheToken, setCacheToken] = useState(0);
  const qc = useQueryClient();

  const handleCapture = async () => {
    setCapturing(true);
    try {
      const res = await fetch(`${BASE}/api/docs/screenshots/capture`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: docKey, path: capPath }),
      });
      const body = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(body.error ?? "Capture failed");
      setImgError(false);
      setImgLoaded(false);
      setCacheToken((k) => k + 1);
      setShowCapture(false);
      void qc.invalidateQueries({ queryKey: ["doc-screenshots"] });
    } catch (err) {
      alert(`Capture failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setCapturing(false);
    }
  };

  return (
    <div className="my-6">
      <div
        className={`relative rounded-xl overflow-hidden border transition-all ${
          imgError
            ? "border-dashed border-border/60 bg-muted/20"
            : "border-border/50 shadow-sm bg-muted/10"
        }`}
      >
        {!imgError ? (
          <>
            {!imgLoaded && (
              <div className="flex items-center justify-center py-20 animate-pulse">
                <ImageIcon className="h-8 w-8 text-muted-foreground/20" />
              </div>
            )}
            <img
              key={cacheToken}
              src={`${BASE}/api/docs/screenshots/${docKey}${cacheToken > 0 ? `?t=${cacheToken}` : ""}`}
              alt={caption}
              className={`w-full h-auto object-top transition-opacity duration-300 ${imgLoaded ? "opacity-100" : "opacity-0 absolute inset-0"}`}
              onLoad={() => setImgLoaded(true)}
              onError={() => { setImgError(true); setImgLoaded(false); }}
            />
          </>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 px-8 gap-3 text-center">
            <Camera className="h-7 w-7 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">No screenshot captured yet</p>
            {isAdmin && (
              <p className="text-xs text-muted-foreground/60">
                Click <span className="font-semibold">Capture</span> to add one from the live app
              </p>
            )}
          </div>
        )}

        {isAdmin && (
          <button
            onClick={() => setShowCapture((s) => !s)}
            className="absolute top-2 right-2 flex items-center gap-1.5 rounded-lg bg-black/55 text-white text-[11px] px-2.5 py-1 hover:bg-black/75 transition-colors backdrop-blur-sm"
          >
            <Camera className="h-3 w-3" />
            {imgError ? "Capture" : "Recapture"}
          </button>
        )}
      </div>

      {showCapture && isAdmin && (
        <div className="mt-2 rounded-xl border border-border/50 bg-card/60 p-4 space-y-3">
          <p className="text-xs font-semibold text-foreground">Capture screenshot</p>
          <div className="flex gap-2">
            <Input
              value={capPath}
              onChange={(e) => setCapPath(e.target.value)}
              placeholder="/scans"
              className="h-8 text-xs flex-1 font-mono"
            />
            <Button size="sm" onClick={handleCapture} disabled={capturing} className="h-8 text-xs shrink-0">
              {capturing ? (
                <><RefreshCw className="h-3 w-3 animate-spin mr-1" />Capturing…</>
              ) : (
                <><Camera className="h-3 w-3 mr-1" />Capture</>
              )}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
            The server will navigate to <span className="font-mono">localhost:PORT{capPath}</span> using your session.
            Works best in production where the API server serves the frontend.
          </p>
        </div>
      )}

      {caption && imgLoaded && !imgError && (
        <p className="mt-2 text-[11px] text-center text-muted-foreground/70 italic">{caption}</p>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function Documentation() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin" || user?.role === "super_admin";

  const [activeItem, setActiveItem] = useState("getting-started");
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(["guide", "reference"]));
  const [search, setSearch] = useState("");

  const toggle = (id: string) => {
    setExpandedSections((prev) => {
      const s = new Set(prev);
      s.has(id) ? s.delete(id) : s.add(id);
      return s;
    });
  };

  const lowerSearch = search.trim().toLowerCase();
  const isSearching = lowerSearch.length > 0;

  const matchedRules = isSearching
    ? ruleReferences.filter(
        (r) =>
          r.id.toLowerCase().includes(lowerSearch) ||
          r.title.toLowerCase().includes(lowerSearch) ||
          r.detail.toLowerCase().includes(lowerSearch),
      )
    : [];
  const matchedManual = isSearching
    ? manualOnlyCriteria.filter(
        (c) => c[0].includes(lowerSearch) || c[1].toLowerCase().includes(lowerSearch),
      )
    : [];

  const allSections = isAdmin ? [...SECTIONS, ADMIN_SECTION] : SECTIONS;

  return (
    <div className="relative w-full min-h-[calc(100vh-8rem)]">
      <header className="relative mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/50 pb-5">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 border border-primary/20 text-primary">
            <BookOpen className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-foreground">Ampera docs</h1>
            <p className="text-[11px] text-muted-foreground mt-0.5">Reference library and user guide</p>
          </div>
        </div>
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search documentation or rules…"
            className="h-9 pl-9 text-xs bg-card/40 border-border/60 focus:bg-background shadow-sm"
          />
        </div>
      </header>

      <div className="relative flex flex-col md:flex-row gap-8 items-start">
        {/* Left Sidebar */}
        <nav className="w-full md:w-56 shrink-0 md:sticky md:top-4 space-y-2">
          {allSections.map((sec) => (
            <div key={sec.id}>
              <button
                onClick={() => toggle(sec.id)}
                className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold transition-colors ${
                  expandedSections.has(sec.id)
                    ? "text-foreground"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                }`}
              >
                <span className={expandedSections.has(sec.id) ? "text-primary" : "text-muted-foreground/70"}>
                  {sec.icon}
                </span>
                {sec.label}
                <ChevronRight
                  className={`ml-auto h-3.5 w-3.5 transition-transform ${
                    expandedSections.has(sec.id) ? "rotate-90 text-foreground" : "text-muted-foreground/50"
                  }`}
                />
              </button>
              {expandedSections.has(sec.id) && (
                <div className="ml-5 mt-0.5 mb-2 space-y-0.5 border-l border-border/50 pl-3">
                  {sec.items.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => { setActiveItem(item.id); setSearch(""); }}
                      className={`block w-full text-left rounded-lg px-2 py-1.5 text-xs transition-colors ${
                        !isSearching && activeItem === item.id
                          ? "text-primary font-semibold bg-primary/10"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>

        {/* Main Content */}
        <article className="flex-1 min-w-0 max-w-3xl pb-16">
          {isSearching ? (
            <div className="space-y-8 animate-in fade-in duration-300">
              <h2 className="text-lg font-semibold text-foreground">
                Search results for &ldquo;{search}&rdquo;
              </h2>
              {matchedRules.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-muted-foreground mb-4">
                    ACT Rules ({matchedRules.length})
                  </h3>
                  <div className="grid gap-4 md:grid-cols-2">
                    <RuleList rules={matchedRules} />
                  </div>
                </div>
              )}
              {matchedManual.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-muted-foreground mb-4 mt-6">
                    Manual Criteria ({matchedManual.length})
                  </h3>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    <ManualList criteria={matchedManual} />
                  </div>
                </div>
              )}
              {matchedRules.length === 0 && matchedManual.length === 0 && (
                <div className="py-12 text-center text-muted-foreground">
                  <Search className="w-8 h-8 mx-auto mb-3 opacity-20" />
                  <p>No results found for &ldquo;{search}&rdquo;</p>
                </div>
              )}
            </div>
          ) : (
            <div className="animate-in fade-in duration-300">
              {activeItem === "getting-started"    && <GettingStarted />}
              {activeItem === "interface"           && <InterfaceOverview />}
              {activeItem === "manual-scan"         && <CreateManualScan />}
              {activeItem === "scan-config"         && <ScanConfiguration />}
              {activeItem === "scan-results"        && <ScanResults />}
              {activeItem === "reports"             && <ReportsDocs />}
              {activeItem === "site-dashboard"      && <SiteDashboardDocs />}
              {activeItem === "crawler"             && <CrawlerDocs />}
              {activeItem === "qa"                  && <QualityAssuranceDocs />}
              {activeItem === "scanner"             && <ScannerCapabilities />}
              {activeItem === "act-rules"           && <ActRules />}
              {activeItem === "manual"              && <ManualCriteria />}
              {activeItem === "screenshot-manager"  && isAdmin && <ScreenshotManager />}
            </div>
          )}
        </article>

        {/* Right TOC */}
        <aside className="hidden xl:block w-48 shrink-0 md:sticky md:top-4">
          {TOC[activeItem] && !isSearching && (
            <div className="animate-in fade-in duration-300">
              <p className="font-mono text-[10px] font-bold uppercase tracking-[.18em] text-muted-foreground/70 mb-3">
                On this page
              </p>
              <div className="space-y-2">
                {TOC[activeItem].map((t, i) => (
                  <span key={i} className="block w-full text-left text-xs text-muted-foreground">
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

// ── Section: Getting started ──────────────────────────────────────────────────
function GettingStarted() {
  return (
    <div>
      <h2 className="text-2xl font-bold tracking-tight text-foreground mb-2">Getting started</h2>
      <p className="text-sm text-muted-foreground mb-8">
        Create a scan by entering URLs, uploading a CSV, or using a sitemap.xml source.
      </p>
      <div className="space-y-8">
        <Step n={1} title="Add your targets">
          Open New Scan and add one or more URLs. You can paste a list, upload a CSV, or provide a sitemap.
          The scanner will analyse each page and report all accessibility issues found.
        </Step>
        <Step n={2} title="Configure options">
          Select WCAG level (A, AA, AAA) and specific rules when you want focused validation.
          Enable proxy mode only when a PAC URL is configured in Settings.
        </Step>
        <Step n={3} title="Review results">
          Review scan details, expand issue rows, and export results as CSV, Excel, or PDF.
          Use the AI fix engine for targeted remediation guidance per element.
        </Step>
      </div>
      <Tip title="Pro tip: use Smart Analysis">
        Smart Analysis groups issues by component hierarchy across all pages, making it easy to see
        which shared elements are responsible for the most issues site-wide.
      </Tip>
    </div>
  );
}

// ── Section: Interface overview ───────────────────────────────────────────────
function InterfaceOverview() {
  return (
    <div>
      <SectionHeader title="Interface overview" sub="How the app is laid out and how to navigate between areas." />
      <DocScreenshot docKey="interface-overview" caption="Scan list — typical authenticated view showing sidebar, header, and main content" defaultPath="/scans" />
      <div className="space-y-8 mt-8">
        <Step n={1} title="Sidebar navigation">
          The left sidebar is the primary navigation surface. It is grouped into functional areas:
          <ul className="mt-3 space-y-1.5 text-sm leading-relaxed text-muted-foreground list-disc list-inside">
            <li><strong className="text-foreground">Manual Scan</strong> — New Scan, Scan History, Compare Scans</li>
            <li><strong className="text-foreground">Crawler Scan</strong> — New crawl, Crawler history, Manage Sites</li>
            <li><strong className="text-foreground">Site Issues / Compliance</strong> — Issues, Potential Issues, WCAG, EAA, ADA compliance views (visible when a site is selected)</li>
            <li><strong className="text-foreground">Quality Assurance</strong> — Broken links, Inventory, Spelling, Priority Pages</li>
            <li><strong className="text-foreground">Admin</strong> — Users, Groups, Settings, Permissions (admin and super-admin only)</li>
          </ul>
          Use the search box at the top of the sidebar to jump to any section instantly.
        </Step>
        <Step n={2} title="Header controls">
          The header contains:
          <ul className="mt-3 space-y-1.5 text-sm leading-relaxed text-muted-foreground list-disc list-inside">
            <li><strong className="text-foreground">Site selector</strong> — switch the active site context. All site-scoped views (dashboard, issues, compliance) respond to this selection.</li>
            <li><strong className="text-foreground">Theme toggle</strong> — switch between light, dark, glass, and system themes.</li>
            <li><strong className="text-foreground">Notifications bell</strong> — system alerts and scan completion notices.</li>
            <li><strong className="text-foreground">Account menu</strong> — profile settings, appearance preferences, and sign out.</li>
          </ul>
        </Step>
        <Step n={3} title="Site context">
          Many views are scoped to the currently selected site. When you switch sites using the header
          selector, the sidebar updates to show that site&apos;s issues, compliance status, and page groups.
          Manual scans and crawler sessions can be associated with a site at creation time.
        </Step>
      </div>
    </div>
  );
}

// ── Section: Creating a manual scan ──────────────────────────────────────────
function CreateManualScan() {
  return (
    <div>
      <SectionHeader title="Creating a manual scan" sub="Scan one or more specific URLs on demand." />
      <DocScreenshot docKey="create-manual-scan" caption="New Scan wizard — URL entry step" defaultPath="/new" />
      <div className="space-y-8 mt-8">
        <Step n={1} title="Enter URLs">
          Navigate to <strong>New Scan</strong> in the sidebar. You have four ways to add URLs:
          <ul className="mt-3 space-y-1.5 text-sm leading-relaxed text-muted-foreground list-disc list-inside">
            <li><strong className="text-foreground">Single URL</strong> — type or paste one URL directly into the field.</li>
            <li><strong className="text-foreground">Paste multiple</strong> — paste a newline-separated list; each line becomes a separate page to scan.</li>
            <li><strong className="text-foreground">CSV upload</strong> — upload a CSV file where the first column contains URLs (header row is automatically skipped).</li>
            <li><strong className="text-foreground">Sitemap</strong> — provide a sitemap.xml URL; the scanner extracts all <code>&lt;loc&gt;</code> entries and scans each one.</li>
          </ul>
        </Step>
        <Step n={2} title="Name &amp; project">
          Give the scan a descriptive name so you can find it in history later. Optionally associate
          it with a <strong>project</strong> (a grouping of related scans) and a <strong>site</strong>
          (which links this scan to the site&apos;s compliance dashboard). Both can be changed after the scan completes.
        </Step>
        <Step n={3} title="Start scan">
          Click <strong>Start Scan</strong>. The scanner queues your URLs and begins processing them
          immediately. You can watch progress in real-time from the scan detail page — each page
          transitions through <em>Queued → Scanning → Complete</em> or <em>Failed</em>. You can
          navigate away and return at any time; the scan continues in the background.
        </Step>
      </div>
      <Tip title="Large URL lists">
        For sites with hundreds of pages, use the Crawler instead of a manual scan. The Crawler
        automatically discovers pages by following links and handles rate-limiting and bot-detection
        challenges, then runs the accessibility scan on every page it finds.
      </Tip>
    </div>
  );
}

// ── Section: Configuring scans ────────────────────────────────────────────────
function ScanConfiguration() {
  return (
    <div>
      <SectionHeader title="Configuring scans" sub="WCAG levels, rule selection, and timing options." />
      <DocScreenshot docKey="scan-configuration" caption="Scan configuration panel — WCAG level and rule selection" defaultPath="/new" />
      <div className="space-y-8 mt-8">
        <Step n={1} title="WCAG levels">
          Select which conformance levels to test:
          <div className="mt-3 space-y-2">
            {[
              ["A", "sky", "Minimum — covers the most critical barriers (keyboard access, text alternatives, captions)."],
              ["AA", "violet", "Standard — required by most regulations (ADA, EAA). Includes contrast ratios, resize, and form labels."],
              ["AAA", "fuchsia", "Enhanced — highest level. Includes sign language, extended audio description, and advanced context requirements."],
            ].map(([level, color, desc]) => (
              <div key={level} className={`flex gap-3 rounded-xl border border-${color}-200/50 bg-${color}-50/40 dark:border-${color}-800/50 dark:bg-${color}-950/20 p-3`}>
                <Badge className={`h-5 shrink-0 self-start mt-0.5 rounded-md border-${color}-300/60 bg-${color}-100 text-${color}-700 dark:border-${color}-700/60 dark:bg-${color}-950/50 dark:text-${color}-300 text-[10px] font-bold px-1.5`}>
                  {level}
                </Badge>
                <p className="text-xs leading-relaxed text-muted-foreground">{desc}</p>
              </div>
            ))}
          </div>
        </Step>
        <Step n={2} title="Rule selection">
          By default all rules for the selected level are active. Use the <strong>Rules</strong> picker
          to enable only a specific subset — useful when auditing a particular criterion or comparing
          results against a specific WCAG success criterion. Selected rules are saved in the scan
          record and shown on the results page.
        </Step>
        <Step n={3} title="Scan delay">
          The scan delay (default 10 s) is the wait time between a page finishing loading and the
          accessibility rules running. Increase it for single-page applications that hydrate slowly
          or load content asynchronously. Decrease it for mostly-static pages to speed up large scans.
          A value of 0 runs rules immediately after the DOM-ready event.
        </Step>
      </div>
      <Tip title="Matching your compliance target">
        If your organisation targets WCAG 2.2 AA, select <strong>AA</strong>. The scanner covers all
        automatable AA rules. The manual criteria list shows which AA criteria still require human review.
      </Tip>
    </div>
  );
}

// ── Section: Viewing scan results ─────────────────────────────────────────────
function ScanResults() {
  return (
    <div>
      <SectionHeader title="Viewing scan results" sub="How to read, filter, and act on what the scanner found." />
      <DocScreenshot docKey="scan-results" caption="Scan detail — issue list with rule breakdown and occurrence counts" defaultPath="/scans" />
      <div className="space-y-8 mt-8">
        <Step n={1} title="Issue summary">
          The top of the scan detail page shows a summary card: total pages scanned, total issues,
          and a breakdown by impact level (Critical, Serious, Moderate, Minor). Each level maps to
          how significantly the issue affects users with disabilities. Use the compliance score ring
          to quickly gauge overall page health.
        </Step>
        <Step n={2} title="Filtering results">
          The issue table can be filtered by:
          <ul className="mt-3 space-y-1.5 text-sm leading-relaxed text-muted-foreground list-disc list-inside">
            <li><strong className="text-foreground">Rule</strong> — focus on a specific ACT rule (e.g. R25 — colour contrast).</li>
            <li><strong className="text-foreground">WCAG level</strong> — show only A, AA, or AAA issues.</li>
            <li><strong className="text-foreground">Status</strong> — Issues vs Potential Issues (requires manual confirmation).</li>
            <li><strong className="text-foreground">Page</strong> — see all rules that fired on a specific URL.</li>
          </ul>
          Filters combine with AND logic — applying rule + level shows only that rule&apos;s issues
          at the chosen level.
        </Step>
        <Step n={3} title="Element Viewer">
          Enable Element Viewer in <strong>Settings → Accessibility options</strong>. Click any occurrence
          row to open an inline panel showing a live preview of the page alongside the HTML source
          with the offending element highlighted. Use First / Prev / Next / Last to step through
          all occurrences without closing the panel.
        </Step>
        <Step n={4} title="AI fixes">
          Each issue can have an AI-generated fix suggestion. Click the <strong>Fix suggestion</strong>
          button on any rule row. The AI engine analyses the element&apos;s HTML context and returns a
          specific, copy-ready code fix for that occurrence. If your organisation uses an enterprise
          AI key this can be configured in Admin → System Settings.
        </Step>
      </div>
    </div>
  );
}

// helper for step numbers beyond 3
function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
        <Hash className="h-4 w-4 text-primary/50" />
        {n}. {title}
      </h3>
      <div className="text-sm leading-7 text-muted-foreground pl-6">{children}</div>
    </div>
  );
}

// ── Section: Reports ──────────────────────────────────────────────────────────
function ReportsDocs() {
  return (
    <div>
      <SectionHeader title="Reports" sub="Full-site reports, page-level reports, and export options." />
      <DocScreenshot docKey="scan-report" caption="Full report view — all pages and rules with export controls" defaultPath="/scans" />
      <div className="space-y-8 mt-8">
        <Step n={1} title="Full report">
          Open a completed scan and click <strong>View Report</strong>. The full report aggregates every
          rule finding across all scanned pages into a single scrollable view. Each rule shows:
          total occurrences, affected pages, WCAG criterion, and impact level. Expand any rule to see
          per-page occurrence counts and the specific element selectors.
        </Step>
        <Step n={2} title="Page-level report">
          Click any page URL inside the scan to open its page-level report. This shows only the
          issues found on that specific page, with the page screenshot alongside each finding. The
          page report is useful for sharing with developers responsible for a specific template or component.
        </Step>
        <Step n={3} title="Export options">
          Export from any scan using the <strong>Export</strong> button:
          <ul className="mt-3 space-y-1.5 text-sm leading-relaxed text-muted-foreground list-disc list-inside">
            <li><strong className="text-foreground">CSV</strong> — flat spreadsheet with one row per occurrence. Includes URL, rule ID, WCAG criterion, element selector, and description.</li>
            <li><strong className="text-foreground">Excel (.xlsx)</strong> — formatted workbook with summary and detail sheets.</li>
            <li><strong className="text-foreground">PDF</strong> — branded report with executive summary, rule breakdown, and page-level findings.</li>
          </ul>
        </Step>
        <Step n={4} title="Smart Analysis">
          Smart Analysis (available from the scan detail action menu) groups issues by their
          component hierarchy — identifying which shared elements (headers, footers, navigation)
          cause the same issue to appear across many pages. Fixing one shared component can resolve
          hundreds of occurrences at once.
        </Step>
      </div>
    </div>
  );
}

// ── Section: Site dashboard ───────────────────────────────────────────────────
function SiteDashboardDocs() {
  return (
    <div>
      <SectionHeader title="Site dashboard" sub="Track compliance scores, issue trends, and framework coverage over time." />
      <DocScreenshot docKey="site-dashboard" caption="Site dashboard — compliance score, trend chart, and framework breakdown" defaultPath="/sites" />
      <div className="space-y-8 mt-8">
        <Step n={1} title="Compliance score">
          The dashboard shows a headline compliance score (0–100) calculated from the ratio of
          issue-free element checks to total checks across all scanned pages. The score is updated
          after every crawler or manual scan associated with the site. A score above 90 is considered
          good; below 70 indicates significant barriers for users with disabilities.
        </Step>
        <Step n={2} title="Issue trends">
          The trend chart shows how the total issue count has changed across scan sessions over time.
          Use this to measure the impact of remediation work — a downward trend confirms fixes are
          reducing the number of barriers. Hover over any data point to see the exact count and
          session date.
        </Step>
        <Step n={3} title="Frameworks">
          The dashboard breaks down compliance by framework:
          <ul className="mt-3 space-y-1.5 text-sm leading-relaxed text-muted-foreground list-disc list-inside">
            <li><strong className="text-foreground">WCAG 2.2</strong> — W3C guidelines, the foundational standard.</li>
            <li><strong className="text-foreground">EAA</strong> — European Accessibility Act coverage for EN 301 549.</li>
            <li><strong className="text-foreground">ADA Title II</strong> — US federal requirement for government and public-facing sites.</li>
          </ul>
          Navigate to the framework-specific pages using the sidebar to see criterion-level detail.
        </Step>
        <Step n={4} title="Page Groups">
          Page Groups let you categorise your site&apos;s pages by template type (e.g. Home, Product, Blog,
          Forms). Configure groups in <strong>Sites → Page Groups</strong>. When a crawler scan runs,
          each page is automatically classified, and the dashboard shows compliance scores per group —
          making it easy to identify which templates need the most attention.
        </Step>
      </div>
    </div>
  );
}

// ── Section: Crawler ──────────────────────────────────────────────────────────
function CrawlerDocs() {
  return (
    <div>
      <SectionHeader title="Crawler" sub="Automatically discover and scan an entire site's pages." />
      <DocScreenshot docKey="crawler-list" caption="Crawler history — list of crawl sessions with status and page counts" defaultPath="/crawler" />
      <div className="space-y-8 mt-8">
        <Step n={1} title="Creating a crawl">
          Go to <strong>Crawler → New Crawl</strong>. Enter the seed URL (the starting page, usually
          the homepage). Set the maximum pages and depth limits for discovery. Associate the crawl
          with a site to feed results into the site dashboard. Click <strong>Start Crawl</strong>.
        </Step>
        <Step n={2} title="Phase 1 — Discovery">
          The crawler visits each page starting from the seed URL, extracts all internal links,
          and adds them to the queue. Multiple parallel discovery workers run simultaneously
          (configurable, default 2) so large sites are crawled much faster. Each URL is visited once.
          Discovery respects your <em>robots.txt</em> rules by default.
        </Step>

        <DocScreenshot docKey="crawler-live" caption="Live crawler overview — discovery progress and scan pipeline during Phase 2" defaultPath="/crawler" />

        <Step n={3} title="Phase 2 — Scanning">
          Once discovery completes (or while it is still running with Crawl Boost enabled), the
          accessibility scanner processes every discovered page using the same rule engine as manual
          scans. Up to 8 parallel browser workers scan pages concurrently. Phase 2 progress is
          shown in the live overview as a pipeline with pages queued, scanning, and completed.
        </Step>
        <Step n={4} title="Live overview">
          The crawler detail page shows real-time progress via a live connection to the server.
          You can see:
          <ul className="mt-3 space-y-1.5 text-sm leading-relaxed text-muted-foreground list-disc list-inside">
            <li>URLs discovered vs total expected</li>
            <li>Pages scanned vs queued</li>
            <li>Elapsed time and estimated completion</li>
            <li>Broken links detected during discovery</li>
            <li>Current page being scanned</li>
          </ul>
          You can pause, resume, or cancel a crawl at any time without losing progress.
        </Step>
        <Step n={5} title="Advanced options">
          <ul className="mt-3 space-y-1.5 text-sm leading-relaxed text-muted-foreground list-disc list-inside">
            <li><strong className="text-foreground">Crawl Boost</strong> — Phase 1 captures rendered HTML for each page and Phase 2 reuses it, avoiding double browser visits and reducing bot-detection challenges.</li>
            <li><strong className="text-foreground">Incremental mode</strong> — compares page HTML against the previous session. Pages whose content has not changed are skipped, dramatically reducing scan time for large sites.</li>
            <li><strong className="text-foreground">Discovery cache</strong> — reuse the URL list from a previous crawl, skipping Phase 1 entirely. Useful for frequent re-scans of a well-known site.</li>
            <li><strong className="text-foreground">Scan delay</strong> — per-page wait time before accessibility rules run. Default 10 s; reduce for static sites.</li>
            <li><strong className="text-foreground">Discovery workers</strong> — number of parallel browsers for Phase 1 (1–4). More workers = faster URL discovery; requires more server RAM.</li>
          </ul>
        </Step>
      </div>
    </div>
  );
}

// ── Section: Quality Assurance ────────────────────────────────────────────────
function QualityAssuranceDocs() {
  return (
    <div>
      <SectionHeader title="Quality Assurance" sub="Broken links, content inventory, spelling, and page health checks." />
      <DocScreenshot docKey="qa-overview" caption="QA overview — broken links, inventory categories, and spelling summary" defaultPath="/quality-assurance" />
      <div className="space-y-8 mt-8">
        <Step n={1} title="Broken links">
          The <strong>Broken Links</strong> section shows every internal and external URL that returned
          a 4xx / 5xx HTTP response or failed to connect during the last crawler run. For each broken
          link you see: the source page that contains it, the broken URL, the HTTP status code, and
          the anchor text. Filter by status code or source page to prioritise fixes.
        </Step>
        <Step n={2} title="Inventory">
          The Inventory gives a complete picture of all content assets on the site:
          <ul className="mt-3 space-y-1.5 text-sm leading-relaxed text-muted-foreground list-disc list-inside">
            <li><strong className="text-foreground">Pages</strong> — all discovered URLs with their HTTP status, page type, and depth.</li>
            <li><strong className="text-foreground">Links</strong> — all unique href values found across pages.</li>
            <li><strong className="text-foreground">Documents</strong> — PDFs, Word files, and other downloadable content found via links.</li>
            <li><strong className="text-foreground">Media</strong> — images and video embeds with source URLs.</li>
            <li><strong className="text-foreground">Email / Phone / SSN</strong> — contact details exposed in page text (useful for privacy audits).</li>
            <li><strong className="text-foreground">JavaScript / CSS / Meta tags / Sitemap</strong> — technical asset inventories.</li>
          </ul>
        </Step>
        <Step n={3} title="Spelling">
          The Spelling section identifies misspelled words across all pages. Go to
          <strong> Spelling → Pages</strong> to see which pages contain misspellings, or
          <strong> Misspellings</strong> for a word-level view. Use <strong>Decisions</strong> to mark
          words as intentional (proper nouns, technical terms) so they are excluded from future checks.
          The <strong>Word Inventory</strong> shows every unique word found and its frequency — useful
          for content audits.
        </Step>
        <Step n={4} title="Single page check">
          <strong>Single Page Check</strong> lets you run a QA scan on any one URL on demand, without
          starting a full crawl. It checks the page for broken links, spelling errors, and returns a
          summary of all outgoing links. Use it to quickly verify a page before publishing.
        </Step>
      </div>
      <Tip title="Priority Pages">
        Priority Pages (accessible from the sidebar under QA) shows the pages with the highest
        combined score of issues, broken links, and spelling errors — a ready-made list of where to
        focus remediation effort first.
      </Tip>
    </div>
  );
}

// ── Section: Scanner capabilities ─────────────────────────────────────────────
function ScannerCapabilities() {
  return (
    <div>
      <h2 className="text-2xl font-bold tracking-tight text-foreground mb-2">Scanner capabilities</h2>
      <p className="text-sm text-muted-foreground mb-8">
        What the scanner detects, how results are reported, and how to navigate them.
      </p>
      <div className="space-y-8">
        <Step n={1} title="Rules coverage">
          The scanner implements approximately 83 of the current ACT rules (ACT-R1 – ACT-R118),
          covering WCAG 2.1 / 2.2 criteria at levels A, AA, and AAA. All rules are validated against
          industry-leading accessibility platforms for accuracy. Each issue includes a rule ID, impact
          level, WCAG success criterion, remediation guidance, and the offending element&apos;s HTML selector.
        </Step>
        <Step n={2} title="No cap on issue counts">
          Every rule reports all occurrences found on a page — there is no artificial ceiling on how
          many issues are returned. When a rule finds more than 99 occurrences, the count badge shows{" "}
          <span className="font-mono bg-muted/60 px-1.5 py-0.5 rounded text-[11px] border border-border/50">
            99+
          </span>{" "}
          to keep the display concise while the full list remains available for export.
        </Step>
        <Step n={3} title="Element Viewer">
          Enable the Element Viewer in Settings to inspect any issue inline. Click an occurrence row
          to open the viewer, which shows the live page preview alongside the HTML source with the
          offending element highlighted. Use First / Prev / Next / Last to step through all occurrences
          of a rule without closing the panel.
        </Step>
      </div>
    </div>
  );
}

// ── Section: ACT Rules catalog ────────────────────────────────────────────────
function ActRules() {
  return (
    <div className="space-y-4">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground">ACT Rules catalog</h2>
          <p className="text-sm text-muted-foreground mt-1">Detailed reference descriptions for scanner rules.</p>
        </div>
        <div className="rounded-xl border border-border/50 bg-card/30 px-3 py-2 text-xs text-muted-foreground shadow-sm">
          Reference library{" "}
          <span className="font-mono text-primary font-semibold ml-1">{ruleReferences.length} rules</span>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <RuleList rules={ruleReferences} />
      </div>
    </div>
  );
}

// ── Section: Manual criteria ──────────────────────────────────────────────────
function ManualCriteria() {
  return (
    <div className="space-y-4">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground">Manual Only (Cannot Be Automated)</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Human review criteria that require context beyond automated scanning.
          </p>
        </div>
        <div className="rounded-xl border border-border/50 bg-card/30 px-3 py-2 text-xs text-muted-foreground shadow-sm">
          <span className="font-mono text-primary font-semibold">{manualOnlyCriteria.length} criteria</span>
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <ManualList criteria={manualOnlyCriteria} />
      </div>
    </div>
  );
}

// ── Screenshot manager (admin only) ──────────────────────────────────────────
function ScreenshotManager() {
  const qc = useQueryClient();
  const { data: captured = [], isLoading } = useQuery({
    queryKey: ["doc-screenshots"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/docs/screenshots`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json() as Promise<{ key: string; captured_at: string; width: number; height: number }[]>;
    },
  });

  const capturedMap = new Map(captured.map((s) => [s.key, s]));

  const handleCapture = async (key: string, path: string) => {
    try {
      const res = await fetch(`${BASE}/api/docs/screenshots/capture`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, path }),
      });
      const body = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(body.error ?? "Failed");
      void qc.invalidateQueries({ queryKey: ["doc-screenshots"] });
    } catch (err) {
      alert(`Capture failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleDelete = async (key: string) => {
    if (!confirm(`Delete screenshot for "${key}"?`)) return;
    await fetch(`${BASE}/api/docs/screenshots/${key}`, { method: "DELETE", credentials: "include" });
    void qc.invalidateQueries({ queryKey: ["doc-screenshots"] });
  };

  return (
    <div>
      <h2 className="text-2xl font-bold tracking-tight text-foreground mb-2">Screenshot manager</h2>
      <p className="text-sm text-muted-foreground mb-6">
        Capture screenshots for each documentation section. The server navigates to each page using
        your admin session. Best results in <strong>production</strong> where the API server serves
        the React frontend.
      </p>

      <div className="rounded-2xl border border-amber-200/50 bg-amber-50/40 dark:border-amber-800/50 dark:bg-amber-950/20 p-4 mb-6 text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
        <strong>Note:</strong> Screenshots are captured at <code className="font-mono">localhost:PORT/path</code>.
        In development the Vite server is separate from the API server, so captures may show the API
        server&apos;s plain HTML rather than the React UI. Deploy to production for accurate screenshots.
      </div>

      <div className="space-y-2">
        {isLoading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>
        ) : (
          SCREENSHOT_DEFS.map((def) => {
            const info = capturedMap.get(def.key);
            return (
              <div
                key={def.key}
                className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl border border-border/50 bg-card/40 p-3"
              >
                {/* Status icon */}
                {info ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                ) : (
                  <Camera className="h-4 w-4 text-muted-foreground/40 shrink-0" />
                )}

                {/* Label + meta */}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-foreground truncate">{def.label}</p>
                  <p className="text-[11px] text-muted-foreground font-mono">{def.path}</p>
                  {info && (
                    <p className="text-[11px] text-muted-foreground/70 flex items-center gap-1 mt-0.5">
                      <Clock className="h-3 w-3" />
                      {new Date(info.captured_at).toLocaleString()} — {info.width}×{info.height}
                    </p>
                  )}
                </div>

                {/* Preview thumbnail */}
                {info && (
                  <img
                    src={`${BASE}/api/docs/screenshots/${def.key}`}
                    alt={def.label}
                    className="hidden sm:block h-12 w-20 rounded-lg object-cover object-top border border-border/50 shrink-0"
                  />
                )}

                {/* Actions */}
                <div className="flex gap-2 shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-[11px] gap-1"
                    onClick={() => handleCapture(def.key, def.path)}
                  >
                    <Camera className="h-3 w-3" />
                    {info ? "Recapture" : "Capture"}
                  </Button>
                  {info && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-[11px] gap-1 text-destructive hover:text-destructive"
                      onClick={() => handleDelete(def.key)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="mt-6 flex justify-end">
        <Button
          variant="outline"
          size="sm"
          className="gap-2 text-xs"
          onClick={async () => {
            for (const def of SCREENSHOT_DEFS) {
              await handleCapture(def.key, def.path);
              await new Promise((r) => setTimeout(r, 3000));
            }
          }}
        >
          <Camera className="h-3.5 w-3.5" />
          Capture all ({SCREENSHOT_DEFS.length})
        </Button>
      </div>
    </div>
  );
}

// ── Shared sub-components ─────────────────────────────────────────────────────
function SectionHeader({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="mb-6">
      <h2 className="text-2xl font-bold tracking-tight text-foreground mb-1">{title}</h2>
      <p className="text-sm text-muted-foreground">{sub}</p>
    </div>
  );
}

function Tip({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-10 rounded-2xl border border-blue-200/50 bg-blue-50/50 p-5 dark:border-blue-900/40 dark:bg-blue-950/20 shadow-sm">
      <div className="flex gap-3">
        <Lightbulb className="h-5 w-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-blue-900 dark:text-blue-300">{title}</p>
          <p className="mt-1 text-xs text-blue-800/80 dark:text-blue-400/80 leading-5">{children}</p>
        </div>
      </div>
    </div>
  );
}

function RuleList({ rules }: { rules: typeof ruleReferences }) {
  return (
    <TooltipProvider>
      {rules.map((rule) => (
        <div
          key={rule.id}
          className={`rounded-xl border border-border/60 bg-card/40 p-4 space-y-3 transition-colors hover:border-primary/30 hover:bg-card/60 shadow-sm ${rule.deprecated ? "opacity-60 grayscale-[0.5]" : ""}`}
        >
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="font-mono text-[10px] border-border/70 bg-muted/50 text-foreground px-1.5">
              {rule.id}
            </Badge>
            <h3 className="font-medium text-sm leading-tight">{rule.title}</h3>
            {rule.deprecated && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="outline" className="text-[10px] border-amber-500/50 text-amber-600 bg-amber-50 dark:bg-amber-950/30 dark:text-amber-400 cursor-help">
                    Deprecated
                  </Badge>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs text-xs">{rule.deprecatedReason}</TooltipContent>
              </Tooltip>
            )}
            {rule.relatedRules?.map((relatedRule) => (
              <Badge
                key={relatedRule}
                variant="outline"
                className="text-[10px] border-blue-500/50 bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300"
              >
                Related: {relatedRule}
              </Badge>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {rule.wcagLevel
              ?.filter((level) => level !== "Best Practice" && level !== "WAI-ARIA")
              .map((level) => (
                <Badge key={level} className="h-5 rounded-md border border-violet-200/60 bg-violet-50/50 px-1.5 py-0 text-[10px] font-semibold uppercase tracking-wide text-violet-700 hover:bg-violet-50/50 dark:border-violet-800/60 dark:bg-violet-950/20 dark:text-violet-300">
                  {level}
                </Badge>
              ))}
            {rule.wcagCriteria?.map((criterion) => (
              <Badge key={criterion} className="h-5 rounded-md border border-sky-200/60 bg-sky-50/50 px-1.5 py-0 text-[10px] font-semibold tracking-wide text-sky-700 hover:bg-sky-50/50 dark:border-sky-800/60 dark:bg-sky-950/20 dark:text-sky-300">
                WCAG {criterion}
              </Badge>
            ))}
            {rule.ruleType && (
              <Badge className="h-5 rounded-md border border-slate-200/60 bg-slate-100/50 px-1.5 py-0 text-[10px] font-semibold tracking-wide text-slate-700 hover:bg-slate-100/50 dark:border-slate-700/60 dark:bg-slate-800/40 dark:text-slate-300">
                {rule.ruleType}
              </Badge>
            )}
            {rule.eaa && (
              <Badge className="h-5 rounded-md border border-emerald-200/60 bg-emerald-50/50 px-1.5 py-0 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 hover:bg-emerald-50/50 dark:border-emerald-800/60 dark:bg-emerald-950/20 dark:text-emerald-300">
                EAA
              </Badge>
            )}
            {rule.ada && (
              <Badge className="h-5 rounded-md border border-indigo-200/60 bg-indigo-50/50 px-1.5 py-0 text-[10px] font-semibold uppercase tracking-wide text-indigo-700 hover:bg-indigo-50/50 dark:border-indigo-800/60 dark:bg-indigo-950/20 dark:text-indigo-300">
                ADA
              </Badge>
            )}
          </div>
          <p className="text-[13px] text-muted-foreground leading-relaxed">{rule.detail}</p>
        </div>
      ))}
    </TooltipProvider>
  );
}

function ManualList({
  criteria,
}: {
  criteria: readonly (readonly [string, string, string])[] | [string, string, string][];
}) {
  return (
    <>
      {criteria.map(([criterion, title, level]) => (
        <div
          key={criterion}
          className="group flex min-h-11 items-center gap-2 rounded-xl border border-border/50 bg-card/40 px-2.5 py-2 transition-colors hover:border-primary/40 hover:bg-muted/40 shadow-sm"
        >
          <Badge variant="outline" className="h-6 shrink-0 rounded-md border-slate-200/80 bg-slate-50/50 px-1.5 font-mono text-[10px] font-semibold text-slate-700 dark:border-slate-700/80 dark:bg-slate-900/50 dark:text-slate-300">
            {criterion}
          </Badge>
          <span className="min-w-0 flex-1 text-xs font-medium leading-tight text-foreground">{title}</span>
          <Badge variant="outline" className={`h-5 shrink-0 rounded-md px-1.5 font-mono text-[10px] font-bold ${manualLevelStyles[level as Level]}`}>
            {level}
          </Badge>
        </div>
      ))}
    </>
  );
}
