import { Router } from "express";
import { db, pool } from "@workspace/db";
import { notificationsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/authMiddleware";
import { getEffectivePermissions } from "../lib/permissions";

const router = Router();

function isAdmin(role?: string) {
  return role === "super_admin" || role === "admin";
}

async function getNotificationAccess(userId: number) {
  const result = await pool.query<{ role: string; is_active: boolean }>(
    "SELECT role, is_active FROM users WHERE id = $1 LIMIT 1",
    [userId],
  );
  const currentUser = result.rows[0];
  if (!currentUser?.is_active) return null;
  const permissions = await getEffectivePermissions(userId, currentUser.role);
  return {
    isAdmin: isAdmin(currentUser.role),
    canViewIssues: permissions.canViewIssues,
  };
}

// GET /api/notifications
// Every user receives targeted notifications. Admins additionally receive
// legacy/global notifications that have no explicit recipients.
router.get("/notifications", requireAuth, async (req, res): Promise<void> => {
  const user = req.session?.user;
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  try {
    const access = await getNotificationAccess(user.id);
    if (!access) { res.status(403).json({ error: "Account is inactive" }); return; }
    const rows = await pool.query<{
      id: number;
      type: string;
      title: string;
      body: string | null;
      link: string | null;
      actor_id: number | null;
      actor_name: string | null;
      created_at: Date;
      is_read: boolean;
    }>(
      `SELECT n.id, n.type, n.title, n.body, n.link, n.actor_id, n.actor_name, n.created_at,
              (nr.user_id IS NOT NULL) AS is_read
       FROM notifications n
       LEFT JOIN notification_reads nr
         ON nr.notification_id = n.id AND nr.user_id = $1
       WHERE (
          EXISTS (
            SELECT 1 FROM notification_recipients target
            WHERE target.notification_id = n.id AND target.user_id = $1
              AND (n.type <> 'issue' OR $3::boolean = TRUE)
         )
          OR (
            $2::boolean = TRUE
            AND NOT EXISTS (
              SELECT 1 FROM notification_recipients any_target
              WHERE any_target.notification_id = n.id
            )
          )
       )
        AND NOT EXISTS (
          SELECT 1 FROM notification_dismissals dismissed
          WHERE dismissed.notification_id = n.id AND dismissed.user_id = $1
        )
       ORDER BY n.created_at DESC
       LIMIT 60`,
      [user.id, access.isAdmin, access.canViewIssues],
    );

    res.json(
      rows.rows.map((r) => ({
        id:        r.id,
        type:      r.type,
        title:     r.title,
        body:      r.body,
        link:      r.link,
        actorId:   r.actor_id,
        actorName: r.actor_name,
        createdAt: r.created_at.toISOString(),
        isRead:    Boolean(r.is_read),
      })),
    );
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch notifications" });
  }
});

// PUT /api/notifications/read-all — mark every notification as read for current user
router.put("/notifications/read-all", requireAuth, async (req, res): Promise<void> => {
  const user = req.session?.user;
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  try {
    const access = await getNotificationAccess(user.id);
    if (!access) { res.status(403).json({ error: "Account is inactive" }); return; }
    // Insert read records only for notifications visible to this user.
    await pool.query(
      `INSERT INTO notification_reads (notification_id, user_id)
       SELECT n.id, $1
       FROM notifications n
       WHERE (
         EXISTS (
           SELECT 1 FROM notification_recipients target
           WHERE target.notification_id = n.id AND target.user_id = $1
             AND (n.type <> 'issue' OR $3::boolean = TRUE)
         )
         OR (
           $2::boolean = TRUE
           AND NOT EXISTS (
             SELECT 1 FROM notification_recipients any_target
             WHERE any_target.notification_id = n.id
           )
         )
       )
       ON CONFLICT DO NOTHING`,
      [user.id, access.isAdmin, access.canViewIssues],
    );
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to mark all as read" });
  }
});

// PUT /api/notifications/:id/read — mark one notification as read
router.put("/notifications/:id/read", requireAuth, async (req, res): Promise<void> => {
  const user = req.session?.user;
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid notification ID" }); return; }

  try {
    const access = await getNotificationAccess(user.id);
    if (!access) { res.status(403).json({ error: "Account is inactive" }); return; }
    const result = await pool.query(
      `INSERT INTO notification_reads (notification_id, user_id)
       SELECT n.id, $1
       FROM notifications n
       WHERE n.id = $2
         AND (
           EXISTS (
             SELECT 1 FROM notification_recipients target
             WHERE target.notification_id = n.id AND target.user_id = $1
               AND (n.type <> 'issue' OR $4::boolean = TRUE)
           )
           OR (
             $3::boolean = TRUE
             AND NOT EXISTS (
               SELECT 1 FROM notification_recipients any_target
               WHERE any_target.notification_id = n.id
             )
           )
         )
       ON CONFLICT (notification_id, user_id)
       DO UPDATE SET user_id = EXCLUDED.user_id
       RETURNING notification_id`,
      [user.id, id, access.isAdmin, access.canViewIssues],
    );
    if (result.rowCount === 0) {
      res.status(404).json({ error: "Notification not found" });
      return;
    }
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to mark as read" });
  }
});

// DELETE /api/notifications/clear-all — dismiss every visible notification for current user
router.delete("/notifications/clear-all", requireAuth, async (req, res): Promise<void> => {
  const user = req.session?.user;
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  try {
    const access = await getNotificationAccess(user.id);
    if (!access) { res.status(403).json({ error: "Account is inactive" }); return; }
    const result = await pool.query(
      `INSERT INTO notification_dismissals (notification_id, user_id)
       SELECT n.id, $1
       FROM notifications n
       WHERE (
         EXISTS (
           SELECT 1 FROM notification_recipients target
           WHERE target.notification_id = n.id AND target.user_id = $1
             AND (n.type <> 'issue' OR $3::boolean = TRUE)
         )
         OR (
           $2::boolean = TRUE
           AND NOT EXISTS (
             SELECT 1 FROM notification_recipients any_target
             WHERE any_target.notification_id = n.id
           )
         )
       )
       ON CONFLICT DO NOTHING`,
      [user.id, access.isAdmin, access.canViewIssues],
    );
    res.json({ ok: true, cleared: result.rowCount ?? 0 });
  } catch {
    res.status(500).json({ error: "Failed to clear notifications" });
  }
});

// DELETE /api/notifications/:id — super_admin only
router.delete("/notifications/:id", requireAuth, async (req, res): Promise<void> => {
  const user = req.session?.user;
  if (!user || user.role !== "super_admin") { res.status(403).json({ error: "Super admins only" }); return; }

  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  try {
    await db.delete(notificationsTable).where(eq(notificationsTable.id, id));
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to delete notification" });
  }
});

export default router;
