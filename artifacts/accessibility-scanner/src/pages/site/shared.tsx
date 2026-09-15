import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { useSite as useSiteContext } from "@/contexts/site";
import { usePageGroup } from "@/contexts/page-group";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  AlertTriangle,
  Info,
  Minus,
  Search,
  X,
  ChevronsLeft,
  ChevronsRight,
  ExternalLink,
} from "lucide-react";

export const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Site {
  id: number;
  name: string;
  baseUrl: string;
  description: string | null;
  targetScore?: number | null;
  targetWcagLevel?: "A" | "AA" | "AAA";
}

export interface SessionInfo {
  crawlerId: number;
  completedAt: string;
  totalScanned: number;
  totalDiscovered: number;
  brokenLinksCount: number;
}

export interface Coverage {
  totalScanned: number;
  totalDiscovered: number;
  pagesWithIssues: number;
  pagesWithoutIssues: number;
  totalOccurrences: number;
  distinctRules: number;
  brokenLinks: number;
  automaticApplicabilityCoverage?: number;
  ruleExecution?: RuleCoverage[];
  confidence?: ScanConfidence;
}

export interface RuleCoverage {
  ruleId: string;
  selected: number;
  notSelected: number;
  notApplicable: number;
  executed: number;
  manual: number;
  failed: number;
  executionTier: "automatic" | "manual";
}

export interface ScanConfidence {
  classification: "high" | "medium" | "low" | "unavailable";
  score: number | null;
  basis: string[];
  completedPages: number;
  failedPages: number;
  automaticApplicabilityCoverage: number;
  manualUnresolved: number;
  potentialUnresolved: number;
  fallbackDenominatorPages: number;
  carriedForwardPages: number;
}

export interface ImpactRow {
  impact: string;
  occurrences: number;
  pages_affected: number;
  distinct_rules: number;
}

export interface TopIssue {
  rule_id: string;
  description: string;
  impact: string;
  wcag_criteria: string | null;
  wcag_level: string | null;
  occurrences: number;
  pages_affected: number;
  points_to_gain: number;
}

export interface LevelScore {
  level: string;
  score: number;
  occurrences: number;
  pagesAffected: number;
  distinctRules: number;
}

export interface DashboardData {
  site: Site;
  session: SessionInfo | null;
  score: number | null;
  scoreDelta: number | null;
  previousScore: number | null;
  coverage: Coverage | null;
  levelScores: LevelScore[];
  impactBreakdown: ImpactRow[];
  topIssues: TopIssue[];
  topPotentialIssues: TopIssue[];
  resolvedIssues: TopIssue[];
}

export interface ScoreHistoryPoint {
  score: number;
  scanned_at: string;
  total_scanned?: number;
  level_a_issues?: number;
  level_aa_issues?: number;
  total_issues?: number;
  level_a_potential?: number;
  level_aa_potential?: number;
  total_potential_issues?: number;
}

export interface PageGroup {
  page_type: string;
  pages: number;
  scanned_pages: number;
  pages_with_issues: number;
  total_occurrences: number;
  distinct_rules: number;
  issues_count: number;
  potential_issues_count: number;
  score: number | null;
  points_to_target: number | null;
}

export interface IssueRow {
  rule_id: string;
  description: string;
  impact: string;
  wcag_criteria: string | null;
  wcag_level: string | null;
  occurrences: number;
  pages_affected: number;
  points_to_gain: number;
}

export interface IssuesResponse {
  issues: IssueRow[];
  total: number;
  totalOccurrences: number;
  page: number;
  limit: number;
}

export interface PagesWithIssuesResponse {
  pages: {
    pageId: number;
    url: string;
    title: string | null;
    issueCount: number;
    ruleCount: number;
    scannedAt: string | null;
  }[];
  total: number;
  totalOccurrences: number;
  page: number;
  limit: number;
  type: "issues" | "potential";
  scanId?: number;
}

// ── Hooks ────────────────────────────────────────────────────────────────────

