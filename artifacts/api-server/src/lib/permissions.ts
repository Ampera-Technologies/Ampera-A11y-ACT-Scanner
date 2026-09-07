import { db, userPermissionsTable, userGroupsTable, userGroupMembersTable, sitesTable, siteUserAccessTable, siteGroupAccessTable, crawlerSessionsTable } from "@workspace/db";
import { eq, and, inArray, max } from "drizzle-orm";
import { sql } from "drizzle-orm";

export interface EffectivePermissions {
  canScan: boolean;
  canExport: boolean;
  canViewAllScans: boolean;
  canEditScan: boolean;
  canDeleteScan: boolean;
  canManageScan: boolean;
  canCreateProject: boolean;
  canDeleteProject: boolean;
  canDisableJs: boolean;
  canSmartAnalysis: boolean;
  canSwitchSite: boolean;
  canCreateCrawl: boolean;
  canDeleteCrawl: boolean;
  canViewCrawlHistory: boolean;
  canViewQualityAssurance: boolean;
  canViewSiteAccessibilityDashboard: boolean;
  canViewHtmlReplay: boolean;
  canManageSites: boolean;
  canManageSiteTargetScore: boolean;
  canViewIssues: boolean;
  canCreateIssue: boolean;
  canEditIssue: boolean;
  canCommentIssue: boolean;
  canManageIssues: boolean;
  allowedRules: string[] | null;
}

const FULL_ACCESS: EffectivePermissions = {
  canScan: true,
  canExport: true,
  canViewAllScans: true,
  canEditScan: true,
  canDeleteScan: true,
  canManageScan: true,
  canCreateProject: true,
  canDeleteProject: true,
  canDisableJs: true,
  canSmartAnalysis: true,
  canSwitchSite: true,
  canCreateCrawl: true,
  canDeleteCrawl: true,
  canViewCrawlHistory: true,
  canViewQualityAssurance: true,
  canViewSiteAccessibilityDashboard: true,
  canViewHtmlReplay: true,
  canManageSites: true,
  canManageSiteTargetScore: true,
  canViewIssues: true,
  canCreateIssue: true,
  canEditIssue: true,
  canCommentIssue: true,
  canManageIssues: true,
  allowedRules: null,
};

// Keep this projection explicit. Whole-table projections have caused
// orderSelectedFields() failures in bundled production builds when table
// metadata is traversed recursively.
const USER_PERMISSION_COLUMNS = {
  userId: userPermissionsTable.userId,
  canScan: userPermissionsTable.canScan,
  canExport: userPermissionsTable.canExport,
  canViewAllScans: userPermissionsTable.canViewAllScans,
  canEditScan: userPermissionsTable.canEditScan,
  canDeleteScan: userPermissionsTable.canDeleteScan,
  canManageScan: userPermissionsTable.canManageScan,
  canCreateProject: userPermissionsTable.canCreateProject,
  canDeleteProject: userPermissionsTable.canDeleteProject,
  canDisableJs: userPermissionsTable.canDisableJs,
  canSmartAnalysis: userPermissionsTable.canSmartAnalysis,
  canSwitchSite: userPermissionsTable.canSwitchSite,
  canCreateCrawl: userPermissionsTable.canCreateCrawl,
  canDeleteCrawl: userPermissionsTable.canDeleteCrawl,
  canViewCrawlHistory: userPermissionsTable.canViewCrawlHistory,
  canViewQualityAssurance: userPermissionsTable.canViewQualityAssurance,
  canViewSiteAccessibilityDashboard: userPermissionsTable.canViewSiteAccessibilityDashboard,
  canViewHtmlReplay: userPermissionsTable.canViewHtmlReplay,
  canManageSites: userPermissionsTable.canManageSites,
  canManageSiteTargetScore: userPermissionsTable.canManageSiteTargetScore,
  canViewIssues: userPermissionsTable.canViewIssues,
  canCreateIssue: userPermissionsTable.canCreateIssue,
  canEditIssue: userPermissionsTable.canEditIssue,
  canCommentIssue: userPermissionsTable.canCommentIssue,
  canManageIssues: userPermissionsTable.canManageIssues,
  allowedRules: userPermissionsTable.allowedRules,
  updatedAt: userPermissionsTable.updatedAt,
  updatedBy: userPermissionsTable.updatedBy,
};

