import { describe, expect, it } from "vitest";
import {
  canTransitionIssue,
  getAllowedIssueTransitions,
  isIssueStatus,
  terminalIssueStatus,
} from "./issue-workflow";

describe("issue workflow transitions", () => {
  it("uses the requested task and story lifecycle with deployment before review", () => {
    expect(getAllowedIssueTransitions("task", "todo")).toEqual(["in_progress"]);
    expect(getAllowedIssueTransitions("task", "in_progress")).toEqual(["deployed", "blocked"]);
    expect(getAllowedIssueTransitions("story", "deployed")).toEqual(["review"]);
    expect(getAllowedIssueTransitions("story", "release_to_retest")).toEqual(["reopen", "verified"]);
    expect(getAllowedIssueTransitions("task", "verified")).toEqual(["complete"]);
    expect(terminalIssueStatus("story")).toBe("complete");
  });

  it("uses Closed as the bug terminal status", () => {
    expect(getAllowedIssueTransitions("bug", "release_to_retest")).toEqual(["reopen", "verified"]);
    expect(getAllowedIssueTransitions("bug", "verified")).toEqual(["closed"]);
    expect(terminalIssueStatus("bug")).toBe("closed");
    expect(getAllowedIssueTransitions("bug", "closed")).toEqual(["reopen"]);
  });

  it("recognizes branch statuses that are valid bug transitions", () => {
    expect(isIssueStatus("fixed")).toBe(true);
    expect(isIssueStatus("rejected")).toBe(true);
    expect(isIssueStatus("blocked")).toBe(true);
    expect(isIssueStatus("differ")).toBe(true);
    expect(canTransitionIssue("bug", "in_progress", "rejected")).toBe(true);
    expect(canTransitionIssue("bug", "in_progress", "blocked")).toBe(true);
    expect(canTransitionIssue("bug", "in_progress", "differ")).toBe(true);
    expect(canTransitionIssue("bug", "rejected", "in_progress")).toBe(true);
    expect(canTransitionIssue("bug", "blocked", "in_progress")).toBe(true);
    expect(canTransitionIssue("bug", "differ", "in_progress")).toBe(true);
    expect(canTransitionIssue("task", "blocked", "in_progress")).toBe(true);
  });

  it("only allows the forward path and reopen loop", () => {
    expect(canTransitionIssue("bug", "review", "release_to_retest")).toBe(true);
    expect(canTransitionIssue("bug", "release_to_retest", "reopen")).toBe(true);
    expect(canTransitionIssue("bug", "reopen", "in_progress")).toBe(true);
    expect(canTransitionIssue("bug", "todo", "verified")).toBe(false);
    expect(canTransitionIssue("task", "complete", "reopen")).toBe(true);
    expect(canTransitionIssue("task", "complete", "in_progress")).toBe(false);
  });

  it("uses the complete lifecycle for the Jira-style planning types", () => {
    expect(getAllowedIssueTransitions("epic", "in_progress")).toEqual(["deployed"]);
    expect(getAllowedIssueTransitions("content", "verified")).toEqual(["complete"]);
    expect(getAllowedIssueTransitions("request", "release_to_retest")).toEqual(["reopen", "verified"]);
    expect(terminalIssueStatus("test")).toBe("complete");
  });
});