import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import session from "express-session";
import request from "supertest";

const {
  mockGetEffectivePermissions,
  mockSelect,
  mockUpdate,
  mockInsert,
} = vi.hoisted(() => ({
  mockGetEffectivePermissions: vi.fn(),
  mockSelect: vi.fn(),
  mockUpdate: vi.fn(),
  mockInsert: vi.fn(),
}));

const tables = {
  issues: { id: "appIssues.id", updatedAt: "appIssues.updatedAt" },
  comments: {
    id: "appIssueComments.id",
    issueId: "appIssueComments.issueId",
    authorId: "appIssueComments.authorId",
    body: "appIssueComments.body",
    mentions: "appIssueComments.mentions",
    updatedAt: "appIssueComments.updatedAt",
  },
  activity: { id: "appIssueActivity.id" },
};

vi.mock("@workspace/db", () => ({
  db: {
    select: mockSelect,
    update: mockUpdate,
    insert: mockInsert,
    delete: vi.fn(),
  },
  appIssuesTable: tables.issues,
  appIssueCommentsTable: tables.comments,
  appIssueActivityTable: tables.activity,
  appIssueAttachmentsTable: {},
  appIssueLinksTable: {},
  usersTable: {},
  sitesTable: {},
  projectsTable: {},
}));

vi.mock("../../lib/permissions", () => ({
  canAccessSite: vi.fn(),
  getEffectivePermissions: mockGetEffectivePermissions,
}));

vi.mock("../../lib/objectStorage", () => ({
  ObjectStorageService: class ObjectStorageService {},
}));

const USER = {
  id: 10,
  username: "comment-owner",
  email: "owner@example.com",
  fullName: "Comment Owner",
  role: "user",
  mustResetPassword: false,
};

function resultBuilder(result: unknown[]) {
  const promise = Promise.resolve(result);
  const builder: any = {
    from: vi.fn(() => builder),
    where: vi.fn(() => builder),
    limit: vi.fn(() => promise),
    then: promise.then.bind(promise),
  };
  return builder;
}

async function createTestApp() {
  const { default: issuesRouter } = await import("../issues");
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test-secret", resave: false, saveUninitialized: true }));
  app.use((req: any, _res, next) => {
    req.session.user = USER;
    next();
  });
  app.use("/api", issuesRouter);
  return app;
}

