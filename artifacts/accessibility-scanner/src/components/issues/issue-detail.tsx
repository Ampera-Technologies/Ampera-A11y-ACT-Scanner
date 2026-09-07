import React, { useEffect, useState } from "react";
import { Loader2, Archive, Link2, X, Pencil, RotateCcw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useIssue, useUpdateIssue, useAddComment, useUpdateComment, useArchiveIssue, useAddIssueLink, useRemoveIssueLink } from "../../hooks/use-issues";
import { getStatusTransitions, STATUS_LABELS, STATUS_COLORS, TYPE_COLORS, Person, Issue, ISSUE_LINK_LABELS, ISSUE_LINK_TYPES, IssueLinkType } from "../../lib/issue-types";
import { RichTextEditor } from "./rich-text-editor";
import { AttachmentControl, AttachmentPreview } from "./attachment-control";
import { useToast } from "@/hooks/use-toast";
import { sanitizeIssueHtml } from "../../lib/sanitize-issue-html";

interface IssueDetailProps {
  id: number;
  people: Person[];
  issues: Issue[];
  currentUserId?: number;
  canEdit: boolean;
  canComment: boolean;
  canManage: boolean;
  onClose?: () => void;
  onSelectIssue?: (id: number) => void;
}

export function IssueDetail({ id, people, issues, currentUserId, canEdit, canComment, canManage, onClose, onSelectIssue }: IssueDetailProps) {
  const { data, isLoading } = useIssue(id);
  const updateIssue = useUpdateIssue(id);
  const addComment = useAddComment(id);
  const updateComment = useUpdateComment(id);
  const archiveIssue = useArchiveIssue();
  const addIssueLink = useAddIssueLink(id);
  const removeIssueLink = useRemoveIssueLink(id);
  const { toast } = useToast();

  const [commentBody, setCommentBody] = useState("");
  const [commentAttachments, setCommentAttachments] = useState<any[]>([]);
  const [editingCommentId, setEditingCommentId] = useState<number | null>(null);
  const [editingCommentBody, setEditingCommentBody] = useState("");
  const [linkType, setLinkType] = useState<IssueLinkType>("relates_to");
  const [linkTargetId, setLinkTargetId] = useState("");
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");

  useEffect(() => {
    if (!editing) {
      setEditTitle(data?.issue.title ?? "");
      setEditDescription(data?.issue.description ?? "");
    }
  }, [data?.issue.title, data?.issue.description, editing]);

  if (isLoading || !data) {
    return (
      <div className="h-full flex items-center justify-center bg-card">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const { issue, comments, activity, attachments, epic, epicIssues = [], links = [] } = data;
  const epicOptions = issues.filter((candidate) => candidate.type === "epic" && candidate.id !== issue.id);
  const linkTargets = issues.filter((candidate) => candidate.id !== issue.id);

  const handleStatusChange = (newStatus: string) => {
    if (newStatus === issue.status || updateIssue.isPending) return;
    updateIssue.mutate(
      { status: newStatus },
      {
        onSuccess: () => {
          toast({
            title: "Status updated",
            description: `${STATUS_LABELS[newStatus] ?? newStatus} selected for ${issue.issueKey}.`,
          });
        },
        onError: (error) => {
          toast({
            title: "Couldn't update status",
            description: error.message,
            variant: "destructive",
          });
        },
      },
    );
  };

  const handleAssigneeChange = (assigneeId: string) => {
    updateIssue.mutate({ assigneeId: assigneeId === "unassigned" ? null : Number(assigneeId) });
  };

  const submitComment = () => {
    if (!commentBody.trim() && commentAttachments.length === 0) return;
    const mentionIds = (() => {
      const parsed = new DOMParser().parseFromString(commentBody, "text/html");
      const markedIds = Array.from(parsed.querySelectorAll("[data-mention-id]"))
        .map((element) => Number(element.getAttribute("data-mention-id")))
        .filter((personId) => Number.isInteger(personId) && personId > 0);
      const textMatches = people
        .filter((person) => commentBody.includes(`@${person.name}`))
        .map((person) => person.id);
      return [...new Set([...markedIds, ...textMatches])];
    })();
    addComment.mutate(
      { body: commentBody, mentionIds, attachments: commentAttachments },
      {
        onSuccess: () => {
          setCommentBody("");
          setCommentAttachments([]);
          toast({ title: "Comment added" });
        }
      }
    );
  };

  const mentionIdsFromBody = (body: string) => {
    const parsed = new DOMParser().parseFromString(body, "text/html");
    const markedIds = Array.from(parsed.querySelectorAll("[data-mention-id]"))
      .map((element) => Number(element.getAttribute("data-mention-id")))
      .filter((personId) => Number.isInteger(personId) && personId > 0);
    const textMatches = people
      .filter((person) => body.includes(`@${person.name}`))
      .map((person) => person.id);
    return [...new Set([...markedIds, ...textMatches])];
  };

  const saveEditedComment = () => {
    if (editingCommentId === null || !editingCommentBody.trim()) return;
    updateComment.mutate(
      {
        commentId: editingCommentId,
        body: editingCommentBody,
        mentionIds: mentionIdsFromBody(editingCommentBody),
      },
      {
        onSuccess: () => {
          setEditingCommentId(null);
          setEditingCommentBody("");
          toast({ title: "Comment updated" });
        },
        onError: (error) => {
          toast({
            title: "Couldn't update comment",
            description: error.message,
            variant: "destructive",
          });
        },
      },
    );
  };

  const handleArchive = async () => {
    if (!confirm("Are you sure you want to archive this issue?")) return;
    archiveIssue.mutate(id, {
      onSuccess: () => {
        toast({ title: "Issue archived" });
        onClose?.();
      }
    });
  };

  const handleAddLink = () => {
    const targetIssueId = Number(linkTargetId);
    if (!targetIssueId) return;
    addIssueLink.mutate({ targetIssueId, linkType }, {
      onSuccess: () => {
        setLinkTargetId("");
        toast({ title: "Issue relationship added" });
      },
      onError: (error) => toast({ title: "Couldn't add relationship", description: error.message, variant: "destructive" }),
    });
  };

  const handleSaveDetails = () => {
    const title = editTitle.trim();
    if (!title || updateIssue.isPending) return;
    updateIssue.mutate(
      { title, description: editDescription },
      {
        onSuccess: () => {
          setEditing(false);
          toast({ title: "Issue details updated", description: `${issue.issueKey} was saved.` });
        },
        onError: (error) => toast({
          title: "Couldn't update issue details",
          description: error.message,
          variant: "destructive",
        }),
      },
    );
  };

  const cancelEditing = () => {
    setEditTitle(issue.title);
    setEditDescription(issue.description);
    setEditing(false);
  };

  const handleRemoveLink = (linkId: number) => {
    removeIssueLink.mutate(linkId, {
      onSuccess: () => toast({ title: "Issue relationship removed" }),
      onError: (error) => toast({ title: "Couldn't remove relationship", description: error.message, variant: "destructive" }),
    });
  };

  const allowedStatuses = [issue.status, ...getStatusTransitions(issue.type, issue.status)];

  return (
    <div className="h-full flex flex-col bg-card overflow-hidden">
      {/* Header */}
      <div className="flex-none border-b bg-card px-4 py-3">
        <div className="mb-2 flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs font-semibold text-muted-foreground">{issue.issueKey}</span>
            <Badge className={`${TYPE_COLORS[issue.type]} border-0 px-1.5 py-0 text-[10px] font-bold uppercase tracking-wider`}>
              {issue.type}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            {canEdit && ["closed", "complete"].includes(issue.status) && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleStatusChange("reopen")}
                className="h-8"
                disabled={updateIssue.isPending}
              >
                {updateIssue.isPending ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                )}
                Reopen issue
              </Button>
            )}
            {canEdit && !editing && (
              <Button variant="outline" size="sm" onClick={() => setEditing(true)} className="h-8">
                <Pencil className="mr-1.5 h-3.5 w-3.5" />
                Edit
              </Button>
            )}
            {editing && (
              <>
                <Button variant="ghost" size="sm" onClick={cancelEditing} className="h-8" disabled={updateIssue.isPending}>
                  Cancel
                </Button>
                <Button size="sm" onClick={handleSaveDetails} className="h-8" disabled={!editTitle.trim() || updateIssue.isPending}>
                  {updateIssue.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
                  Save
                </Button>
              </>
            )}
            {canManage && (
              <Button variant="ghost" size="sm" onClick={handleArchive} className="h-8 text-muted-foreground hover:text-destructive">
                <Archive className="mr-1.5 h-3.5 w-3.5" />
                Archive
              </Button>
            )}
            {onClose && (
              <Button variant="ghost" size="sm" onClick={onClose} className="md:hidden">
                Close
              </Button>
            )}
          </div>
        </div>
         {editing ? (
           <Input
             aria-label="Issue title"
             value={editTitle}
             maxLength={300}
             onChange={(event) => setEditTitle(event.target.value)}
             className="mt-1 text-lg font-bold"
           />
         ) : (
           <h1 className="text-lg font-bold leading-snug tracking-tight text-foreground">{issue.title}</h1>
         )}
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 p-5 lg:p-6">
          
          {/* Main Column */}
          <div className="xl:col-span-2 space-y-8">
            {/* Description */}
            <section>
              <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">Description</h3>
              {editing ? (
                <RichTextEditor
                  value={editDescription}
                  onChange={setEditDescription}
                  placeholder="Describe the issue, add context, and insert links..."
                  people={people}
                />
              ) : (
                <div
                  className="prose prose-sm dark:prose-invert max-w-none text-foreground/90 leading-relaxed bg-muted/20 p-4 rounded-lg border"
                  dangerouslySetInnerHTML={{ __html: sanitizeIssueHtml(issue.description) || "<p>No description provided.</p>" }}
                />
              )}
            </section>

            {/* Type-Specific Fields */}
            {issue.type === "bug" && (
              <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {issue.stepsToReproduce && (
                  <div className="bg-destructive/5 border border-destructive/10 p-4 rounded-lg md:col-span-2">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-destructive mb-2">Steps to Reproduce</h4>
                    <div className="prose prose-sm dark:prose-invert max-w-none" dangerouslySetInnerHTML={{ __html: sanitizeIssueHtml(issue.stepsToReproduce) }} />
                  </div>
                )}
                {issue.expectedResult && (
                  <div className="bg-emerald-500/5 border border-emerald-500/10 p-4 rounded-lg">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-600 mb-2">Expected Result</h4>
                    <div className="prose prose-sm dark:prose-invert max-w-none" dangerouslySetInnerHTML={{ __html: sanitizeIssueHtml(issue.expectedResult) }} />
                  </div>
                )}
                {issue.actualResult && (
                  <div className="bg-rose-500/5 border border-rose-500/10 p-4 rounded-lg">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-rose-600 mb-2">Actual Result</h4>
                    <div className="prose prose-sm dark:prose-invert max-w-none" dangerouslySetInnerHTML={{ __html: sanitizeIssueHtml(issue.actualResult) }} />
                  </div>
                )}
              </section>
            )}

            {issue.type === "story" && issue.acceptanceCriteria && (
              <section>
                <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">Acceptance Criteria</h3>
                <div className="bg-muted/30 p-4 rounded-lg border prose prose-sm dark:prose-invert max-w-none" dangerouslySetInnerHTML={{ __html: sanitizeIssueHtml(issue.acceptanceCriteria) }} />
              </section>
            )}

            {issue.type === "task" && issue.checklist && issue.checklist.length > 0 && (
              <section>
                <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">Checklist</h3>
                <div className="space-y-2 bg-muted/20 p-4 rounded-lg border">
                  {issue.checklist.map((item, idx) => (
                    <label key={idx} className="flex items-start gap-3 cursor-pointer group">
                      <input 
                        type="checkbox" 
                        className="mt-1 h-4 w-4 rounded border-primary text-primary focus:ring-primary"
                        checked={item.done}
                        disabled={!canEdit}
                        onChange={(e) => {
                          const newList = [...(issue.checklist || [])];
                          newList[idx].done = e.target.checked;
                          updateIssue.mutate({ checklist: newList });
                        }}
                      />
                      <span className={`text-sm ${item.done ? 'line-through text-muted-foreground' : 'text-foreground group-hover:text-primary transition-colors'}`}>
                        {item.text}
                      </span>
                    </label>
                  ))}
                </div>
              </section>
            )}

            {issue.customFields && Object.keys(issue.customFields).length > 0 && (
              <section className="grid gap-3 sm:grid-cols-2">
                {Object.entries(issue.customFields).filter(([, value]) => Boolean(value)).map(([label, value]) => (
                  <div key={label} className="rounded-lg border bg-muted/15 p-3">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label.replace(/([A-Z])/g, " $1")}</h4>
                    <p className="mt-1 whitespace-pre-wrap text-sm">{String(value)}</p>
                  </div>
                ))}
              </section>
            )}

            <section aria-labelledby="issue-relationships-heading" className="rounded-lg border bg-muted/10 p-4">
              <div className="mb-4 flex items-center gap-2">
                <Link2 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <h3 id="issue-relationships-heading" className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Relationships</h3>
              </div>

              <div className="space-y-3">
                {issue.type !== "epic" && (
                  <div className="text-sm">
                    <span className="font-medium text-muted-foreground">Epic: </span>
                    {epic ? (
                      <Button variant="link" className="h-auto p-0 text-left font-medium" onClick={() => onSelectIssue?.(epic.id)}>
                        {epic.issueKey} — {epic.title}
                      </Button>
                    ) : <span>No Epic assigned</span>}
                  </div>
                )}

                {issue.type === "epic" && (
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Contains {epicIssues.length} issue{epicIssues.length === 1 ? "" : "s"}</p>
                    {epicIssues.length > 0 && (
                      <ul className="mt-2 space-y-1" aria-label="Issues contained by this Epic">
                        {epicIssues.map((child) => (
                          <li key={child.id}>
                            <Button variant="link" className="h-auto p-0 text-left text-sm" onClick={() => onSelectIssue?.(child.id)}>
                              {child.issueKey} — {child.title}
                            </Button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {links.length > 0 && (
                  <ul className="space-y-2" aria-label="Linked issues">
                    {links.map((link) => (
                      <li key={link.id} className="flex items-center justify-between gap-3 rounded-md border bg-background p-2">
                        <div className="min-w-0 text-sm">
                          <span className="mr-2 text-muted-foreground">{ISSUE_LINK_LABELS[link.linkType]}:</span>
                          <Button variant="link" className="h-auto max-w-full truncate p-0 text-left align-baseline" onClick={() => onSelectIssue?.(link.issue.id)}>
                            {link.issue.issueKey} — {link.issue.title}
                          </Button>
                        </div>
                        {canEdit && (
                          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => handleRemoveLink(link.id)} aria-label={`Remove ${ISSUE_LINK_LABELS[link.linkType].toLowerCase()} link to ${link.issue.issueKey}`}>
                            <X className="h-4 w-4" />
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                {canEdit && (
                  <div className="grid gap-2 border-t pt-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                    <div>
                      <Label htmlFor="relationship-type" className="sr-only">Relationship type</Label>
                      <Select value={linkType} onValueChange={(value) => setLinkType(value as IssueLinkType)}>
                        <SelectTrigger id="relationship-type" aria-label="Relationship type">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ISSUE_LINK_TYPES.map((type) => <SelectItem key={type} value={type}>{ISSUE_LINK_LABELS[type]}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="relationship-issue" className="sr-only">Issue to link</Label>
                      <Select value={linkTargetId} onValueChange={setLinkTargetId}>
                        <SelectTrigger id="relationship-issue" aria-label="Issue to link">
                          <SelectValue placeholder="Choose issue" />
                        </SelectTrigger>
                        <SelectContent>
                          {linkTargets.map((target) => <SelectItem key={target.id} value={String(target.id)}>{target.issueKey} — {target.title}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button type="button" onClick={handleAddLink} disabled={!linkTargetId || addIssueLink.isPending}>Add link</Button>
                  </div>
                )}
              </div>
            </section>

            {/* Source Reference */}
            {issue.ruleId && (
              <section className="bg-muted/40 p-4 rounded-lg border flex flex-col gap-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Source Finding</h4>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{issue.ruleId}</span>
                  </div>
                  {issue.siteName && <span>• Site: {issue.siteName}</span>}
                  {issue.pageId && <span>• Page ID: {issue.pageId}</span>}
                </div>
                {issue.selector && (
                  <code className="mt-2 block p-2 bg-background border rounded text-xs text-muted-foreground break-all">
                    {issue.selector}
                  </code>
                )}
                {issue.sourceDescription && (
                  <p className="text-sm text-muted-foreground mt-2">{issue.sourceDescription}</p>
                )}
              </section>
            )}

            {/* Attachments */}
            {(attachments && attachments.length > 0) && (
              <section>
                <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">Attachments</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {attachments.map(att => (
                    <AttachmentPreview key={att.id || att.objectPath} attachment={att} issueId={issue.id} />
                  ))}
                </div>
              </section>
            )}

            {/* Comments */}
            <section className="pt-6 border-t">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4">Activity</h3>
              
              {canComment && (
                <div className="mb-8 bg-muted/10 p-4 rounded-lg border">
                  <h4 className="text-xs font-bold uppercase tracking-wider mb-3">Add Comment</h4>
                  <RichTextEditor 
                    value={commentBody} 
                    onChange={setCommentBody} 
                    placeholder="Write a comment... Use @ to mention" 
                    people={people}
                  />
                  
                  {commentAttachments.length > 0 && (
                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {commentAttachments.map((att, idx) => (
                         <AttachmentPreview 
                           key={idx} 
                           attachment={att} 
                           onRemove={() => setCommentAttachments(prev => prev.filter((_, i) => i !== idx))} 
                         />
                      ))}
                    </div>
                  )}
                  
                  <div className="mt-3 flex items-center justify-between">
                    <AttachmentControl 
                      issueId={issue.id} 
                      onUploaded={(att) => setCommentAttachments(prev => [...prev, att])} 
                    />
                    <Button onClick={submitComment} disabled={!commentBody.trim() && commentAttachments.length === 0}>
                      Save Comment
                    </Button>
                  </div>
                </div>
              )}

              <div className="space-y-6">
                {comments.map((comment) => (
                  <div key={comment.id} className="flex gap-4">
                    <div className="h-8 w-8 rounded-full bg-primary/10 flex-shrink-0 flex items-center justify-center text-primary font-bold text-xs mt-1">
                      {comment.authorName.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-3 mb-1.5">
                        <span className="font-semibold text-sm">{comment.authorName}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">
                            {new Date(comment.createdAt).toLocaleString()}
                            {comment.updatedAt && new Date(comment.updatedAt).getTime() > new Date(comment.createdAt).getTime() + 1000 ? " (edited)" : ""}
                          </span>
                          {canComment && currentUserId === comment.authorId && editingCommentId !== comment.id && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              onClick={() => {
                                setEditingCommentId(comment.id);
                                setEditingCommentBody(comment.body);
                              }}
                              aria-label={`Edit comment by ${comment.authorName}`}
                            >
                              <Pencil className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                              Edit
                            </Button>
                          )}
                        </div>
                      </div>
                      {editingCommentId === comment.id ? (
                        <div className="rounded-lg border bg-muted/10 p-3">
                          <RichTextEditor
                            value={editingCommentBody}
                            onChange={setEditingCommentBody}
                            placeholder="Edit your comment..."
                            people={people}
                          />
                          <div className="mt-3 flex justify-end gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={updateComment.isPending}
                              onClick={() => {
                                setEditingCommentId(null);
                                setEditingCommentBody("");
                              }}
                            >
                              Cancel
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              disabled={!editingCommentBody.trim() || updateComment.isPending}
                              onClick={saveEditedComment}
                            >
                              {updateComment.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Save className="mr-1 h-3.5 w-3.5" aria-hidden="true" />}
                              Save
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="prose prose-sm dark:prose-invert max-w-none text-foreground/90 bg-muted/20 p-3 rounded-lg border" dangerouslySetInnerHTML={{ __html: sanitizeIssueHtml(comment.body) }} />
                      )}
                      
                      {comment.attachments && comment.attachments.length > 0 && (
                        <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {comment.attachments.map(att => (
                            <AttachmentPreview key={att.id || att.objectPath} attachment={att} issueId={issue.id} />
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                
                {activity.map((event) => (
                  <div key={event.id} className="flex items-center gap-3 py-1 pl-11 text-xs text-muted-foreground">
                    <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/30" />
                    <span><strong className="text-foreground/70 font-medium">{event.actorName}</strong> {event.action} • {new Date(event.createdAt).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </section>

          </div>

          {/* Right Column - Meta Data */}
          <div className="space-y-6">
            <div className="bg-muted/10 rounded-lg border p-4 space-y-5">
              
              <div className="space-y-1.5">
                <Label htmlFor="issue-status" className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Status</Label>
                <Select
                  value={issue.status}
                  onValueChange={handleStatusChange}
                  disabled={!canEdit || updateIssue.isPending}
                >
                  <SelectTrigger id="issue-status" className={`w-full ${STATUS_COLORS[issue.status]} font-semibold tracking-wide border-0`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {allowedStatuses.map(status => (
                      <SelectItem key={status} value={status} className="font-medium">
                        {STATUS_LABELS[status]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="issue-assignee-detail" className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Assignee</Label>
                <Select value={issue.assigneeId ? String(issue.assigneeId) : "unassigned"} onValueChange={handleAssigneeChange} disabled={!canEdit}>
                  <SelectTrigger id="issue-assignee-detail" className="w-full">
                    <SelectValue placeholder="Unassigned" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unassigned">Unassigned</SelectItem>
                    {people.map(person => (
                      <SelectItem key={person.id} value={String(person.id)}>{person.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="issue-priority-detail" className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Priority</Label>
                <Select 
                  value={issue.priority} 
                  onValueChange={(v) => updateIssue.mutate({ priority: v })} 
                  disabled={!canEdit}
                >
                  <SelectTrigger id="issue-priority-detail" className="w-full capitalize">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["lowest", "low", "medium", "high", "highest"].map(p => (
                      <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {issue.type !== "epic" && (
                <div className="space-y-1.5">
                  <Label htmlFor="issue-epic-detail" className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Epic <span className="normal-case font-normal">(optional)</span></Label>
                  <Select
                    value={issue.epicId ? String(issue.epicId) : "no-epic"}
                    onValueChange={(value) => updateIssue.mutate({ epicId: value === "no-epic" ? null : Number(value) })}
                    disabled={!canEdit}
                  >
                    <SelectTrigger id="issue-epic-detail" className="w-full">
                      <SelectValue placeholder="No Epic" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="no-epic">No Epic</SelectItem>
                      {epicOptions.map((candidate) => (
                        <SelectItem key={candidate.id} value={String(candidate.id)}>
                          {candidate.issueKey} — {candidate.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {issue.severity && (
                <div className="space-y-1.5">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Severity</Label>
                  <div className="text-sm font-medium capitalize flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${issue.severity === 'critical' ? 'bg-destructive' : 'bg-amber-500'}`} />
                    {issue.severity}
                  </div>
                </div>
              )}

              {issue.labels && issue.labels.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Labels</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {issue.labels.map(label => (
                      <Badge key={label} variant="secondary" className="font-normal">{label}</Badge>
                    ))}
                  </div>
                </div>
              )}
              
              <div className="pt-4 border-t space-y-3">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground font-medium">Created</span>
                  <span className="font-medium">{new Date(issue.createdAt).toLocaleDateString()}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground font-medium">Updated</span>
                  <span className="font-medium">{new Date(issue.updatedAt).toLocaleDateString()}</span>
                </div>
                {issue.reporterName && (
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground font-medium">Reporter</span>
                    <span className="font-medium">{issue.reporterName}</span>
                  </div>
                )}
              </div>

            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