export function useSite(siteId: number) {
  return useQuery<Site>({
    queryKey: ["site", siteId],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/sites/${siteId}`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load site");
      return r.json();
    },
  });
}

/**
 * Automatically switches the header site selector to match the site currently
 * being browsed. Call this once at the top of any `/sites/:id/*` page component.
 * No-ops when the site is already active (no flash / no loop).
 */
export function useAutoActiveSite(siteId: number) {
  const { sites, activeSite, setActiveSite } = useSiteContext();
  useEffect(() => {
    if (!siteId || sites.length === 0) return;
    if (activeSite?.id === siteId) return;
    const match = sites.find((s) => s.id === siteId);
    if (match) setActiveSite(match);
  }, [siteId, sites, activeSite, setActiveSite]);
}

// ── Breadcrumb ───────────────────────────────────────────────────────────────

export function SiteBreadcrumb({ siteId, siteName, current }: { siteId: number; siteName: string; current?: string }) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Link href="/crawler/sites" className="hover:underline">Sites</Link>
      <ChevronRight className="w-3 h-3" />
      {current ? (
        <Link href={`/sites/${siteId}`} className="hover:underline">{siteName}</Link>
      ) : (
        <span className="text-foreground font-medium">{siteName}</span>
      )}
      {current && (
        <>
          <ChevronRight className="w-3 h-3" />
          <span className="text-foreground font-medium">{current}</span>
        </>
      )}
    </div>
  );
}

// ── Primitive sub-components ──────────────────────────────────────────────────

export function ScoreGauge({ score }: { score: number }) {
  const radius = 42;
  const strokeWidth = 9;
  const circumference = 2 * Math.PI * radius;
  const arc = (score / 100) * circumference;
  const color =
    score >= 80 ? "#22c55e" : score >= 65 ? "#eab308" : score >= 50 ? "#f97316" : "#ef4444";
  return (
    <svg width="110" height="110" viewBox="0 0 110 110">
      <circle cx="55" cy="55" r={radius} fill="none" stroke="currentColor"
        strokeWidth={strokeWidth} className="text-muted/20" />
      <circle cx="55" cy="55" r={radius} fill="none" stroke={color}
        strokeWidth={strokeWidth} strokeDasharray={`${arc} ${circumference}`}
        strokeLinecap="round" transform="rotate(-90 55 55)"
        style={{ transition: "stroke-dasharray 0.8s ease" }} />
      <text x="55" y="51" textAnchor="middle" fontSize="20" fontWeight="700" fill={color}>
        {score.toFixed(1)}
      </text>
      <text x="55" y="67" textAnchor="middle" fontSize="10" fill="currentColor" opacity="0.55">
        / 100
      </text>
    </svg>
  );
}

export function ScoreRing({ score }: { score: number }) {
  const r = 14;
  const circ = 2 * Math.PI * r;
  const arc = (score / 100) * circ;
  const color = score >= 80 ? "#22c55e" : score >= 65 ? "#eab308" : score >= 50 ? "#f97316" : "#ef4444";
  return (
    <span className="inline-flex items-center justify-center relative" style={{ width: 38, height: 38 }}>
      <svg width="38" height="38" viewBox="0 0 38 38">
        <circle cx="19" cy="19" r={r} fill="none" stroke="currentColor" strokeWidth="3" className="text-muted/20" />
        <circle cx="19" cy="19" r={r} fill="none" stroke={color} strokeWidth="3"
          strokeDasharray={`${arc} ${circ}`} strokeLinecap="round" transform="rotate(-90 19 19)" />
      </svg>
      <span className="absolute text-[9px] font-bold" style={{ color }}>{score.toFixed(0)}</span>
    </span>
  );
}

export function DifficultyDots({ impact }: { impact: string }) {
  const levels: Record<string, { filled: number; color: string; label: string }> = {
    critical: { filled: 4, color: "bg-red-500",    label: "Expert" },
    serious:  { filled: 3, color: "bg-orange-500", label: "Advanced" },
    moderate: { filled: 2, color: "bg-yellow-500", label: "Intermediate" },
    minor:    { filled: 1, color: "bg-blue-400",   label: "Basic" },
  };
  const cfg = levels[impact] ?? levels.minor;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="flex items-center gap-0.5 cursor-default">
          {[1, 2, 3, 4].map((i) => (
            <span key={i} className={`w-2 h-2 rounded-full ${i <= cfg.filled ? cfg.color : "bg-muted"}`} />
          ))}
          <span className="ml-1 text-xs text-muted-foreground">{cfg.label}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent>{cfg.label}</TooltipContent>
    </Tooltip>
  );
}

export function ConformanceBadge({ level }: { level: string | null }) {
  if (!level) return <span className="text-muted-foreground text-xs">—</span>;
  const styles: Record<string, string> = {
    A:   "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
    AA:  "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
    AAA: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  };
  return (
    <Badge className={`text-[10px] px-1.5 py-0 font-semibold ${styles[level] ?? styles.A}`}>
      {level}
    </Badge>
  );
}

