import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import net from "net";
import { db } from "@workspace/db";
import { usersTable, userGroupsTable, userGroupMembersTable, userPermissionsTable, appSettingsTable } from "@workspace/db";
import { eq, asc, inArray, and } from "drizzle-orm";
import { requireAdmin, requireSuperAdmin } from "../middlewares/authMiddleware";
import { sendInviteEmail } from "../lib/email";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const userColumns = {
  id: usersTable.id, email: usersTable.email, username: usersTable.username, passwordHash: usersTable.passwordHash,
  fullName: usersTable.fullName, profileImageUrl: usersTable.profileImageUrl, profileImageContentType: usersTable.profileImageContentType,
  role: usersTable.role, isActive: usersTable.isActive, mustResetPassword: usersTable.mustResetPassword,
  inviteToken: usersTable.inviteToken, inviteTokenExpiresAt: usersTable.inviteTokenExpiresAt, createdAt: usersTable.createdAt, updatedAt: usersTable.updatedAt,
};
const groupColumns = {
  id: userGroupsTable.id, name: userGroupsTable.name, description: userGroupsTable.description, roleLabel: userGroupsTable.roleLabel,
  canScan: userGroupsTable.canScan, canExport: userGroupsTable.canExport, canViewAllScans: userGroupsTable.canViewAllScans,
  canEditScan: userGroupsTable.canEditScan, canDeleteScan: userGroupsTable.canDeleteScan, canManageScan: userGroupsTable.canManageScan,
  canCreateProject: userGroupsTable.canCreateProject, canDeleteProject: userGroupsTable.canDeleteProject, canDisableJs: userGroupsTable.canDisableJs,
  canSmartAnalysis: userGroupsTable.canSmartAnalysis, canSwitchSite: userGroupsTable.canSwitchSite, canCreateCrawl: userGroupsTable.canCreateCrawl,
  canDeleteCrawl: userGroupsTable.canDeleteCrawl, canViewCrawlHistory: userGroupsTable.canViewCrawlHistory, canViewQualityAssurance: userGroupsTable.canViewQualityAssurance,
  canViewSiteAccessibilityDashboard: userGroupsTable.canViewSiteAccessibilityDashboard, canViewHtmlReplay: userGroupsTable.canViewHtmlReplay,
  canManageSites: userGroupsTable.canManageSites, canManageSiteTargetScore: userGroupsTable.canManageSiteTargetScore,
  canViewIssues: userGroupsTable.canViewIssues, canCreateIssue: userGroupsTable.canCreateIssue, canEditIssue: userGroupsTable.canEditIssue,
  canCommentIssue: userGroupsTable.canCommentIssue, canManageIssues: userGroupsTable.canManageIssues, createdAt: userGroupsTable.createdAt,
};
const permissionColumns = {
  userId: userPermissionsTable.userId, canScan: userPermissionsTable.canScan, canExport: userPermissionsTable.canExport,
  canViewAllScans: userPermissionsTable.canViewAllScans, canEditScan: userPermissionsTable.canEditScan, canDeleteScan: userPermissionsTable.canDeleteScan,
  canManageScan: userPermissionsTable.canManageScan, canCreateProject: userPermissionsTable.canCreateProject, canDeleteProject: userPermissionsTable.canDeleteProject,
  canDisableJs: userPermissionsTable.canDisableJs, canSmartAnalysis: userPermissionsTable.canSmartAnalysis, canSwitchSite: userPermissionsTable.canSwitchSite,
  canCreateCrawl: userPermissionsTable.canCreateCrawl, canDeleteCrawl: userPermissionsTable.canDeleteCrawl, canViewCrawlHistory: userPermissionsTable.canViewCrawlHistory,
  canViewQualityAssurance: userPermissionsTable.canViewQualityAssurance, canViewSiteAccessibilityDashboard: userPermissionsTable.canViewSiteAccessibilityDashboard,
  canViewHtmlReplay: userPermissionsTable.canViewHtmlReplay, canManageSites: userPermissionsTable.canManageSites, canManageSiteTargetScore: userPermissionsTable.canManageSiteTargetScore,
  canViewIssues: userPermissionsTable.canViewIssues, canCreateIssue: userPermissionsTable.canCreateIssue, canEditIssue: userPermissionsTable.canEditIssue,
  canCommentIssue: userPermissionsTable.canCommentIssue, canManageIssues: userPermissionsTable.canManageIssues, allowedRules: userPermissionsTable.allowedRules,
  updatedAt: userPermissionsTable.updatedAt, updatedBy: userPermissionsTable.updatedBy,
};

// ── Users ─────────────────────────────────────────────────────────────────────

