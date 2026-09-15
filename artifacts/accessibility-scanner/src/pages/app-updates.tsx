import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Accessibility,
  BarChart3,
  CheckCircle2,
  ClipboardCheck,
  ChevronDown,
  ChevronUp,
  Database,
  Filter,
  FolderOpen,
  GitBranch,
  Globe,
  Layers,
  ListFilter,
  MousePointerClick,
  PanelLeft,
  Palette,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Sparkles,
  Search,
  UserRound,
  Workflow,
  Zap,
} from "lucide-react";
import { DEFAULT_LOGO_SUBTITLE, DEFAULT_LOGO_TEXT } from "@/pages/settings";

const BRANDING_BASE = (import.meta.env.BASE_URL as string).replace(/\/$/, "");
import {
  APP_RELEASE_MONTH,
  APP_RULE_MAPPING_RELEASE,
  APP_VERSION,
} from "@/lib/app-version";

export const APP_UPDATES_VERSION = APP_VERSION;
export const APP_UPDATES_MONTH = APP_RELEASE_MONTH;

type UpdateGroup = {
  icon: typeof Accessibility;
  title: string;
  description: string;
  category: UpdateCategory;
  features: string[];
};

type UpdateCategory =
  | "Accessibility"
  | "Scanning"
  | "Reliability"
  | "Reporting"
  | "Platform";