export function ImpactIcon({ impact }: { impact: string }) {
  if (impact === "critical") return <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5" />;
  if (impact === "serious")  return <AlertTriangle className="w-3.5 h-3.5 text-orange-500 shrink-0 mt-0.5" />;
  if (impact === "moderate") return <Info className="w-3.5 h-3.5 text-yellow-500 shrink-0 mt-0.5" />;
  return <Minus className="w-3.5 h-3.5 text-blue-400 shrink-0 mt-0.5" />;
}

// ── Pagination ─────────────────────────────────────────────────────────────────

export function Pagination({
  page, totalPages, onPage,
}: { page: number; totalPages: number; onPage: (p: number) => void }) {
  if (totalPages <= 1) return null;

  // Build page number list: always show first, last, and up to 3 around current
  const pages: (number | "…")[] = [];
  const add = (n: number) => { if (!pages.includes(n)) pages.push(n); };
  add(1);
  if (page - 2 > 2) pages.push("…");
  for (let i = Math.max(2, page - 2); i <= Math.min(totalPages - 1, page + 2); i++) add(i);
  if (page + 2 < totalPages - 1) pages.push("…");
  if (totalPages > 1) add(totalPages);

  return (
    <div className="flex items-center gap-1">
      <Button variant="ghost" size="icon" className="h-7 w-7" disabled={page <= 1}
        onClick={() => onPage(1)} title="First page">
        <ChevronsLeft className="w-3.5 h-3.5" />
      </Button>
      <Button variant="ghost" size="icon" className="h-7 w-7" disabled={page <= 1}
        onClick={() => onPage(page - 1)}>
        <ChevronLeft className="w-3.5 h-3.5" />
      </Button>

      {pages.map((p, i) =>
        p === "…" ? (
          <span key={`ellipsis-${i}`} className="px-1 text-muted-foreground text-xs">…</span>
        ) : (
          <Button key={p} variant={p === page ? "default" : "ghost"}
            size="sm" className="h-7 w-7 text-xs px-0"
            onClick={() => onPage(p as number)}>
            {p}
          </Button>
        ),
      )}

      <Button variant="ghost" size="icon" className="h-7 w-7" disabled={page >= totalPages}
        onClick={() => onPage(page + 1)}>
        <ChevronRight className="w-3.5 h-3.5" />
      </Button>
      <Button variant="ghost" size="icon" className="h-7 w-7" disabled={page >= totalPages}
        onClick={() => onPage(totalPages)} title="Last page">
        <ChevronsRight className="w-3.5 h-3.5" />
      </Button>
    </div>
  );
}

// ── IssuesTable (self-contained with filters) ─────────────────────────────────

interface IssuesTableProps {
  siteId: number;
  type: "issues" | "potential";
  label: string;
  scopeImpacts: string[];   // impacts available as filter options for this tab
}

const LIMIT = 25;