/** True when the user belongs to a group named "Developer" (case-insensitive). */
async function isInDeveloperGroup(userId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: userGroupMembersTable.groupId })
    .from(userGroupMembersTable)
    .innerJoin(userGroupsTable, eq(userGroupMembersTable.groupId, userGroupsTable.id))
    .where(and(
      eq(userGroupMembersTable.userId, userId),
      sql`lower(${userGroupsTable.name}) = 'developer'`,
    ))
    .limit(1);
  return !!row;
}

export interface SiteWithRole {
  id: number;
  name: string;
  baseUrl: string;
  description: string | null;
  role: "owner" | "member" | "admin";
  pageCount: number;
}

/** Returns max(totalScanned) per site from crawlerSessions — used for the site selector. */
async function getPageCounts(siteIds: number[]): Promise<Map<number, number>> {
  if (siteIds.length === 0) return new Map();
  const rows = await db
    .select({
      siteId: crawlerSessionsTable.siteId,
      pageCount: max(crawlerSessionsTable.totalScanned),
    })
    .from(crawlerSessionsTable)
    .where(inArray(crawlerSessionsTable.siteId, siteIds))
    .groupBy(crawlerSessionsTable.siteId);
  const map = new Map<number, number>();
  for (const r of rows) {
    if (r.siteId != null) map.set(r.siteId, r.pageCount ?? 0);
  }
  return map;
}

/**
 * Returns the list of sites the user can access.
 *
 * - super_admin / admin → all sites (role = "admin")
 * - user → sites assigned directly via site_user_access
 *           UNION sites whose group the user belongs to via site_group_access
 */
export async function getEffectiveSites(
  userId: number,
  userIdStr: string,
  role: string,
): Promise<SiteWithRole[]> {
  if (role === "super_admin" || role === "admin") {
    const all = await db.select({
      id: sitesTable.id,
      name: sitesTable.name,
      baseUrl: sitesTable.baseUrl,
      description: sitesTable.description,
    }).from(sitesTable).orderBy(sitesTable.name);
    const siteIds = all.map((s) => s.id);
    const pageCounts = await getPageCounts(siteIds);
    return all.map((s) => ({ ...s, role: "admin" as const, pageCount: pageCounts.get(s.id) ?? 0 }));
  }

  // Direct access rows for this user (via site_user_access)
  const directRows = await db
    .select({
      siteId: siteUserAccessTable.siteId,
      role: siteUserAccessTable.role,
    })
    .from(siteUserAccessTable)
    .where(eq(siteUserAccessTable.userId, userId));

  // Legacy owner sites (sites.user_id = this user's text id — existing ownership model)
  const legacyOwnerRows = await db
    .select({ id: sitesTable.id })
    .from(sitesTable)
    .where(eq(sitesTable.userId, userIdStr));

  // Groups this user belongs to
  const groupRows = await db
    .select({ groupId: userGroupMembersTable.groupId })
    .from(userGroupMembersTable)
    .where(eq(userGroupMembersTable.userId, userId));

  // Sites accessible via group access
  const groupSiteIds: Set<number> = new Set();
  if (groupRows.length > 0) {
    const groupIds = groupRows.map((g) => g.groupId);
    const groupAccess = await db
      .select({ siteId: siteGroupAccessTable.siteId })
      .from(siteGroupAccessTable)
      .where(inArray(siteGroupAccessTable.groupId, groupIds));
    for (const ga of groupAccess) groupSiteIds.add(ga.siteId);
  }

  // Merge: direct access overrides group and legacy; legacy owner fills role="owner" if not in directMap
  const directMap = new Map(directRows.map((r) => [r.siteId, r.role as "owner" | "member"]));
  for (const lr of legacyOwnerRows) {
    if (!directMap.has(lr.id)) directMap.set(lr.id, "owner");
  }
  const allSiteIds = new Set([...directMap.keys(), ...groupSiteIds]);
  if (allSiteIds.size === 0) return [];

  const sites = await db
    .select({
      id: sitesTable.id,
      name: sitesTable.name,
      baseUrl: sitesTable.baseUrl,
      description: sitesTable.description,
    })
    .from(sitesTable)
    .where(inArray(sitesTable.id, [...allSiteIds]))
    .orderBy(sitesTable.name);

  const pageCounts = await getPageCounts(sites.map((s) => s.id));

  return sites.map((s) => ({
    ...s,
    role: directMap.get(s.id) ?? "member",
    pageCount: pageCounts.get(s.id) ?? 0,
  }));
}

