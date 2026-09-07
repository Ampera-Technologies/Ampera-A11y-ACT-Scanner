import { Router, type IRouter } from "express";
import {
  db,
  projectsTable,
  projectSitesTable,
  sitesTable,
  scanSessionsTable,
} from "@workspace/db";
import { eq, asc, and, inArray, or, isNull } from "drizzle-orm";
import { requireAuth } from "../middlewares/authMiddleware";
import {
  canAccessSite,
  getEffectivePermissions,
  getEffectiveSites,
} from "../lib/permissions";

const router: IRouter = Router();
const projectColumns = { id: projectsTable.id, name: projectsTable.name, createdAt: projectsTable.createdAt };

router.get("/projects", requireAuth, async (req, res): Promise<void> => {
  const rawSiteId = req.query["siteId"];
  const siteId = rawSiteId ? parseInt(String(rawSiteId), 10) : null;
  const includeUnassociated = String(req.query["includeUnassociated"] ?? "") === "true";
  if (rawSiteId && (!Number.isInteger(siteId) || siteId! <= 0)) {
    res.status(400).json({ error: "Invalid site ID" });
    return;
  }

  if (siteId != null) {
    const userId = String(req.session!.user!.id);
    const userIdNum = Number(req.session!.user!.id);
    const role = req.session!.user!.role;
    if (!(await canAccessSite(userIdNum, userId, role, siteId))) {
      res.status(403).json({ error: "You do not have access to the specified site" });
      return;
    }
  }

  const accessibleSites = await getEffectiveSites(
    Number(req.session!.user!.id),
    String(req.session!.user!.id),
    req.session!.user!.role,
  );
  const accessibleSiteIds = accessibleSites.map((site) => site.id);
  if (siteId == null && accessibleSiteIds.length === 0) {
    res.json([]);
    return;
  }

  const projects = siteId == null
    ? includeUnassociated
      ? await db
          .selectDistinct({
            id: projectsTable.id,
            name: projectsTable.name,
            createdAt: projectsTable.createdAt,
          })
          .from(projectsTable)
          .leftJoin(projectSitesTable, eq(projectSitesTable.projectId, projectsTable.id))
          .where(
            accessibleSiteIds.length > 0
              ? or(
                  inArray(projectSitesTable.siteId, accessibleSiteIds),
                  isNull(projectSitesTable.id),
                )
              : isNull(projectSitesTable.id),
          )
          .orderBy(asc(projectsTable.name))
      : await db
          .selectDistinct({
            id: projectsTable.id,
            name: projectsTable.name,
            createdAt: projectsTable.createdAt,
          })
          .from(projectsTable)
          .innerJoin(projectSitesTable, eq(projectSitesTable.projectId, projectsTable.id))
          .where(inArray(projectSitesTable.siteId, accessibleSiteIds))
          .orderBy(asc(projectsTable.name))
    : await db
        .selectDistinct({
          id: projectsTable.id,
          name: projectsTable.name,
          createdAt: projectsTable.createdAt,
        })
        .from(projectsTable)
        .leftJoin(projectSitesTable, eq(projectSitesTable.projectId, projectsTable.id))
        .leftJoin(scanSessionsTable, eq(scanSessionsTable.projectId, projectsTable.id))
        .where(or(
          eq(projectSitesTable.siteId, siteId),
          // Legacy projects may have a scan tied to the site before the
          // project_sites association was backfilled.
          and(
            isNull(projectSitesTable.id),
            eq(scanSessionsTable.siteId, siteId),
          ),
        ))
        .orderBy(asc(projectsTable.name));

  const projectIds = projects.map((project) => project.id);
  const associations = projectIds.length === 0
    ? []
    : await db
        .select({
          projectId: projectSitesTable.projectId,
          siteId: projectSitesTable.siteId,
          siteName: sitesTable.name,
        })
        .from(projectSitesTable)
        .innerJoin(sitesTable, eq(projectSitesTable.siteId, sitesTable.id))
        .where(inArray(projectSitesTable.projectId, projectIds));
  const associationMap = new Map<number, { id: number; name: string }[]>();
  for (const association of associations) {
    const list = associationMap.get(association.projectId) ?? [];
    list.push({ id: association.siteId, name: association.siteName });
    associationMap.set(association.projectId, list);
  }

  res.json(projects.map((p) => ({
    ...p,
    sites: associationMap.get(p.id) ?? [],
    createdAt: p.createdAt.toISOString(),
  })));
});