export function IssuesTable({ siteId, type, label, scopeImpacts }: IssuesTableProps) {
  const [, navigate] = useLocation();
  const { selectedGroup } = usePageGroup();
  const [page, setPage] = useState(1);
  const [filterImpact, setFilterImpact] = useState<string>("all");
  const [filterWcag, setFilterWcag] = useState<string>("all");
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // Debounce search input (500 ms)
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput), 500);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Reset to page 1 whenever filters change
  useEffect(() => { setPage(1); }, [filterImpact, filterWcag, debouncedSearch]);

  const hasFilters = filterImpact !== "all" || filterWcag !== "all" || debouncedSearch !== "";

  const params = new URLSearchParams({
    type,
    page: String(page),
    limit: String(LIMIT),
  });
  if (filterImpact !== "all") params.set("impact", filterImpact);
  if (filterWcag !== "all") params.set("wcag_level", filterWcag);
  if (debouncedSearch) params.set("search", debouncedSearch);
  if (selectedGroup) params.set("page_group", selectedGroup.id);

  const { data, isLoading, isFetching } = useQuery<IssuesResponse>({
    queryKey: ["site-issues", siteId, type, page, filterImpact, filterWcag, debouncedSearch, selectedGroup?.id ?? "all"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/sites/${siteId}/issues?${params}`, {
        credentials: "include",
      });
      if (!r.ok) throw new Error("Failed to load issues");
      return r.json();
    },
    placeholderData: (prev) => prev,
  });

  const total = data?.total ?? 0;
  const totalOccurrences = data?.totalOccurrences ?? 0;
  const totalPages = Math.ceil(total / LIMIT);
  const rangeStart = total === 0 ? 0 : (page - 1) * LIMIT + 1;
  const rangeEnd = Math.min(page * LIMIT, total);

  function clearFilters() {
    setFilterImpact("all");
    setFilterWcag("all");
    setSearchInput("");
    setPage(1);
  }

  return (
    <Card>
      <CardHeader className="pb-0">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <CardTitle className="text-sm font-semibold">{label}</CardTitle>
            {!isLoading && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {total.toLocaleString()} rule{total !== 1 ? "s" : ""}
                {" · "}
                {totalOccurrences.toLocaleString()} occurrence{totalOccurrences !== 1 ? "s" : ""}
                {hasFilters && " (filtered)"}
              </p>
            )}
          </div>
        </div>

        {/* ── Filter bar ── */}
        <div className="flex flex-wrap items-center gap-2 pt-3 pb-1">
          {/* Search */}
          <div className="relative flex-1 min-w-48 max-w-80">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              placeholder="Search rule name or ID…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="pl-8 h-8 text-sm"
            />
            {searchInput && (
              <button
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setSearchInput("")}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Impact filter */}
          <Select value={filterImpact} onValueChange={setFilterImpact}>
            <SelectTrigger className="h-8 w-36 text-sm">
              <SelectValue placeholder="Impact" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All impacts</SelectItem>
              {scopeImpacts.map((imp) => (
                <SelectItem key={imp} value={imp} className="capitalize">{imp}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* WCAG level filter */}
          <Select value={filterWcag} onValueChange={setFilterWcag}>
            <SelectTrigger className="h-8 w-36 text-sm">
              <SelectValue placeholder="WCAG Level" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All levels</SelectItem>
              <SelectItem value="A">Level A</SelectItem>
              <SelectItem value="AA">Level AA</SelectItem>
              <SelectItem value="AAA">Level AAA</SelectItem>
            </SelectContent>
          </Select>

          {/* Clear filters */}
          {hasFilters && (
            <Button variant="ghost" size="sm" className="h-8 gap-1 text-xs" onClick={clearFilters}>
              <X className="w-3 h-3" /> Clear filters
            </Button>
          )}

          {/* Loading indicator */}
          {isFetching && !isLoading && (
            <span className="text-xs text-muted-foreground animate-pulse ml-auto">Updating…</span>
          )}
        </div>
      </CardHeader>

      <CardContent className="p-0 mt-1">
        <div className={isFetching && !isLoading ? "opacity-70 transition-opacity" : ""}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Issue</TableHead>
                <TableHead className="w-24 text-center">Conformance</TableHead>
                <TableHead className="w-44">Difficulty</TableHead>
                <TableHead className="w-28 text-right">Occurrences</TableHead>
                <TableHead className="w-20 text-right">Pages</TableHead>
                <TableHead className="w-32 text-right">Points to gain</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={6}>
                      <div className="h-4 bg-muted animate-pulse rounded w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : (data?.issues ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-12">
                    {hasFilters
                      ? "No issues match your filters."
                      : "No issues found for this site."}
                  </TableCell>
                </TableRow>
              ) : (
                (data?.issues ?? []).map((issue) => (
                  <TableRow
                    key={`${issue.rule_id}-${issue.impact}`}
                    className="cursor-pointer hover:bg-muted/60"
                    onClick={() => navigate(`/sites/${siteId}/issues/${encodeURIComponent(issue.rule_id)}`)}
                  >
                    <TableCell className="py-3">
                      <div className="flex items-start gap-2 min-w-0">
                        <ImpactIcon impact={issue.impact} />
                        <div className="min-w-0">
                          <p className="text-sm font-medium leading-snug">
                            {issue.description
                              ? issue.description.split(": ")[0]
                              : issue.rule_id}
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {issue.rule_id}
                            {issue.wcag_criteria && <> · WCAG {issue.wcag_criteria}</>}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <ConformanceBadge level={issue.wcag_level} />
                    </TableCell>
                    <TableCell>
                      <DifficultyDots impact={issue.impact} />
                    </TableCell>
                    <TableCell className="text-right text-sm font-medium tabular-nums">
                      {issue.occurrences.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {issue.pages_affected.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="text-sm font-semibold text-green-700 dark:text-green-400 tabular-nums">
                        +{issue.points_to_gain} pts
                      </span>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* ── Pagination footer ── */}
        {(totalPages > 1 || total > 0) && (
          <div className="flex items-center justify-between gap-4 px-4 py-3 border-t">
            <p className="text-xs text-muted-foreground">
              {total === 0
                ? "No results"
                : `Showing ${rangeStart.toLocaleString()}–${rangeEnd.toLocaleString()} of ${total.toLocaleString()} rule${total !== 1 ? "s" : ""}`}
            </p>
            <Pagination page={page} totalPages={totalPages} onPage={setPage} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function PagesWithIssuesTable({ siteId, type = "issues" }: { siteId: number; type?: "issues" | "potential" }) {
  const { selectedGroup } = usePageGroup();
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const limit = 25;

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 400);
    return () => clearTimeout(timer);
  }, [searchInput]);
  useEffect(() => { setPage(1); }, [search, type]);

  const params = new URLSearchParams({
    type,
    page: String(page),
    limit: String(limit),
  });
  if (search) params.set("search", search);
  if (selectedGroup) params.set("page_group", selectedGroup.id);

  const { data, isLoading, isFetching } = useQuery<PagesWithIssuesResponse>({
    queryKey: ["site-pages-with-issues", siteId, type, page, search, selectedGroup?.id ?? "all"],
    queryFn: async () => {
      const response = await fetch(`${BASE}/api/sites/${siteId}/pages-with-issues?${params}`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to load pages with issues");
      return response.json();
    },
    placeholderData: (previous) => previous,
  });

  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / limit);
  const rangeStart = total === 0 ? 0 : (page - 1) * limit + 1;
  const rangeEnd = Math.min(page * limit, total);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <CardTitle className="text-sm font-semibold">Pages with issues</CardTitle>
            {!isLoading && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {total.toLocaleString()} affected page{total !== 1 ? "s" : ""}
                {" · "}
                {(data?.totalOccurrences ?? 0).toLocaleString()} occurrence{(data?.totalOccurrences ?? 0) !== 1 ? "s" : ""}
              </p>
            )}
          </div>
          {isFetching && !isLoading && (
            <span className="text-xs text-muted-foreground animate-pulse">Updating…</span>
          )}
        </div>
        <div className="relative max-w-md pt-2">
          <Search className="absolute left-2.5 top-[calc(50%+4px)] -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            placeholder="Search page URL…"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            className="pl-8 h-8 text-sm"
          />
          {searchInput && (
            <button
              className="absolute right-2 top-[calc(50%+4px)] -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={() => setSearchInput("")}
              aria-label="Clear page search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className={isFetching && !isLoading ? "opacity-70 transition-opacity" : ""}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Page title</TableHead>
                <TableHead className="w-28 text-right">Issues</TableHead>
                <TableHead className="w-28 text-right">Rules</TableHead>
                <TableHead className="w-36 text-right">Last scanned</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, index) => (
                  <TableRow key={index}>
                    <TableCell colSpan={4}><div className="h-4 bg-muted animate-pulse rounded w-full" /></TableCell>
                  </TableRow>
                ))
              ) : (data?.pages ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground py-10">
                    {search ? "No pages match your search." : "No pages with issues found."}
                  </TableCell>
                </TableRow>
              ) : (
                (data?.pages ?? []).map((pageRow) => (
                  <TableRow key={pageRow.pageId} className="hover:bg-muted/50">
                    <TableCell className="py-3 min-w-0">
                      <a
                        href={`/scans/${data?.scanId ?? 0}/pages/${pageRow.pageId}/report`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block min-w-0 text-sm font-medium text-primary hover:underline"
                        title={pageRow.title || "Open page report"}
                      >
                        <span className="block truncate">
                          {pageRow.title || "Untitled page"}
                        </span>
                      </a>
                      <a
                        href={pageRow.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group mt-0.5 flex max-w-full items-start gap-1 text-xs text-muted-foreground hover:text-primary hover:underline"
                        title={pageRow.url}
                      >
                        <span className="truncate">{pageRow.url}</span>
                        <ExternalLink className="w-3 h-3 shrink-0 mt-0.5 opacity-60 group-hover:opacity-100" />
                      </a>
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{pageRow.issueCount.toLocaleString()}</TableCell>
                    <TableCell className="text-right tabular-nums">{pageRow.ruleCount.toLocaleString()}</TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">
                      {pageRow.scannedAt ? new Date(pageRow.scannedAt).toLocaleDateString() : "—"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        {(totalPages > 1 || total > 0) && (
          <div className="flex items-center justify-between gap-4 px-4 py-3 border-t">
            <p className="text-xs text-muted-foreground">
              {total === 0 ? "No results" : `Showing ${rangeStart.toLocaleString()}–${rangeEnd.toLocaleString()} of ${total.toLocaleString()} pages`}
            </p>
            <Pagination page={page} totalPages={totalPages} onPage={setPage} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