router.get("/admin/users", requireAdmin, async (req, res): Promise<void> => {
  const users = await db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      username: usersTable.username,
      fullName: usersTable.fullName,
      role: usersTable.role,
      isActive: usersTable.isActive,
      mustResetPassword: usersTable.mustResetPassword,
      createdAt: usersTable.createdAt,
    })
    .from(usersTable)
    .orderBy(asc(usersTable.fullName));

  // Attach group memberships
  const userIds = users.map((u) => u.id);
  let memberships: { userId: number; groupId: number; groupName: string }[] = [];
  if (userIds.length > 0) {
    const rows = await db
      .select({
        userId: userGroupMembersTable.userId,
        groupId: userGroupMembersTable.groupId,
        groupName: userGroupsTable.name,
      })
      .from(userGroupMembersTable)
      .leftJoin(userGroupsTable, eq(userGroupMembersTable.groupId, userGroupsTable.id))
      .where(inArray(userGroupMembersTable.userId, userIds));
    memberships = rows as typeof memberships;
  }

  const memberMap = memberships.reduce<Record<number, { id: number; name: string }[]>>((acc, m) => {
    if (!acc[m.userId]) acc[m.userId] = [];
    acc[m.userId].push({ id: m.groupId, name: m.groupName });
    return acc;
  }, {});

  res.json(
    users.map((u) => ({
      ...u,
      createdAt: u.createdAt.toISOString(),
      groups: memberMap[u.id] || [],
    }))
  );
});

router.get("/admin/users/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid user ID" }); return; }

  const [user] = await db.select(userColumns).from(usersTable).where(eq(usersTable.id, id));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  res.json({ ...user, passwordHash: undefined, createdAt: user.createdAt.toISOString(), updatedAt: user.updatedAt.toISOString() });
});

router.post("/admin/users", requireAdmin, async (req, res): Promise<void> => {
  const { email, username, fullName, role, groupIds } = req.body ?? {};
  if (!email || !username || !fullName) {
    res.status(400).json({ error: "email, username, and fullName are required" });
    return;
  }

  // Only super_admin can create admin/super_admin accounts
  const requestingRole = req.session!.user!.role;
  if ((role === "admin" || role === "super_admin") && requestingRole !== "super_admin") {
    res.status(403).json({ error: "Only super admins can create admin accounts" });
    return;
  }

  const finalRole = role && ["super_admin", "admin", "user"].includes(role) ? role : "user";

  // Generate temp password
  const tempPassword = crypto.randomBytes(6).toString("base64url");
  const passwordHash = await bcrypt.hash(tempPassword, 12);

  // Generate invite token (72 hours)
  const inviteToken = crypto.randomBytes(32).toString("hex");
  const inviteTokenExpiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);

  try {
    const [user] = await db
      .insert(usersTable)
      .values({
        email,
        username,
        fullName,
        role: finalRole,
        passwordHash,
        isActive: true,
        mustResetPassword: true,
        inviteToken,
        inviteTokenExpiresAt,
      })
      .returning();

    // Add user to selected groups
    if (Array.isArray(groupIds) && groupIds.length > 0) {
      await db.insert(userGroupMembersTable).values(
        groupIds.map((gid: number) => ({ userId: user.id, groupId: gid }))
      ).onConflictDoNothing();
    }

    const proto = String(req.headers["x-forwarded-proto"] ?? "https");
    const host = req.headers.host || "";
    const basePath = process.env.BASE_PATH || "";
    const appUrl = `${proto}://${host}${basePath}`;

    const emailSent = await sendInviteEmail({
      to: email,
      fullName,
      username,
      tempPassword,
      inviteToken,
      appUrl,
    });

    logger.info({ userId: user.id, emailSent }, "User created");

    res.status(201).json({
      ...user,
      passwordHash: undefined,
      tempPassword: emailSent ? undefined : tempPassword,
      inviteLink: emailSent ? undefined : `${appUrl}/reset-password?token=${inviteToken}`,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    });
  } catch (err: any) {
    if (err?.code === "23505") {
      res.status(409).json({ error: "A user with that email or username already exists" });
      return;
    }
    throw err;
  }
});