/**
 * Returns the caller's access level for a single site, or null if they have none.
 * - "admin"  → super_admin / admin role (implicit access to all sites)
 * - "owner"  → direct site_user_access with role=owner, OR legacy sites.user_id match
 * - "member" → direct site_user_access with role=member, OR group-inherited access
 * - null     → no access
 */
export async function canAccessSite(
  userId: number,
  userIdStr: string,
  role: string,
  siteId: number,
): Promise<"admin" | "owner" | "member" | null> {
  if (role === "super_admin" || role === "admin") return "admin";

  // Direct access via site_user_access
  const [directRow] = await db
    .select({ role: siteUserAccessTable.role })
    .from(siteUserAccessTable)
    .where(and(eq(siteUserAccessTable.siteId, siteId), eq(siteUserAccessTable.userId, userId)))
    .limit(1);
  if (directRow) return directRow.role as "owner" | "member";

  // Legacy ownership: sites.user_id (text) equals this user's id string
  const [legacyRow] = await db
    .select({ id: sitesTable.id })
    .from(sitesTable)
    .where(and(eq(sitesTable.id, siteId), eq(sitesTable.userId, userIdStr)))
    .limit(1);
  if (legacyRow) return "owner";

  // Group-inherited access
  const groupRows = await db
    .select({ groupId: userGroupMembersTable.groupId })
    .from(userGroupMembersTable)
    .where(eq(userGroupMembersTable.userId, userId));
  if (groupRows.length > 0) {
    const groupIds = groupRows.map((g) => g.groupId);
    const [groupAccess] = await db
      .select({ siteId: siteGroupAccessTable.siteId })
      .from(siteGroupAccessTable)
      .where(and(eq(siteGroupAccessTable.siteId, siteId), inArray(siteGroupAccessTable.groupId, groupIds)))
      .limit(1);
    if (groupAccess) return "member";
  }

  return null;
}

