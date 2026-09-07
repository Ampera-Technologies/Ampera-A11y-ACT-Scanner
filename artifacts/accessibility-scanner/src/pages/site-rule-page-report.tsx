import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useParams, Link, useSearch } from "wouter";
import { ACT_RULES, getRuleTitle } from "@/lib/actRules";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  ArrowLeft,
  Monitor,
  Code,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  ExternalLink,
  AlertTriangle,
  AlertCircle,
  Info,
  ZoomIn,
  ZoomOut,
  Crosshair,
  Eye,
  EyeOff,
  XCircle,
  Settings2,
  Ban,
  CheckCircle2,
  Clock,
  Undo2,
} from "lucide-react";
import { useAuth } from "@/contexts/auth";
import { InteractiveHtmlTree } from "@/components/page-report/html-tree";
import { SnapshotView, type SnapshotHandle } from "@/components/element-viewer";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

const DEPRECATED_RULES = new Set(["ACT-R3", "ACT-R6", "ACT-R34", "ACT-R36", "ACT-R83"]);

interface ReportIssue {
  id: number;
  ruleId: string;
  ruleType?: string | null;
  impact: string;
  description: string;
  element: string | null;
  elementContext?: string | null;
  selector: string | null;
  wcagCriteria: string | null;
  wcagLevel: string | null;
  remediation: string | null;
  bboxX?: number | null;
  bboxY?: number | null;
  bboxWidth?: number | null;
  bboxHeight?: number | null;
  falsePositive?: boolean;
}

interface RuleReportData {
  pageId: number;
  scanId: number;
  url: string;
  ruleId: string;
  hasSnapshot: boolean;
  isCrawlerScan: boolean;
  issues: ReportIssue[];
}

type DecisionRecord = {
  id: number;
  issueId: number | null;
  ruleId: string;
  selector: string | null;
  classPattern: string | null;
  decisionType: "cant_fix" | "false_positive";
  scope: "single" | "selector" | "class";
  reason: string | null;
  submitterName: string | null;
  reviewStatus: string;
  reviewedBy: number | null;
  reviewComment: string | null;
  createdAt: string;
};

function ImpactDot({ impact }: { impact: string }) {
  const color =
    impact === "critical" ? "#E11D48" :
    impact === "serious" ? "#EA580C" :
    impact === "moderate" ? "#EAB308" : "#3B82F6";
  return <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ background: color }} />;
}

function ImpactIcon({ impact }: { impact: string }) {
  switch (impact) {
    case "critical": return <AlertTriangle className="w-4 h-4 text-[#E11D48]" />;
    case "serious":  return <AlertTriangle className="w-4 h-4 text-[#EA580C]" />;
    case "moderate": return <AlertCircle className="w-4 h-4 text-[#EAB308]" />;
    default:         return <Info className="w-4 h-4 text-[#3B82F6]" />;
  }
}

function shortElementLabel(issue: ReportIssue): string {
  const el = (issue.element ?? "").trim().replace(/\s+/g, " ");
  if (el) return el.length > 90 ? `${el.slice(0, 90)}…` : el;
  const sel = issue.selector ?? "";
  const last = sel.split(/\s*>\s*/).pop() ?? sel;
  return last || "(element)";
}