router.put("/admin/users/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid user ID" }); return; }

  const { fullName, email, role, isActive, groupIds } = req.body ?? {};
  const requestingRole = req.session!.user!.role;

  // Only super_admin can change roles
  const updates: Partial<typeof usersTable.$inferInsert> = { updatedAt: new Date() };
  if (fullName) updates.fullName = fullName;
  if (email) updates.email = email;
  if (typeof isActive === "boolean") updates.isActive = isActive;
  if (role && requestingRole === "super_admin") {
    if (["super_admin", "admin", "user"].includes(role)) updates.role = role;
  }

  const [updated] = await db.update(usersTable).set(updates).where(eq(usersTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "User not found" }); return; }

  // Sync group memberships if provided
  if (Array.isArray(groupIds)) {
    // Remove all current memberships for this user
    await db.delete(userGroupMembersTable).where(eq(userGroupMembersTable.userId, id));
    // Re-add selected groups
    if (groupIds.length > 0) {
      await db.insert(userGroupMembersTable).values(
        groupIds.map((gid: number) => ({ userId: id, groupId: gid }))
      ).onConflictDoNothing();
    }
  }

  res.json({ ...updated, passwordHash: undefined, createdAt: updated.createdAt.toISOString(), updatedAt: updated.updatedAt.toISOString() });
});

router.delete("/admin/users/:id", requireSuperAdmin, async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid user ID" }); return; }

  // Prevent deleting yourself
  if (req.session!.user!.id === id) {
    res.status(400).json({ error: "Cannot delete your own account" });
    return;
  }

  await db.delete(usersTable).where(eq(usersTable.id, id));
  res.status(204).send();
});

// POST /admin/users/:id/reset-invite — resend invite / generate new temp password
router.post("/admin/users/:id/reset-invite", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid user ID" }); return; }

  const [user] = await db.select(userColumns).from(usersTable).where(eq(usersTable.id, id));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  const tempPassword = crypto.randomBytes(6).toString("base64url");
  const passwordHash = await bcrypt.hash(tempPassword, 12);
  const inviteToken = crypto.randomBytes(32).toString("hex");
  const inviteTokenExpiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);

  await db.update(usersTable).set({ passwordHash, mustResetPassword: true, inviteToken, inviteTokenExpiresAt, updatedAt: new Date() }).where(eq(usersTable.id, id));

  const proto = String(req.headers["x-forwarded-proto"] ?? "https");
  const host = req.headers.host || "";
  const basePath = process.env.BASE_PATH || "";
  const appUrl = `${proto}://${host}${basePath}`;

  const emailSent = await sendInviteEmail({ to: user.email, fullName: user.fullName, username: user.username, tempPassword, inviteToken, appUrl });

  res.json({
    ok: true,
    emailSent,
    tempPassword: emailSent ? undefined : tempPassword,
    inviteLink: emailSent ? undefined : `${appUrl}/reset-password?token=${inviteToken}`,
  });
});

// ── Groups ────────────────────────────────────────────────────────────────────

router.get("/admin/groups", requireAdmin, async (_req, res): Promise<void> => {
  const groups = await db.select(groupColumns).from(userGroupsTable).orderBy(asc(userGroupsTable.name));

  const groupIds = groups.map((g) => g.id);
  let memberships: { groupId: number; userId: number; fullName: string; username: string }[] = [];
  if (groupIds.length > 0) {
    const rows = await db
      .select({
        groupId: userGroupMembersTable.groupId,
        userId: userGroupMembersTable.userId,
        fullName: usersTable.fullName,
        username: usersTable.username,
      })
      .from(userGroupMembersTable)
      .leftJoin(usersTable, eq(userGroupMembersTable.userId, usersTable.id))
      .where(inArray(userGroupMembersTable.groupId, groupIds));
    memberships = rows as typeof memberships;
  }

  const memberMap = memberships.reduce<Record<number, { id: number; fullName: string; username: string }[]>>((acc, m) => {
    if (!acc[m.groupId]) acc[m.groupId] = [];
    acc[m.groupId].push({ id: m.userId, fullName: m.fullName, username: m.username });
    return acc;
  }, {});

  res.json(groups.map((g) => ({ ...g, createdAt: g.createdAt.toISOString(), members: memberMap[g.id] || [] })));
});