export async function getEffectivePermissions(
  userId: number,
  role: string,
): Promise<EffectivePermissions> {
  // super_admin gets full access including site switching
  if (role === "super_admin") return FULL_ACCESS;

  // admin gets full access except canSwitchSite which requires explicit grant
  if (role === "admin") {
    const [perm] = await db.select(USER_PERMISSION_COLUMNS).from(userPermissionsTable).where(eq(userPermissionsTable.userId, userId));
    return {
      ...FULL_ACCESS,
      canSwitchSite: perm?.canSwitchSite ?? false,
      canViewHtmlReplay: perm?.canViewHtmlReplay ?? false,
    };
  }

  const [[perm], inDevGroup] = await Promise.all([
    db.select(USER_PERMISSION_COLUMNS).from(userPermissionsTable).where(eq(userPermissionsTable.userId, userId)),
    isInDeveloperGroup(userId),
  ]);
  const groupPermissions = await db
    .select({
      canScan: userGroupsTable.canScan,
      canExport: userGroupsTable.canExport,
      canViewAllScans: userGroupsTable.canViewAllScans,
      canEditScan: userGroupsTable.canEditScan,
      canDeleteScan: userGroupsTable.canDeleteScan,
      canManageScan: userGroupsTable.canManageScan,
      canCreateProject: userGroupsTable.canCreateProject,
      canDeleteProject: userGroupsTable.canDeleteProject,
      canDisableJs: userGroupsTable.canDisableJs,
      canSmartAnalysis: userGroupsTable.canSmartAnalysis,
      canSwitchSite: userGroupsTable.canSwitchSite,
      canCreateCrawl: userGroupsTable.canCreateCrawl,
      canDeleteCrawl: userGroupsTable.canDeleteCrawl,
      canViewCrawlHistory: userGroupsTable.canViewCrawlHistory,
      canViewQualityAssurance: userGroupsTable.canViewQualityAssurance,
      canViewSiteAccessibilityDashboard: userGroupsTable.canViewSiteAccessibilityDashboard,
      canViewHtmlReplay: userGroupsTable.canViewHtmlReplay,
      canManageSites: userGroupsTable.canManageSites,
      canManageSiteTargetScore: userGroupsTable.canManageSiteTargetScore,
      canViewIssues: userGroupsTable.canViewIssues,
      canCreateIssue: userGroupsTable.canCreateIssue,
      canEditIssue: userGroupsTable.canEditIssue,
      canCommentIssue: userGroupsTable.canCommentIssue,
      canManageIssues: userGroupsTable.canManageIssues,
    })
    .from(userGroupMembersTable)
    .innerJoin(userGroupsTable, eq(userGroupMembersTable.groupId, userGroupsTable.id))
    .where(eq(userGroupMembersTable.userId, userId));
  const groupGrants = (key: keyof typeof groupPermissions[number]) =>
    groupPermissions.some((group) => group[key] === true);
  const [targetScoreGroup] = await db
    .select({ enabled: userGroupsTable.canManageSiteTargetScore })
    .from(userGroupMembersTable)
    .innerJoin(userGroupsTable, eq(userGroupMembersTable.groupId, userGroupsTable.id))
    .where(and(
      eq(userGroupMembersTable.userId, userId),
      eq(userGroupsTable.canManageSiteTargetScore, true),
    ))
    .limit(1);
  const canViewIssues = Boolean(perm?.canViewIssues ?? true) || groupGrants("canViewIssues");

  return {
    canScan: Boolean(perm?.canScan ?? true) || groupGrants("canScan"),
    canExport: Boolean(perm?.canExport ?? true) || groupGrants("canExport"),
    canViewAllScans: Boolean(perm?.canViewAllScans ?? false) || groupGrants("canViewAllScans"),
    canEditScan: Boolean(perm?.canEditScan ?? true) || groupGrants("canEditScan"),
    canDeleteScan: Boolean(perm?.canDeleteScan ?? true) || groupGrants("canDeleteScan"),
    canManageScan: Boolean(perm?.canManageScan ?? true) || groupGrants("canManageScan"),
    canCreateProject: Boolean(perm?.canCreateProject ?? true) || groupGrants("canCreateProject"),
    canDeleteProject: Boolean(perm?.canDeleteProject ?? true) || groupGrants("canDeleteProject"),
    canDisableJs: Boolean(perm?.canDisableJs ?? false) || groupGrants("canDisableJs"),
    canSmartAnalysis: inDevGroup || Boolean(perm?.canSmartAnalysis ?? false) || groupGrants("canSmartAnalysis"),
    canSwitchSite: Boolean(perm?.canSwitchSite ?? false) || groupGrants("canSwitchSite"),
    canCreateCrawl: Boolean(perm?.canCreateCrawl ?? true) || groupGrants("canCreateCrawl"),
    canDeleteCrawl: Boolean(perm?.canDeleteCrawl ?? true) || groupGrants("canDeleteCrawl"),
    canViewCrawlHistory: Boolean(perm?.canViewCrawlHistory ?? true) || groupGrants("canViewCrawlHistory"),
    canViewQualityAssurance: Boolean(perm?.canViewQualityAssurance ?? true) || groupGrants("canViewQualityAssurance"),
    canViewSiteAccessibilityDashboard: Boolean(perm?.canViewSiteAccessibilityDashboard ?? true) || groupGrants("canViewSiteAccessibilityDashboard"),
    canViewHtmlReplay: Boolean(perm?.canViewHtmlReplay ?? false) || groupGrants("canViewHtmlReplay"),
    canManageSites: Boolean(perm?.canManageSites ?? false) || groupGrants("canManageSites"),
    canManageSiteTargetScore: Boolean(perm?.canManageSiteTargetScore || targetScoreGroup?.enabled || groupGrants("canManageSiteTargetScore")),
    canViewIssues,
    canCreateIssue: canViewIssues && (Boolean(perm?.canCreateIssue ?? true) || groupGrants("canCreateIssue")),
    canEditIssue: canViewIssues && (Boolean(perm?.canEditIssue ?? true) || groupGrants("canEditIssue")),
    canCommentIssue: canViewIssues && (Boolean(perm?.canCommentIssue ?? true) || groupGrants("canCommentIssue")),
    canManageIssues: canViewIssues && (Boolean(perm?.canManageIssues ?? true) || groupGrants("canManageIssues")),
    allowedRules: (perm?.allowedRules as string[] | null) ?? null,
  };
}