export default function SiteRulePageReport() {
  const params = useParams<{ siteId: string; pageId: string }>();
  const siteId = parseInt(params.siteId ?? "0", 10);
  const pageId = parseInt(params.pageId ?? "0", 10);
  const search = useSearch();
  const ruleId = useMemo(() => new URLSearchParams(search).get("rule") ?? "", [search]);
  const { user } = useAuth();

  const [data, setData] = useState<RuleReportData | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!pageId || !ruleId) return;
    setLoading(true);
    setLoadError(false);
    fetch(`${BASE}/api/pages/${pageId}/rule-report?rule=${encodeURIComponent(ruleId)}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: RuleReportData) => { setData(d); setLoading(false); })
      .catch(() => { setLoadError(true); setLoading(false); });
  }, [pageId, ruleId]);

  const scanId = data?.scanId ?? 0;
  const pageUrl = data?.url ?? "";
  const isCrawlerScan = data?.isCrawlerScan ?? false;

  const impactOrder: Record<string, number> = { critical: 0, serious: 1, moderate: 2, minor: 3 };

  const issues = useMemo(
    () => (data?.issues ?? []).filter((i) => !i.falsePositive),
    [data],
  );

  function buildRuleGroups(subset: ReportIssue[]) {
    const map = new Map<string, ReportIssue[]>();
    for (const i of subset) {
      const arr = map.get(i.ruleId) ?? [];
      arr.push(i);
      map.set(i.ruleId, arr);
    }
    return Array.from(map.entries()).sort(
      (a, b) => (impactOrder[a[1][0].impact] ?? 9) - (impactOrder[b[1][0].impact] ?? 9) || a[0].localeCompare(b[0]),
    );
  }

  const confirmedIssues = useMemo(() => issues.filter((i) => !i.ruleType || i.ruleType === "Issue"), [issues]);
  const potentialIssues = useMemo(() => issues.filter((i) => i.ruleType === "Potential Issue"), [issues]);
  const bestPractices   = useMemo(() => issues.filter((i) => i.ruleType === "Best Practice"), [issues]);
  const waiAriaIssues   = useMemo(() => issues.filter((i) => i.ruleType === "WAI-ARIA"), [issues]);

  const ruleGroups        = useMemo(() => buildRuleGroups(confirmedIssues), [confirmedIssues]);
  const potentialGroups   = useMemo(() => buildRuleGroups(potentialIssues), [potentialIssues]);
  const bestPracticeGroups= useMemo(() => buildRuleGroups(bestPractices), [bestPractices]);
  const waiAriaGroups     = useMemo(() => buildRuleGroups(waiAriaIssues), [waiAriaIssues]);

  const [selectedIssueId, setSelectedIssueId] = useState<number | null>(null);
  const [tab, setTab] = useState<"page" | "html">("page");
  const [expandedOcc, setExpandedOcc] = useState<Set<number>>(new Set());
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    () => new Set(["Issue", "Potential Issue", "Best Practice", "WAI-ARIA"]),
  );

  const toggleSection = (cat: string) =>
    setExpandedSections((prev) => { const n = new Set(prev); n.has(cat) ? n.delete(cat) : n.add(cat); return n; });

  const [decisions, setDecisions] = useState<DecisionRecord[]>([]);
  const [decisionPanelId, setDecisionPanelId] = useState<number | null>(null);
  const [dpType, setDpType] = useState<"cant_fix" | "false_positive">("cant_fix");
  const [dpScope, setDpScope] = useState<"single" | "selector" | "class">("single");
  const [dpReason, setDpReason] = useState("");
  const [dpClassInput, setDpClassInput] = useState("");
  const [dpSaving, setDpSaving] = useState(false);

  useEffect(() => {
    if (!scanId) return;
    fetch(`${BASE}/api/scans/${scanId}/decisions`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: DecisionRecord[]) => setDecisions(rows))
      .catch(() => {});
  }, [scanId]);

  useEffect(() => {
    setSelectedIssueId(null);
    setTab("page");
    setExpandedOcc(new Set());
    setSnapshotError(false);
    setPageHtml("");
    setHtmlLoaded(false);
  }, [pageId]);

  useEffect(() => {
    if (selectedIssueId != null || issues.length === 0) return;
    setSelectedIssueId(issues[0].id);
  }, [issues, selectedIssueId]);

  const selectedIssue = issues.find((i) => i.id === selectedIssueId) ?? null;
  const allGroups = useMemo(
    () => [...ruleGroups, ...potentialGroups, ...bestPracticeGroups],
    [ruleGroups, potentialGroups, bestPracticeGroups],
  );
  const selectedGroup = selectedIssue
    ? (allGroups.find(([r]) => r === selectedIssue.ruleId)?.[1] ?? [])
    : [];
  const occIndex = selectedIssue ? selectedGroup.findIndex((i) => i.id === selectedIssue.id) : -1;
  const ruleMeta = selectedIssue ? ACT_RULES[selectedIssue.ruleId] : undefined;

  const [pageHtml, setPageHtml] = useState("");
  const [htmlLoaded, setHtmlLoaded] = useState(false);
  useEffect(() => {
    if (!pageId) return;
    let cancelled = false;
    fetch(`${BASE}/api/pages/${pageId}/html`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled) { setPageHtml(d?.html ?? ""); setHtmlLoaded(true); } })
      .catch(() => { if (!cancelled) setHtmlLoaded(true); });
    return () => { cancelled = true; };
  }, [pageId]);

  const [zoom, setZoom] = useState(1);
  const [showHighlight, setShowHighlight] = useState(true);
  const [scrollTrigger, setScrollTrigger] = useState(0);
  const [snapshotError, setSnapshotError] = useState(false);
  const snapshotRef = useRef<SnapshotHandle>(null);
  const snapshotContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setScrollTrigger((t) => t + 1); }, [selectedIssueId]);

  const zoomToElement = useCallback(() => {
    if (!snapshotRef.current || !snapshotContainerRef.current) return;
    const optimal = snapshotRef.current.zoomToElement(
      snapshotContainerRef.current.clientWidth,
      snapshotContainerRef.current.clientHeight,
    );
    if (optimal != null) {
      setZoom(Math.min(Math.max(optimal, 0.5), 4));
      setTimeout(() => snapshotRef.current?.scrollToElement(), 80);
    }
  }, []);

  const selectOccurrence = (issue: ReportIssue, mode?: "page" | "html") => {
    setSelectedIssueId(issue.id);
    if (mode) setTab(mode);
  };

  function extractPrimaryClass(selector: string | null | undefined): string | null {
    if (!selector) return null;
    const last = selector.split(/[\s>+~]+/).pop() ?? "";
    const m = last.match(/\.([a-zA-Z0-9_-]+)/);
    return m ? `.${m[1]}` : null;
  }

  function getOccDecision(occ: ReportIssue): DecisionRecord | undefined {
    return decisions.find((d) => {
      if (d.ruleId !== occ.ruleId) return false;
      if (d.scope === "single") return d.issueId === occ.id;
      if (d.scope === "selector") return d.selector === occ.selector;
      if (d.scope === "class") {
        const cls = d.classPattern ?? extractPrimaryClass(d.selector);
        return cls !== null && (occ.selector?.includes(cls) ?? false);
      }
      return false;
    });
  }

  async function saveDecision(occ: ReportIssue) {
    setDpSaving(true);
    try {
      const r = await fetch(`${BASE}/api/scans/${scanId}/decisions`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          issueId: dpScope === "single" ? occ.id : undefined,
          pageId,
          ruleId: occ.ruleId,
          selector: occ.selector,
          classPattern: dpScope === "class" && dpClassInput ? dpClassInput : undefined,
          elementSnippet: occ.element?.slice(0, 500),
          pageUrl,
          issueDescription: occ.description,
          decisionType: dpType,
          scope: dpScope,
          reason: dpReason || undefined,
        }),
      });
      if (r.ok) {
        const created: DecisionRecord = await r.json();
        setDecisions((prev) => [created, ...prev]);
        setDecisionPanelId(null);
        setDpReason("");
        setDpClassInput("");
        setDpScope("single");
      }
    } finally {
      setDpSaving(false);
    }
  }

  async function undoDecision(decisionId: number) {
    const r = await fetch(`${BASE}/api/scans/${scanId}/decisions/${decisionId}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (r.ok) setDecisions((prev) => prev.filter((d) => d.id !== decisionId));
  }

  const backHref = `/sites/${siteId}/issues/${encodeURIComponent(ruleId)}`;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[70vh] text-muted-foreground gap-2">
        <Loader2 className="w-5 h-5 animate-spin" /> Loading page report…
      </div>
    );
  }

  if (loadError || !data) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        <p>Page not found or access denied.</p>
        <Link href={backHref} className="text-violet-600 hover:underline text-sm">
          Back to pages
        </Link>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-white flex flex-col" data-testid="page-report">
      {/* ── Top bar ── */}
      <div className="shrink-0 flex items-center gap-3 px-4 py-2 border-b bg-gray-50">
        <Link href={backHref}>
          <Button variant="ghost" size="sm" className="gap-1.5 text-xs" data-testid="button-back-to-scan">
            <ArrowLeft className="w-3.5 h-3.5" /> Back to pages
          </Button>
        </Link>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">Page report</p>
          <a
            href={pageUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-violet-600 hover:underline font-mono truncate flex items-center gap-1"
          >
            <span className="truncate">{pageUrl}</span>
            <ExternalLink className="w-3 h-3 shrink-0" />
          </a>
        </div>
        <div className="flex shrink-0 rounded-md overflow-hidden border border-gray-200 text-xs">
          <button
            onClick={() => setTab("page")}
            data-testid="tab-view-page"
            className={`flex items-center gap-1.5 px-3 py-1.5 transition-colors ${tab === "page" ? "bg-violet-600 text-white" : "bg-white text-gray-600 hover:bg-gray-100"}`}
          >
            <Monitor className="w-3.5 h-3.5" /> View page
          </button>
          <button
            onClick={() => setTab("html")}
            data-testid="tab-view-html"
            className={`flex items-center gap-1.5 px-3 py-1.5 border-l border-gray-200 transition-colors ${tab === "html" ? "bg-violet-600 text-white" : "bg-white text-gray-600 hover:bg-gray-100"}`}
          >
            <Code className="w-3.5 h-3.5" /> View HTML
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* ── Left sidebar ── */}
        <div className="w-[380px] shrink-0 border-r flex flex-col bg-white overflow-hidden">
          <div className="shrink-0 border-b bg-gray-50 px-3 py-2 space-y-1.5 overflow-y-auto max-h-[55vh]">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                {issues.length} {issues.length === 1 ? "issue" : "issues"} found
              </span>
            </div>

            {ruleGroups.length > 0 && (
              <div>
                <button
                  onClick={() => toggleSection("Issue")}
                  className="w-full flex items-center justify-between px-2 py-1.5 rounded-md bg-red-50 border border-red-200 text-[10px] font-semibold text-red-700 hover:bg-red-100 transition-colors mb-0.5"
                >
                  <span className="flex items-center gap-1.5 uppercase tracking-wide">
                    <XCircle className="w-3 h-3" />
                    Issues ({confirmedIssues.length})
                  </span>
                  {expandedSections.has("Issue") ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                </button>
                {expandedSections.has("Issue") && (
                  <div className="space-y-0.5 pl-1">
                    {ruleGroups.map(([rid, grp]) => {
                      const active = selectedIssue?.ruleId === rid;
                      return (
                        <button
                          key={rid}
                          onClick={() => selectOccurrence(grp[0])}
                          data-testid={`rule-${rid}`}
                          className={`w-full text-left flex items-center gap-2 px-2 py-1.5 rounded text-xs ${active ? "bg-violet-50 text-violet-900 font-semibold" : "hover:bg-gray-100 text-gray-700"}`}
                        >
                          <ImpactDot impact={grp[0].impact} />
                          <span className="flex-1 truncate">{getRuleTitle(rid, grp[0]?.ruleType, grp[0]?.description)}</span>
                          <Badge variant="secondary" className="text-[10px] px-1.5 shrink-0">{grp.length}</Badge>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {potentialGroups.length > 0 && (
              <div>
                <button
                  onClick={() => toggleSection("Potential Issue")}
                  className="w-full flex items-center justify-between px-2 py-1.5 rounded-md bg-amber-50 border border-amber-200 text-[10px] font-semibold text-amber-700 hover:bg-amber-100 transition-colors mb-0.5"
                >
                  <span className="flex items-center gap-1.5 uppercase tracking-wide">
                    <AlertCircle className="w-3 h-3" />
                    Potential Issues ({potentialIssues.length})
                  </span>
                  {expandedSections.has("Potential Issue") ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                </button>
                {expandedSections.has("Potential Issue") && (
                  <div className="space-y-0.5 pl-1">
                    {potentialGroups.map(([rid, grp]) => {
                      const active = selectedIssue?.ruleId === rid;
                      return (
                        <button
                          key={rid}
                          onClick={() => selectOccurrence(grp[0])}
                          data-testid={`rule-${rid}`}
                          className={`w-full text-left flex items-center gap-2 px-2 py-1.5 rounded text-xs ${active ? "bg-amber-50 text-amber-900 font-semibold" : "hover:bg-gray-100 text-gray-700"}`}
                        >
                          <span className="w-2 h-2 rounded-full shrink-0 bg-amber-400" />
                          <span className="flex-1 truncate">{getRuleTitle(rid, grp[0]?.ruleType, grp[0]?.description)}</span>
                          <Badge variant="secondary" className="text-[10px] px-1.5 shrink-0 bg-amber-100 text-amber-700">{grp.length}</Badge>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {bestPracticeGroups.length > 0 && (
              <div>
                <button
                  onClick={() => toggleSection("Best Practice")}
                  className="w-full flex items-center justify-between px-2 py-1.5 rounded-md bg-blue-50 border border-blue-200 text-[10px] font-semibold text-blue-700 hover:bg-blue-100 transition-colors mb-0.5"
                >
                  <span className="flex items-center gap-1.5 uppercase tracking-wide">
                    <Info className="w-3 h-3" />
                    Best Practices ({bestPractices.length})
                  </span>
                  {expandedSections.has("Best Practice") ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                </button>
                {expandedSections.has("Best Practice") && (
                  <div className="space-y-0.5 pl-1">
                    {bestPracticeGroups.map(([rid, grp]) => {
                      const active = selectedIssue?.ruleId === rid;
                      return (
                        <button
                          key={rid}
                          onClick={() => selectOccurrence(grp[0])}
                          data-testid={`rule-${rid}`}
                          className={`w-full text-left flex items-center gap-2 px-2 py-1.5 rounded text-xs ${active ? "bg-blue-50 text-blue-900 font-semibold" : "hover:bg-gray-100 text-gray-700"}`}
                        >
                          <span className="w-2 h-2 rounded-full shrink-0 bg-blue-400" />
                          <span className="flex-1 truncate">{getRuleTitle(rid, grp[0]?.ruleType, grp[0]?.description)}</span>
                          <Badge variant="secondary" className="text-[10px] px-1.5 shrink-0 bg-blue-100 text-blue-700">{grp.length}</Badge>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {waiAriaGroups.length > 0 && (
              <div>
                <button
                  onClick={() => toggleSection("WAI-ARIA")}
                  className="w-full flex items-center justify-between px-2 py-1.5 rounded-md bg-purple-50 border border-purple-200 text-[10px] font-semibold text-purple-700 hover:bg-purple-100 transition-colors mb-0.5"
                >
                  <span className="flex items-center gap-1.5 uppercase tracking-wide">
                    <Code className="w-3 h-3" />
                    WAI-ARIA ({waiAriaIssues.length})
                  </span>
                  {expandedSections.has("WAI-ARIA") ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                </button>
                {expandedSections.has("WAI-ARIA") && (
                  <div className="space-y-0.5 pl-1">
                    {waiAriaGroups.map(([rid, grp]) => {
                      const active = selectedIssue?.ruleId === rid;
                      return (
                        <button
                          key={rid}
                          onClick={() => selectOccurrence(grp[0])}
                          data-testid={`rule-${rid}`}
                          className={`w-full text-left flex items-center gap-2 px-2 py-1.5 rounded text-xs ${active ? "bg-purple-50 text-purple-900 font-semibold" : "hover:bg-gray-100 text-gray-700"}`}
                        >
                          <span className="w-2 h-2 rounded-full shrink-0 bg-purple-400" />
                          <span className="flex-1 truncate">{getRuleTitle(rid, grp[0]?.ruleType, grp[0]?.description)}</span>
                          <Badge variant="secondary" className="text-[10px] px-1.5 shrink-0 bg-purple-100 text-purple-700">{grp.length}</Badge>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {issues.length === 0 && (
              <p className="text-xs text-gray-400 italic">No issues on this page for this rule</p>
            )}
          </div>

          {selectedIssue && (
            <div className="flex-1 overflow-auto">
              <div className="px-4 py-3 border-b">
                <div className="flex items-center gap-2 mb-1.5">
                  <ImpactIcon impact={selectedIssue.impact} />
                  <h2 className="text-sm font-bold leading-snug">
                    {getRuleTitle(selectedIssue.ruleId, selectedIssue.ruleType, selectedIssue.description)}
                  </h2>
                </div>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  <Badge variant="outline" className="text-[10px] font-mono">{selectedIssue.ruleId}</Badge>
                  {selectedIssue.ruleId.startsWith("ACT-") && (
                    <Badge variant="outline" className="text-[10px] font-mono text-muted-foreground">
                      Equivalent: {selectedIssue.ruleId.replace(/^ACT-/, "SIA-")}
                    </Badge>
                  )}
                  {DEPRECATED_RULES.has(selectedIssue.ruleId) && (
                    <Badge variant="outline" className="text-[10px] border-amber-500 text-amber-600 bg-amber-50">
                      Deprecated
                    </Badge>
                  )}
                  {ruleMeta?.relatedRules?.map((relatedRule) => (
                    <Badge
                      key={relatedRule}
                      variant="outline"
                      className="text-[10px] border-blue-500/50 bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300"
                    >
                      Related: {relatedRule}
                    </Badge>
                  ))}
                  {selectedIssue.wcagCriteria && (
                    <Badge variant="secondary" className="text-[10px] font-mono">WCAG {selectedIssue.wcagCriteria}</Badge>
                  )}
                  {selectedIssue.wcagLevel && (
                    <Badge variant="outline" className="text-[10px]">Level {selectedIssue.wcagLevel}</Badge>
                  )}
                  <Badge variant="outline" className="text-[10px] capitalize">{selectedIssue.impact}</Badge>
                </div>
                <p className="text-xs text-gray-600 leading-relaxed">{selectedIssue.description}</p>
              </div>

              {(ruleMeta?.detail || selectedIssue.remediation) && (
                <div className="px-4 py-3 border-b bg-blue-50/50">
                  <p className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold mb-1">
                    Why is this an issue?
                  </p>
                  {ruleMeta?.detail && (
                    <p className="text-xs text-gray-700 leading-relaxed">{ruleMeta.detail}</p>
                  )}
                  {selectedIssue.remediation && (
                    <div className="mt-2">
                      <p className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold mb-1">How to fix</p>
                      <p className="text-xs text-gray-700 leading-relaxed">{selectedIssue.remediation}</p>
                    </div>
                  )}
                </div>
              )}

              <div className="px-4 py-3">
                <p className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold mb-2">
                  Occurrences ({selectedGroup.length})
                </p>
                <div className="space-y-1">
                  {selectedGroup.map((occ, i) => {
                    const active = occ.id === selectedIssue.id;
                    const expanded = expandedOcc.has(occ.id);
                    return (
                      <div
                        key={occ.id}
                        className={`border rounded ${active ? "border-violet-400 bg-violet-50/60" : "border-gray-200"}`}
                      >
                        <button
                          onClick={() => {
                            selectOccurrence(occ);
                            setExpandedOcc((prev) => {
                              const n = new Set(prev);
                              if (n.has(occ.id)) n.delete(occ.id); else n.add(occ.id);
                              return n;
                            });
                          }}
                          data-testid={`occurrence-${i}`}
                          className="w-full flex items-start gap-2 px-2 py-1.5 text-left"
                        >
                          {expanded ? (
                            <ChevronDown className="w-3.5 h-3.5 mt-0.5 shrink-0 text-gray-400" />
                          ) : (
                            <ChevronRight className="w-3.5 h-3.5 mt-0.5 shrink-0 text-gray-400" />
                          )}
                          <span className="text-[11px] font-mono text-gray-700 leading-snug break-all">
                            {i + 1}. {shortElementLabel(occ)}
                          </span>
                        </button>
                        {expanded && (() => {
                          const occDecision = getOccDecision(occ);
                          const showPanel = decisionPanelId === occ.id;
                          return (
                            <div className="px-2 pb-2 pl-8 space-y-1.5">
                              {occ.selector && (
                                <code className="block text-[10px] text-gray-500 font-mono break-all">
                                  {occ.selector}
                                </code>
                              )}
                              <div className="flex gap-1.5 flex-wrap items-center">
                                <Button
                                  variant="outline" size="sm"
                                  className="h-6 text-[10px] px-2 gap-1"
                                  onClick={() => selectOccurrence(occ, "page")}
                                >
                                  <Monitor className="w-3 h-3" /> View on page
                                </Button>
                                <Button
                                  variant="outline" size="sm"
                                  className="h-6 text-[10px] px-2 gap-1"
                                  onClick={() => selectOccurrence(occ, "html")}
                                >
                                  <Code className="w-3 h-3" /> View in HTML
                                </Button>
                                {isCrawlerScan && (
                                  <button
                                    type="button"
                                    title="Decision for this occurrence (crawler scans only)"
                                    onClick={() => {
                                      if (showPanel) { setDecisionPanelId(null); return; }
                                      setDecisionPanelId(occ.id);
                                      setDpType(occDecision?.decisionType ?? "cant_fix");
                                      setDpScope(occDecision?.scope ?? "single");
                                      setDpReason(occDecision?.reason ?? "");
                                      setDpClassInput(occDecision?.classPattern ?? "");
                                    }}
                                    className={`h-6 w-6 flex items-center justify-center rounded border transition-colors ${showPanel ? "border-violet-400 bg-violet-50 text-violet-600" : occDecision ? "border-amber-300 bg-amber-50 text-amber-700" : "border-gray-200 text-gray-400 hover:border-gray-400 hover:text-gray-600"}`}
                                  >
                                    <Settings2 className="w-3 h-3" />
                                  </button>
                                )}
                                {occDecision && (
                                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium inline-flex items-center gap-1 ${occDecision.decisionType === "cant_fix" ? "bg-amber-100 text-amber-700" : occDecision.reviewStatus === "confirmed" ? "bg-green-100 text-green-700" : occDecision.reviewStatus === "rejected" ? "bg-red-100 text-red-700" : "bg-blue-100 text-blue-700"}`}>
                                    {occDecision.decisionType === "cant_fix" ? <Ban className="w-2.5 h-2.5" /> : occDecision.reviewStatus === "confirmed" ? <CheckCircle2 className="w-2.5 h-2.5" /> : occDecision.reviewStatus === "rejected" ? <XCircle className="w-2.5 h-2.5" /> : <Clock className="w-2.5 h-2.5" />}
                                    {occDecision.decisionType === "cant_fix" ? "Can't Fix" : occDecision.reviewStatus === "confirmed" ? "Confirmed FP" : occDecision.reviewStatus === "rejected" ? "FP Rejected" : "FP Pending Review"}
                                  </span>
                                )}
                              </div>
                              {showPanel && (
                                <div className="mt-1.5 rounded border border-violet-200 bg-violet-50/70 p-3 space-y-2.5">
                                  <p className="text-[11px] font-semibold text-gray-700">Decision for this occurrence</p>
                                  {occDecision ? (
                                    <div className="space-y-2">
                                      <p className="text-xs text-gray-600">
                                        <span className="font-medium">{occDecision.decisionType === "cant_fix" ? "Can't Fix" : "False Positive"}</span>
                                        {occDecision.scope === "selector" ? " — applied to all with this selector" : occDecision.scope === "class" ? ` — applied to all with class ${occDecision.classPattern ?? extractPrimaryClass(occDecision.selector) ?? ""}` : " — single occurrence"}
                                        {occDecision.reason && <> · <span className="italic">{occDecision.reason}</span></>}
                                      </p>
                                      <p className="text-[10px] text-gray-400">By {occDecision.submitterName} · {new Date(occDecision.createdAt).toLocaleDateString()}</p>
                                      <button
                                        type="button"
                                        onClick={() => undoDecision(occDecision.id)}
                                        className="flex items-center gap-1 text-[10px] text-red-600 hover:underline font-medium"
                                      >
                                        <Undo2 className="w-3 h-3" /> Undo decision
                                      </button>
                                    </div>
                                  ) : (
                                    <>
                                      <div className="space-y-1">
                                        {(["cant_fix", "false_positive"] as const).map((t) => (
                                          <label key={t} className="flex items-center gap-2 cursor-pointer">
                                            <input type="radio" name={`dp-type-${occ.id}`} value={t} checked={dpType === t} onChange={() => setDpType(t)} className="accent-violet-600" />
                                            <span className="text-[11px] text-gray-700 font-medium">
                                              {t === "cant_fix" ? "Dismiss as can't fix" : "Dismiss as false positive"}
                                            </span>
                                          </label>
                                        ))}
                                      </div>
                                      <div>
                                        <label className="text-[10px] text-gray-500 block mb-1">Please explain your decision (optional):</label>
                                        <textarea
                                          value={dpReason}
                                          onChange={(e) => setDpReason(e.target.value)}
                                          rows={2}
                                          className="w-full text-xs border border-gray-200 rounded px-2 py-1 resize-none focus:outline-none focus:border-violet-400"
                                          placeholder="Optional reason…"
                                        />
                                      </div>
                                      <details className="group">
                                        <summary className="text-[10px] text-gray-500 cursor-pointer select-none">Advanced options</summary>
                                        <div className="mt-1.5 space-y-1.5 pl-2">
                                          <p className="text-[10px] text-gray-500 mb-1">Apply decision to:</p>
                                          {(["single", "selector"] as const).map((s) => (
                                            <label key={s} className="flex items-start gap-2 cursor-pointer">
                                              <input type="radio" name={`dp-scope-${occ.id}`} value={s} checked={dpScope === s} onChange={() => setDpScope(s)} className="accent-violet-600 mt-0.5" />
                                              <span className="text-[10px] text-gray-600 leading-snug">
                                                {s === "single" ? "This occurrence only" : `All occurrences matching selector: ${occ.selector ?? "(none)"}`}
                                              </span>
                                            </label>
                                          ))}
                                          <label className="flex items-start gap-2 cursor-pointer">
                                            <input type="radio" name={`dp-scope-${occ.id}`} value="class" checked={dpScope === "class"} onChange={() => setDpScope("class")} className="accent-violet-600 mt-0.5" />
                                            <span className="text-[10px] text-gray-600 leading-snug">All occurrences sharing CSS class (all pages in this scan)</span>
                                          </label>
                                          {dpScope === "class" && (() => {
                                            const rawCls = dpClassInput.trim();
                                            const normalizedCls = rawCls ? (rawCls.startsWith(".") ? rawCls : `.${rawCls}`) : "";
                                            const matchCount = normalizedCls
                                              ? issues.filter((i) => i.selector?.includes(normalizedCls)).length
                                              : 0;
                                            const hasMatch = matchCount > 0;
                                            return (
                                              <div className="pl-5 space-y-1">
                                                <input
                                                  type="text"
                                                  placeholder=".my-class or class-name"
                                                  value={dpClassInput}
                                                  onChange={(e) => setDpClassInput(e.target.value)}
                                                  className="w-full text-[10px] border border-gray-200 rounded px-2 py-1 focus:outline-none focus:border-violet-400 font-mono"
                                                  autoFocus
                                                />
                                                {rawCls && (
                                                  <p className={`text-[10px] ${hasMatch ? "text-violet-600" : "text-red-500"}`}>
                                                    {hasMatch
                                                      ? `${matchCount} matching occurrence${matchCount !== 1 ? "s" : ""} for rule ${occ.ruleId} on this page`
                                                      : `No matches for "${normalizedCls}" — check the class name`}
                                                  </p>
                                                )}
                                              </div>
                                            );
                                          })()}
                                        </div>
                                      </details>
                                      <div className="flex gap-2">
                                        <button
                                          type="button"
                                          onClick={() => setDecisionPanelId(null)}
                                          className="text-[11px] px-3 py-1 rounded border border-gray-300 text-gray-600 hover:bg-gray-50"
                                        >
                                          Cancel
                                        </button>
                                        <button
                                          type="button"
                                          disabled={dpSaving || (dpScope === "class" && !dpClassInput.trim())}
                                          onClick={() => saveDecision(occ)}
                                          className="text-[11px] px-3 py-1 rounded bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 font-medium"
                                        >
                                          {dpSaving ? "Saving…" : "Save decision"}
                                        </button>
                                      </div>
                                    </>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── Main content ── */}
        <div className="flex-1 flex flex-col overflow-hidden bg-gray-100">
          {selectedIssue && tab === "page" && (
            <>
              <div className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-white border-b">
                {selectedGroup.length > 1 && (
                  <div className="flex items-center gap-0.5 mr-2">
                    <Button variant="ghost" size="sm" className="h-6 px-1.5" disabled={occIndex <= 0} onClick={() => selectOccurrence(selectedGroup[occIndex - 1])}>
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </Button>
                    <span className="text-xs text-gray-500 font-mono tabular-nums">{occIndex + 1}/{selectedGroup.length}</span>
                    <Button variant="ghost" size="sm" className="h-6 px-1.5" disabled={occIndex >= selectedGroup.length - 1} onClick={() => selectOccurrence(selectedGroup[occIndex + 1])}>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                )}
                <div className="flex-1" />
                <Button variant="ghost" size="sm" className="h-6 px-2 text-xs gap-1" onClick={() => setShowHighlight((v) => !v)}>
                  {showHighlight ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  {showHighlight ? "Hide highlight" : "Show highlight"}
                </Button>
                <Button variant="ghost" size="sm" className="h-6 px-2 text-xs gap-1" onClick={zoomToElement} title="Zoom to element">
                  <Crosshair className="w-3.5 h-3.5" /> Focus
                </Button>
                <Button variant="ghost" size="sm" className="h-6 px-1.5" onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))}>
                  <ZoomOut className="w-3.5 h-3.5" />
                </Button>
                <span className="text-xs text-gray-500 font-mono w-10 text-center">{Math.round(zoom * 100)}%</span>
                <Button variant="ghost" size="sm" className="h-6 px-1.5" onClick={() => setZoom((z) => Math.min(4, +(z + 0.25).toFixed(2)))}>
                  <ZoomIn className="w-3.5 h-3.5" />
                </Button>
              </div>
              <div ref={snapshotContainerRef} className="flex-1 overflow-hidden">
                {snapshotError ? (
                  <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-400">
                    <Monitor className="w-8 h-8" />
                    <p className="text-sm">No snapshot stored for this page</p>
                    <a href={pageUrl} target="_blank" rel="noopener noreferrer" className="text-violet-600 hover:underline text-xs flex items-center gap-1">
                      Open live page <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                ) : (
                  <SnapshotView
                    ref={snapshotRef}
                    pageId={pageId}
                    bboxX={selectedIssue.bboxX ?? null}
                    bboxY={selectedIssue.bboxY ?? null}
                    bboxWidth={selectedIssue.bboxWidth ?? null}
                    bboxHeight={selectedIssue.bboxHeight ?? null}
                    zoom={zoom}
                    showHighlight={showHighlight}
                    scrollTrigger={scrollTrigger}
                    onError={() => setSnapshotError(true)}
                    onNaturalSize={() => {}}
                  />
                )}
              </div>
              {selectedIssue.selector && (
                <div className="shrink-0 bg-gray-900 text-gray-300 text-xs px-3 py-1.5 font-mono truncate" title={selectedIssue.selector}>
                  <span className="text-gray-500 mr-2">target:</span>{selectedIssue.selector}
                </div>
              )}
            </>
          )}

          {selectedIssue && tab === "html" && (
            <div className="flex-1 flex flex-col overflow-hidden bg-white">
              {!htmlLoaded ? (
                <div className="flex-1 flex items-center justify-center text-gray-400 gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-sm">Loading page HTML…</span>
                </div>
              ) : (
                <InteractiveHtmlTree
                  key={selectedIssue.id}
                  pageHtml={pageHtml}
                  elementHtml={selectedIssue.element ?? ""}
                  elementContext={selectedIssue.elementContext}
                  selector={selectedIssue.selector ?? ""}
                />
              )}
            </div>
          )}

          {!selectedIssue && (
            <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
              No issues on this page for this rule.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