router.post("/admin/groups", requireAdmin, async (req, res): Promise<void> => {
  const {
    name, description, roleLabel,
    canScan, canExport, canViewAllScans, canEditScan, canDeleteScan,
    canManageScan, canCreateProject, canDeleteProject, canDisableJs,
    canSmartAnalysis, canSwitchSite, canCreateCrawl, canDeleteCrawl,
    canViewCrawlHistory, canViewQualityAssurance,
    canViewSiteAccessibilityDashboard, canViewHtmlReplay, canManageSites, canManageSiteTargetScore,
    canViewIssues, canCreateIssue, canEditIssue, canCommentIssue, canManageIssues,
  } = req.body ?? {};
  if (!name) { res.status(400).json({ error: "Group name is required" }); return; }

  try {
    const [group] = await db.insert(userGroupsTable).values({
      name,
      description: description || null,
      roleLabel: roleLabel || null,
      canScan: typeof canScan === "boolean" ? canScan : false,
      canExport: typeof canExport === "boolean" ? canExport : false,
      canViewAllScans: typeof canViewAllScans === "boolean" ? canViewAllScans : false,
      canEditScan: typeof canEditScan === "boolean" ? canEditScan : false,
      canDeleteScan: typeof canDeleteScan === "boolean" ? canDeleteScan : false,
      canManageScan: typeof canManageScan === "boolean" ? canManageScan : false,
      canCreateProject: typeof canCreateProject === "boolean" ? canCreateProject : false,
      canDeleteProject: typeof canDeleteProject === "boolean" ? canDeleteProject : false,
      canDisableJs: typeof canDisableJs === "boolean" ? canDisableJs : false,
      canSmartAnalysis: typeof canSmartAnalysis === "boolean" ? canSmartAnalysis : false,
      canSwitchSite: typeof canSwitchSite === "boolean" ? canSwitchSite : false,
      canCreateCrawl: typeof canCreateCrawl === "boolean" ? canCreateCrawl : false,
      canDeleteCrawl: typeof canDeleteCrawl === "boolean" ? canDeleteCrawl : false,
      canViewCrawlHistory: typeof canViewCrawlHistory === "boolean" ? canViewCrawlHistory : false,
      canViewQualityAssurance: typeof canViewQualityAssurance === "boolean" ? canViewQualityAssurance : false,
      canViewSiteAccessibilityDashboard: typeof canViewSiteAccessibilityDashboard === "boolean" ? canViewSiteAccessibilityDashboard : false,
      canViewHtmlReplay: typeof canViewHtmlReplay === "boolean" ? canViewHtmlReplay : false,
      canManageSites: typeof canManageSites === "boolean" ? canManageSites : false,
      canManageSiteTargetScore: typeof canManageSiteTargetScore === "boolean" ? canManageSiteTargetScore : false,
      canViewIssues: typeof canViewIssues === "boolean" ? canViewIssues : false,
      canCreateIssue: typeof canCreateIssue === "boolean" ? canCreateIssue : false,
      canEditIssue: typeof canEditIssue === "boolean" ? canEditIssue : false,
      canCommentIssue: typeof canCommentIssue === "boolean" ? canCommentIssue : false,
      canManageIssues: typeof canManageIssues === "boolean" ? canManageIssues : false,
    }).returning();
    res.status(201).json({ ...group, createdAt: group.createdAt.toISOString(), members: [] });
  } catch (err: any) {
    if (err?.code === "23505") { res.status(409).json({ error: "A group with that name already exists" }); return; }
    throw err;
  }
});

router.put("/admin/groups/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid group ID" }); return; }

  const {
    name, description, roleLabel,
    canScan, canExport, canViewAllScans, canEditScan, canDeleteScan,
    canManageScan, canCreateProject, canDeleteProject, canDisableJs,
    canSmartAnalysis, canSwitchSite, canCreateCrawl, canDeleteCrawl,
    canViewCrawlHistory, canViewQualityAssurance,
    canViewSiteAccessibilityDashboard, canViewHtmlReplay, canManageSites, canManageSiteTargetScore,
    canViewIssues, canCreateIssue, canEditIssue, canCommentIssue, canManageIssues,
  } = req.body ?? {};
  const updates: Partial<typeof userGroupsTable.$inferInsert> = {};
  if (name) updates.name = name;
  if (description !== undefined) updates.description = description;
  if (roleLabel !== undefined) updates.roleLabel = roleLabel || null;
  const permissionFields = {
    canScan, canExport, canViewAllScans, canEditScan, canDeleteScan,
    canManageScan, canCreateProject, canDeleteProject, canDisableJs,
    canSmartAnalysis, canSwitchSite, canCreateCrawl, canDeleteCrawl,
    canViewCrawlHistory, canViewQualityAssurance,
    canViewSiteAccessibilityDashboard, canViewHtmlReplay, canManageSites, canManageSiteTargetScore,
    canViewIssues, canCreateIssue, canEditIssue, canCommentIssue, canManageIssues,
  } as const;
  for (const [key, value] of Object.entries(permissionFields)) {
    if (typeof value === "boolean") {
      (updates as Record<string, unknown>)[key] = value;
    }
  }

  const [updated] = await db.update(userGroupsTable).set(updates).where(eq(userGroupsTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Group not found" }); return; }

  res.json({ ...updated, createdAt: updated.createdAt.toISOString() });
});

router.delete("/admin/groups/:id", requireSuperAdmin, async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid group ID" }); return; }

  await db.delete(userGroupsTable).where(eq(userGroupsTable.id, id));
  res.status(204).send();
});

