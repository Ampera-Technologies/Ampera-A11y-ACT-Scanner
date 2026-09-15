import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Globe, ExternalLink, BarChart3, ArrowRight, TrendingUp, TrendingDown,
  AlertTriangle, FileText, Layers, Download, Target, Save, Shield, Zap, LayoutDashboard, Minus, CheckCircle, AlertCircle, XCircle
} from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as ChartTooltip, ResponsiveContainer, ReferenceLine
} from "recharts";
import { BASE, DashboardData, ScoreHistoryPoint, useAutoActiveSite } from "@/pages/site/shared";
import { useAuth } from "@/contexts/auth";
import { usePageGroup } from "@/contexts/page-group";

interface Props { siteId: number }

const DATE_RANGES = [
  { label: "Last 3 months",  months: 3 },
  { label: "Last 6 months",  months: 6 },
  { label: "Last 12 months", months: 12 },
  { label: "All time",       months: 0 },
];

function exportCsv(data: ScoreHistoryPoint[], mode: "issues" | "potential") {
  const header = mode === "issues"
    ? "Date,Score,Pages,Total Issues,Level A Issues,Level AA Issues"
    : "Date,Score,Pages,Total Potential,Level A Potential,Level AA Potential";
  const rows = data.map((p) => {
    const dt = new Date(p.scanned_at).toLocaleDateString();
    if (mode === "issues") {
      return `${dt},${p.score.toFixed(1)},${p.total_scanned ?? 0},${p.total_issues ?? 0},${p.level_a_issues ?? 0},${p.level_aa_issues ?? 0}`;
    }
    return `${dt},${p.score.toFixed(1)},${p.total_scanned ?? 0},${p.total_potential_issues ?? 0},${p.level_a_potential ?? 0},${p.level_aa_potential ?? 0}`;
  });
  const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `score-history-${mode}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function ScoreRing({ score }: { score: number | null }) {
  const displayScore = score ?? 0;
  const r = 44, circ = 2 * Math.PI * r;
  const filled = (displayScore / 100) * circ;
  const color = score === null ? "#94a3b8" : displayScore >= 80 ? "#16a47a" : displayScore >= 60 ? "#3778c8" : "#e04545";
  return (
    <div className="relative grid h-24 w-24 place-items-center my-2">
      <svg width="96" height="96" viewBox="0 0 96 96" className="-rotate-90" aria-hidden="true">
        <circle cx="48" cy="48" r={r} fill="none" strokeWidth="7" className="stroke-muted/30" />
        <circle cx="48" cy="48" r={r} fill="none" strokeWidth="7" stroke={color} strokeLinecap="round"
          strokeDasharray={`${filled.toFixed(1)} ${(circ - filled).toFixed(1)}`}
          style={{ transition: "stroke-dasharray .8s cubic-bezier(.4,0,.2,1)" }} />
      </svg>
      <div className="absolute grid place-items-center text-center">
        <p className="text-3xl font-bold leading-none" style={{ color }}>{score === null ? "—" : score.toFixed(0)}</p>
        <p className="text-[10px] text-muted-foreground mt-0.5">/ 100</p>
      </div>
    </div>
  );
}

export default function SiteDashboard({ siteId }: Props) {
  useAutoActiveSite(siteId);
  const { user } = useAuth();
  const { selectedGroup } = usePageGroup();

  const [improveTab, setImproveTab] = useState<"issues" | "potential">("issues");
  const [topRulesTab, setTopRulesTab] = useState<"issues" | "potential" | "resolved">("issues");
  const [metricView, setMetricView] = useState<"score" | "severity" | "level" | "rules">("score");
  const [historyTab, setHistoryTab] = useState<"issues" | "potential">("issues");
  const [historyMetric, setHistoryMetric] = useState<"count" | "occurrences">("count");
  const [dateRange, setDateRange] = useState(6);
  const [targetDialogOpen, setTargetDialogOpen] = useState(false);
  const [targetDraft, setTargetDraft] = useState("");
  const [targetWcagLevelDraft, setTargetWcagLevelDraft] = useState<"A" | "AA" | "AAA" | "All">("AA");
  const [targetSaving, setTargetSaving] = useState(false);

  const dashQ = useQuery<DashboardData>({
    queryKey: ["site-dashboard", siteId, selectedGroup?.id ?? "all"],
    queryFn: async () => {
      const pageGroupQuery = selectedGroup
        ? `?page_group=${encodeURIComponent(selectedGroup.id)}`
        : "";
      const r = await fetch(`${BASE}/api/sites/${siteId}/dashboard${pageGroupQuery}`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load dashboard");
      return r.json();
    },
  });

  const historyQ = useQuery<{ history: ScoreHistoryPoint[] }>({
    queryKey: ["site-score-history", siteId, selectedGroup?.id ?? "all"],
    queryFn: async () => {
      const pageGroupQuery = selectedGroup
        ? `?page_group=${encodeURIComponent(selectedGroup.id)}`
        : "";
      const r = await fetch(`${BASE}/api/sites/${siteId}/score-history${pageGroupQuery}`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load score history");
      return r.json();
    },
  });

  const d = dashQ.data;
  const site = d?.site;

  const filteredHistory = useMemo(() => {
    const all = historyQ.data?.history ?? [];
    if (dateRange === 0) return all;
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - dateRange);
    return all.filter((p) => new Date(p.scanned_at) >= cutoff);
  }, [historyQ.data, dateRange]);

  if (dashQ.isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
        Loading dashboard…
      </div>
    );
  }
  if (dashQ.isError || !site) {
    return (
      <div className="flex items-center justify-center h-64 text-destructive text-sm">
        Failed to load site dashboard.
      </div>
    );
  }

  const impactOrder = ["critical", "serious", "moderate", "minor"];
  const impactMap = Object.fromEntries((d?.impactBreakdown ?? []).map((row) => [row.impact, row]));
  const severityTotal = impactOrder.reduce((sum, impact) => sum + (impactMap[impact]?.occurrences ?? 0), 0);
  const totalIssues = (d?.impactBreakdown ?? [])
    .filter((row) => ["critical", "serious"].includes(row.impact))
    .reduce((sum, row) => sum + row.distinct_rules, 0);
  const totalPotential = (d?.impactBreakdown ?? [])
    .filter((row) => ["moderate", "minor"].includes(row.impact))
    .reduce((sum, row) => sum + row.distinct_rules, 0);

  const history = filteredHistory;
  const issueTrendPercent = history.length >= 2 && (history[history.length - 2].total_issues ?? 0) > 0
    ? Math.round((((history[history.length - 1].total_issues ?? 0) - (history[history.length - 2].total_issues ?? 0)) / (history[history.length - 2].total_issues ?? 1)) * 100)
    : null;
  const targetScore = d?.site?.targetScore ?? null;
  const targetWcagLevel = (d?.site?.targetWcagLevel ?? "AA") as "A" | "AA" | "AAA" | "All";
  const targetLevelOrder = { A: 1, AA: 2, AAA: 3 } as const;
  const selectedTargetRank = targetWcagLevel === "All" ? 3 : (targetLevelOrder[targetWcagLevel as keyof typeof targetLevelOrder] ?? 2);
  const levelRows = (d?.levelScores ?? []).filter((row) => {
    if (targetWcagLevel === "All") return true;
    if (!(row.level in targetLevelOrder)) return false;
    return targetLevelOrder[row.level as keyof typeof targetLevelOrder] <= selectedTargetRank;
  });
  const levelTotal = levelRows.reduce((sum, row) => sum + row.occurrences, 0);
  const canManageTargetScore = user?.permissions.canManageSiteTargetScore ?? false;

  const chartData = history.map((p) => ({
    score: +p.score.toFixed(1),
    date: new Date(p.scanned_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" }),
    total_issues: p.total_issues ?? 0,
    level_a_issues: p.level_a_issues ?? 0,
    level_aa_issues: p.level_aa_issues ?? 0,
    total_potential: p.total_potential_issues ?? 0,
    level_a_potential: p.level_a_potential ?? 0,
    level_aa_potential: p.level_aa_potential ?? 0,
    pages: p.total_scanned ?? 0,
  }));

  const topActiveIssues = improveTab === "issues" ? d?.topIssues ?? [] : d?.topPotentialIssues ?? [];
  const resolvedIssues = d?.resolvedIssues ?? [];
  const activeRuleList = topRulesTab === "issues" ? d?.topIssues ?? []
                       : topRulesTab === "potential" ? d?.topPotentialIssues ?? []
                       : resolvedIssues;
  const maxRuleOccurrences = Math.max(...activeRuleList.map(r => r.occurrences), 1);
  const recentScans = [...filteredHistory].reverse().slice(0, 5);

  async function saveTargetScore() {
    const trimmed = targetDraft.trim();
    const value = trimmed === "" ? null : Number(trimmed);
    if (value !== null && (!Number.isFinite(value) || value < 0 || value > 100)) return;
    setTargetSaving(true);
    try {
      const response = await fetch(`${BASE}/api/sites/${siteId}/target-score`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetScore: value, targetWcagLevel: targetWcagLevelDraft }),
      });
      if (!response.ok) throw new Error("Failed to save target score");
      const updated = await response.json();
      setTargetDialogOpen(false);
      await dashQ.refetch();
    } finally {
      setTargetSaving(false);
    }
  }

  function openTargetEditor() {
    setTargetDraft(targetScore === null ? "" : String(targetScore));
    setTargetWcagLevelDraft(targetWcagLevel);
    setTargetDialogOpen(true);
  }

  return (
    <div className="relative w-full pb-10">
      <div className="relative z-10 space-y-5">
        
        {/* Header */}
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border/40 pb-5 pt-2">
          <div className="flex items-center gap-4">
            <div className="grid h-11 w-11 place-items-center rounded-xl border border-primary/20 bg-primary/10 text-primary shadow-sm">
              <LayoutDashboard className="h-5 w-5"/>
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
                {site.name}
              </h1>
              <a href={site.baseUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-muted-foreground hover:text-primary hover:underline flex items-center gap-1 mt-0.5">
                <Globe className="h-3 w-3" />
                {site.baseUrl}
                <ExternalLink className="w-2.5 h-2.5 opacity-70" />
              </a>
            </div>
          </div>
          <div className="flex items-center gap-3 text-right">
            {d?.session && (
              <div className="text-xs text-muted-foreground">
                <p className="font-medium text-foreground">Last scan: {new Date(d.session.completedAt).toLocaleDateString()}</p>
                {user?.permissions.canViewCrawlHistory && (
                  <Link href={`/crawler/${d.session.crawlerId}`} className="text-primary hover:underline flex items-center gap-1 justify-end mt-0.5">
                    View crawl session <ArrowRight className="w-3 h-3" />
                  </Link>
                )}
              </div>
            )}
          </div>
        </header>

        {!d?.session ? (
          <article className="rounded-[22px] border border-border/60 bg-card/70 p-16 text-center space-y-3 backdrop-blur-xl shadow-sm">
            <BarChart3 className="w-12 h-12 mx-auto text-muted-foreground/50" />
            <p className="text-foreground font-medium text-lg">No completed crawler scan found for this site.</p>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Run a crawler scan and link it to this site to see the accessibility dashboard.
            </p>
            {user?.permissions.canCreateCrawl && (
              <Button className="mt-4 shadow-sm" asChild>
                <Link href="/crawler/new">Start a crawler scan</Link>
              </Button>
            )}
          </article>
        ) : (
          <>
            {/* Original accessibility overview, refreshed with the new visual language. */}
            <section className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold tracking-tight text-foreground">Accessibility overview</h2>
                <p className="mt-1 text-xs text-muted-foreground">Choose a metric to see its breakdown for the latest scan.</p>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(180px,.8fr)_repeat(3,minmax(0,1fr))]">
                {([
                  {
                    id: "score" as const,
                    label: "Site Accessibility Score",
                    value: d.score === null ? "—" : d.score.toFixed(1),
                    detail: targetScore === null ? "No target set" : `Target: ${targetScore}`,
                    icon: <Target className="h-4 w-4" />,
                    color: "text-primary",
                  },
                  {
                    id: "severity" as const,
                    label: "Total issues",
                    value: (totalIssues + totalPotential).toLocaleString(),
                    detail: `${totalIssues.toLocaleString()} confirmed · ${totalPotential.toLocaleString()} potential`,
                    icon: <AlertTriangle className="h-4 w-4" />,
                    color: "text-amber-600 dark:text-amber-400",
                  },
                  {
                    id: "level" as const,
                    label: "Issues found by violation level",
                    value: levelTotal.toLocaleString(),
                    detail: `${levelRows.length} WCAG levels`,
                    icon: <BarChart3 className="h-4 w-4" />,
                    color: "text-blue-600 dark:text-blue-400",
                  },
                  {
                    id: "rules" as const,
                    label: "Rules violated",
                    value: (d.coverage?.distinctRules ?? 0).toLocaleString(),
                    detail: "Across all WCAG levels",
                    icon: <Shield className="h-4 w-4" />,
                    color: "text-violet-600 dark:text-violet-400",
                  },
                ]).map((metric) => (
                  <button
                    key={metric.id}
                    type="button"
                    onClick={() => setMetricView(metric.id)}
                    aria-pressed={metricView === metric.id}
                    className={`dashboard-overview-card min-w-0 min-h-[210px] rounded-[20px] border p-5 text-left transition-all hover:-translate-y-0.5 ${
                      metric.id === "score"
                        ? "flex flex-col items-center justify-center text-center"
                        : ""
                    } ${
                      metricView === metric.id
                        ? "dashboard-overview-card-active"
                        : ""
                    }`}
                  >
                    {metric.id === "score" ? (
                      <>
                        <p className="font-mono text-[10px] font-bold uppercase tracking-[.18em] text-primary">Accessibility score</p>
                        <ScoreRing score={d.score} />
                        <span className={`mt-1 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                          d.scoreDelta !== null && d.scoreDelta > 0
                            ? "bg-green-500/10 text-green-700 dark:text-green-400"
                            : d.scoreDelta !== null && d.scoreDelta < 0
                              ? "bg-red-500/10 text-red-700 dark:text-red-400"
                              : "bg-muted/60 text-muted-foreground"
                        }`}>
                          {d.scoreDelta !== null && d.scoreDelta > 0 ? <TrendingUp className="h-3.5 w-3.5" /> : d.scoreDelta !== null && d.scoreDelta < 0 ? <TrendingDown className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
                          {d.scoreDelta !== null && d.scoreDelta !== 0 ? `${d.scoreDelta > 0 ? "+" : ""}${d.scoreDelta} from last scan` : "No change from last scan"}
                        </span>
                        <p className="mt-4 text-xs text-muted-foreground">WCAG 2.2 AA · {(d.coverage?.totalScanned ?? 0).toLocaleString()} pages</p>
                      </>
                    ) : (
                      <>
                        <div className="flex items-start justify-between gap-2">
                          <span className={`grid h-10 w-10 place-items-center rounded-xl border ${
                            metric.id === "severity"
                              ? "border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-950/30"
                              : metric.id === "rules"
                                ? "border-violet-200 bg-violet-50 dark:border-violet-900/50 dark:bg-violet-950/30"
                                : "border-blue-200 bg-blue-50 dark:border-blue-900/50 dark:bg-blue-950/30"
                          } ${metric.color}`}>
                            {metric.icon}
                          </span>
                          {metric.id === "severity" && issueTrendPercent !== null ? (
                            <span className={`inline-flex items-center gap-1 pt-1 text-[11px] font-semibold ${issueTrendPercent <= 0 ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                              {issueTrendPercent <= 0 ? <TrendingDown className="h-3.5 w-3.5" /> : <TrendingUp className="h-3.5 w-3.5" />}
                              {issueTrendPercent > 0 ? "+" : ""}{issueTrendPercent}%
                            </span>
                          ) : (
                            <span className="pt-1 text-[10px] font-semibold text-muted-foreground">
                              {metric.id === "level" ? "By level" : "Coverage"}
                            </span>
                          )}
                        </div>
                        <div className="mt-5 text-3xl font-bold tracking-tight tabular-nums text-foreground">{metric.value}</div>
                        <div className="mt-1 text-sm font-medium text-foreground/85">{metric.label}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{metric.detail}</div>
                      </>
                    )}
                  </button>
                ))}
              </div>

              <article className="dashboard-overview-detail rounded-[20px] border p-5">
                {metricView === "score" && (() => {
                  const levelRank: Record<string, number> = { A: 1, AA: 2, AAA: 3 };
                  const targetRank = levelRank[targetWcagLevel] ?? 2;

                  // WCAG levels up to target rank; WAI-ARIA + Best Practice only when target is "All"
                  const allLevelRows = (d?.levelScores ?? []).filter((r) => {
                    if (r.level === "WAI-ARIA" || r.level === "Best Practice") return targetWcagLevel === "All";
                    const rank = levelRank[r.level];
                    return rank !== undefined && rank <= targetRank;
                  });

                  const levelMeta: Record<string, { bg: string; text: string; badge: string; label: string }> = {
                    A:              { bg: "bg-[#a21caf]",  text: "text-white", badge: "A",    label: "Level A" },
                    AA:             { bg: "bg-[#6d28d9]",  text: "text-white", badge: "AA",   label: "Level AA" },
                    AAA:            { bg: "bg-[#1d4ed8]",  text: "text-white", badge: "AAA",  label: "Level AAA" },
                    "WAI-ARIA":     { bg: "bg-[#0d9488]",  text: "text-white", badge: "ARIA", label: "WAI-ARIA" },
                    "Best Practice":{ bg: "bg-[#d97706]",  text: "text-white", badge: "BP",   label: "Best Practice" },
                  };

                  return (
                    <div className={`grid items-center gap-4 ${allLevelRows.length > 0 ? "lg:grid-cols-[auto_1fr_auto]" : "lg:grid-cols-[1fr_auto]"}`}>

                      {/* All level bars — leftmost column */}
                      {allLevelRows.length > 0 && (
                        <div className="min-w-0 rounded-xl border border-border/50 bg-muted/20 p-3 lg:w-52">
                          {/* Target badges row */}
                          <div className="mb-2.5 flex items-center gap-1.5 flex-wrap">
                            <span className="shrink-0 text-[10px] font-semibold text-muted-foreground">Target:</span>
                            <div className="flex items-center gap-0.5 rounded-full border border-border/60 p-0.5 flex-wrap">
                              {allLevelRows.map((row) => {
                                const m = levelMeta[row.level];
                                if (!m) return null;
                                return (
                                  <span
                                    key={row.level}
                                    className={`inline-flex min-w-[22px] items-center justify-center rounded-full px-1.5 py-px text-[10px] font-bold ${m.bg} ${m.text}`}
                                  >
                                    {m.badge}
                                  </span>
                                );
                              })}
                            </div>
                          </div>

                          {/* Per-level bars */}
                          <div className="space-y-2.5">
                            {allLevelRows.map((row) => {
                              const meta = levelMeta[row.level];
                              if (!meta) return null;
                              const pct = Math.max(0, Math.min(100, row.score));
                              return (
                                <div key={row.level}>
                                  <div className="mb-1 flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-1.5">
                                      <span className={`inline-flex items-center justify-center rounded px-1 py-px text-[10px] font-bold leading-none ${meta.bg} ${meta.text}`}>
                                        {meta.badge}
                                      </span>
                                      <span className="text-[11px] font-medium text-foreground">{meta.label}</span>
                                    </div>
                                    <span className="tabular-nums text-[11px] font-bold text-foreground">
                                      {row.score.toFixed(1)}<span className="text-[10px] font-normal text-muted-foreground">/100</span>
                                    </span>
                                  </div>
                                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                                    <div
                                      className="h-full rounded-full bg-[#b5cc52] transition-all dark:bg-[#9ab83e]"
                                      style={{ width: `${pct}%` }}
                                      aria-label={`${meta.label}: ${row.score.toFixed(1)} / 100`}
                                    />
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Description + delta */}
                      <div className="min-w-0">
                        <h3 className="font-semibold text-foreground">Site Accessibility Score</h3>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Overall accessibility performance calculated from the latest completed scan
                          {selectedGroup ? ` for ${selectedGroup.name}` : ""}.
                        </p>
                        {d.scoreDelta !== null && (
                          <div className={`mt-3 flex items-center gap-1 text-sm font-semibold ${
                            d.scoreDelta > 0 ? "text-green-600 dark:text-green-400" : d.scoreDelta < 0 ? "text-red-500" : "text-muted-foreground"
                          }`}>
                            {d.scoreDelta > 0 ? <TrendingUp className="h-4 w-4" /> : d.scoreDelta < 0 ? <TrendingDown className="h-4 w-4" /> : <Minus className="h-4 w-4" />}
                            {d.scoreDelta > 0 ? "+" : ""}{d.scoreDelta} vs last scan
                          </div>
                        )}
                      </div>

                      {/* Numeric target box */}
                      <div className="min-w-0 rounded-xl border border-border/50 bg-background/50 p-4 lg:min-w-44">
                        <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                          <Target className="h-4 w-4" /> Site target score
                        </div>
                        <div className="mt-2 text-2xl font-bold text-foreground">{targetScore === null ? "Not set" : targetScore}</div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {targetScore === null ? "Set a target to track progress." : `WCAG ${targetWcagLevel} conformance.`}
                        </p>
                        {canManageTargetScore && (
                          <Button variant="outline" size="sm" className="mt-3 h-7 gap-1 rounded-lg text-xs" onClick={openTargetEditor}>
                            <Target className="h-3 w-3" /> {targetScore === null ? "Set target" : "Edit"}
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {metricView === "severity" && (
                  <div>
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <div>
                        <h3 className="font-semibold text-foreground">Issues found by severity</h3>
                        <p className="mt-1 text-sm text-muted-foreground">Occurrences grouped by impact level.</p>
                      </div>
                      <span className="text-2xl font-bold tabular-nums text-foreground">{severityTotal.toLocaleString()}</span>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      {impactOrder.map((impact) => {
                        const count = impactMap[impact]?.occurrences ?? 0;
                        const tone = {
                          critical: { dot: "bg-red-500", bar: "bg-red-500" },
                          serious: { dot: "bg-orange-500", bar: "bg-orange-400" },
                          moderate: { dot: "bg-yellow-400", bar: "bg-yellow-400" },
                          minor: { dot: "bg-blue-400", bar: "bg-blue-400" },
                        }[impact];
                        return (
                          <div key={impact} className="min-w-0 rounded-xl border border-border/50 bg-background/40 p-3">
                            <div className="flex items-center gap-2 text-sm capitalize text-foreground">
                              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${tone?.dot ?? "bg-primary"}`} />
                              {impact}
                            </div>
                            <div className="mt-2 text-xl font-bold tabular-nums text-foreground">{count.toLocaleString()}</div>
                            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                              <div className={`h-full rounded-full ${tone?.bar ?? "bg-primary"}`} style={{ width: `${Math.round((count / Math.max(severityTotal, 1)) * 100)}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {metricView === "level" && (
                  <div>
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <div>
                        <h3 className="font-semibold text-foreground">Score by level</h3>
                        <p className="mt-1 text-sm text-muted-foreground">Accessibility score and issue coverage grouped by WCAG conformance level.</p>
                      </div>
                      <span className="text-2xl font-bold tabular-nums text-foreground">{levelTotal.toLocaleString()}</span>
                    </div>
                    <div className="flex flex-nowrap gap-3 overflow-x-auto pb-1">
                      {levelRows.map((row) => {
                        const tone = row.level === "A"
                          ? { label: "WCAG A", color: "#16a47a", badge: "bg-green-500/10 text-green-700 dark:text-green-400" }
                          : row.level === "AA"
                            ? { label: "WCAG AA", color: "#3778c8", badge: "bg-blue-500/10 text-blue-700 dark:text-blue-400" }
                            : row.level === "AAA"
                              ? { label: "WCAG AAA", color: "#a855f7", badge: "bg-purple-500/10 text-purple-700 dark:text-purple-400" }
                              : { label: row.level, color: "#14b8a6", badge: "bg-teal-500/10 text-teal-700 dark:text-teal-400" };
                        return (
                          <div key={row.level} className="min-w-[220px] flex-1 rounded-xl border border-border/50 bg-background/40 p-4">
                            <div className="flex items-start justify-between gap-3">
                              <span className={`rounded-full px-2 py-1 text-xs font-semibold ${tone.badge}`}>{tone.label}</span>
                              <div className="text-right">
                                <div className="text-2xl font-bold tabular-nums" style={{ color: tone.color }}>{row.score.toFixed(1)}</div>
                                <div className="text-[11px] text-muted-foreground">out of 100</div>
                              </div>
                            </div>
                            <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted" aria-label={`${tone.label} score ${row.score.toFixed(1)} out of 100`}>
                              <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, row.score))}%`, backgroundColor: tone.color }} />
                            </div>
                            <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                              <div><div className="font-semibold tabular-nums text-foreground">{row.occurrences.toLocaleString()}</div><div className="text-muted-foreground">occurrences</div></div>
                              <div><div className="font-semibold tabular-nums text-foreground">{row.pagesAffected.toLocaleString()}</div><div className="text-muted-foreground">pages</div></div>
                              <div><div className="font-semibold tabular-nums text-foreground">{row.distinctRules.toLocaleString()}</div><div className="text-muted-foreground">rules</div></div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {metricView === "rules" && (
                  <div className="grid items-center gap-5 lg:grid-cols-[auto_1fr]">
                    <div className="grid h-20 w-20 place-items-center rounded-2xl border border-violet-200 bg-violet-50 text-violet-600 dark:border-violet-900/50 dark:bg-violet-950/30 dark:text-violet-400">
                      <Shield className="h-9 w-9" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-semibold text-foreground">Rules violated</h3>
                      <p className="mt-1 text-sm text-muted-foreground">Distinct accessibility rules found across all WCAG levels in the latest scan.</p>
                      <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                        <span className="text-3xl font-bold tabular-nums text-foreground">{(d.coverage?.distinctRules ?? 0).toLocaleString()}</span>
                        <span className="text-sm text-muted-foreground">rules across {(d.coverage?.totalScanned ?? 0).toLocaleString()} pages</span>
                      </div>
                    </div>
                  </div>
                )}
              </article>
              {d.coverage?.confidence && (
                <article className="rounded-[20px] border border-border/70 bg-card/80 p-4" aria-label="Scan evidence confidence">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">Scan evidence confidence</h3>
                      <p className="mt-1 text-xs text-muted-foreground">Separate from the accessibility score; based on completed pages and rule applicability.</p>
                    </div>
                    <Badge variant="outline" className="capitalize">{d.coverage.confidence.classification}</Badge>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
                    <span><strong className="text-foreground">{d.coverage.automaticApplicabilityCoverage ?? 0}%</strong> automatic coverage</span>
                    <span><strong className="text-foreground">{d.coverage.confidence.manualUnresolved}</strong> manual review</span>
                    <span><strong className="text-foreground">{d.coverage.confidence.fallbackDenominatorPages}</strong> fallback pages</span>
                    <span><strong className="text-foreground">{d.coverage.confidence.carriedForwardPages}</strong> carried forward</span>
                  </div>
                  <details className="mt-3 text-xs text-muted-foreground">
                    <summary className="cursor-pointer font-medium text-foreground">How this classification was determined</summary>
                    <ul className="mt-2 list-disc space-y-1 pl-4">{d.coverage.confidence.basis.map((item) => <li key={item}>{item}</li>)}</ul>
                  </details>
                </article>
              )}
            </section>

            {/* Restore the live remediation workflow before the newer analytical sections. */}
            <section className="space-y-3">
              <div>
                <h2 className="text-lg font-semibold tracking-tight text-foreground">Improve your score</h2>
                <p className="mt-1 text-xs text-muted-foreground">Prioritize the rules with the clearest accessibility impact.</p>
              </div>
              <article className="overflow-hidden rounded-2xl border border-border/60 bg-card/70 shadow-sm backdrop-blur-xl">
                <div className="flex min-w-0 items-center gap-1 overflow-x-auto border-b border-border/50 px-3 sm:px-4">
                  {[
                    { id: "issues" as const, label: "Issues", count: totalIssues },
                    { id: "potential" as const, label: "Potential issues", count: totalPotential },
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setImproveTab(tab.id)}
                      className={`-mb-px inline-flex shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-sm font-semibold transition-colors sm:px-4 ${
                        improveTab === tab.id
                          ? "border-primary text-primary"
                          : "border-transparent text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {tab.id === "issues" ? <XCircle className="h-4 w-4 text-red-500" /> : <AlertTriangle className="h-4 w-4 text-amber-500" />}
                      {tab.label}
                      <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${
                        improveTab === tab.id ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                      }`}>
                        {tab.count.toLocaleString()}
                      </span>
                    </button>
                  ))}
                </div>

                <div className="grid min-w-0 grid-cols-1 divide-y divide-border/50 lg:grid-cols-2 lg:divide-x lg:divide-y-0">
                  <div className="min-w-0 p-4">
                    <p className="mb-3 text-xs font-semibold text-muted-foreground">Fix these issues to improve your score</p>
                    <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-3 border-b border-border/50 pb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      <span>Issues</span>
                      <span className="hidden w-20 text-right sm:block">Occurrences</span>
                      <span className="hidden w-28 text-right sm:block">Points to gain</span>
                    </div>
                    {topActiveIssues.length === 0 ? (
                      <p className="py-8 text-center text-sm text-muted-foreground">No {improveTab === "issues" ? "issues" : "potential issues"} found.</p>
                    ) : (
                      <div>
                        {topActiveIssues.slice(0, 6).map((issue) => (
                          <Link
                            key={`${issue.rule_id}-${issue.impact}`}
                            href={`/sites/${siteId}/issues/${encodeURIComponent(issue.rule_id)}`}
                            className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_auto] gap-3 border-b border-border/40 py-3 transition-colors hover:bg-muted/30"
                          >
                            <span className="flex min-w-0 items-start gap-2">
                              <XCircle className={`mt-0.5 h-4 w-4 shrink-0 ${
                                issue.impact === "critical" ? "text-red-500" :
                                issue.impact === "serious" ? "text-orange-500" :
                                issue.impact === "moderate" ? "text-amber-500" : "text-blue-500"
                              }`} />
                              <span className="min-w-0">
                                <span className="block truncate text-sm font-medium text-foreground hover:text-primary">{issue.description}</span>
                                <span className="mt-0.5 block text-[11px] text-muted-foreground sm:hidden">
                                  {issue.occurrences.toLocaleString()} occurrences · {(+issue.points_to_gain).toFixed(2)} points
                                </span>
                              </span>
                            </span>
                            <span className="hidden w-20 text-right text-sm tabular-nums text-muted-foreground sm:block">{issue.occurrences.toLocaleString()}</span>
                            <span className="hidden w-28 text-right text-sm font-bold tabular-nums text-foreground sm:block">{(+issue.points_to_gain).toFixed(2)} points</span>
                          </Link>
                        ))}
                      </div>
                    )}
                    <Link href={`/sites/${siteId}/issues`} className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
                      View all issues <ArrowRight className="h-3 w-3" />
                    </Link>
                  </div>

                  <div className="min-w-0 p-4">
                    <p className="mb-3 text-xs font-semibold text-muted-foreground">Resolved issues</p>
                    <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-3 border-b border-border/50 pb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      <span>Resolved issues</span>
                      <span className="hidden w-20 text-right sm:block">Occurrences</span>
                      <span className="hidden w-28 text-right sm:block">Points gained</span>
                    </div>
                    {resolvedIssues.length === 0 ? (
                      <p className="py-8 text-center text-sm text-muted-foreground">
                        {d.previousScore === null ? "No previous scan to compare." : "No resolved issues since last scan."}
                      </p>
                    ) : (
                      <div>
                        {resolvedIssues.slice(0, 6).map((issue) => (
                          <div key={`${issue.rule_id}-${issue.impact}`} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_auto] gap-3 border-b border-border/40 py-3">
                            <span className="flex min-w-0 items-start gap-2">
                              <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
                              <span className="min-w-0">
                                <span className="block truncate text-sm font-medium text-foreground">{issue.description}</span>
                                <span className="mt-0.5 block text-[11px] text-muted-foreground sm:hidden">
                                  {issue.occurrences.toLocaleString()} occurrences · {(+issue.points_to_gain).toFixed(2)} points
                                </span>
                              </span>
                            </span>
                            <span className="hidden w-20 text-right text-sm tabular-nums text-muted-foreground sm:block">{issue.occurrences.toLocaleString()}</span>
                            <span className="hidden w-28 text-right text-sm font-bold tabular-nums text-green-600 dark:text-green-400 sm:block">{(+issue.points_to_gain).toFixed(2)} points</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {resolvedIssues.length > 0 && (
                      <p className="mt-3 text-xs text-muted-foreground">{resolvedIssues.length} rule{resolvedIssues.length === 1 ? "" : "s"} resolved since last scan.</p>
                    )}
                  </div>
                </div>
              </article>
            </section>

            {/* Charts */}
            <section className="grid gap-4 lg:grid-cols-2">
              <article className="flex min-w-0 flex-col rounded-[22px] border border-white/80 bg-card/80 p-5 shadow-[0_14px_34px_rgba(69,57,112,.06)] backdrop-blur-xl transition-all hover:shadow-[0_18px_38px_rgba(69,57,112,.1)]">
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <p className="font-mono text-[10px] font-bold uppercase tracking-[.18em] text-muted-foreground">Score trend</p>
                    <h3 className="mt-1 text-sm font-semibold text-foreground">12-month history</h3>
                  </div>
                  <span className="text-[11px] font-semibold text-primary px-2.5 py-1 rounded-full bg-primary/10">{chartData.length} scans</span>
                </div>
                <div className="flex-1 min-h-[180px]">
                  {chartData.length >= 2 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartData} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
                        <XAxis dataKey="date" tick={{ fontSize: 10, fill: "currentColor", opacity: 0.5 }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={20} />
                        <YAxis hide domain={['auto', 100]} />
                        <ChartTooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid hsl(var(--border))", background: "hsl(var(--card))", color: "hsl(var(--foreground))" }} formatter={(val: number) => [`${val} pts`, "Score"]} labelFormatter={(label) => `Date: ${label}`} />
                        {targetScore !== null && <ReferenceLine y={targetScore} stroke="#16a47a" strokeDasharray="4 4" strokeOpacity={0.7} />}
                        <Line type="monotone" dataKey="score" stroke="hsl(var(--primary))" strokeWidth={3} dot={{ r: 3, fill: "hsl(var(--background))", strokeWidth: 2, stroke: "hsl(var(--primary))" }} activeDot={{ r: 5, fill: "hsl(var(--primary))", strokeWidth: 0 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
                      Run more scans to see score history
                    </div>
                  )}
                </div>
              </article>

              <article className="flex min-w-0 flex-col rounded-[22px] border border-white/80 bg-card/80 p-5 shadow-[0_14px_34px_rgba(69,57,112,.06)] backdrop-blur-xl transition-all hover:shadow-[0_18px_38px_rgba(69,57,112,.1)]">
                <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
                  <div>
                    <p className="font-mono text-[10px] font-bold uppercase tracking-[.18em] text-muted-foreground">Issue count</p>
                    <h3 className="mt-1 text-sm font-semibold text-foreground">Progress over time</h3>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" className="h-7 text-[10px] font-semibold gap-1 px-2.5 rounded-lg border-border/60" onClick={() => exportCsv(filteredHistory, historyTab as "issues" | "potential")}>
                      <Download className="w-3 h-3" /> CSV
                    </Button>
                  </div>
                </div>
                
                <div className="flex flex-wrap items-center gap-3 mb-6 border-b border-border/40 pb-4">
                  <div className="flex rounded-lg bg-muted/40 p-1">
                    {[ { id: "issues", label: "Issues" }, { id: "potential", label: "Potential" } ].map(tab => (
                      <button key={tab.id} onClick={() => setHistoryTab(tab.id as any)} className={`px-3 py-1.5 text-[11px] font-semibold rounded-md transition-all ${historyTab === tab.id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"}`}>
                        {tab.label}
                      </button>
                    ))}
                  </div>
                  
                  <div className="flex items-center gap-2 ml-auto">
                    <select value={historyMetric} onChange={e => setHistoryMetric(e.target.value as any)} className="text-[11px] border-none bg-muted/40 rounded-lg px-2.5 py-1.5 font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 appearance-none cursor-pointer">
                      <option value="count">By Type</option>
                      <option value="occurrences">By Occurrences</option>
                    </select>
                    <select value={dateRange} onChange={e => setDateRange(+e.target.value)} className="text-[11px] border-none bg-muted/40 rounded-lg px-2.5 py-1.5 font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 appearance-none cursor-pointer">
                      {DATE_RANGES.map(r => <option key={r.months} value={r.months}>{r.label}</option>)}
                    </select>
                  </div>
                </div>

                <div className="flex-1 min-h-[180px]">
                  {chartData.length >= 2 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartData} margin={{ top: 10, right: 30, bottom: 0, left: -20 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-muted/10" vertical={false} />
                        <XAxis dataKey="date" tick={{ fontSize: 10, fill: "currentColor", opacity: 0.5 }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={20} />
                        <YAxis yAxisId="left" tick={{ fontSize: 10, fill: "currentColor", opacity: 0.5 }} tickLine={false} axisLine={false} width={40} />
                        <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: "currentColor", opacity: 0.5 }} tickLine={false} axisLine={false} width={40} />
                        <ChartTooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid hsl(var(--border))", background: "hsl(var(--card))", color: "hsl(var(--foreground))" }} />
                        
                        {historyTab === "issues" ? (
                          <>
                            <Line yAxisId="left" type="monotone" dataKey="level_a_issues" name="Level A" stroke="#ef4444" strokeWidth={2.5} dot={{ r: 3, fill: "hsl(var(--background))", strokeWidth: 1.5 }} activeDot={{ r: 5, strokeWidth: 0 }} />
                            <Line yAxisId="left" type="monotone" dataKey="level_aa_issues" name="Level AA" stroke="#a855f7" strokeWidth={2.5} strokeDasharray="5 4" dot={{ r: 3, fill: "hsl(var(--background))", strokeWidth: 1.5 }} activeDot={{ r: 5, strokeWidth: 0 }} />
                          </>
                        ) : (
                          <>
                            <Line yAxisId="left" type="monotone" dataKey="level_a_potential" name="Level A" stroke="#ef4444" strokeWidth={2.5} dot={{ r: 3, fill: "hsl(var(--background))", strokeWidth: 1.5 }} activeDot={{ r: 5, strokeWidth: 0 }} />
                            <Line yAxisId="left" type="monotone" dataKey="level_aa_potential" name="Level AA" stroke="#a855f7" strokeWidth={2.5} strokeDasharray="5 4" dot={{ r: 3, fill: "hsl(var(--background))", strokeWidth: 1.5 }} activeDot={{ r: 5, strokeWidth: 0 }} />
                          </>
                        )}
                        <Line yAxisId="right" type="monotone" dataKey="pages" name="Pages" stroke="hsl(var(--muted-foreground))" strokeWidth={2} strokeDasharray="3 3" dot={false} activeDot={{ r: 4 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
                      Run more scans to see progress
                    </div>
                  )}
                </div>
              </article>
            </section>

            {/* Bottom Panels */}
            <section className="grid min-w-0 gap-4 lg:grid-cols-[minmax(220px,0.7fr)_minmax(0,2.3fr)]">
              {/* Recent Scans */}
              <article className="min-w-0 rounded-[22px] border border-border/60 bg-card/70 p-4 backdrop-blur-xl shadow-sm transition-all hover:shadow-md sm:p-5">
                <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-base font-semibold text-foreground">Recent scans</h3>
                  {user?.permissions.canViewCrawlHistory && d.session && (
                    <Link href={`/crawler/${d.session.crawlerId}`} className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-primary hover:underline bg-primary/5 px-2.5 py-1 rounded-full transition-colors hover:bg-primary/10">
                      View all history <ArrowRight className="h-3 w-3"/>
                    </Link>
                  )}
                </div>
                
                <div className="space-y-2 flex-1">
                  {recentScans.map((s, i) => (
                    <div key={i} className="flex min-w-0 items-center gap-3 rounded-xl border border-border/40 bg-background/40 p-3 hover:border-primary/30 transition-colors shadow-sm">
                      <div className={`h-10 w-10 shrink-0 grid place-items-center rounded-xl text-sm font-bold shadow-sm ${
                        s.score >= 85 ? "bg-green-50 text-green-700 border border-green-200 dark:bg-green-950/40 dark:text-green-400 dark:border-green-900/50" : 
                        s.score >= 70 ? "bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-900/50" : 
                        "bg-orange-50 text-orange-700 border border-orange-200 dark:bg-orange-950/40 dark:text-orange-400 dark:border-orange-900/50"
                      }`}>
                        {s.score.toFixed(0)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-foreground tracking-tight">Full site scan</p>
                        <p className="truncate text-[11px] text-muted-foreground mt-0.5">
                          {new Date(s.scanned_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} · {(s.total_scanned ?? 0).toLocaleString()} pages · {(s.total_issues ?? 0).toLocaleString()} issues
                        </p>
                      </div>
                      {user?.permissions.canViewCrawlHistory && (
                        <div className="shrink-0 text-muted-foreground opacity-50 hover:opacity-100 transition-opacity pr-1">
                          <ArrowRight className="h-4 w-4"/>
                        </div>
                      )}
                    </div>
                  ))}
                  {recentScans.length === 0 && <p className="text-sm text-muted-foreground text-center py-10">No recent scans</p>}
                </div>
                
                {/* Quick Links */}
                <div className="mt-6 grid grid-cols-3 gap-2 border-t border-border/40 pt-5">
                  {[
                    { href: `/sites/${siteId}/page-groups`, icon: <Layers className="w-4 h-4" />, label: "Page Groups" },
                    { href: `/sites/${siteId}/issues`, icon: <AlertCircle className="w-4 h-4" />, label: "Issues" },
                    { href: `/sites/${siteId}/potential-issues`, icon: <FileText className="w-4 h-4" />, label: "Potential Issues" },
                  ].map(({ href, icon, label }) => (
                    <Link key={href} href={href} className="flex min-w-0 flex-col items-center justify-center gap-1.5 rounded-xl border border-border/40 bg-background/30 p-2 text-center hover:bg-muted/40 hover:border-primary/30 transition-all group shadow-sm">
                      <span className="text-muted-foreground group-hover:text-primary transition-colors">{icon}</span>
                      <span className="text-[10px] font-semibold leading-3 text-foreground group-hover:text-primary transition-colors">{label}</span>
                    </Link>
                  ))}
                </div>
              </article>

              {/* Top failing rules */}
              <article className="min-w-0 rounded-[22px] border border-border/60 bg-card/70 p-4 backdrop-blur-xl shadow-sm transition-all hover:shadow-md sm:p-5">
                <div className="flex items-center justify-between mb-5">
                  <h3 className="text-base font-semibold text-foreground">Top rules</h3>
                  <div className="grid place-items-center w-7 h-7 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-500">
                    <Zap className="h-4 w-4"/>
                  </div>
                </div>
                
                <div className="flex rounded-lg bg-muted/40 p-1 mb-5">
                  {[ { id: "issues", label: "Issues" }, { id: "potential", label: "Potential" }, { id: "resolved", label: "Resolved" } ].map(tab => (
                    <button key={tab.id} onClick={() => setTopRulesTab(tab.id as typeof topRulesTab)} className={`min-w-0 flex-1 px-2 py-1.5 text-center text-[11px] font-semibold rounded-md transition-all ${topRulesTab === tab.id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"}`}>
                      {tab.label}
                    </button>
                  ))}
                </div>

                <div className="space-y-1.5 flex-1">
                  {activeRuleList.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                      <CheckCircle className="w-8 h-8 text-green-500/50 mb-3" />
                      <p className="text-sm font-medium text-foreground">No {improveTab} rules</p>
                      <p className="text-xs text-muted-foreground mt-1">Looks like you're doing great!</p>
                    </div>
                  ) : activeRuleList.slice(0, 6).map((r, i) => (
                    <Link href={`/sites/${siteId}/issues/${encodeURIComponent(r.rule_id)}`} key={`${r.rule_id}-${i}`} className="block min-w-0">
                      <div className="group flex min-w-0 items-center gap-3 overflow-hidden rounded-xl border border-transparent p-2 transition-all hover:border-border/50 hover:bg-muted/40">
                        <span className="w-9 shrink-0 font-mono text-[10px] font-bold text-muted-foreground/60 group-hover:text-primary transition-colors">{r.rule_id}</span>
                        <div className="flex-1 min-w-0">
                          <p className="truncate text-xs font-medium text-foreground group-hover:text-primary transition-colors leading-relaxed">{r.description}</p>
                          <div className="mt-1.5 h-1.5 rounded-full bg-muted/60 overflow-hidden shadow-inner">
                            <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${(r.occurrences / maxRuleOccurrences) * 100}%`, backgroundColor: topRulesTab === "resolved" ? "#22c55e" : undefined }}/>
                          </div>
                        </div>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold shadow-sm ${
                          r.wcag_level === "A" ? "bg-red-50 text-red-700 border border-red-100 dark:bg-red-950/40 dark:text-red-400 dark:border-red-900/50" :
                          r.wcag_level === "AA" ? "bg-blue-50 text-blue-700 border border-blue-100 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-900/50" :
                          r.wcag_level === "AAA" ? "bg-purple-50 text-purple-700 border border-purple-100 dark:bg-purple-950/40 dark:text-purple-400 dark:border-purple-900/50" :
                          "bg-muted/50 text-muted-foreground border border-border/50"
                        }`}>
                          {r.wcag_level || "N/A"}
                        </span>
                        <span className="w-10 shrink-0 text-right text-[11px] font-bold tabular-nums text-primary">{r.occurrences.toLocaleString()}</span>
                      </div>
                    </Link>
                  ))}
                </div>
                
                {activeRuleList.length > 6 && (
                  <div className="mt-4 pt-4 border-t border-border/40 text-center">
                    <Link href={`/sites/${siteId}/issues`} className="text-[11px] font-semibold text-primary hover:underline">
                      View all {activeRuleList.length} rules
                    </Link>
                  </div>
                )}
              </article>
            </section>
          </>
        )}

        <Dialog open={targetDialogOpen} onOpenChange={setTargetDialogOpen}>
          <DialogContent className="max-w-sm rounded-[24px]">
            <DialogHeader>
              <DialogTitle>{targetScore === null ? "Set target score" : "Edit target score"}</DialogTitle>
              <DialogDescription>
                Choose a score from 0 to 100 to track your accessibility goals.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-4">
              <label htmlFor="site-target-score" className="text-xs font-semibold text-foreground uppercase tracking-wide">Target score</label>
              <Input
                id="site-target-score"
                type="number"
                min={0}
                max={100}
                step={1}
                placeholder="e.g. 90"
                value={targetDraft}
                onChange={(event) => setTargetDraft(event.target.value)}
                className="h-10 text-base"
              />
              <div className="space-y-1.5 pt-2">
                <label htmlFor="site-target-wcag-level" className="text-xs font-semibold text-foreground uppercase tracking-wide">
                  WCAG conformance scope
                </label>
                <Select value={targetWcagLevelDraft} onValueChange={(value) => setTargetWcagLevelDraft(value as "A" | "AA" | "AAA" | "All")}>
                  <SelectTrigger id="site-target-wcag-level" className="h-10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="A">Level A</SelectItem>
                    <SelectItem value="AA">Level AA (A + AA)</SelectItem>
                    <SelectItem value="AAA">Level AAA (A + AA + AAA)</SelectItem>
                    <SelectItem value="All">All levels (A + AA + AAA + WAI-ARIA + Best Practice)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {targetWcagLevelDraft === "All"
                    ? "Scores include all WCAG levels plus WAI-ARIA and Best Practice rules."
                    : "Scores include all WCAG levels up to the selected conformance level."}
                </p>
              </div>
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="ghost" onClick={() => setTargetDialogOpen(false)} className="rounded-xl">
                Cancel
              </Button>
              <Button
                type="button"
                disabled={targetSaving || (targetDraft.trim() !== "" && (!Number.isFinite(Number(targetDraft)) || Number(targetDraft) < 0 || Number(targetDraft) > 100))}
                onClick={() => void saveTargetScore()}
                className="gap-2 rounded-xl shadow-sm"
              >
                {targetSaving ? <span className="animate-pulse">Saving…</span> : <><Save className="w-4 h-4" /> Save</>}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