export const updateGroups: UpdateGroup[] = [
  {
    icon: GitBranch,
    title: "Release continuity",
    description: "Patch releases now remain traceable within the same minor version.",
    category: "Platform",
    features: [
      "Additional releases in the same minor line increment the patch number, such as 1.4.1, 1.4.2, and 1.4.3",
      "The shared version source keeps the header, Welcome page, login intro, update indicator, and release history synchronized",
    ],
  },
  {
    icon: Workflow,
    title: "Jira-style issue tracking",
    description: "Turn accessibility findings and team requests into visible, accountable work.",
    category: "Platform",
    features: [
      "Create Content, Epic, Test, Task, Story, Request, and Bug issues from the workspace, including direct context from accessibility findings",
      "Type-aware forms capture the fields each work item needs, while issue types stay stable after creation",
      "Switch between a searchable list and Kanban board with filters for type, status, priority, assignee, and site",
      "Task, Story, Content, Epic, Test, and Request work through To Do, In Progress, Deployed, Review, Release to Retest, Verified, and Complete",
      "Bug work follows the tested Fixed and Closed path, with Reopen returning work to In Progress",
      "Rich descriptions and comments support formatting, user mentions, and private screenshot, video, and document evidence",
      "Issue visibility, comments, archive controls, and Super Admin access follow the existing permission boundaries",
    ],
  },
  {
    icon: Workflow,
    title: "Guided manual scan setup",
    description: "New scans now move through a focused four-step setup instead of one long form.",
    category: "Scanning",
    features: [
      "Target, Accessibility Scope, Scan Settings, and Scan Details are separated into clear steps",
      "Previous and Next controls keep navigation predictable, while Start Scan appears only after the details step",
      "The target step supports manual URLs, sitemap fetching, and CSV upload without losing the rest of the scan configuration",
      "The details step keeps project, scan title, group, and initiator information together before launch",
      "Completed steps show a checkmark so users can see which parts of the setup are ready",
    ],
  },
  {
    icon: Accessibility,
    title: "Scoped accessibility checks",
    description: "Choose the standards and rules that matter for each scan.",
    category: "Accessibility",
    features: [
      "Scan scope can be limited to WCAG A, AA, AAA, WAI-ARIA, or Best Practice levels",
      "Selecting levels filters the individual rule picker to only the rules in scope",
      "The scan preserves the selected scope in its request so manual and crawler workflows stay aligned",
      "Scope is presented as a dedicated review step instead of being hidden among URL and settings controls",
    ],
  },
  {
    icon: FolderOpen,
    title: "Projects and scan organization",
    description: "New scans are easier to classify, find, and keep aligned with the active site.",
    category: "Scanning",
    features: [
      "Projects are now required for manual scan creation so every new scan is organized from the start",
      "Project selectors are scoped to the active site and only show projects associated with that site",
      "Manual Scan History includes a site-scoped Project filter that resets safely when the active site changes",
      "Legacy site-less scans remain visible in history while new scans follow the site and project boundary",
      "Project/site compatibility is validated by the API, with generated OpenAPI clients aligned to the required field",
    ],
  },
  {
    icon: ClipboardCheck,
    title: "Clearer scan titles",
    description: "Scan labels now better describe what the value is used for across the product.",
    category: "Platform",
    features: [
      "User-facing Scan Name labels are now presented as Scan Title in creation, editing, history, details, reports, and exports",
      "Required-field and URL guidance now refer to descriptive scan titles",
      "Existing stored name values, API properties, and legacy scan records remain compatible",
    ],
  },
  {
    icon: Accessibility,
    title: "Accessibility rule coverage",
    description: "Broader, more useful checks aligned with ACT and WCAG workflows.",
    category: "Accessibility",
    features: [
      "Expanded WCAG 2.1 and WCAG 2.2, ARIA, and best-practice rule coverage",
      "Issue versus Potential Issue outcomes are classified per occurrence instead of blanketing a whole rule",
      "Manual-review references identify criteria that need human or interactive-state verification",
      "New experimental rule ACT-R118: “HTML images contain no text” is now available; it asks reviewers to check human-language text and the decorative, incidental, essential, and redundant exceptions",
      "Improved image alternatives, contrast, fixed font-size, touch-target, headings, landmarks, keyboard, and media checks",
      "Rule evidence includes selectors, HTML context, remediation, WCAG criteria, impact, and legal mapping",
    ],
  },
  {
    icon: Workflow,
    title: "Scan workflows",
    description: "More control over scans from the first URL through the final report.",
    category: "Scanning",
    features: [
      "Add URLs to an active, paused, or pending scan without restarting it",
      "Remove URLs that are still pending in a live scan queue with safe pending-only handling",
      "Live page progress now shows URL, stage, load time, scan time, issues, and actions",
      "Extension counts beside the URL type filter cover PDFs, HTML, and every other extension in the scan",
      "Manual scan history stays separate from crawler history while preserving older site-less scans",
      "Retry, pause, resume, cancel, and recovery states are reflected consistently in the interface",
    ],
  },
  {
    icon: Globe,
    title: "Crawler and discovery",
    description: "Site crawling is now easier to manage, monitor, and recover.",
    category: "Scanning",
    features: [
      "Crawl Only mode discovers URLs without scanning them until accessibility scanning is explicitly started",
      "Sitemap, URL-list, and crawl-based discovery workflows with crawler-specific history and details",
      "Crawled-page and accessibility-scanned-page counts are tracked independently",
      "Scheduling, Run now, page limits, speed controls, filters, pagination, and progress views",
      "Failed crawler pages are automatically requeued before a session can be finalized",
      "Crawler policies are snapshotted per session so later site-setting changes do not alter an active run",
    ],
  },
  {
    icon: ShieldCheck,
    title: "Protected-site reliability",
    description: "Scanning now handles slow, proxied, WAF-protected, and JavaScript-heavy sites more safely.",
    category: "Reliability",
    features: [
      "WAF-aware browser fallback for pages that reject plain HTTP requests or return bot challenges",
      "Progressive navigation retries with aligned hard deadlines for slow pages",
      "Rendered JavaScript snapshots include CSS and visual assets for stable report layouts",
      "Rule-time HTML is captured before ACT rules run, while final visual resources and bounding boxes are captured afterward",
      "Broken URLs include final 4xx/5xx responses plus confirmed transport and redirect failures",
      "Browser rule bundles are embedded and verified during production builds for reliable deployment",
    ],
  },
  {
    icon: RefreshCw,
    title: "Incremental scans and recovery",
    description: "Repeat scans spend less time on unchanged pages without carrying forward bad results.",
    category: "Reliability",
    features: [
      "Raw-HTML content hashing detects unchanged pages before launching a full browser scan",
      "Safe baselines can carry forward verified results, but failed pages never qualify for carry-forward",
      "Orphaned scans recover after a server restart and resume pending work",
      "Mid-flight pages are reset and requeued when a scan is resumed",
      "Concurrent queue workers atomically claim pages so queue changes cannot delete a page that already started",
    ],
  },
  {
    icon: ClipboardCheck,
    title: "Quality Assurance",
    description: "Review the quality of links, pages, metadata, and site content in one workspace.",
    category: "Reporting",
    features: [
      "Broken-link, redirect, transport, and unsafe-link review with source-page context",
      "Page, link, media, document, email, phone, CSS, JavaScript, sitemap, and word inventories",
      "Meta-tag, priority-page, spelling, and page-quality review areas",
      "Check history and issue tracking for repeatable QA workflows",
      "Crawler results and QA data remain available through dedicated scan detail views",
    ],
  },
  {
    icon: BarChart3,
    title: "Reports and analysis",
    description: "Turn large scan results into practical, shareable insights.",
    category: "Reporting",
    features: [
      "Site dashboards, WCAG/ADA/EAA compliance views, rule reports, and page-level details",
      "Smart Analysis groups recurring issues by shared components and patterns",
      "CSV, Excel, and PDF exports for scans, reports, and analysis results",
      "False-positive review and per-occurrence notes help teams keep triage decisions precise",
      "Large-scan report endpoints use database aggregation to avoid loading every row into memory",
    ],
  },
  {
    icon: Settings2,
    title: "Platform controls and permissions",
    description: "The platform now adapts better to teams, roles, sites, and accessibility preferences.",
    category: "Platform",
    features: [
      "Role-aware navigation and permission boundaries for scans, crawlers, QA, sites, and dashboards",
      "Site ownership and site selection determine the right customer and administrator views",
      "Settings opens as an in-app dialog, including proxy configuration and application preferences",
      "Accessibility mode preferences persist locally and apply from the document root",
      "Sidebar collapse, favorites, active-site selection, and account controls persist between visits",
    ],
  },
  {
    icon: PanelLeft,
    title: "Interface and navigation updates",
    description: "A refreshed application shell makes everyday navigation faster, clearer, and easier to personalize.",
    category: "Platform",
    features: [
      "New header layout keeps the logo, current version tag, support, updates, walkthrough, documentation, and account actions together",
      "Themes and accent colors can be changed from Settings, with the selected accent carried across the application shell",
      "New expanded sidebar panel includes a Main menu heading, sidebar search, collapse controls, internal scrolling, and persistent layout state",
      "Colored sidebar rail remains visible in collapsed and expanded states with clearer active navigation treatment",
      "Collapsed rail flyouts provide grouped destinations and create actions with a hover bridge and only one active flyout at a time",
      "Flyout switching and closing are now quick and smooth, without overlapping menus or duplicate pointer controls",
      "Accessibility mode control is centered in the sidebar rail and opens persistent contrast, focus, keyboard, zoom, motion, and speech preferences",
      "Main-menu sections open reliably on the first click, including Accessibility and Quality Assurance",
    ],
  },
  {
    icon: Palette,
    title: "Themes, backgrounds, and accents",
    description: "Personalize the workspace with visual choices that carry consistently through the application.",
    category: "Platform",
    features: [
      "Choose from light, dark, and glass-inspired themes to set the overall tone of the workspace",
      "Select a background image or use a clean backdrop, with the choice applied consistently across the application shell",
      "Custom accent colors carry through active navigation, buttons, controls, highlights, and status treatments",
      "Theme-aware contrast keeps text, header branding, account menus, charts, dialogs, and flyouts readable on every surface",
      "Account menus, dropdowns, dialogs, sidebar flyouts, and nested menus share the selected visual treatment instead of revealing distracting page content behind them",
      "Scrollbar tracks and arrows stay hidden while rounded draggable thumbs preserve clean scrolling inside panels and dialogs",
      "Theme, accent, background, and scrollbar treatments remain consistent when moving between pages, dialogs, reports, and nested panels",
    ],
  },
  {
    icon: Sparkles,
    title: "Guidance and experience",
    description: "New guidance makes the platform easier to learn and return to.",
    category: "Platform",
    features: [
      "App Walkthrough highlights the header, navigation, menus, account controls, version, and updates",
      "App Updates now provides a complete release history for the recent platform improvements",
      "Version badges and update indicators make new capabilities easier to discover",
      "Accessible controls include descriptive labels for compact actions, filters, pagination, and icon buttons",
      "Stable loading, empty, error, and partial-progress states make long-running work clearer",
    ],
  },
  {
    icon: Database,
    title: "Deployment and operations",
    description: "Production packaging and large-scale operation received reliability improvements.",
    category: "Reliability",
    features: [
      "Startup migrations safely add newly required database columns to existing environments",
      "Production builds verify frontend assets, API bundles, browser rule bundles, and runtime dependencies",
      "Chrome profiles use a cache location outside the repository to prevent oversized checkpoints",
      "Scan status and report APIs use efficient SQL aggregation for large scans",
      "Health checks, workflow restarts, and startup recovery provide clearer operational signals",
    ],
  },
];

const ruleMappingReleaseGroups: UpdateGroup[] = [
  {
    icon: ShieldCheck,
    title: "Verified rule mappings and cloud-safe upgrades",
    description: "Accessibility findings now retain the correct rule identity across new scans and deployed environments.",
    category: "Accessibility",
    features: [
      "Corrected ACT-R32 to Siteimprove SIA-R32: visual-only video content must have an audio-track alternative",
      "ACT-R32 is now presented as a non-WCAG best-practice review instead of an enhanced touch-target finding",
      "Enhanced 44×44 target-size findings are recorded as ACT-R111 (WCAG 2.5.5 AAA), while 24×24 minimum findings use ACT-R113 (WCAG 2.5.8 AA)",
      "Startup migration safely reclassifies legacy R32 target-size findings and their scoring statistics during Azure deployment",
      "Rule labels, report metadata, documentation, and guided fixes now use the corrected mapping consistently",
    ],
  },
];