// Group members
router.post("/admin/groups/:id/members", requireAdmin, async (req, res): Promise<void> => {
  const groupId = parseInt(req.params["id"] as string, 10);
  const userId = parseInt(req.body?.userId, 10);
  if (isNaN(groupId) || isNaN(userId)) { res.status(400).json({ error: "Invalid IDs" }); return; }

  await db.insert(userGroupMembersTable).values({ groupId, userId }).onConflictDoNothing();
  res.json({ ok: true });
});

router.delete("/admin/groups/:id/members/:userId", requireAdmin, async (req, res): Promise<void> => {
  const groupId = parseInt(req.params["id"] as string, 10);
  const userId = parseInt(req.params["userId"] as string, 10);
  if (isNaN(groupId) || isNaN(userId)) { res.status(400).json({ error: "Invalid IDs" }); return; }

  await db.delete(userGroupMembersTable).where(
    and(eq(userGroupMembersTable.groupId, groupId), eq(userGroupMembersTable.userId, userId))
  );
  res.status(204).send();
});

// ── Permissions ───────────────────────────────────────────────────────────────

// GET /admin/permissions — list permissions for all users (super_admin only)
router.get("/admin/permissions", requireSuperAdmin, async (_req, res): Promise<void> => {
  const users = await db
    .select({
      id: usersTable.id,
      username: usersTable.username,
      fullName: usersTable.fullName,
      email: usersTable.email,
      role: usersTable.role,
    })
    .from(usersTable)
    .orderBy(asc(usersTable.fullName));

  const perms = await db.select(permissionColumns).from(userPermissionsTable);
  const permMap = perms.reduce<Record<number, typeof perms[0]>>((acc, p) => {
    acc[p.userId] = p;
    return acc;
  }, {});

  res.json(users.map((u) => ({
    ...u,
    permissions: permMap[u.id] ?? {
      userId: u.id,
      canScan: true,
      canExport: true,
      canViewAllScans: false,
      canEditScan: true,
      canDeleteScan: true,
      canManageScan: true,
      canCreateProject: true,
      canDeleteProject: true,
      canDisableJs: false,
      canSmartAnalysis: false,
      canSwitchSite: false,
      canCreateCrawl: true,
      canDeleteCrawl: true,
      canViewCrawlHistory: true,
      canViewQualityAssurance: true,
      canViewSiteAccessibilityDashboard: true,
      canViewHtmlReplay: false,
      canManageSites: false,
      canManageSiteTargetScore: false,
      canViewIssues: true,
      canCreateIssue: true,
      canEditIssue: true,
      canCommentIssue: true,
      canManageIssues: true,
      allowedRules: null,
    },
  })));
});

// PUT /admin/permissions/:userId — upsert permissions for a user (super_admin only)
router.put("/admin/permissions/:userId", requireSuperAdmin, async (req, res): Promise<void> => {
  const userId = parseInt(req.params["userId"] as string, 10);
  if (isNaN(userId)) { res.status(400).json({ error: "Invalid user ID" }); return; }

  const {
    canScan, canExport, canViewAllScans, canEditScan, canDeleteScan,
    canManageScan, canCreateProject, canDeleteProject, canDisableJs,
    canSmartAnalysis, canSwitchSite, canCreateCrawl, canDeleteCrawl,
    canViewCrawlHistory, canViewQualityAssurance,
    canViewSiteAccessibilityDashboard, canViewHtmlReplay, canManageSites, canManageSiteTargetScore,
    canViewIssues, canCreateIssue, canEditIssue, canCommentIssue, canManageIssues, allowedRules,
  } = req.body ?? {};
  const updatedBy = req.session!.user!.id;

  const bool = (v: unknown, def: boolean) => typeof v === "boolean" ? v : def;

  const values = {
    userId,
    canScan: bool(canScan, true),
    canExport: bool(canExport, true),
    canViewAllScans: bool(canViewAllScans, false),
    canEditScan: bool(canEditScan, true),
    canDeleteScan: bool(canDeleteScan, true),
    canManageScan: bool(canManageScan, true),
    canCreateProject: bool(canCreateProject, true),
    canDeleteProject: bool(canDeleteProject, true),
    canDisableJs: bool(canDisableJs, false),
    canSmartAnalysis: bool(canSmartAnalysis, false),
    canSwitchSite: bool(canSwitchSite, false),
    canCreateCrawl: bool(canCreateCrawl, true),
    canDeleteCrawl: bool(canDeleteCrawl, true),
    canViewCrawlHistory: bool(canViewCrawlHistory, true),
    canViewQualityAssurance: bool(canViewQualityAssurance, true),
    canViewSiteAccessibilityDashboard: bool(canViewSiteAccessibilityDashboard, true),
    canViewHtmlReplay: bool(canViewHtmlReplay, false),
    canManageSites: bool(canManageSites, false),
    canManageSiteTargetScore: bool(canManageSiteTargetScore, false),
    canViewIssues: bool(canViewIssues, true),
    canCreateIssue: bool(canCreateIssue, true),
    canEditIssue: bool(canEditIssue, true),
    canCommentIssue: bool(canCommentIssue, true),
    canManageIssues: bool(canManageIssues, true),
    allowedRules: Array.isArray(allowedRules) ? allowedRules : null,
    updatedAt: new Date(),
    updatedBy,
  };

  await db
    .insert(userPermissionsTable)
    .values(values)
    .onConflictDoUpdate({
      target: userPermissionsTable.userId,
      set: {
        canScan: values.canScan,
        canExport: values.canExport,
        canViewAllScans: values.canViewAllScans,
        canEditScan: values.canEditScan,
        canDeleteScan: values.canDeleteScan,
        canManageScan: values.canManageScan,
        canCreateProject: values.canCreateProject,
        canDeleteProject: values.canDeleteProject,
        canDisableJs: values.canDisableJs,
        canSmartAnalysis: values.canSmartAnalysis,
        canSwitchSite: values.canSwitchSite,
        canCreateCrawl: values.canCreateCrawl,
        canDeleteCrawl: values.canDeleteCrawl,
        canViewCrawlHistory: values.canViewCrawlHistory,
        canViewQualityAssurance: values.canViewQualityAssurance,
        canViewSiteAccessibilityDashboard: values.canViewSiteAccessibilityDashboard,
        canViewHtmlReplay: values.canViewHtmlReplay,
        canManageSites: values.canManageSites,
        canManageSiteTargetScore: values.canManageSiteTargetScore,
        canViewIssues: values.canViewIssues,
        canCreateIssue: values.canCreateIssue,
        canEditIssue: values.canEditIssue,
        canCommentIssue: values.canCommentIssue,
        canManageIssues: values.canManageIssues,
        allowedRules: values.allowedRules,
        updatedAt: values.updatedAt,
        updatedBy: values.updatedBy,
      },
    });

  res.json(values);
});

