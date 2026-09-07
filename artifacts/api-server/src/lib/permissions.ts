import { db, pool, userGroupMembersTable, sitesTable, siteUserAccessTable, siteGroupAccessTable, crawlerSessionsTable } from "@workspace/db";
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

type PermissionRow = Partial<EffectivePermissions> & {
  userId?: number;
};

const PERMISSION_SELECT_SQL = `
  SELECT
    user_id AS "userId",
    can_scan AS "canScan",
    can_export AS "canExport",
    can_view_all_scans AS "canViewAllScans",
    can_edit_scan AS "canEditScan",
    can_delete_scan AS "canDeleteScan",
    can_manage_scan AS "canManageScan",
    can_create_project AS "canCreateProject",
    can_delete_project AS "canDeleteProject",
    can_disable_js AS "canDisableJs",
    can_smart_analysis AS "canSmartAnalysis",
    can_switch_site AS "canSwitchSite",
    can_create_crawl AS "canCreateCrawl",
    can_delete_crawl AS "canDeleteCrawl",
    can_view_crawl_history AS "canViewCrawlHistory",
    can_view_quality_assurance AS "canViewQualityAssurance",
    can_view_site_accessibility_dashboard AS "canViewSiteAccessibilityDashboard",
    can_view_html_replay AS "canViewHtmlReplay",
    can_manage_sites AS "canManageSites",
    can_manage_site_target_score AS "canManageSiteTargetScore",
    can_view_issues AS "canViewIssues",
    can_create_issue AS "canCreateIssue",
    can_edit_issue AS "canEditIssue",
    can_comment_issue AS "canCommentIssue",
    can_manage_issues AS "canManageIssues",
    allowed_rules AS "allowedRules"
  FROM user_permissions
  WHERE user_id = $1
  LIMIT 1`;

const GROUP_PERMISSION_SELECT_SQL = `
  SELECT
    g.can_scan AS "canScan",
    g.can_export AS "canExport",
    g.can_view_all_scans AS "canViewAllScans",
    g.can_edit_scan AS "canEditScan",
    g.can_delete_scan AS "canDeleteScan",
    g.can_manage_scan AS "canManageScan",
    g.can_create_project AS "canCreateProject",
    g.can_delete_project AS "canDeleteProject",
    g.can_disable_js AS "canDisableJs",
    g.can_smart_analysis AS "canSmartAnalysis",
    g.can_switch_site AS "canSwitchSite",
    g.can_create_crawl AS "canCreateCrawl",
    g.can_delete_crawl AS "canDeleteCrawl",
    g.can_view_crawl_history AS "canViewCrawlHistory",
    g.can_view_quality_assurance AS "canViewQualityAssurance",
    g.can_view_site_accessibility_dashboard AS "canViewSiteAccessibilityDashboard",
    g.can_view_html_replay AS "canViewHtmlReplay",
    g.can_manage_sites AS "canManageSites",
    g.can_manage_site_target_score AS "canManageSiteTargetScore",
    g.can_view_issues AS "canViewIssues",
    g.can_create_issue AS "canCreateIssue",
    g.can_edit_issue AS "canEditIssue",
    g.can_comment_issue AS "canCommentIssue",
    g.can_manage_issues AS "canManageIssues"
  FROM user_group_members membership
  INNER JOIN user_groups g ON g.id = membership.group_id
  WHERE membership.user_id = $1`;

async function getDirectPermissions(userId: number): Promise<PermissionRow | undefined> {
  const result = await pool.query<PermissionRow>(PERMISSION_SELECT_SQL, [userId]);
  return result.rows[0];
}

/** True when the user belongs to a group named "Developer" (case-insensitive). */
async function isInDeveloperGroup(userId: number): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1
       FROM user_group_members membership
       INNER JOIN user_groups g ON g.id = membership.group_id
      WHERE membership.user_id = $1 AND lower(g.name) = 'developer'
      LIMIT 1`,
    [userId],
  );
  return result.rowCount !== null && result.rowCount > 0;
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
    const perm = await getDirectPermissions(userId);
    return {
      ...FULL_ACCESS,
      canSwitchSite: perm?.canSwitchSite ?? false,
      canViewHtmlReplay: perm?.canViewHtmlReplay ?? false,
    };
  }

  const [perm, inDevGroup, groupResult] = await Promise.all([
    getDirectPermissions(userId),
    isInDeveloperGroup(userId),
    pool.query<PermissionRow>(GROUP_PERMISSION_SELECT_SQL, [userId]),
  ]);
  const groupPermissions = groupResult.rows;
  const groupGrants = (key: keyof typeof groupPermissions[number]) =>
    groupPermissions.some((group) => group[key] === true);
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
    canManageSiteTargetScore: Boolean(perm?.canManageSiteTargetScore || groupGrants("canManageSiteTargetScore")),
    canViewIssues,
    canCreateIssue: canViewIssues && (Boolean(perm?.canCreateIssue ?? true) || groupGrants("canCreateIssue")),
    canEditIssue: canViewIssues && (Boolean(perm?.canEditIssue ?? true) || groupGrants("canEditIssue")),
    canCommentIssue: canViewIssues && (Boolean(perm?.canCommentIssue ?? true) || groupGrants("canCommentIssue")),
    canManageIssues: canViewIssues && (Boolean(perm?.canManageIssues ?? true) || groupGrants("canManageIssues")),
    allowedRules: (perm?.allowedRules as string[] | null) ?? null,
  };
}