const release141ProductGroups: UpdateGroup[] = [
  {
    icon: Layers,
    title: "Page Groups and scoped insights",
    description: "Keep dashboards and issue review focused on the pages that matter to each team or journey.",
    category: "Reporting",
    features: [
      "Page Groups can be created, edited, and selected from the workspace without changing the active site",
      "The selected Page Group scopes dashboards, issue lists, affected pages, issue details, compliance cards, and score history",
      "Page Group coverage is captured at scan analysis start so retries and resumed scans keep a stable scope",
      "QA pages intentionally remain unfiltered so link, content, and inventory checks continue to represent the full scan",
      "Page Group selectors and empty states explain when a group has no matching pages or coverage yet",
    ],
  },
  {
    icon: Sparkles,
    title: "New screens and guided workspace flows",
    description: "New destinations make the platform easier to learn, organize, and use day to day.",
    category: "Platform",
    features: [
      "App Updates provides searchable release history, category filters, section jumps, counts, and expandable change details",
      "App Walkthrough introduces the header, site switcher, sidebar, accessibility controls, projects, scan history, and profile settings",
      "Manual Scan, Projects, Page Groups, Quality Assurance, Smart Analysis, and profile settings have clearer dedicated screens and entry points",
      "The refreshed welcome screen highlights the latest release, manual scanning, recent scans, walkthrough, and workspace personalization",
      "New header, sidebar, rail flyouts, account menu, themes, backgrounds, and accessibility controls are coordinated across the application",
    ],
  },
  {
    icon: CheckCircle2,
    title: "Bug fixes and reliability improvements",
    description: "The release removes recurring sources of incorrect results, lost context, and fragile long-running work.",
    category: "Reliability",
    features: [
      "Large report responses now use SQL aggregation instead of loading every issue row into server memory",
      "Failed crawler pages are requeued before completion, and active queue claims are protected from pending-URL removal",
      "Slow, WAF-protected, and JavaScript-heavy pages receive safer navigation retries and browser fallbacks",
      "Incremental scans never carry forward failed-page results, and visual assets are hydrated only when issue evidence needs them",
      "Site, project, Page Group, permission, target-scope, and legacy site-less history boundaries remain consistent across screens",
      "Theme, flyout, tooltip, account-menu, navigation, contrast, and responsive-layout fixes keep the redesigned shell usable across modes",
    ],
  },
  ...updateGroups.slice(2),
  ...ruleMappingReleaseGroups,
];

const release142ProductGroups: UpdateGroup[] = [
  updateGroups[0],
  updateGroups[2],
  updateGroups[3],
];

const release143ProductGroups: UpdateGroup[] = [
  updateGroups[0],
  updateGroups[1],
  updateGroups[2],
  updateGroups[3],
];

const release144ProductGroups: UpdateGroup[] = [
  {
    icon: Workflow,
    title: "Issue module workflow improvements",
    description: "Issue details, collaboration, evidence, and relationships are easier to manage without losing context.",
    category: "Platform",
    features: [
      "Issue descriptions and new comments open in focused dialogs, while issue pop-outs use the shared accessible dialog experience",
      "Rich-text tables support adding, deleting, and splitting rows and columns without losing existing cell content",
      "Authenticated inline images can be inserted and resized safely in descriptions and comments",
      "Comments and activity are separated into tabs inside a collapsible, fixed-height history panel so long tickets remain manageable",
      "Generic issue relationships can connect any visible issues independently of Epic assignment, while Epic hierarchy remains clearly separated",
      "Private attachments, inline evidence, HTML sanitization, ownership checks, and audit activity retain their existing security boundaries",
    ],
  },
  {
    icon: Accessibility,
    title: "Accessibility engine accuracy updates",
    description: "ACT rule execution and classification now align more closely with real media, landmark, table, and keyboard behavior.",
    category: "Accessibility",
    features: [
      "ACT-R37 now reports a Potential Issue for visible prerecorded videos when audio presence is unresolved and no audio-description track or complete media alternative is found",
      "Reviewers can confirm whether important visual events are conveyed through existing audio, synchronized audio description, or an equivalent alternative version",
      "Confirmed-silent videos remain excluded from ACT-R37 and continue through the appropriate visual-only media rules",
      "ACT-R22 detects videos with confirmed audio and missing captions, while unresolved audio remains a Potential Issue instead of being silently skipped",
      "ACT-R56 now groups duplicate unnamed landmarks correctly without misclassifying them as ACT-R40 region-name failures",
      "Rule validation distinguishes headerless tables, hidden communication iframes, and content-dependent media checks according to their exact Alfa applicability",
      "Focused regression coverage protects media registry selection plus confirmed-audio, unknown-audio, silent-video, description-track, and media-alternative outcomes",
    ],
  },
];

type ReleaseHistoryEntry = {
  version: string;
  month: string;
  label: string;
  summary: string;
  groups: UpdateGroup[];
};

export const releaseHistory: ReleaseHistoryEntry[] = [
  {
    version: APP_UPDATES_VERSION,
    month: APP_UPDATES_MONTH,
    label: "Current release",
    summary: "A stronger Issue module and more accurate accessibility engine behavior across media and structural rules.",
    groups: release144ProductGroups,
  },
  {
    version: "1.4.3",
    month: "August 2026",
    label: "Previous release",
    summary: "A complete issue workflow for accessibility teams, alongside clearer scan setup and scoped checks.",
    groups: release143ProductGroups,
  },
  {
    version: "1.4.2",
    month: "August 2026",
    label: "Previous release",
    summary: "A clearer manual scan setup, scoped accessibility checks, and patch release continuity for the 1.4 minor release line.",
    groups: release142ProductGroups,
  },
  {
    version: APP_RULE_MAPPING_RELEASE,
    month: "August 2026",
    label: "Previous release",
    summary: "New screens, scoped Page Group insights, reliability fixes, and corrected historical rule mappings.",
    groups: release141ProductGroups,
  },
  {
    version: "1.3.0",
    month: "July 2026",
    label: "Previous release",
    summary: "A stronger foundation for accessibility scanning, reports, and team workflows.",
    groups: [
      {
        icon: Accessibility,
        title: "ACT and WCAG rule foundations",
        description: "More standards-aware checks and clearer rule evidence.",
        category: "Accessibility",
        features: [
          "ACT-aligned rule identifiers and WCAG criteria are presented consistently in findings",
          "Rule evidence includes selectors, HTML context, impact, remediation, and legal mapping",
          "Potential Issue outcomes are separated from confirmed Issues when human review is needed",
        ],
      },
      {
        icon: Workflow,
        title: "Scan lifecycle controls",
        description: "Long-running scans are easier to monitor and recover.",
        category: "Scanning",
        features: [
          "Pause, resume, retry, cancel, and recovery states are reflected consistently",
          "Live scan progress includes current URL, stage, timing, and issue counts",
          "Queued pages are claimed atomically so active work is protected from queue changes",
        ],
      },
      {
        icon: BarChart3,
        title: "Reports and exports",
        description: "Turn scan results into practical views for review and sharing.",
        category: "Reporting",
        features: [
          "WCAG, ADA, and EAA compliance views provide an overview of scan health",
          "Rule reports, page-level details, and Smart Analysis connect findings to patterns",
          "CSV, Excel, and PDF exports support reporting outside the platform",
        ],
      },
      {
        icon: ShieldCheck,
        title: "Protected-site scanning",
        description: "More resilient capture for slow, proxied, and JavaScript-heavy sites.",
        category: "Reliability",
        features: [
          "Browser fallback handles WAF responses and JavaScript challenges more safely",
          "Progressive navigation retries give slow pages more time without hanging a run",
          "Rendered snapshots preserve CSS and visual assets for stable report layouts",
        ],
      },
      {
        icon: Database,
        title: "Operational safeguards",
        description: "Large scans and deployed environments get safer defaults.",
        category: "Reliability",
        features: [
          "Large report endpoints use database aggregation instead of loading every row into memory",
          "Startup migrations add newly required columns safely to existing environments",
          "Production packaging verifies browser rule bundles and runtime assets",
        ],
      },
    ],
  },
];