// ── App Settings (SMTP etc.) ───────────────────────────────────────────────────

// ── Logo settings ─────────────────────────────────────────────────────────────

const LOGO_KEYS = [
  "logo_type",
  "logo_image_url",
  "logo_text",
  "logo_subtitle",
  "logo_size",
  "logo_text_color",
] as const;

// GET /api/logo — public, no auth required; returns current logo settings for all users
router.get("/logo", async (_req, res): Promise<void> => {
  try {
    const rows = await db.select({ key: appSettingsTable.key, value: appSettingsTable.value }).from(appSettingsTable)
      .where(inArray(appSettingsTable.key, [...LOGO_KEYS]));
    const map: Record<string, string> = {};
    for (const row of rows) {
      if (row.value != null) map[row.key] = row.value;
    }
    res.json({
      type: map["logo_type"] ?? "image",
      imageUrl: map["logo_image_url"] ?? "",
      text: map["logo_text"] ?? "Ampera A11y",
      subtitle: map["logo_subtitle"] ?? "Accessibility workspace",
      size: map["logo_size"] ? parseInt(map["logo_size"], 10) : null,
      textColor: map["logo_text_color"] ?? "",
    });
  } catch {
    res.json({ type: "image", imageUrl: "", text: "", size: null, textColor: "" });
  }
});

// PUT /api/admin/logo — super_admin only; upserts shared branding settings
router.put("/admin/logo", requireSuperAdmin, async (req, res): Promise<void> => {
  const updatedBy = req.session!.user!.id;
  const { type, imageUrl, text, subtitle, size, textColor } = req.body ?? {};
  const now = new Date();

  const rows: { key: string; value: string; updatedAt: Date; updatedBy: number }[] = [];
  if (type === "image" || type === "text" || type === "image-text") {
    rows.push({ key: "logo_type", value: type, updatedAt: now, updatedBy });
  }
  if (typeof imageUrl === "string") {
    rows.push({ key: "logo_image_url", value: imageUrl, updatedAt: now, updatedBy });
  }
  if (typeof text === "string") {
    rows.push({ key: "logo_text", value: text, updatedAt: now, updatedBy });
  }
  if (typeof subtitle === "string") {
    rows.push({ key: "logo_subtitle", value: subtitle, updatedAt: now, updatedBy });
  }
  if (typeof size === "number" && Number.isFinite(size)) {
    rows.push({ key: "logo_size", value: String(size), updatedAt: now, updatedBy });
  }
  if (typeof textColor === "string") {
    rows.push({ key: "logo_text_color", value: textColor, updatedAt: now, updatedBy });
  }

  for (const row of rows) {
    await db.insert(appSettingsTable).values(row).onConflictDoUpdate({
      target: appSettingsTable.key,
      set: { value: row.value, updatedAt: row.updatedAt, updatedBy: row.updatedBy },
    });
  }

  res.json({ ok: true });
});

