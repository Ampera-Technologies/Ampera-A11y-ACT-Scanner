import { describe, expect, it } from "vitest";
import { buildIssueNotificationEmail } from "./email";

describe("issue notification email", () => {
  it("includes the complete comment and explicit issue details", () => {
    const message = buildIssueNotificationEmail({
      to: "mentioned@example.com",
      fullName: "Mentioned User",
      issueKey: "AMP-0014",
      issueTitle: "Improve comment notifications",
      issueStatus: "In Progress",
      eventTitle: "You were mentioned in a comment",
      eventSummary: "Comment Author mentioned you in a comment on AMP-0014.",
      commentBody: "Please review the full accessibility findings before retesting.",
      issueUrl: "https://app.example.com/issues?issueId=14",
    });

    expect(message.subject).toBe("[AMP-0014] You were mentioned in a comment");
    expect(message.text).toContain("Please review the full accessibility findings before retesting.");
    expect(message.text).toContain("Issue no: AMP-0014");
    expect(message.text).toContain("Title: Improve comment notifications");
    expect(message.text).toContain("Status: In Progress");
    expect(message.text).toContain("Open issue: https://app.example.com/issues?issueId=14");
    expect(message.html).toContain("<strong>Issue no:</strong> AMP-0014");
  });

  it("escapes comment content in the HTML email", () => {
    const message = buildIssueNotificationEmail({
      to: "mentioned@example.com",
      fullName: "Mentioned User",
      issueKey: "AMP-0020",
      issueTitle: "Email safety",
      issueStatus: "To Do",
      eventTitle: "You were mentioned in a comment",
      eventSummary: "A team member mentioned you.",
      commentBody: "<script>alert('unsafe')</script>",
      issueUrl: "https://app.example.com/issues?issueId=20",
    });

    expect(message.html).not.toContain("<script>");
    expect(message.html).toContain("&lt;script&gt;alert(&#39;unsafe&#39;)&lt;/script&gt;");
  });
});