router.post("/projects", requireAuth, async (req, res): Promise<void> => {
  const userId = req.session!.user!.id;
  const role = req.session!.user!.role;
  const perms = await getEffectivePermissions(userId, role);
  if (!perms.canCreateProject) {
    res.status(403).json({ error: "You don't have permission to create projects" });
    return;
  }

  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const siteId = Number(req.body?.siteId);
  if (!name || name.length > 200) {
    res.status(400).json({ error: "Project name is required (max 200 chars)" });
    return;
  }
  if (!Number.isInteger(siteId) || siteId <= 0) {
    res.status(400).json({ error: "A site is required for every project" });
    return;
  }
  if (!(await canAccessSite(Number(userId), String(userId), role, siteId))) {
    res.status(403).json({ error: "You do not have access to the specified site" });
    return;
  }

  const [project] = await db.insert(projectsTable)
    .values({ name })
    .returning();
  await db.insert(projectSitesTable).values({ projectId: project.id, siteId });

  const [site] = await db
    .select({ id: sitesTable.id, name: sitesTable.name })
    .from(sitesTable)
    .where(eq(sitesTable.id, siteId))
    .limit(1);
  res.status(201).json({
    ...project,
    sites: site ? [site] : [],
    createdAt: project.createdAt.toISOString(),
  });
});

router.post("/projects/:id/sites", requireAuth, async (req, res): Promise<void> => {
  const userId = Number(req.session!.user!.id);
  const role = req.session!.user!.role;
  const perms = await getEffectivePermissions(userId, role);
  if (!perms.canCreateProject) {
    res.status(403).json({ error: "You don't have permission to associate projects" });
    return;
  }
  const projectId = parseInt(String(req.params["id"]), 10);
  const siteId = Number(req.body?.siteId);
  if (!Number.isInteger(projectId) || !Number.isInteger(siteId) || siteId <= 0) {
    res.status(400).json({ error: "Valid project and site IDs are required" });
    return;
  }
  const [project] = await db.select({ id: projectsTable.id }).from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1);
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  if (!(await canAccessSite(userId, String(userId), role, siteId))) {
    res.status(403).json({ error: "You do not have access to the specified site" });
    return;
  }
  await db.insert(projectSitesTable)
    .values({ projectId, siteId })
    .onConflictDoNothing({ target: [projectSitesTable.projectId, projectSitesTable.siteId] });
  res.status(204).send();
});

router.delete("/projects/:id/sites/:siteId", requireAuth, async (req, res): Promise<void> => {
  const userId = Number(req.session!.user!.id);
  const role = req.session!.user!.role;
  const perms = await getEffectivePermissions(userId, role);
  if (!perms.canDeleteProject) {
    res.status(403).json({ error: "You don't have permission to remove project associations" });
    return;
  }
  const projectId = parseInt(String(req.params["id"]), 10);
  const siteId = parseInt(String(req.params["siteId"]), 10);
  if (!Number.isInteger(projectId) || !Number.isInteger(siteId)) {
    res.status(400).json({ error: "Invalid project or site ID" });
    return;
  }
  if (!(await canAccessSite(userId, String(userId), role, siteId))) {
    res.status(403).json({ error: "You do not have access to the specified site" });
    return;
  }
  const [association] = await db
    .select({ id: projectSitesTable.id })
    .from(projectSitesTable)
    .where(and(eq(projectSitesTable.projectId, projectId), eq(projectSitesTable.siteId, siteId)))
    .limit(1);
  if (!association) {
    res.status(404).json({ error: "Project is not associated with this site" });
    return;
  }
  const [scanUsage] = await db
    .select({ id: scanSessionsTable.id })
    .from(scanSessionsTable)
    .where(and(eq(scanSessionsTable.projectId, projectId), eq(scanSessionsTable.siteId, siteId)))
    .limit(1);
  if (scanUsage) {
    res.status(409).json({
      error: "This project/site association is used by existing scans and cannot be removed",
    });
    return;
  }
  await db.delete(projectSitesTable)
    .where(and(eq(projectSitesTable.projectId, projectId), eq(projectSitesTable.siteId, siteId)));
  res.status(204).send();
});

router.get("/projects/:id", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid project ID" });
    return;
  }

  const [project] = await db.select(projectColumns)
    .from(projectsTable)
    .where(eq(projectsTable.id, id));

  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const sites = await db
    .select({ id: sitesTable.id, name: sitesTable.name })
    .from(projectSitesTable)
    .innerJoin(sitesTable, eq(projectSitesTable.siteId, sitesTable.id))
    .where(eq(projectSitesTable.projectId, id));

  res.json({
    ...project,
    sites,
    createdAt: project.createdAt.toISOString(),
  });
});

router.delete("/projects/:id", requireAuth, async (req, res): Promise<void> => {
  const userId = req.session!.user!.id;
  const role = req.session!.user!.role;
  const perms = await getEffectivePermissions(userId, role);
  if (!perms.canDeleteProject) {
    res.status(403).json({ error: "You don't have permission to delete projects" });
    return;
  }

  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid project ID" });
    return;
  }

  await db.delete(projectsTable).where(eq(projectsTable.id, id));
  res.status(204).send();
});

export default router;