// ── SMTP settings ─────────────────────────────────────────────────────────────

const SMTP_KEYS = ["smtp_host", "smtp_port", "smtp_user", "smtp_pass", "smtp_from"] as const;
const AI_KEYS = ["ai_engine_enabled", "ai_external_enabled", "ai_external_provider", "ai_external_api_key", "ai_external_model", "smart_analysis_ai_enabled"] as const;
const SCAN_KEYS = ["scan_page_timeout_ms"] as const;
const ALL_SETTINGS_KEYS = [...SMTP_KEYS, ...AI_KEYS, ...SCAN_KEYS] as const;

// GET /admin/settings — return current SMTP + AI settings (super_admin only)
router.get("/admin/settings", requireSuperAdmin, async (req, res): Promise<void> => {
  const rows = await db.select({ key: appSettingsTable.key, value: appSettingsTable.value }).from(appSettingsTable).where(inArray(appSettingsTable.key, [...ALL_SETTINGS_KEYS]));
  const map: Record<string, string> = {};
  for (const row of rows) {
    if (row.value !== null && row.value !== undefined) map[row.key] = row.value;
  }
  // Never expose the raw API key — replace with a sentinel so the UI knows it's set
  if (map["ai_external_api_key"]) map["ai_external_api_key"] = "••••••••";
  res.json(map);
});

// PUT /admin/settings — upsert SMTP + AI settings (super_admin only)
router.put("/admin/settings", requireSuperAdmin, async (req, res): Promise<void> => {
  const updatedBy = req.session!.user!.id;
  const body = req.body ?? {};
  const now = new Date();

  const rows = ALL_SETTINGS_KEYS
    .filter((k) => {
      if (typeof body[k] !== "string") return false;
      // Don't overwrite the API key if the client sent back the masked sentinel
      if (k === "ai_external_api_key" && body[k] === "••••••••") return false;
      return true;
    })
    .map((k) => ({ key: k, value: body[k] as string, updatedAt: now, updatedBy }));

  if (rows.length > 0) {
    for (const row of rows) {
      await db
        .insert(appSettingsTable)
        .values(row)
        .onConflictDoUpdate({
          target: appSettingsTable.key,
          set: { value: row.value, updatedAt: row.updatedAt, updatedBy: row.updatedBy },
        });
    }
  }

  res.json({ ok: true });
});

// GET /scan-settings — public endpoint; scan delay is non-sensitive read-only config
router.get("/scan-settings", async (_req, res): Promise<void> => {
  const [row] = await db
    .select({ value: appSettingsTable.value })
    .from(appSettingsTable)
    .where(eq(appSettingsTable.key, "scan_page_timeout_ms"));
  // Use >= 0 so that 0 (no delay) is returned as-is, not replaced by the default.
  const timeoutMs = row?.value != null ? parseInt(row.value, 10) : 10000;
  res.json({ pageTimeoutMs: Number.isFinite(timeoutMs) && timeoutMs >= 0 ? timeoutMs : 10000 });
});

// ── Active proxy (system-level fallback for 403-blocked pages) ─────────────────
// GET /admin/active-proxy — return current system proxy PAC URL (admin+)
router.get("/admin/active-proxy", requireAdmin, async (_req, res): Promise<void> => {
  const [row] = await db.select({ value: appSettingsTable.value }).from(appSettingsTable).where(eq(appSettingsTable.key, "active_proxy_pac"));
  res.json({ proxyPacUrl: row?.value ?? "" });
});

// PUT /admin/active-proxy — set or clear system proxy PAC URL (admin+)
router.put("/admin/active-proxy", requireAdmin, async (req, res): Promise<void> => {
  const updatedBy = req.session!.user!.id;
  const { proxyPacUrl } = req.body ?? {};
  const value = typeof proxyPacUrl === "string" ? proxyPacUrl.trim() : "";
  await db.insert(appSettingsTable).values({ key: "active_proxy_pac", value, updatedAt: new Date(), updatedBy })
    .onConflictDoUpdate({ target: appSettingsTable.key, set: { value, updatedAt: new Date(), updatedBy } });
  res.json({ ok: true });
});

// ── Proxy test ──────────────────────────────────────────────────────────────────
// POST /admin/proxy/test — validate that a proxy URL is reachable and supports HTTPS CONNECT

