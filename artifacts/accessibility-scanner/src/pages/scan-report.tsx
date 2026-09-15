import { useParams, Link } from "wouter";
import { useGetScanReport, useGetScan, getGetScanQueryKey, getGetScanReportQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, ArrowUpRight, FileDown, Loader2, Sparkles } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/auth";

export default function ScanReport() {
  const { id } = useParams();
  const scanId = Number(id);
  const { toast } = useToast();
  const { user } = useAuth();
  const [isExporting, setIsExporting] = useState(false);
  const { data: scan } = useGetScan(scanId, { query: { enabled: !!scanId, queryKey: getGetScanQueryKey(scanId) } });
  const { data: report, isLoading, isError, refetch } = useGetScanReport(scanId, { query: { enabled: !!scanId, queryKey: getGetScanReportQueryKey(scanId) } });

  const exportCsv = async () => {
    if (!scanId) return;
    setIsExporting(true);
    try {
      const response = await fetch(`/api/scans/${scanId}/export?format=csv`, { credentials: "include" });
      if (!response.ok) throw new Error(`Export failed with status ${response.status}`);
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${(scan?.name || `scan-${scanId}`).replace(/[^a-z0-9_-]/gi, "_").toLowerCase()}-a11y-report.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
      toast({ title: "CSV exported" });
    } catch {
      toast({ title: "Export failed", description: "Could not generate the CSV report.", variant: "destructive" });
    } finally {
      setIsExporting(false);
    }
  };

  if (isError || (!isLoading && !report)) return (
    <div className="mx-auto flex min-h-[55vh] max-w-xl flex-col items-center justify-center gap-4 text-center" data-testid="report-error">
      <div className="grid h-14 w-14 place-items-center rounded-2xl bg-red-50 text-red-600">!</div>
      <div><h2 className="text-lg font-semibold">Report unavailable</h2><p className="mt-1 text-sm text-muted-foreground">We couldn’t load this scan report.</p></div>
      <div className="flex gap-2"><Button variant="outline" onClick={() => refetch()} data-testid="button-retry-report">Retry</Button><Link href={`/scans/${scanId}`}><Button variant="ghost" data-testid="link-back-scan"><ArrowLeft className="mr-2 h-4 w-4" />Back to scan</Button></Link></div>
    </div>
  );
  if (isLoading || !report) return <div className="space-y-6"><div className="h-20 animate-pulse rounded-3xl bg-muted/60" /><div className="grid gap-4 md:grid-cols-4">{[1,2,3,4].map((n) => <div key={n} className="h-28 animate-pulse rounded-2xl bg-muted/60" />)}</div></div>;

  const impactData = [
    { name: "Critical", value: report.issuesByImpact.critical, color: "hsl(346 75% 51%)" },
    { name: "Serious", value: report.issuesByImpact.serious, color: "hsl(24 86% 52%)" },
    { name: "Moderate", value: report.issuesByImpact.moderate, color: "hsl(42 88% 48%)" },
    { name: "Minor", value: report.issuesByImpact.minor, color: "hsl(198 70% 52%)" },
  ].filter((d) => d.value > 0);
  const wcagData = [{ name: "A", value: report.issuesByWcagLevel.A }, { name: "AA", value: report.issuesByWcagLevel.AA }, { name: "AAA", value: report.issuesByWcagLevel.AAA }].filter((d) => d.value > 0);
  const average = report.scannedPages ? Math.round((report.totalIssues / report.scannedPages) * 10) / 10 : 0;

  return (
    <div className="relative space-y-7 pb-8">
      <header className="relative flex flex-wrap items-start gap-4">
        <Link href={`/scans/${scanId}`}><Button variant="outline" size="icon" className="rounded-xl bg-white/70" data-testid="link-report-back"><ArrowLeft className="h-4 w-4" /></Button></Link>
        <div className="min-w-0 flex-1"><div className="mb-2 flex flex-wrap items-center gap-2"><Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">Executive view</Badge><span className="font-mono text-xs text-muted-foreground">SCAN-{scanId}</span></div><h1 className="text-3xl font-semibold tracking-tight text-[#172b4d]">Scan intelligence report</h1><p className="mt-1 text-sm text-muted-foreground">{scan?.name || `Scan #${scanId}`} <span className="mx-2 text-border">·</span> WCAG 2.2 AA</p></div>
        <div className="flex flex-wrap gap-2">
          {user?.permissions.canCreateIssue && <Link href={`/issues?${new URLSearchParams({ create: "1", type: "bug", scanId: String(scanId), title: `Follow up: ${scan?.name || `Scan ${scanId}`}`, source: `Accessibility scan ${scan?.name || `SCAN-${scanId}`}` })}`}>
            <Button variant="outline" className="rounded-xl bg-white/70">Create issue</Button>
          </Link>}
          <Button variant="outline" className="rounded-xl bg-white/70" onClick={exportCsv} disabled={isExporting} data-testid="button-export-report">{isExporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileDown className="mr-2 h-4 w-4" />}{isExporting ? "Exporting…" : "Export CSV"}</Button>
        </div>
      </header>
      <section className="relative grid gap-4 md:grid-cols-4">
        {[["Total issues", report.totalIssues, "Across all scanned pages", "text-[#6d48c7]"], ["Scanned pages", report.scannedPages, `${report.failedPages} failed or unavailable`, "text-[#198f88]"], ["Critical issues", report.issuesByImpact.critical, "Needs immediate attention", "text-red-600"], ["Issues / page", average, "Average issue density", "text-[#3778c8]"]].map(([label, value, hint, color]) => (
          <Card key={String(label)} className="rounded-2xl border-white/80 bg-white/65 shadow-[0_10px_30px_rgba(69,57,112,.06)] backdrop-blur-xl"><CardContent className="p-5"><p className="text-xs font-semibold uppercase tracking-[.12em] text-muted-foreground">{label}</p><p className={`mt-3 font-mono text-3xl font-bold ${color}`}>{value}</p><p className="mt-1 text-xs text-muted-foreground">{hint}</p></CardContent></Card>
        ))}
      </section>
      <div className="relative grid gap-5 lg:grid-cols-[1.05fr_.95fr]">
        <Card className="rounded-2xl border-white/80 bg-white/65 shadow-[0_12px_32px_rgba(69,57,112,.06)] backdrop-blur-xl"><CardHeader className="flex flex-row items-start justify-between"><div><CardTitle className="text-base">Impact distribution</CardTitle><p className="mt-1 text-xs text-muted-foreground">Where remediation effort is concentrated</p></div><Sparkles className="h-4 w-4 text-[#6d48c7]" /></CardHeader><CardContent className="h-[290px]">{impactData.length ? <ResponsiveContainer><PieChart><Pie data={impactData} cx="50%" cy="50%" innerRadius={62} outerRadius={94} paddingAngle={4} dataKey="value">{impactData.map((entry) => <Cell key={entry.name} fill={entry.color} />)}</Pie><Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #e8e0fa" }} /><Legend /></PieChart></ResponsiveContainer> : <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No issues found</div>}</CardContent></Card>
        <Card className="rounded-2xl border-white/80 bg-white/65 shadow-[0_12px_32px_rgba(69,57,112,.06)] backdrop-blur-xl"><CardHeader><CardTitle className="text-base">WCAG level breakdown</CardTitle><p className="mt-1 text-xs text-muted-foreground">Issues mapped to conformance levels</p></CardHeader><CardContent className="h-[290px]">{wcagData.length ? <ResponsiveContainer><BarChart data={wcagData} margin={{ top: 20, right: 18, left: -18, bottom: 5 }}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#ebe8f3" /><XAxis dataKey="name" /><YAxis allowDecimals={false} /><Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #e8e0fa" }} /><Bar dataKey="value" fill="#6d48c7" radius={[7, 7, 0, 0]} /></BarChart></ResponsiveContainer> : <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No issues found</div>}</CardContent></Card>
      </div>
      <Card className="relative rounded-2xl border-white/80 bg-white/65 shadow-[0_12px_32px_rgba(69,57,112,.06)] backdrop-blur-xl">
        <CardHeader className="flex flex-row items-start justify-between">
          <div>
            <CardTitle className="text-base">Evidence confidence</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">Confidence is separate from the accessibility score.</p>
          </div>
          <Badge variant="outline" className="capitalize">{report.confidence.classification}</Badge>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 text-sm sm:grid-cols-4">
            <div><span className="text-muted-foreground">Automatic coverage</span><strong className="ml-2">{report.automaticApplicabilityCoverage}%</strong></div>
            <div><span className="text-muted-foreground">Manual review</span><strong className="ml-2">{report.confidence.manualUnresolved}</strong></div>
            <div><span className="text-muted-foreground">Fallback pages</span><strong className="ml-2">{report.confidence.fallbackDenominatorPages}</strong></div>
            <div><span className="text-muted-foreground">Carried forward</span><strong className="ml-2">{report.confidence.carriedForwardPages}</strong></div>
          </div>
          <details className="rounded-lg border border-violet-100 bg-violet-50/40 px-3 py-2 text-xs">
            <summary className="cursor-pointer font-medium text-violet-800">How this classification was determined</summary>
            <ul className="mt-2 list-disc space-y-1 pl-4 text-muted-foreground">{report.confidence.basis.map((item) => <li key={item}>{item}</li>)}</ul>
          </details>
        </CardContent>
      </Card>
      <Card className="relative rounded-2xl border-white/80 bg-white/65 shadow-[0_12px_32px_rgba(69,57,112,.06)] backdrop-blur-xl">
        <CardHeader><CardTitle className="text-base">Rule execution coverage</CardTitle><p className="mt-1 text-xs text-muted-foreground">Selected, applicable, executed, manual, and failed page counts.</p></CardHeader>
        <CardContent>
          <div className="max-h-80 overflow-auto">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-white/90 text-muted-foreground"><tr><th className="py-2">Rule</th><th>Tier</th><th>Selected</th><th>Not selected</th><th>Not applicable</th><th>Executed</th><th>Manual</th><th>Failed</th></tr></thead>
              <tbody>{report.ruleCoverage.map((rule) => <tr key={rule.ruleId} className="border-t border-violet-100/70"><td className="py-2 font-mono">{rule.ruleId}</td><td>{rule.executionTier}</td><td>{rule.selected}</td><td>{rule.notSelected}</td><td>{rule.notApplicable}</td><td>{rule.executed}</td><td>{rule.manual}</td><td>{rule.failed}</td></tr>)}</tbody>
            </table>
          </div>
        </CardContent>
      </Card>
      <Card className="relative rounded-2xl border-white/80 bg-white/65 shadow-[0_12px_32px_rgba(69,57,112,.06)] backdrop-blur-xl"><CardHeader className="flex flex-row items-center justify-between"><div><CardTitle className="text-base">Top violated rules</CardTitle><p className="mt-1 text-xs text-muted-foreground">Prioritized by occurrence count</p></div><ArrowUpRight className="h-4 w-4 text-muted-foreground" /></CardHeader><CardContent>{report.topRules.length ? <div className="divide-y divide-violet-100/70">{report.topRules.map((rule, idx) => <div key={`${rule.ruleId}-${idx}`} className="flex items-center gap-4 py-4" data-testid={`row-rule-${rule.ruleId}`}><span className="font-mono text-xs text-muted-foreground">0{idx + 1}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{rule.description}</p><p className="mt-1 font-mono text-xs text-[#6d48c7]">{rule.ruleId}</p></div><Badge variant="outline" className="rounded-lg border-violet-200 bg-violet-50 px-3 py-1 font-mono text-violet-700">{rule.count} issues</Badge></div>)}</div> : <div className="py-10 text-center text-sm text-muted-foreground">No violated rules recorded.</div>}</CardContent></Card>
    </div>
  );
}