describe("issue comment editing", () => {
  beforeEach(() => {
    mockGetEffectivePermissions.mockReset();
    mockSelect.mockReset();
    mockUpdate.mockReset();
    mockInsert.mockReset();
    mockGetEffectivePermissions.mockResolvedValue({ canCommentIssue: true });
    mockInsert.mockImplementation(() => ({
      values: vi.fn().mockResolvedValue(undefined),
    }));
  });

  function arrangeSelections(issue: Record<string, unknown> | undefined, comment?: Record<string, unknown>) {
    const matchingComment = issue && comment?.issueId === issue.id ? comment : undefined;
    mockSelect
      .mockImplementationOnce(() => resultBuilder(issue ? [issue] : []))
      .mockImplementationOnce(() => resultBuilder(matchingComment ? [matchingComment] : []));
  }

  function arrangeSuccessfulUpdates(updatedComment: Record<string, unknown>) {
    const commentReturning = vi.fn().mockResolvedValue([updatedComment]);
    const commentWhere = vi.fn(() => ({ returning: commentReturning }));
    const commentSet = vi.fn<(value: Record<string, unknown>) => { where: typeof commentWhere }>(
      () => ({ where: commentWhere }),
    );
    const issueWhere = vi.fn().mockResolvedValue(undefined);
    const issueSet = vi.fn<(value: Record<string, unknown>) => { where: typeof issueWhere }>(
      () => ({ where: issueWhere }),
    );
    mockUpdate.mockImplementation((table) => ({
      set: table === tables.comments ? commentSet : issueSet,
    }));
    return { commentSet, issueSet };
  }

  it("allows the owner to edit a comment and sanitizes the saved body", async () => {
    const issue = { id: 42, title: "Issue" };
    const comment = { id: 7, issueId: 42, authorId: USER.id, body: "Old" };
    arrangeSelections(issue, comment);
    arrangeSuccessfulUpdates({ ...comment, body: "<p>Safe</p>", mentions: [11] });

    const response = await request(await createTestApp())
      .patch("/api/issues/42/comments/7")
      .send({ body: "<script>bad()</script><p>Safe</p>", mentionIds: [11] });

    expect(response.status).toBe(200);
    expect(response.body.body).toBe("<p>Safe</p>");
    expect(mockUpdate).toHaveBeenCalledWith(tables.comments);
  });

  it("preserves safe tables and authenticated issue images while removing unsafe image sources", async () => {
    const issue = { id: 42, title: "Issue" };
    const comment = { id: 7, issueId: 42, authorId: USER.id, body: "Old" };
    arrangeSelections(issue, comment);
    const safeBody = '<table><tbody><tr><td>Result</td></tr></tbody></table><figure><img src="/api/issues/42/attachments/9" alt="Scan result" style="width:50%;height:auto;max-width:100%"><figcaption>Scan result</figcaption></figure>';
    arrangeSuccessfulUpdates({ ...comment, body: safeBody, mentions: [] });

    const response = await request(await createTestApp())
      .patch("/api/issues/42/comments/7")
      .send({
        body: `${safeBody}<img src="https://attacker.example/tracker.png" onerror="bad()">`,
      });

    expect(response.status).toBe(200);
    const savedBody = mockUpdate.mock.results[0]?.value.set.mock.calls[0]?.[0]?.body;
    expect(savedBody).toContain("<table>");
    expect(savedBody).toContain('<img src="/api/issues/42/attachments/9" alt="Scan result" style="width:50%;height:auto;max-width:100%">');
    expect(savedBody).not.toContain("attacker.example");
    expect(savedBody).not.toContain("onerror");
  });

  it("rejects an edit by someone other than the comment author", async () => {
    arrangeSelections(
      { id: 42 },
      { id: 7, issueId: 42, authorId: 99, body: "Someone else's comment" },
    );

    const response = await request(await createTestApp())
      .patch("/api/issues/42/comments/7")
      .send({ body: "Rewritten" });

    expect(response.status).toBe(403);
    expect(response.body.error).toBe("You can only edit your own comments");
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it.each([
    ["a missing issue", "/api/issues/999/comments/7", undefined, undefined],
    ["a non-numeric comment ID", "/api/issues/42/comments/not-a-number", { id: 42 }, undefined],
  ])("returns 404 for %s", async (_case, path, issue, comment) => {
    arrangeSelections(issue, comment);

    const response = await request(await createTestApp()).patch(path).send({ body: "Updated" });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe("Comment not found");
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("does not find a real comment through a different issue ID", async () => {
    const commentOnAnotherIssue = {
      id: 7,
      issueId: 99,
      authorId: USER.id,
      body: "Belongs to issue 99",
    };
    arrangeSelections({ id: 42 }, commentOnAnotherIssue);

    const response = await request(await createTestApp())
      .patch("/api/issues/42/comments/7")
      .send({ body: "Updated through wrong issue" });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe("Comment not found");
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("requires canCommentIssue permission before reading or changing comments", async () => {
    mockGetEffectivePermissions.mockResolvedValue({ canCommentIssue: false });

    const response = await request(await createTestApp())
      .patch("/api/issues/42/comments/7")
      .send({ body: "Updated" });

    expect(response.status).toBe(403);
    expect(response.body.error).toContain("permission");
    expect(mockSelect).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", undefined],
    ["whitespace-only", "   "],
    ["sanitized-empty", "<script>alert('no')</script>"],
  ])("rejects a %s body", async (_case, body) => {
    arrangeSelections(
      { id: 42 },
      { id: 7, issueId: 42, authorId: USER.id, body: "Existing" },
    );

    const response = await request(await createTestApp())
      .patch("/api/issues/42/comments/7")
      .send(body === undefined ? {} : { body });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Comment cannot be empty");
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("uses one updated timestamp for the comment and its parent issue", async () => {
    const comment = { id: 7, issueId: 42, authorId: USER.id, body: "Existing" };
    arrangeSelections({ id: 42 }, comment);
    const { commentSet, issueSet } = arrangeSuccessfulUpdates({ ...comment, body: "Updated" });

    const response = await request(await createTestApp())
      .patch("/api/issues/42/comments/7")
      .send({ body: "Updated" });

    expect(response.status).toBe(200);
    const commentUpdate = commentSet.mock.calls[0]?.[0] as { updatedAt: Date };
    const issueUpdate = issueSet.mock.calls[0]?.[0] as { updatedAt: Date };
    expect(commentUpdate.updatedAt).toBeInstanceOf(Date);
    expect(issueUpdate.updatedAt).toBe(commentUpdate.updatedAt);
  });

  it("records a body-free audit event for a successful edit", async () => {
    const comment = { id: 7, issueId: 42, authorId: USER.id, body: "Existing" };
    arrangeSelections({ id: 42 }, comment);
    arrangeSuccessfulUpdates({ ...comment, body: "Sensitive updated text" });
    const activityValues = vi.fn().mockResolvedValue(undefined);
    mockInsert.mockImplementation((table) => ({
      values: table === tables.activity ? activityValues : vi.fn().mockResolvedValue(undefined),
    }));

    const response = await request(await createTestApp())
      .patch("/api/issues/42/comments/7")
      .send({ body: "Sensitive updated text" });

    expect(response.status).toBe(200);
    expect(activityValues).toHaveBeenCalledWith({
      issueId: 42,
      actorId: USER.id,
      action: "edited a comment",
      details: { commentId: 7 },
    });
    expect(JSON.stringify(activityValues.mock.calls[0][0])).not.toContain("Sensitive updated text");
  });
});