function testProxyConnectivity(proxyUrl: string): Promise<{ ok: boolean; ms?: number; error?: string }> {
  return new Promise((resolve) => {
    const start = Date.now();
    let parsed: URL;
    try { parsed = new URL(proxyUrl); } catch {
      resolve({ ok: false, error: "Invalid proxy URL — must start with http://, socks4://, or socks5://" });
      return;
    }

    const proxyHost = parsed.hostname;
    const defaultPort = parsed.protocol === "https:" ? 443 : 1080;
    const proxyPort = parsed.port ? parseInt(parsed.port, 10) : defaultPort;

    if (!proxyHost || isNaN(proxyPort)) {
      resolve({ ok: false, error: "Cannot parse proxy host or port" });
      return;
    }

    const socket = new net.Socket();
    let settled = false;

    const done = (result: { ok: boolean; ms?: number; error?: string }) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(8000);
    socket.on("timeout", () => done({ ok: false, error: "Timed out connecting to proxy (8s)" }));
    socket.on("error", (err) => done({ ok: false, error: `TCP connect failed: ${err.message}` }));

    socket.connect(proxyPort, proxyHost, () => {
      const protocol = parsed.protocol;

      if (protocol === "socks4:") {
        // SOCKS4 CONNECT to 93.184.216.34:443 (example.com)
        const buf = Buffer.alloc(9);
        buf[0] = 4; buf[1] = 1;
        buf.writeUInt16BE(443, 2);
        buf[4] = 93; buf[5] = 184; buf[6] = 216; buf[7] = 34;
        buf[8] = 0; // null-terminated user ID
        socket.write(buf);
        socket.once("data", (data) => {
          if (data[0] === 0 && data[1] === 90) {
            done({ ok: true, ms: Date.now() - start });
          } else {
            done({ ok: false, error: `SOCKS4 rejected CONNECT (code ${data[1]}) — proxy may require auth or blocked the target` });
          }
        });
      } else if (protocol === "socks5:" || protocol === "socks:") {
        // SOCKS5 greeting (no-auth)
        socket.write(Buffer.from([5, 1, 0]));
        socket.once("data", (data) => {
          if (data[0] !== 5 || data[1] !== 0) {
            done({ ok: false, error: `SOCKS5 auth failed (server method: ${data[1]})` });
            return;
          }
          // CONNECT to example.com:443
          const domain = "example.com";
          const req = Buffer.alloc(7 + domain.length);
          req[0] = 5; req[1] = 1; req[2] = 0; req[3] = 3;
          req[4] = domain.length;
          Buffer.from(domain).copy(req, 5);
          req.writeUInt16BE(443, 5 + domain.length);
          socket.write(req);
          socket.once("data", (data2) => {
            if (data2[0] === 5 && data2[1] === 0) {
              done({ ok: true, ms: Date.now() - start });
            } else {
              done({ ok: false, error: `SOCKS5 CONNECT rejected (code ${data2[1]})` });
            }
          });
        });
      } else {
        // HTTP proxy: test CONNECT tunneling for HTTPS
        socket.write(`CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\nProxy-Connection: keep-alive\r\n\r\n`);
        let buf = "";
        const onData = (chunk: Buffer) => {
          buf += chunk.toString("utf8");
          if (buf.includes("\r\n\r\n") || buf.length > 512) {
            socket.off("data", onData);
            const statusLine = buf.split("\r\n")[0] ?? "";
            if (statusLine.includes(" 200")) {
              done({ ok: true, ms: Date.now() - start });
            } else if (statusLine) {
              done({ ok: false, error: `HTTP proxy rejected CONNECT: ${statusLine} — proxy may not support HTTPS tunneling` });
            } else {
              done({ ok: false, error: "HTTP proxy returned empty response — does not support HTTPS CONNECT tunneling" });
            }
          }
        };
        socket.on("data", onData);
      }
    });
  });
}

router.post("/admin/proxy/test", requireAdmin, async (req, res): Promise<void> => {
  const { proxyUrl } = req.body ?? {};
  if (!proxyUrl || typeof proxyUrl !== "string") {
    res.status(400).json({ ok: false, error: "proxyUrl is required" });
    return;
  }
  const result = await testProxyConnectivity(proxyUrl.trim());
  res.json(result);
});

// POST /admin/settings/test-email — send a test email using current SMTP config (super_admin only)
router.post("/admin/settings/test-email", requireSuperAdmin, async (req, res): Promise<void> => {
  const { to } = req.body ?? {};
  if (!to) { res.status(400).json({ error: "Recipient email required" }); return; }

  const { sendTestEmail } = await import("../lib/email");
  const result = await sendTestEmail({ to });
  if (result.ok) {
    res.json({ ok: true });
  } else {
    res.status(502).json({ error: result.error ?? "Failed to send test email. Check SMTP configuration." });
  }
});

export default router;