const CATEGORY_OPTIONS: UpdateCategory[] = [
  "Accessibility",
  "Scanning",
  "Reliability",
  "Reporting",
  "Platform",
];

function updateGroupId(title: string) {
  return `update-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

function UpdateCard({
  group,
  open,
  onToggle,
}: {
  group: UpdateGroup;
  open: boolean;
  onToggle: () => void;
}) {
  const Icon = group.icon;
  const id = updateGroupId(group.title);
  const panelId = `${id}-content`;
  return (
    <div
      id={id}
      data-testid={`card-update-${group.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
      className={`scroll-mt-6 rounded-xl border bg-card transition-colors ${
        open ? "border-primary/30 shadow-sm" : "hover:border-primary/30 hover:bg-muted/30"
      }`}
    >
      <h2>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={onToggle}
          className="flex min-h-[76px] w-full items-center gap-3 rounded-xl px-4 py-3 text-left outline-none transition-colors hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon className="h-4.5 w-4.5" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold">{group.title}</span>
              <Badge variant="secondary" className="h-5 px-1.5 text-[10px] font-medium">
                {group.category}
              </Badge>
            </span>
            <span className="mt-1 block text-sm leading-5 text-muted-foreground">
              {group.description}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-2 text-muted-foreground">
            <span className="hidden text-xs sm:inline">{group.features.length} changes</span>
            {open ? (
              <ChevronUp className="h-4 w-4" aria-hidden="true" />
            ) : (
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
            )}
          </span>
        </button>
      </h2>
      {open && (
        <div id={panelId} className="border-t px-4 pb-4 pt-3">
          <ul className="space-y-2">
            {group.features.map((feature) => (
              <li key={feature} className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" aria-hidden="true" />
                <span>{feature}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

type WalkthroughId =
  | "header"
  | "site-switcher"
  | "sidebar"
  | "accessibility-mode"
  | "personalize"
  | "new-scan"
  | "scan-history"
  | "projects"
  | "profile"
  | "vision-glass";

const walkthroughSections: Array<{
  id: WalkthroughId;
  label: string;
  eyebrow: string;
  title: string;
  description: string;
  icon: typeof Accessibility;
  accent: string;
}> = [
  {
    id: "header",
    label: "Header",
    eyebrow: "Everything important, visible",
    title: "A header built around the next action",
    description: "Version, support, updates, walkthrough, documentation, and account actions now sit together in a calm, consistent header.",
    icon: Sparkles,
    accent: "from-fuchsia-500 via-violet-500 to-blue-500",
  },
  {
    id: "site-switcher",
    label: "Site switcher",
    eyebrow: "Stay in the right context",
    title: "Switch sites without leaving your workflow",
    description: "The active site is always close to the center of the header, so scans, projects, dashboards, and navigation stay scoped correctly.",
    icon: Globe,
    accent: "from-cyan-400 via-sky-500 to-violet-500",
  },
  {
    id: "sidebar",
    label: "Sidebar",
    eyebrow: "Navigate with confidence",
    title: "A rail and panel that adapt to your workspace",
    description: "Collapse the sidebar, search destinations, open grouped sections, and use flyouts without losing your place.",
    icon: PanelLeft,
    accent: "from-violet-500 via-fuchsia-500 to-rose-400",
  },
  {
    id: "accessibility-mode",
    label: "Accessibility mode",
    eyebrow: "Tune the experience",
    title: "Accessibility controls are always within reach",
    description: "Contrast, focus, keyboard, zoom, motion, and speech preferences live in the centered rail control and persist between visits.",
    icon: Accessibility,
    accent: "from-emerald-400 via-teal-500 to-cyan-500",
  },
  {
    id: "personalize",
    label: "Themes, backgrounds & accents",
    eyebrow: "Make it yours",
    title: "Themes, backgrounds, and accents that follow you",
    description: "Choose a theme, background, and app accent once, then see the selected treatment carried through the shell, active states, and controls.",
    icon: Palette,
    accent: "from-amber-300 via-orange-400 to-fuchsia-500",
  },
  {
    id: "vision-glass",
    label: "Backgrounds",
    eyebrow: "Set the scene",
    title: "Backgrounds that complement your workspace",
    description: "Choose a background image that complements your selected theme and accent while keeping content, menus, and controls readable.",
    icon: Palette,
    accent: "from-sky-300 via-cyan-400 to-violet-500",
  },
  {
    id: "new-scan",
    label: "New Scan",
    eyebrow: "Start with context",
    title: "Create a scan with the right project attached",
    description: "The updated flow puts Scan Title, Project, and target URLs together so new work is organized before it starts.",
    icon: Workflow,
    accent: "from-violet-500 via-fuchsia-500 to-rose-400",
  },
  {
    id: "scan-history",
    label: "Scan History",
    eyebrow: "Find work faster",
    title: "Filter history by the active site and project",
    description: "Manual Scan History keeps the useful filters close at hand, with scan titles and status visible in the results.",
    icon: Filter,
    accent: "from-cyan-400 via-blue-500 to-violet-500",
  },
  {
    id: "projects",
    label: "Manage Projects",
    eyebrow: "Keep work organized",
    title: "Create and link projects under a site",
    description: "Project management makes site associations explicit and keeps the New Scan selector focused on the active site.",
    icon: FolderOpen,
    accent: "from-amber-300 via-orange-400 to-fuchsia-500",
  },
  {
    id: "profile",
    label: "Profile settings",
    eyebrow: "Stay in control",
    title: "Account details and password security in one place",
    description: "The profile area brings identity fields and password changes into a clear, dedicated settings experience.",
    icon: UserRound,
    accent: "from-emerald-400 via-teal-500 to-cyan-500",
  },
];

function PreviewField({
  label,
  value,
  wide = false,
}: {
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "sm:col-span-2" : ""}>
      <p className="mb-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-400">{label}</p>
      <div className="rounded-md border border-slate-700 bg-slate-900/90 px-2.5 py-2 text-[11px] text-slate-200">
        {value}
      </div>
    </div>
  );
}

function useSharedBranding() {
  const [brandName, setBrandName] = useState(DEFAULT_LOGO_TEXT);
  const [brandSubtitle, setBrandSubtitle] = useState(DEFAULT_LOGO_SUBTITLE);

  useEffect(() => {
    const applyBranding = (data: { text?: string; subtitle?: string }) => {
      if (data.text !== undefined) setBrandName(data.text || DEFAULT_LOGO_TEXT);
      if (data.subtitle !== undefined) setBrandSubtitle(data.subtitle || DEFAULT_LOGO_SUBTITLE);
    };
    const loadBranding = () =>
      fetch(`${BRANDING_BASE}/api/logo`)
        .then((response) => response.json())
        .then(applyBranding)
        .catch(() => {});
    loadBranding();
    const syncBranding = (event: Event) => {
      const detail = (event as CustomEvent<{ text?: string; subtitle?: string }>).detail;
      if (detail) applyBranding(detail);
    };
    window.addEventListener("a11y-logo-changed", syncBranding);
    return () => window.removeEventListener("a11y-logo-changed", syncBranding);
  }, []);

  return { brandName, brandSubtitle };
}

function WalkthroughPreview({ id }: { id: WalkthroughId }) {
  const { brandName, brandSubtitle } = useSharedBranding();

  if (id === "header") {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
          <div className="h-6 w-6 rounded-md bg-gradient-to-br from-fuchsia-400 to-violet-600" />
          <span className="flex flex-col">
            <span className="text-[11px] font-semibold text-slate-200">{brandName}</span>
            <span className="text-[7px] leading-tight text-slate-500">{brandSubtitle}</span>
          </span>
          <span className="rounded border border-fuchsia-400/30 bg-fuchsia-400/10 px-1.5 py-0.5 font-mono text-[8px] text-fuchsia-300">
            v{APP_UPDATES_VERSION}
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            {["Support", "Updates", "Tour", "Docs"].map((label) => (
              <span key={label} className="rounded-md bg-slate-800 px-2 py-1 text-[8px] text-slate-300">
                {label}
              </span>
            ))}
            <span className="ml-1 flex h-6 w-6 items-center justify-center rounded-full bg-fuchsia-400/25 text-[8px] font-semibold text-fuchsia-100">
              AM
            </span>
          </div>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-3">
          <p className="text-[10px] font-semibold text-slate-200">One place for the next step</p>
          <p className="mt-1 text-[9px] leading-4 text-slate-500">
            Release notes, guided help, documentation, and your account are always one click away.
          </p>
        </div>
      </div>
    );
  }

  if (id === "site-switcher") {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">Current context</p>
            <p className="mt-1 text-base font-semibold text-white">Site switcher</p>
          </div>
          <span className="rounded-md border border-cyan-400/30 bg-cyan-400/10 px-2 py-1.5 text-[9px] text-cyan-200">2 sites</span>
        </div>
        <div className="rounded-lg border border-cyan-400/40 bg-cyan-400/10 p-3">
          <p className="text-[9px] uppercase tracking-[0.12em] text-cyan-200">Active site</p>
          <div className="mt-2 flex items-center justify-between">
            <div>
              <p className="text-[12px] font-semibold text-white">Marketing site</p>
              <p className="mt-0.5 text-[9px] text-slate-400">https://example.com</p>
            </div>
            <ChevronDown className="h-4 w-4 text-cyan-200" aria-hidden="true" />
          </div>
        </div>
        <div className="space-y-1 rounded-lg border border-slate-800 bg-slate-900/70 p-2">
          {["Marketing site", "Product documentation"].map((site, index) => (
            <div key={site} className={`flex items-center justify-between rounded-md px-2 py-2 text-[10px] ${index === 0 ? "bg-cyan-400/10 text-cyan-100" : "text-slate-400"}`}>
              {site}
              {index === 0 && <CheckCircle2 className="h-3.5 w-3.5 text-cyan-300" aria-hidden="true" />}
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (id === "sidebar") {
    return (
      <div className="flex min-h-[245px] gap-3">
        <div className="flex w-12 shrink-0 flex-col items-center gap-3 rounded-lg bg-gradient-to-b from-violet-600 to-fuchsia-700 py-3">
          <PanelLeft className="h-4 w-4 text-white" aria-hidden="true" />
          <Workflow className="h-4 w-4 text-white/70" aria-hidden="true" />
          <BarChart3 className="h-4 w-4 text-white/70" aria-hidden="true" />
          <UserRound className="mt-auto h-4 w-4 text-white/80" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1 rounded-lg border border-slate-800 bg-slate-900/70 p-3">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <span className="text-[11px] text-slate-300">Main menu</span>
            <div className="flex gap-1.5">
              <Search className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
              <PanelLeft className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
            </div>
          </div>
          <div className="mt-3 rounded-md border border-slate-700 bg-slate-950 px-2.5 py-2 text-[9px] text-slate-500">
            Search sidebar...
          </div>
          <div className="mt-3 space-y-1.5">
            {["Accessibility", "Quality Assurance", "Reports", "Site management"].map((item, index) => (
              <div key={item} className={`rounded-md px-2.5 py-2 text-[10px] ${index === 0 ? "bg-fuchsia-400/15 text-fuchsia-100" : "text-slate-400"}`}>
                {item}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (id === "accessibility-mode") {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-3 rounded-lg border border-emerald-400/30 bg-emerald-400/10 p-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-400/20">
            <Accessibility className="h-5 w-5 text-emerald-200" aria-hidden="true" />
          </div>
          <div>
            <p className="text-[11px] font-semibold text-white">Accessibility mode</p>
            <p className="mt-0.5 text-[9px] text-emerald-100/70">Preferences persist across visits</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {["Contrast", "Focus", "Keyboard", "Zoom", "Motion", "Speech"].map((item, index) => (
            <div key={item} className="flex items-center justify-between rounded-md border border-slate-800 bg-slate-900/70 px-2.5 py-2">
              <span className="text-[9px] text-slate-300">{item}</span>
              <span className={`h-3.5 w-6 rounded-full p-0.5 ${index < 2 ? "bg-emerald-400" : "bg-slate-700"}`}>
                <span className={`block h-2.5 w-2.5 rounded-full bg-white ${index < 2 ? "ml-2.5" : ""}`} />
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (id === "personalize") {
    return (
      <div className="space-y-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">Settings</p>
          <p className="mt-1 text-base font-semibold text-white">Theme and accent</p>
        </div>
        <div>
          <p className="mb-2 text-[9px] font-semibold text-slate-300">Theme</p>
          <div className="grid grid-cols-3 gap-2">
            {["System", "Light", "Dark"].map((theme, index) => (
              <div key={theme} className={`rounded-md border px-2 py-2 text-center text-[9px] ${index === 0 ? "border-fuchsia-400 bg-fuchsia-400/15 text-fuchsia-100" : "border-slate-700 text-slate-400"}`}>
                {theme}
              </div>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-2 text-[9px] font-semibold text-slate-300">App accent</p>
          <div className="flex gap-2">
            {["#6366f1", "#d946ef", "#14b8a6", "#f97316", "#0ea5e9"].map((color, index) => (
              <span key={color} className={`h-6 w-6 rounded-full ${index === 0 ? "ring-2 ring-white ring-offset-2 ring-offset-slate-950" : ""}`} style={{ backgroundColor: color }} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (id === "vision-glass") {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">Appearance</p>
            <p className="mt-1 text-base font-semibold text-white">Themes, backgrounds, and accents</p>
          </div>
          <span className="rounded-full bg-cyan-400/15 px-2 py-1 text-[9px] font-semibold text-cyan-200">Personalized</span>
        </div>
        <div className="relative overflow-hidden rounded-lg border border-white/15 bg-slate-800/80 p-3">
          <div className="pointer-events-none absolute -right-8 -top-10 h-24 w-24 rounded-full bg-cyan-300/20 blur-2xl" />
          <div className="relative rounded-md border border-white/15 bg-white/10 p-3 backdrop-blur">
            <div className="flex items-center justify-between">
              <div>
            <p className="text-[9px] uppercase tracking-[0.12em] text-cyan-200">Workspace appearance</p>
            <p className="mt-1 text-[11px] font-semibold text-white">Your visual system</p>
              </div>
              <span className="h-5 w-5 rounded-full bg-white/80 shadow-[0_0_12px_rgba(255,255,255,0.25)]" />
            </div>
            <div className="mt-3 flex gap-2">
              <span className="h-2 flex-1 rounded-full bg-white/25" />
              <span className="h-2 w-10 rounded-full bg-cyan-300/70" />
            </div>
          </div>
          <div className="mt-2 flex items-center gap-2 text-[9px] text-slate-300">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-300" />
            Themes, backgrounds, and accents stay coordinated across the app
          </div>
        </div>
        <div className="flex items-center justify-between rounded-md border border-slate-700 bg-slate-900/70 px-3 py-2">
          <span className="text-[10px] text-slate-300">Selected accent</span>
          <span className="h-4 w-4 rounded-full bg-cyan-300 shadow-[0_0_12px_rgba(103,232,249,0.5)]" />
        </div>
      </div>
    );
  }

  if (id === "new-scan") {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">Scanning</p>
            <p className="mt-1 text-base font-semibold text-white">New Scan</p>
          </div>
          <span className="rounded-full bg-fuchsia-400/15 px-2 py-1 text-[9px] font-semibold text-fuchsia-200">Manual</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <PreviewField label="Scan Title" value="Q3 marketing review" />
          <PreviewField label="Project" value="Marketing site" />
          <PreviewField label="Target URL" value="https://example.com" wide />
        </div>
        <div className="flex items-center justify-between border-t border-slate-800 pt-3">
          <span className="text-[10px] text-slate-400">Project required for new scans</span>
          <span className="rounded-md bg-fuchsia-500 px-3 py-2 text-[10px] font-semibold text-white shadow-lg shadow-fuchsia-500/20">
            Start scan
          </span>
        </div>
      </div>
    );
  }

  if (id === "scan-history") {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">Scans</p>
            <p className="mt-1 text-base font-semibold text-white">Manual Scan History</p>
          </div>
          <span className="rounded-md border border-slate-700 px-2.5 py-1.5 text-[9px] text-slate-300">Export</span>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <PreviewField label="Search" value="marketing" />
          <PreviewField label="Project" value="All projects" />
          <PreviewField label="Status" value="Completed" />
        </div>
        <div className="overflow-hidden rounded-md border border-slate-800">
          {[
            ["Q3 marketing review", "Marketing site", "Completed"],
            ["Homepage keyboard pass", "Core web", "Running"],
          ].map(([title, project, status]) => (
            <div key={title} className="flex items-center justify-between gap-3 border-b border-slate-800 px-3 py-2.5 last:border-0">
              <div className="min-w-0">
                <p className="truncate text-[11px] font-medium text-slate-200">{title}</p>
                <p className="mt-0.5 text-[9px] text-slate-500">{project}</p>
              </div>
              <span className={`shrink-0 rounded-full px-2 py-1 text-[9px] ${status === "Running" ? "bg-cyan-400/15 text-cyan-200" : "bg-emerald-400/15 text-emerald-200"}`}>
                {status}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (id === "projects") {
    return (
      <div className="space-y-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">Workspace</p>
          <p className="mt-1 text-base font-semibold text-white">Manage Projects</p>
        </div>
        <div className="rounded-md border border-slate-800 bg-slate-900/70 p-3">
          <p className="mb-2 text-[10px] font-semibold text-slate-200">Add a project under this site</p>
          <div className="flex gap-2">
            <div className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-950 px-2.5 py-2 text-[10px] text-slate-400">
              New project name…
            </div>
            <span className="rounded-md bg-orange-400 px-2.5 py-2 text-[9px] font-semibold text-slate-950">Create project</span>
          </div>
        </div>
        <div className="flex items-center justify-between rounded-md border border-slate-800 px-3 py-2.5">
          <div>
            <p className="text-[11px] font-medium text-slate-200">Marketing site</p>
            <p className="mt-0.5 text-[9px] text-slate-500">Available for the active site</p>
          </div>
          <span className="rounded-full bg-amber-300/15 px-2 py-1 text-[9px] text-amber-200">Linked</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-fuchsia-400/20 text-sm font-semibold text-fuchsia-100">AM</div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">Profile</p>
          <p className="mt-1 text-base font-semibold text-white">Account details</p>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <PreviewField label="Full name" value="Alex Morgan" />
        <PreviewField label="Username" value="alex.morgan" />
        <PreviewField label="Email" value="alex@example.com" wide />
      </div>
      <div className="flex items-center justify-between border-t border-slate-800 pt-3">
        <div>
          <p className="text-[11px] font-medium text-slate-200">Change password</p>
          <p className="mt-0.5 text-[9px] text-slate-500">Update your account security settings</p>
        </div>
        <span className="rounded-md border border-slate-700 px-2.5 py-1.5 text-[9px] text-slate-300">Open</span>
      </div>
    </div>
  );
}

function InterfaceUpdateShowcase() {
  const [activeId, setActiveId] = useState<WalkthroughId>("new-scan");
  const { brandName, brandSubtitle } = useSharedBranding();
  const active = walkthroughSections.find((item) => item.id === activeId) ?? walkthroughSections[0];
  const ActiveIcon = active.icon;
  const panelId = `walkthrough-panel-${active.id}`;

  return (
    <section className="relative overflow-hidden rounded-2xl border border-primary/25 bg-slate-950 text-white shadow-[0_20px_60px_rgba(76,29,149,0.18)]">
      <div className={`pointer-events-none absolute -right-28 -top-36 h-96 w-96 rounded-full bg-gradient-to-br ${active.accent} opacity-25 blur-3xl transition-all duration-700`} />
      <div className="relative grid gap-8 p-5 sm:p-7 lg:grid-cols-[minmax(220px,0.8fr)_minmax(0,1.2fr)] lg:items-center lg:p-9">
        <div>
          <div className="mb-4 flex items-center gap-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 ring-1 ring-white/15">
              <Sparkles className="h-4 w-4 text-fuchsia-300" aria-hidden="true" />
            </span>
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-fuchsia-200">
              UI walkthrough
            </span>
          </div>
          <h2 className="max-w-md text-2xl font-bold tracking-tight sm:text-3xl">
            See what changed, in context.
          </h2>
          <p className="mt-3 max-w-md text-sm leading-6 text-slate-300">
            Explore the sections and fields that make the latest workflow updates useful day to day.
          </p>

          <div className="mt-6 flex flex-wrap gap-2" role="tablist" aria-label="Updated product sections">
            {walkthroughSections.map((item) => {
              const Icon = item.icon;
              const selected = activeId === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-controls={panelId}
                  onClick={() => setActiveId(item.id)}
                  className={`inline-flex min-h-10 items-center gap-2 rounded-full px-3.5 text-xs font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-300 ${
                    selected
                      ? "bg-white text-slate-950 shadow-lg shadow-fuchsia-950/30"
                      : "bg-white/10 text-slate-300 hover:bg-white/15 hover:text-white"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  {item.label}
                </button>
              );
            })}
          </div>

          <div className="mt-7 border-l-2 border-fuchsia-400/70 pl-4" role="tabpanel" id={panelId}>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-fuchsia-200">
              {active.eyebrow}
            </p>
            <h3 className="mt-1 text-lg font-semibold">{active.title}</h3>
            <p className="mt-2 text-sm leading-6 text-slate-300">{active.description}</p>
          </div>
        </div>

        <div className="relative min-h-[280px] overflow-hidden rounded-xl border border-white/10 bg-slate-900/80 p-3 shadow-2xl sm:min-h-[330px] sm:p-5">
          <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${active.accent} transition-all duration-500`} />
          <div className="absolute -bottom-16 -left-10 h-44 w-44 rounded-full bg-fuchsia-500/10 blur-3xl" />
          <div className="relative h-full overflow-hidden rounded-lg border border-slate-700/80 bg-slate-950">
            <div className="flex h-10 items-center justify-between border-b border-slate-800 px-3">
              <div className="flex items-center gap-2">
                <div className="h-5 w-5 rounded-md bg-gradient-to-br from-fuchsia-400 to-violet-600" />
                <span className="flex flex-col">
                  <span className="text-[10px] font-semibold text-slate-300">{brandName}</span>
                  <span className="text-[7px] leading-tight text-slate-500">{brandSubtitle}</span>
                </span>
                <span className="rounded border border-fuchsia-400/30 bg-fuchsia-400/10 px-1.5 py-0.5 font-mono text-[8px] text-fuchsia-300">
                  v{APP_UPDATES_VERSION}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="h-5 w-5 rounded-md bg-slate-800" />
                <div className="h-6 w-6 rounded-full bg-slate-700 ring-2 ring-slate-800" />
              </div>
            </div>
            <div className="flex min-h-[250px]">
              <div className="flex w-11 shrink-0 flex-col items-center gap-3 border-r border-slate-800 bg-gradient-to-b from-violet-600 to-fuchsia-700 py-3">
                <PanelLeft className="h-4 w-4 text-white" aria-hidden="true" />
                <Workflow className="h-4 w-4 text-white/50" aria-hidden="true" />
                <BarChart3 className="h-4 w-4 text-white/50" aria-hidden="true" />
                <UserRound className="mt-auto h-4 w-4 text-white/80" aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1 p-4">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <ActiveIcon className="h-4 w-4 text-fuchsia-300" aria-hidden="true" />
                      <span className="text-[11px] font-semibold text-slate-200">{active.label}</span>
                    </div>
                    <p className="mt-1 text-[9px] text-slate-500">Updated workspace controls</p>
                  </div>
                  <span className="rounded-md bg-fuchsia-500/80 px-2.5 py-1.5 text-[9px] font-semibold text-white">
                    {active.id === "new-scan" ? "Start scan" : "View details"}
                  </span>
                </div>
                <WalkthroughPreview id={active.id} />
              </div>
            </div>
          </div>
          <div className="absolute bottom-4 right-4 flex items-center gap-2 rounded-full border border-white/10 bg-slate-800/90 px-3 py-1.5 text-[10px] font-medium text-slate-300 shadow-xl backdrop-blur">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            Read-only walkthrough
          </div>
        </div>
      </div>
    </section>
  );
}

export function AppUpdatesContent({ compact = false }: { compact?: boolean }) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<UpdateCategory | "All">("All");
  const [selectedReleaseVersion, setSelectedReleaseVersion] = useState(APP_UPDATES_VERSION);
  const [openGroups, setOpenGroups] = useState<Set<string>>(
    () => new Set(updateGroups.slice(0, 2).map((group) => updateGroupId(group.title))),
  );
  const selectedRelease =
    releaseHistory.find((release) => release.version === selectedReleaseVersion) ?? releaseHistory[0];
  const selectedGroups = selectedRelease.groups;

  const selectRelease = (version: string) => {
    const release = releaseHistory.find((entry) => entry.version === version);
    if (!release) return;
    setSelectedReleaseVersion(version);
    setSearch("");
    setCategory("All");
    setOpenGroups(new Set(release.groups.slice(0, 2).map((group) => updateGroupId(group.title))));
  };

  const filteredGroups = useMemo(() => {
    const query = search.trim().toLowerCase();
    return selectedGroups.filter((group) => {
      if (category !== "All" && group.category !== category) return false;
      if (!query) return true;
      return [
        group.title,
        group.description,
        group.category,
        ...group.features,
      ].some((value) => value.toLowerCase().includes(query));
    });
  }, [category, search, selectedGroups]);

  const allVisibleOpen =
    filteredGroups.length > 0 &&
    filteredGroups.every((group) => openGroups.has(updateGroupId(group.title)));

  const toggleGroup = (title: string) => {
    const id = updateGroupId(title);
    setOpenGroups((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const setVisibleGroupsOpen = (open: boolean) => {
    setOpenGroups((current) => {
      const next = new Set(current);
      filteredGroups.forEach((group) => {
        const id = updateGroupId(group.title);
        if (open) next.add(id);
        else next.delete(id);
      });
      return next;
    });
  };

  const jumpToGroup = (group: UpdateGroup) => {
    const id = updateGroupId(group.title);
    setOpenGroups((current) => new Set(current).add(id));
    window.setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  };

  useEffect(() => {
    const hash = window.location.hash.slice(1);
    const group = selectedGroups.find((candidate) => updateGroupId(candidate.title) === hash);
    if (group) jumpToGroup(group);
    // The release page reads the hash once when it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedReleaseVersion]);

  return (
    <div className={compact ? "space-y-5" : "space-y-7"}>
      <div className={compact ? "flex flex-wrap items-start justify-between gap-4" : "grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]"}>
        <div>
          <Badge className="mb-3 gap-1.5 bg-primary/10 text-primary hover:bg-primary/15">
            <Sparkles className="h-3.5 w-3.5" />
            Version {selectedRelease.version}
          </Badge>
          <h1 className={compact ? "text-2xl font-bold tracking-tight" : "text-3xl font-bold tracking-tight text-foreground"}>
            What&apos;s new
          </h1>
          <p className="mt-1 max-w-2xl text-muted-foreground">
            A complete look at the latest accessibility scanning, project organization,
            reporting, reliability, and platform improvements.
          </p>
          {!compact && (
            <div className="mt-5 rounded-xl border border-primary/15 bg-primary/[0.035] p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="font-mono text-xs">
                  v{selectedRelease.version} · {selectedRelease.month}
                </Badge>
                <span className="text-xs font-medium text-muted-foreground">{selectedRelease.label}</span>
              </div>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                {selectedRelease.summary}
              </p>
            </div>
          )}
        </div>

        {compact ? (
          <Badge variant="outline" className="font-mono text-xs">
            v{selectedRelease.version} · {selectedRelease.month}
          </Badge>
        ) : (
          <Card className="overflow-hidden rounded-2xl border-primary/20 bg-card/70 shadow-[0_10px_34px_rgba(109,72,199,0.08)] backdrop-blur-xl">
            <CardHeader className="space-y-0 border-b border-border/60 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <RefreshCw className="h-4 w-4 text-primary" />
                  Release history
                </CardTitle>
                <Badge variant="secondary" className="font-mono text-[10px]">
                  {releaseHistory.length}
                </Badge>
              </div>
              <CardDescription className="sr-only">
                Browse product improvements version by version.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-2">
              <div className="app-scrollbar max-h-64 space-y-1 overflow-y-auto pr-1">
                {releaseHistory.map((release) => {
                  const selected = release.version === selectedRelease.version;
                  return (
                    <button
                      key={release.version}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => selectRelease(release.version)}
                      className={`group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                        selected
                          ? "bg-primary/10 text-foreground"
                          : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                      }`}
                    >
                      <span className={`h-2 w-2 shrink-0 rounded-full ${selected ? "bg-primary" : "bg-muted-foreground/35"}`} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <span className="font-mono text-xs font-semibold">v{release.version}</span>
                          <span className="shrink-0 text-[10px] text-muted-foreground">{release.month}</span>
                        </span>
                        <span className="mt-0.5 block truncate text-[11px]">
                          {release.groups.length} update {release.groups.length === 1 ? "area" : "areas"}
                        </span>
                      </span>
                      <span className={`text-xs transition-transform group-hover:translate-x-0.5 ${selected ? "text-primary" : "text-muted-foreground/60"}`}>
                        →
                      </span>
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {!compact && <InterfaceUpdateShowcase />}

      <Card className="overflow-hidden border-primary/20">
        <div className="h-1 bg-gradient-to-r from-primary via-violet-500 to-fuchsia-500" />
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            {selectedRelease.label}
          </CardTitle>
          <CardDescription>
            {selectedRelease.summary}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {selectedGroups.slice(0, 8).map((group) => {
            const Icon = group.icon;
            return (
              <div key={group.title} className="flex items-start gap-2 rounded-lg bg-muted/40 p-3 text-sm">
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <span>{group.title}</span>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3 rounded-xl border bg-card/60 p-3 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search updates..."
            aria-label="Search updates"
            className="h-10 pl-9"
          />
        </div>
        <div className="flex min-w-0 items-center gap-2 overflow-x-auto">
          <Filter className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="flex gap-1.5" role="group" aria-label="Filter updates by category">
            {(["All", ...CATEGORY_OPTIONS] as const).map((option) => (
              <Button
                key={option}
                type="button"
                size="sm"
                variant={category === option ? "secondary" : "ghost"}
                className="h-8 shrink-0 rounded-full px-3 text-xs"
                onClick={() => setCategory(option)}
                aria-pressed={category === option}
              >
                {option}
              </Button>
            ))}
          </div>
        </div>
        <div className="flex shrink-0 items-center justify-end gap-1 border-t pt-2 sm:border-l sm:border-t-0 sm:pl-3 sm:pt-0">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8 text-xs"
            onClick={() => setVisibleGroupsOpen(!allVisibleOpen)}
            disabled={filteredGroups.length === 0}
          >
            {allVisibleOpen ? "Collapse all" : "Expand all"}
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>
          Showing {filteredGroups.length} of {selectedGroups.length} update areas in v{selectedRelease.version}
        </span>
        {(search || category !== "All") && (
          <button
            type="button"
            className="font-medium text-primary hover:underline"
            onClick={() => {
              setSearch("");
              setCategory("All");
            }}
          >
            Clear filters
          </button>
        )}
      </div>

      <div className={compact ? "space-y-3" : "grid gap-6 lg:grid-cols-[minmax(0,1fr)_230px]"}>
        <div className="space-y-3">
          {filteredGroups.length > 0 ? (
            filteredGroups.map((group) => (
              <UpdateCard
                key={group.title}
                group={group}
                open={openGroups.has(updateGroupId(group.title))}
                onToggle={() => toggleGroup(group.title)}
              />
            ))
          ) : (
            <Card>
              <CardContent className="flex flex-col items-center justify-center px-6 py-12 text-center">
                <Search className="mb-3 h-8 w-8 text-muted-foreground/60" aria-hidden="true" />
                <p className="font-medium">No updates found</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Try a different search term or clear the category filter.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
        {!compact && (
          <aside className="h-fit rounded-2xl border border-primary/15 bg-card/55 p-3 shadow-sm backdrop-blur-xl lg:sticky lg:top-4">
            <div className="mb-2 flex items-center gap-2 px-2">
              <ListFilter className="h-4 w-4 text-primary" aria-hidden="true" />
              <h2 className="text-sm font-semibold">In this release</h2>
            </div>
            <nav aria-label="Release sections" className="space-y-0.5">
              {selectedGroups.map((group) => (
                <button
                  key={group.title}
                  type="button"
                  className="flex min-h-9 w-full items-center justify-between gap-2 rounded-md px-2 text-left text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  onClick={() => jumpToGroup(group)}
                >
                  <span className="truncate">{group.title}</span>
                  <span className="shrink-0 text-[10px] text-muted-foreground/70">
                    {group.features.length}
                  </span>
                </button>
              ))}
            </nav>
          </aside>
        )}
      </div>
    </div>
  );
}

export default function AppUpdates() {
  return (
    <div className="w-full">
      <AppUpdatesContent />
    </div>
  );
}