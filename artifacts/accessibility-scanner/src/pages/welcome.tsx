import { Link } from "wouter";
import { useListScans, getListScansQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  History,
  BookOpen,
  PlayCircle,
  Sparkles,
  ArrowRight,
  Layers,
  FilePlus2,
  Route,
  Palette,
  ShieldCheck,
  ListChecks,
  CheckCircle2,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useAuth } from "@/contexts/auth";
import { APP_VERSION } from "@/lib/app-version";
import { useEffect, useState } from "react";
import { DEFAULT_LOGO_SUBTITLE, DEFAULT_LOGO_TEXT } from "@/pages/settings";

const BASE = (import.meta.env.BASE_URL as string).replace(/\/$/, "");

interface Scan {
  id: number;
  name: string | null;
  status: string;
  totalUrls: number;
  totalIssues?: number | null;
  createdAt?: string | null;
}

export default function WelcomePage() {
  const { user } = useAuth();
  const [brandName, setBrandName] = useState(DEFAULT_LOGO_TEXT);
  const [brandSubtitle, setBrandSubtitle] = useState(DEFAULT_LOGO_SUBTITLE);

  useEffect(() => {
    const applyBranding = (data: { text?: string; subtitle?: string }) => {
      if (data.text !== undefined) setBrandName(data.text || DEFAULT_LOGO_TEXT);
      if (data.subtitle !== undefined) setBrandSubtitle(data.subtitle || DEFAULT_LOGO_SUBTITLE);
    };
    const loadBranding = () => fetch(`${BASE}/api/logo`)
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
  const listParams = {};
  const { data: allScans, isLoading } = useListScans(
    listParams,
    {
      query: {
        queryKey: getListScansQueryKey(listParams),
        refetchOnWindowFocus: false,
      },
    }
  );

  const recentScans = ((allScans as Scan[] | undefined) || []).slice(0, 3);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Compact header tab */}
      <div className="border-b bg-card/50">
        <div className="flex items-center gap-2 px-6 py-2.5">
          <div className="flex items-center gap-2 px-3 py-1 rounded-md bg-primary/10 border border-primary/20">
            <Sparkles className="w-3.5 h-3.5 text-primary" />
            <span className="text-sm font-medium text-foreground">Welcome</span>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="app-scrollbar min-h-0 flex-1 overflow-y-auto">
        <div className="w-full space-y-10 px-6 py-10 md:px-8 md:py-12">
          {/* Header */}
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/15">
                <Sparkles className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-3xl font-bold tracking-tight md:text-4xl">
                  {brandName}
                </h1>
                <p className="mt-0.5 text-sm font-medium text-primary">
                  {brandSubtitle}
                </p>
              </div>
            </div>
            <p className="max-w-2xl text-base leading-7 text-muted-foreground md:text-lg">
              Professional accessibility and quality assurance workspace with trustworthy scanning results and a calmer, more personal interface.
            </p>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Badge variant="outline" className="font-mono text-xs">
                Version {APP_VERSION}
              </Badge>
              <Link href="/app-updates">
                <Button variant="ghost" size="sm" className="h-7 text-xs gap-1.5">
                  What's new
                  <ArrowRight className="w-3 h-3" />
                </Button>
              </Link>
            </div>
          </div>

          {/* Latest update */}
          <Card className="overflow-hidden border-primary/20">
            <div className="h-1 bg-gradient-to-r from-cyan-400 via-violet-500 to-fuchsia-500" />
            <CardContent className="flex items-start gap-4 p-5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-400/10 text-emerald-600 dark:text-emerald-300">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-semibold">
                    More reliable video accessibility review in {APP_VERSION}
                  </h2>
                  <Badge variant="outline" className="text-[10px]">
                    New
                  </Badge>
                </div>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  ACT-R37 now keeps visible prerecorded videos in the review queue
                  when browser audio metadata cannot be confirmed and no audio
                  description or complete media alternative is found. Confirmed-silent
                  videos continue through the appropriate visual-only checks.
                </p>
                <Link href="/app-updates">
                  <Button variant="link" className="h-auto px-0 text-xs text-cyan-700 dark:text-cyan-300">
                    Review the media update
                    <ArrowRight className="ml-1 h-3 w-3" />
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>

          {/* New workflow spotlight */}
          <section className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
            <Card className="overflow-hidden border-primary/20 bg-gradient-to-br from-primary/[0.07] via-card to-fuchsia-500/[0.06]">
              <CardContent className="p-5 md:p-6">
                <div className="flex items-start gap-4">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/15">
                    <ListChecks className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base font-semibold">A simpler path from URL to results</h2>
                      <Badge variant="secondary" className="text-[10px]">New</Badge>
                    </div>
                    <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
                      The manual scan wizard keeps each decision in context, so you can review the target,
                      accessibility scope, settings, and scan details before launch.
                    </p>
                  </div>
                </div>
                <div className="mt-5 grid gap-2 sm:grid-cols-4">
                  {[
                    ["1", "Target"],
                    ["2", "Scope"],
                    ["3", "Settings"],
                    ["4", "Details"],
                  ].map(([number, label], index) => (
                    <div key={label} className="flex items-center gap-2 rounded-lg border border-border/70 bg-background/60 px-3 py-2.5">
                      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                        index < 2 ? "bg-teal-500 text-white" : "bg-primary/10 text-primary"
                      }`}>
                        {index < 2 ? <CheckCircle2 className="h-3.5 w-3.5" /> : number}
                      </span>
                      <span className="text-xs font-semibold">{label}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-5 flex flex-wrap gap-2">
                  <Link href="/new">
                    <Button size="sm" className="h-8 gap-1.5 text-xs">
                      Try the new scan flow
                      <ArrowRight className="h-3 w-3" />
                    </Button>
                  </Link>
                  <Link href="/app-updates">
                    <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
                      See all changes
                      <ArrowRight className="h-3 w-3" />
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
            <Card className="border-teal-400/20 bg-teal-400/[0.04]">
              <CardContent className="p-5 md:p-6">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-400/10 text-teal-600 dark:text-teal-300">
                    <ShieldCheck className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-teal-700 dark:text-teal-300">
                      Scan scope
                    </p>
                    <h2 className="mt-0.5 text-base font-semibold">Choose what to check</h2>
                  </div>
                </div>
                <p className="mt-4 text-sm leading-6 text-muted-foreground">
                  Focus a scan on WCAG A, AA, AAA, WAI-ARIA, Best Practice, or a filtered combination of rules.
                </p>
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {["A", "AA", "AAA", "ARIA", "Best Practice"].map((level) => (
                    <Badge key={level} variant="outline" className="border-teal-400/30 bg-teal-400/5 text-[10px] text-teal-700 dark:text-teal-300">
                      {level}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          </section>

          {/* Workspace experience */}
          <section className="space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  Make the workspace yours
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Choose the visual treatment that fits the way you work.
                </p>
              </div>
              <Link href="/app-updates">
                <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs">
                  View release details
                  <ArrowRight className="h-3 w-3" />
                </Button>
              </Link>
            </div>
            <div className="grid items-stretch gap-3 md:grid-cols-3">
              <Card className="group border-border/80 transition-all hover:-translate-y-0.5 hover:border-cyan-400/40 hover:shadow-md">
                <CardContent className="space-y-3 p-4">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-cyan-400/10 text-cyan-600 dark:text-cyan-300">
                    <Palette className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold">Themes</h3>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      Switch between available light, dark, and glass-inspired treatments.
                    </p>
                  </div>
                </CardContent>
              </Card>
              <Card className="group border-border/80 transition-all hover:-translate-y-0.5 hover:border-violet-400/40 hover:shadow-md">
                <CardContent className="space-y-3 p-4">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-400/10 text-violet-600 dark:text-violet-300">
                    <Layers className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold">Backgrounds</h3>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      Select a background image or keep a clean, distraction-free backdrop.
                    </p>
                  </div>
                </CardContent>
              </Card>
              <Card className="group border-border/80 transition-all hover:-translate-y-0.5 hover:border-fuchsia-400/40 hover:shadow-md">
                <CardContent className="space-y-3 p-4">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-fuchsia-400/10 text-fuchsia-600 dark:text-fuchsia-300">
                    <Sparkles className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold">Accent colors</h3>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      Apply a custom accent across active states, buttons, rails, and highlights.
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </section>

          {/* Start section */}
          <section className="space-y-4">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Start
            </h2>
            <div className="grid items-stretch gap-4 sm:grid-cols-2">
              <Link href="/new" data-testid="link-start-manual-scan">
                <Card className="group h-full min-h-[132px] cursor-pointer border-border/80 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:bg-muted/30 hover:shadow-md">
                  <CardContent className="flex h-full items-start gap-4 p-5">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary/15">
                      <FilePlus2 className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1 space-y-1">
                      <h3 className="text-base font-semibold">Start a manual scan</h3>
                      <p className="text-sm leading-relaxed text-muted-foreground">
                        Check one or more URLs for accessibility issues
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </Link>

              {user?.permissions.canCreateCrawl && (
                <Link href="/crawler/new" data-testid="link-start-crawler-scan">
                  <Card className="group h-full min-h-[132px] cursor-pointer border-border/80 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:bg-muted/30 hover:shadow-md">
                    <CardContent className="flex h-full items-start gap-4 p-5">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary/15">
                        <Route className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1 space-y-1">
                        <h3 className="text-base font-semibold">Start a crawler scan</h3>
                        <p className="text-sm leading-relaxed text-muted-foreground">
                          Scan entire sites with sitemap, URL list, or crawl-based workflows
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              )}
            </div>
          </section>

          {/* Recent section */}
          {!isLoading && recentScans.length > 0 && (
            <section className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  Recent
                </h2>
                <Link href="/scans">
                  <Button variant="ghost" size="sm" className="h-7 text-xs gap-1.5" data-testid="link-view-all-scans">
                    View all
                    <ArrowRight className="w-3 h-3" />
                  </Button>
                </Link>
              </div>
              <div className="space-y-3">
                {recentScans.map((scan) => (
                  <Link href={`/scans/${scan.id}`} key={scan.id} data-testid={`link-recent-scan-${scan.id}`}>
                    <Card className="group cursor-pointer border-border/80 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:bg-muted/30 hover:shadow-sm">
                      <CardContent className="flex min-h-[72px] items-center gap-4 p-4">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors group-hover:bg-primary/10 group-hover:text-primary">
                          <Layers className="h-4 w-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="font-medium text-sm truncate">
                              {scan.name || `Scan #${scan.id}`}
                            </h3>
                            {scan.status === "completed" && (
                              <Badge variant="outline" className="text-xs bg-green-500/10 text-green-600 border-green-500/20">
                                Complete
                              </Badge>
                            )}
                            {scan.status === "running" && (
                              <Badge variant="outline" className="text-xs bg-primary/10 text-primary border-primary/20">
                                Running
                              </Badge>
                            )}
                            {scan.status === "failed" && (
                              <Badge variant="outline" className="text-xs bg-red-500/10 text-red-600 border-red-500/20">
                                Failed
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-3 text-xs text-muted-foreground">
                            <span className="font-mono">
                              {scan.totalUrls} {scan.totalUrls === 1 ? "page" : "pages"}
                            </span>
                            {scan.totalIssues !== undefined && scan.totalIssues !== null && (
                              <span>
                                {scan.totalIssues} {scan.totalIssues === 1 ? "issue" : "issues"}
                              </span>
                            )}
                            {scan.createdAt && (
                              <span>
                                {formatDistanceToNow(new Date(scan.createdAt), { addSuffix: true })}
                              </span>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* Help section */}
          <section className="space-y-4">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Help
            </h2>
            <div className="grid items-stretch gap-3 sm:grid-cols-3">
              <Link href="/app-walkthrough" data-testid="link-app-walkthrough">
                <div className="group flex h-full min-h-[76px] items-center gap-3 rounded-xl border border-border/70 bg-card/40 px-4 py-3 text-left transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:bg-muted/50 hover:shadow-sm">
                    <PlayCircle className="h-5 w-5 shrink-0 text-primary" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold transition-colors group-hover:text-primary">
                        App Walkthrough
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Learn the interface
                      </div>
                    </div>
                    <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                </div>
              </Link>

              <Link href="/documentation" data-testid="link-documentation">
                <div className="group flex h-full min-h-[76px] items-center gap-3 rounded-xl border border-border/70 bg-card/40 px-4 py-3 text-left transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:bg-muted/50 hover:shadow-sm">
                    <BookOpen className="h-5 w-5 shrink-0 text-primary" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold transition-colors group-hover:text-primary">
                        Documentation
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Rules and guidance
                      </div>
                    </div>
                    <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                </div>
              </Link>

              <Link href="/scans" data-testid="link-scan-history">
                <div className="group flex h-full min-h-[76px] items-center gap-3 rounded-xl border border-border/70 bg-card/40 px-4 py-3 text-left transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:bg-muted/50 hover:shadow-sm">
                    <History className="h-5 w-5 shrink-0 text-primary" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold transition-colors group-hover:text-primary">
                        Scan History
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Review past scans
                      </div>
                    </div>
                    <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                </div>
              </Link>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
