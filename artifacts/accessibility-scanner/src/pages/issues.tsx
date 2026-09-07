import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { AlertCircle, Ban, CheckCheck, CheckCircle2, CircleDot, Eye, GripVertical, Layers, List, Loader2, Lock, PanelRight, PauseCircle, Plus, RefreshCw, RotateCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/auth";

import { uploadIssueAttachment, useIssues, usePeople, useCreateIssue } from "../hooks/use-issues";
import { ISSUE_TYPES, STATUS_LABELS, type IssueMetrics } from "../lib/issue-types";
import { IssueList } from "../components/issues/issue-list";
import { IssueDetail } from "../components/issues/issue-detail";
import { IssueForm } from "../components/issues/issue-form";
import { IssueExportActions } from "../components/issues/issue-export-actions";
import { IssueSortSelect, type IssueSort } from "../components/issues/issue-sort-select";

const PRIORITY_RANK: Record<string, number> = {
  highest: 5,
  high: 4,
  medium: 3,
  low: 2,
  lowest: 1,
};

export default function IssuesPage() {
  const [location, navigate] = useLocation();
  const { user } = useAuth();
  const canManage = user?.permissions?.canManageIssues ?? false;
  const {
    data: issueData,
    error: issuesError,
    isError: issuesFailed,
    isLoading: issuesLoading,
    isFetching: issuesFetching,
    refetch: refetchIssues,
  } = useIssues(canManage);
  const shouldLoadPeople = Boolean(
    user?.permissions?.canCreateIssue ||
      user?.permissions?.canEditIssue ||
      user?.permissions?.canCommentIssue,
  );
  const { data: peopleData } = usePeople(shouldLoadPeople);
  const createIssue = useCreateIssue();
  const { toast } = useToast();

  const [view, setView] = useState<"list" | "details">("details");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sort, setSort] = useState<IssueSort>("updated_desc");
  const [selectedIssueId, setSelectedIssueId] = useState<number | null>(null);
  const [leftPaneWidth, setLeftPaneWidth] = useState(30);
  const [createOpen, setCreateOpen] = useState(false);
  const [createSaving, setCreateSaving] = useState(false);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const draggingDivider = useRef(false);
  
  const [draft, setDraft] = useState<Record<string, any>>({ 
    type: "bug", priority: "medium", status: "todo", title: "", description: "", labels: [], checklist: [] 
  });

  const canCreate = user?.permissions?.canCreateIssue ?? false;
  const canEdit = user?.permissions?.canEditIssue ?? false;
  const canComment = user?.permissions?.canCommentIssue ?? false;

  useEffect(() => {
    const params = new URLSearchParams(location.split("?")[1] ?? "");
    const linkedIssueId = Number(params.get("issueId"));
    if (Number.isInteger(linkedIssueId) && linkedIssueId > 0) {
      setSearch("");
      setTypeFilter("all");
      setStatusFilter("all");
      setSelectedIssueId(linkedIssueId);
      setView("details");
      params.delete("issueId");
      const remaining = params.toString();
      navigate(`/issues${remaining ? `?${remaining}` : ""}`, { replace: true });
      return;
    }
    if (params.get("create") === "1") {
      setDraft({
        type: params.get("type") ?? "bug", 
        priority: params.get("priority") ?? "medium", 
        status: "todo",
        title: params.get("title") ?? "", 
        description: params.get("description") ?? "",
        siteId: params.get("siteId") ? Number(params.get("siteId")) : null, 
        scanId: params.get("scanId") ? Number(params.get("scanId")) : null,
        pageId: params.get("pageId") ? Number(params.get("pageId")) : null, 
        ruleId: params.get("ruleId") ?? null,
        selector: params.get("selector") ?? null, 
        sourceDescription: params.get("source") ?? null, 
        labels: [], 
        checklist: [],
      });
      setCreateOpen(true); 
      navigate("/issues", { replace: true });
    }
  }, [location, navigate]);

  const issues = issueData?.issues || [];
  const metrics: IssueMetrics = issueData?.metrics || {
    total: 0,
    open: 0,
    inProgress: 0,
    done: 0,
    bugs: 0,
  };
  const people = peopleData || [];
  const statusCounts = metrics.statusCounts ?? issues.reduce<Record<string, number>>((counts, issue) => {
    counts[issue.status] = (counts[issue.status] ?? 0) + 1;
    return counts;
  }, {});
  const typeCounts = metrics.typeCounts ?? issues.reduce<Record<string, number>>((counts, issue) => {
    counts[issue.type] = (counts[issue.type] ?? 0) + 1;
    return counts;
  }, {});
  const typeCountLabels: Record<string, string> = {
    bug: "Bugs",
    story: "Stories",
    task: "Tasks",
    epic: "Epics",
    content: "Content",
    test: "Tests",
    request: "Requests",
  };
  const statusCards = [
    { key: "todo", label: "Open", helper: "To Do + Reopen", style: "text-blue-600 dark:text-blue-400", Icon: CircleDot },
    { key: "in_progress", label: "In progress", helper: "", style: "text-amber-600 dark:text-amber-400", Icon: Loader2 },
    { key: "review", label: "Review", helper: "", style: "text-violet-600 dark:text-violet-400", Icon: Eye },
    { key: "release_to_retest", label: "Release to retest", helper: "", style: "text-orange-600 dark:text-orange-400", Icon: RotateCw },
    { key: "fixed", label: "Fixed", helper: "", style: "text-emerald-600 dark:text-emerald-400", Icon: CheckCheck },
    { key: "closed", label: "Closed", helper: "", style: "text-slate-600 dark:text-slate-300", Icon: Lock },
    { key: "blocked", label: "Blocked", helper: "", style: "text-rose-600 dark:text-rose-400", Icon: Ban },
    { key: "differ", label: "Differed", helper: "", style: "text-cyan-600 dark:text-cyan-400", Icon: PauseCircle },
  ];

  const filtered = useMemo(() => issues.filter((issue) => {
    const archiveMatches = statusFilter === "archived" ? issue.archived : !issue.archived;
    const statusMatches =
      statusFilter === "all" ||
      statusFilter === "archived" ||
      issue.status === statusFilter ||
      (statusFilter === "todo" && issue.status === "reopen") ||
      (statusFilter === "closed" && issue.status === "complete");
    return archiveMatches &&
      (!search || [issue.issueKey, issue.title, issue.description, issue.siteName ?? ""].join(" ").toLowerCase().includes(search.toLowerCase())) &&
      (typeFilter === "all" || issue.type === typeFilter) &&
      statusMatches;
  }), [issues, search, typeFilter, statusFilter]);

  const sortedIssues = useMemo(() => {
    const next = [...filtered];
    next.sort((a, b) => {
      if (sort === "updated_desc") return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      if (sort === "updated_asc") return new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
      if (sort === "created_desc") return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      if (sort === "priority_desc") return (PRIORITY_RANK[b.priority] ?? 0) - (PRIORITY_RANK[a.priority] ?? 0);
      if (sort === "key_asc") return a.issueKey.localeCompare(b.issueKey, undefined, { numeric: true });
      return a.title.localeCompare(b.title);
    });
    return next;
  }, [filtered, sort]);

  const allStatuses = canManage ? [...Object.keys(STATUS_LABELS), "archived"] : Object.keys(STATUS_LABELS);

  const handleCreateSave = async (attachments: File[]) => {
    setCreateSaving(true);
    try {
      const saved = await createIssue.mutateAsync(draft);
      const uploads = await Promise.allSettled(attachments.map((file) => uploadIssueAttachment(saved.id, file, true)));
      const failures = uploads.filter((result): result is PromiseRejectedResult => result.status === "rejected");
      const failedUploads = failures.length;
      setCreateOpen(false);
      setSelectedIssueId(saved.id);
      setView("details");
      if (failedUploads > 0) {
        toast({
          title: "Issue created with attachment errors",
          description: `${saved.issueKey} was created, but ${failedUploads} file${failedUploads === 1 ? "" : "s"} could not be uploaded. ${failures[0]?.reason instanceof Error ? failures[0].reason.message : ""}`.trim(),
          variant: "destructive",
        });
      } else {
        toast({
          title: "Issue created",
          description: attachments.length > 0
            ? `${saved.issueKey} created with ${attachments.length} attachment${attachments.length === 1 ? "" : "s"}.`
            : saved.issueKey,
        });
      }
    } catch (err) {
      toast({ title: "Couldn't save issue", description: err instanceof Error ? err.message : "Please try again.", variant: "destructive" });
    } finally {
      setCreateSaving(false);
    }
  };

  const setDraftField = (key: string, value: any) => setDraft((current) => ({ ...current, [key]: value }));
  const openNewIssue = () => { 
    if (!canCreate) return; 
    setDraft({ type: "bug", priority: "medium", status: "todo", title: "", description: "", labels: [], checklist: [] }); 
    setCreateOpen(true); 
  };

  useEffect(() => {
    if (issuesLoading) return;
    if (selectedIssueId == null || !sortedIssues.some((issue) => issue.id === selectedIssueId)) {
      setSelectedIssueId(sortedIssues[0]?.id ?? null);
    }
  }, [issuesLoading, selectedIssueId, sortedIssues]);

  const updatePaneWidth = useCallback((clientX: number) => {
    const bounds = workspaceRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const nextWidth = ((clientX - bounds.left) / bounds.width) * 100;
    setLeftPaneWidth(Math.min(48, Math.max(24, nextWidth)));
  }, []);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      if (draggingDivider.current) updatePaneWidth(event.clientX);
    };
    const stopDragging = () => {
      if (!draggingDivider.current) return;
      draggingDivider.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopDragging);
    window.addEventListener("pointercancel", stopDragging);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopDragging);
      window.removeEventListener("pointercancel", stopDragging);
    };
  }, [updatePaneWidth]);

  const handleDividerKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setLeftPaneWidth((value) => Math.max(24, value - 2));
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      setLeftPaneWidth((value) => Math.min(48, value + 2));
    } else if (event.key === "Home") {
      event.preventDefault();
      setLeftPaneWidth(24);
    } else if (event.key === "End") {
      event.preventDefault();
      setLeftPaneWidth(48);
    }
  };

  if (issuesLoading) {
    return <div className="flex justify-center p-14"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
  }

  if (issuesFailed) {
    return (
      <div className="flex h-[calc(100dvh-4rem)] items-center justify-center bg-muted/10 p-6">
        <Card className="w-full max-w-lg">
          <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
            <div className="rounded-full bg-destructive/10 p-3 text-destructive">
              <AlertCircle className="h-6 w-6" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-lg font-semibold">Issues could not be loaded</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                {issuesError instanceof Error
                  ? issuesError.message
                  : "The Issue Management service is unavailable. Please try again."}
              </p>
            </div>
            <Button
              type="button"
              onClick={() => void refetchIssues()}
              disabled={issuesFetching}
            >
              {issuesFetching ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
              )}
              Try again
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100dvh-4rem)] p-4 md:p-6 bg-muted/10 space-y-4">
      
      {/* Header */}
      <div className="flex-none flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-bold tracking-widest uppercase text-primary mb-1">Work Management</p>
          <h1 className="text-3xl font-extrabold tracking-tight">Issues</h1>
        </div>
        <div className="flex items-center gap-2">
          <IssueExportActions issues={sortedIssues} />
          {canCreate && (
            <Button onClick={openNewIssue} size="lg" className="font-semibold shadow-sm">
              <Plus className="h-5 w-5 mr-2" /> Create Issue
            </Button>
          )}
        </div>
      </div>

      {/* Metrics Row */}
      <div className="flex-none grid grid-cols-2 gap-1.5 sm:grid-cols-4 lg:grid-cols-9">
        <button
          type="button"
          className="rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          aria-label={`Show all ${metrics.total} issues`}
          aria-pressed={statusFilter === "all"}
          onClick={() => setStatusFilter("all")}
        >
          <Card className={`h-full bg-card shadow-sm transition-colors hover:border-primary/50 ${statusFilter === "all" ? "border-primary ring-1 ring-primary/25" : "border-border/50"}`}>
            <CardContent className="flex min-h-[104px] flex-col items-center p-2 text-center">
              <Layers className="mb-0.5 h-3.5 w-3.5 text-violet-500" aria-hidden="true" />
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Total</p>
              <p className="text-2xl font-black leading-none text-foreground">{metrics.total}</p>
              <div className="mt-1.5 grid w-full grid-cols-2 gap-x-2 gap-y-0 border-t pt-1.5 text-left">
                {ISSUE_TYPES.map((type) => (
                  <div key={type} className="flex items-center justify-between gap-1 text-[9px] leading-[14px]">
                    <span className="text-muted-foreground">{typeCountLabels[type] ?? type}</span>
                    <span className="font-bold text-foreground">{typeCounts[type] ?? 0}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </button>
        {statusCards.map(({ key, label, helper, style, Icon }) => (
          <button
            key={key}
            type="button"
            className="rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 cursor-pointer"
            aria-label={`Filter issues by ${label}`}
            aria-pressed={statusFilter === key}
            onClick={() => setStatusFilter((current) => current === key ? "all" : key)}
          >
            <Card className={`h-full bg-card shadow-sm transition-colors hover:border-primary/50 ${statusFilter === key ? "border-primary ring-1 ring-primary/25" : "border-border/50"}`}>
              <CardContent className="flex min-h-[104px] flex-col items-center justify-center p-2 text-center">
                <Icon className={`mb-1 h-3.5 w-3.5 ${style}`} aria-hidden="true" />
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
                {helper && <p className="text-[9px] font-medium leading-3 text-muted-foreground">({helper})</p>}
                <p className={`mt-0.5 text-2xl font-black leading-none ${style}`}>
                  {key === "todo"
                    ? (statusCounts.todo ?? 0) + (statusCounts.reopen ?? 0)
                    : key === "closed"
                    ? (statusCounts.closed ?? 0) + (statusCounts.complete ?? 0)
                    : statusCounts[key] ?? 0}
                </p>
              </CardContent>
            </Card>
          </button>
        ))}
      </div>

      {/* Filter Bar */}
      <div className="flex-none bg-card p-2 rounded-lg border shadow-sm flex flex-col md:flex-row items-center gap-2">
        <div className="relative flex-1 min-w-0 w-full">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input 
            aria-label="Search issues" 
            className="pl-9 border-transparent focus-visible:border-ring bg-muted/50 font-medium" 
            value={search} 
            onChange={(e) => setSearch(e.target.value)} 
            placeholder="Search keywords or keys..." 
          />
        </div>
        <div className="grid w-full grid-cols-2 items-center gap-2 md:flex md:w-auto">
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger aria-label="Filter by issue type" className="w-full md:w-[140px] font-medium bg-muted/50 border-transparent">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              {ISSUE_TYPES.map(t => <SelectItem key={t} value={t} className="uppercase text-xs font-bold tracking-wider">{t}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger aria-label="Filter by issue status" className="w-full md:w-[160px] font-medium bg-muted/50 border-transparent">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent className="max-h-72 overflow-y-auto">
              <SelectItem value="all">All Statuses</SelectItem>
              {allStatuses.map((value) => (
                <SelectItem key={value} value={value} className="font-medium">
                  {value === "archived" ? "Archived" : STATUS_LABELS[value] || value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Tabs value={view} onValueChange={(value) => setView(value as "list" | "details")} className="w-full md:w-auto">
            <TabsList aria-label="Issue view" className="h-10 bg-muted/50 p-1">
              <TabsTrigger value="list" aria-label="List view" className="gap-2 px-3">
                <List className="h-4 w-4" />
                <span className="hidden lg:inline">List</span>
              </TabsTrigger>
              <TabsTrigger value="details" aria-label="Details view" className="gap-2 px-3">
                <PanelRight className="h-4 w-4" />
                <span className="hidden lg:inline">Details</span>
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      {/* Main Workspace */}
      <div className="flex-1 min-h-0 relative">
        {view === "list" ? (
          <div className="absolute inset-0 flex flex-col overflow-hidden rounded-lg border bg-card shadow-sm">
            <div className="flex flex-none flex-col gap-2 border-b bg-card px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">All issues</p>
                <p className="mt-0.5 text-sm font-medium">{sortedIssues.length} issue{sortedIssues.length === 1 ? "" : "s"} shown</p>
              </div>
              <IssueSortSelect value={sort} onChange={setSort} className="w-full sm:w-auto" />
            </div>
            <div className="min-h-0 flex-1">
              <IssueList
                issues={sortedIssues}
                onSelect={(id) => {
                  setSelectedIssueId(id);
                  setView("details");
                }}
                selectedId={selectedIssueId}
                variant="table"
              />
            </div>
          </div>
        ) : (
          <div ref={workspaceRef} className="absolute inset-0 flex border rounded-lg overflow-hidden bg-card shadow-sm">
            <div
              className={`flex flex-col border-r bg-muted/10 ${selectedIssueId ? "hidden md:flex" : "flex"}`}
              style={{ width: selectedIssueId ? `${leftPaneWidth}%` : "100%", flex: "0 0 auto" }}
            >
              <div className="flex-none flex items-center justify-between gap-3 border-b bg-card px-4 py-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Issue navigator</p>
                  <p className="mt-0.5 text-sm font-medium">{sortedIssues.length} issue{sortedIssues.length === 1 ? "" : "s"} shown</p>
                </div>
                <div className="flex items-center gap-2">
                  <IssueSortSelect value={sort} onChange={setSort} className="min-w-0 flex-1 sm:flex-none" />
                  <Button type="button" variant="ghost" size="sm" onClick={() => setView("list")} className="md:hidden">
                    <List className="h-4 w-4" /> List
                  </Button>
                </div>
              </div>
              <IssueList issues={sortedIssues} onSelect={setSelectedIssueId} selectedId={selectedIssueId} variant="compact" />
            </div>

            {selectedIssueId && (
              <div
                role="separator"
                aria-label="Resize issue navigator"
                aria-orientation="vertical"
                aria-valuemin={24}
                aria-valuemax={48}
                aria-valuenow={Math.round(leftPaneWidth)}
                tabIndex={0}
                onPointerDown={(event) => {
                  event.preventDefault();
                  draggingDivider.current = true;
                  document.body.style.cursor = "col-resize";
                  document.body.style.userSelect = "none";
                }}
                onKeyDown={handleDividerKeyDown}
                className="group hidden w-2 shrink-0 cursor-col-resize items-center justify-center bg-border/40 outline-none transition-colors hover:bg-primary/20 focus-visible:bg-primary/30 md:flex"
                style={{ touchAction: "none" }}
              >
                <GripVertical className="h-5 w-5 text-muted-foreground/60 transition-colors group-hover:text-primary group-focus-visible:text-primary" aria-hidden="true" />
              </div>
            )}

            {selectedIssueId ? (
              <div className="min-w-0 flex-1 bg-background">
                <IssueDetail
                  id={selectedIssueId}
                  people={people}
                  issues={issues}
                  currentUserId={user?.id}
                  canEdit={canEdit}
                  canComment={canComment}
                  canManage={canManage}
                  onClose={() => setSelectedIssueId(null)}
                  onSelectIssue={setSelectedIssueId}
                />
              </div>
            ) : (
              <div className="hidden flex-1 flex-col items-center justify-center bg-muted/5 p-8 text-center md:flex">
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
                  <CheckCircle2 className="h-8 w-8 text-muted-foreground" />
                </div>
                <h3 className="text-xl font-bold tracking-tight">Select an issue</h3>
                <p className="mt-2 max-w-sm text-muted-foreground">
                  Choose an issue from the navigator to view its details, update its status, or add comments.
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      <IssueForm 
        open={createOpen} 
        onOpenChange={setCreateOpen} 
        draft={draft} 
        setField={setDraftField} 
        people={people} 
        issues={issues}
        onSave={handleCreateSave}
        isSaving={createSaving}
      />
    </div>
  );
}
