import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Issue,
  IssueDetailData,
  Person,
  IssueAttachment,
  IssueLinkType,
  IssueRelationship,
  IssueMetrics,
} from "../lib/issue-types";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${url}`, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });
  if (response.status === 204) return undefined as T;

  const contentType = response.headers.get("content-type") ?? "";
  const responseText = await response.text();
  let body: unknown = null;

  if (responseText && contentType.includes("application/json")) {
    try {
      body = JSON.parse(responseText);
    } catch {
      throw new Error(
        "The Issue Management service returned invalid JSON. Please try again.",
      );
    }
  }

  if (!response.ok) {
    if (!contentType.includes("application/json")) {
      throw new Error(
        `Issue Management API is unavailable (HTTP ${response.status}). Please deploy the current API server and try again.`,
      );
    }
    const message =
      body &&
      typeof body === "object" &&
      "error" in body &&
      typeof body.error === "string"
        ? body.error
        : "Something went wrong";
    throw new Error(message);
  }

  if (!contentType.includes("application/json")) {
    throw new Error(
      "The Issue Management service returned an unexpected response. Please try again.",
    );
  }

  return body as T;
}

export function useIssues() {
  return useQuery({
    queryKey: ["issues"],
    queryFn: () => api<{ issues: Issue[]; metrics: IssueMetrics }>("/api/issues"),
    // Issue Management is user-driven rather than a live dashboard. Keep the
    // current list stable while the user works and let mutations invalidate it
    // when an explicit change has been made. A full browser refresh still
    // fetches the latest server state.
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
  });
}

export function useIssue(id: number | null) {
  return useQuery({
    queryKey: ["issues", id],
    queryFn: () => api<IssueDetailData>(`/api/issues/${id}`),
    enabled: !!id,
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

export function usePeople(enabled = true) {
  return useQuery({
    queryKey: ["issues-people"],
    queryFn: () => api<Person[]>("/api/issues/people"),
    enabled,
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
  });
}

export function useCreateIssue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<Issue>) =>
      api<Issue>("/api/issues", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["issues"] }),
  });
}

export function useUpdateIssue(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<Issue>) =>
      api<Issue>(`/api/issues/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["issues"] });
      qc.invalidateQueries({ queryKey: ["issues", id] });
    },
  });
}

export function useAddComment(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      body: string;
      mentionIds?: number[];
      attachments?: IssueAttachment[];
    }) =>
      api<any>(`/api/issues/${id}/comments`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["issues", id] }),
  });
}

export function useUpdateComment(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      commentId: number;
      body: string;
      mentionIds?: number[];
    }) =>
      api<any>(`/api/issues/${id}/comments/${data.commentId}`, {
        method: "PATCH",
        body: JSON.stringify({
          body: data.body,
          mentionIds: data.mentionIds,
        }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["issues", id] }),
  });
}

export function useArchiveIssue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      api<any>(`/api/issues/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["issues"] }),
  });
}

export function useAddIssueLink(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { targetIssueId: number; linkType: IssueLinkType }) =>
      api<IssueRelationship>(`/api/issues/${id}/links`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["issues"] });
      qc.invalidateQueries({ queryKey: ["issues", id] });
    },
  });
}

export function useRemoveIssueLink(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (linkId: number) =>
      api<void>(`/api/issues/${id}/links/${linkId}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["issues"] });
      qc.invalidateQueries({ queryKey: ["issues", id] });
    },
  });
}

export function useUploadAttachment(issueId: number) {
  return useMutation({
    mutationFn: (file: File) => uploadIssueAttachment(issueId, file),
  });
}

export async function uploadIssueAttachment(
  issueId: number,
  file: File,
  finalize = false,
): Promise<IssueAttachment> {
  const { uploadURL, uploadHeaders, attachment } = await api<{
    uploadURL: string;
    uploadHeaders?: Record<string, string>;
    attachment: IssueAttachment;
  }>(`/api/issues/${issueId}/attachments/upload-url`, {
    method: "POST",
    body: JSON.stringify({
      filename: file.name,
      contentType: file.type,
      size: file.size,
    }),
  });
  const resolvedUploadURL = uploadURL.startsWith("/")
    ? `${BASE}${uploadURL}`
    : uploadURL;
  const sameOrigin =
    new URL(resolvedUploadURL, window.location.href).origin ===
    window.location.origin;
  const putRes = await fetch(resolvedUploadURL, {
    method: "PUT",
    credentials: sameOrigin ? "include" : "omit",
    headers: uploadHeaders ?? {
      "Content-Type": file.type || "application/octet-stream",
    },
    body: file,
  });
  if (!putRes.ok)
    throw new Error(`Failed to upload ${file.name} (HTTP ${putRes.status})`);
  if (finalize) {
    const confirmed = await api<{ attachments: IssueAttachment[] }>(
      `/api/issues/${issueId}/attachments/confirm`,
      {
        method: "POST",
        body: JSON.stringify({ attachments: [attachment] }),
      },
    );
    if (!confirmed.attachments[0])
      throw new Error(`Failed to confirm ${file.name}`);
    return confirmed.attachments[0];
  }
  return attachment;
}
