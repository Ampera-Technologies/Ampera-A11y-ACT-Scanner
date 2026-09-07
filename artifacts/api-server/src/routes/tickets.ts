import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { supportTicketsTable, ticketRepliesTable, usersTable } from "@workspace/db";
import { eq, desc, asc } from "drizzle-orm";
import { createNotification } from "../lib/notifications";
import { requireAuth, requireAdmin } from "../middlewares/authMiddleware";

const router: IRouter = Router();
const ticketColumns = {
  id: supportTicketsTable.id, userId: supportTicketsTable.userId, subject: supportTicketsTable.subject,
  description: supportTicketsTable.description, status: supportTicketsTable.status, priority: supportTicketsTable.priority,
  createdAt: supportTicketsTable.createdAt, updatedAt: supportTicketsTable.updatedAt,
};

// GET /api/tickets — list tickets (admin: all; user: own)
router.get("/tickets", requireAuth, async (req, res): Promise<void> => {
  const user = req.session!.user!;
  const isAdmin = user.role === "super_admin" || user.role === "admin";

  const tickets = isAdmin
    ? await db
        .select({
          id: supportTicketsTable.id,
          subject: supportTicketsTable.subject,
          description: supportTicketsTable.description,
          status: supportTicketsTable.status,
          priority: supportTicketsTable.priority,
          createdAt: supportTicketsTable.createdAt,
          updatedAt: supportTicketsTable.updatedAt,
          userId: supportTicketsTable.userId,
          userFullName: usersTable.fullName,
          userEmail: usersTable.email,
        })
        .from(supportTicketsTable)
        .leftJoin(usersTable, eq(supportTicketsTable.userId, usersTable.id))
        .orderBy(desc(supportTicketsTable.createdAt))
    : await db
        .select({
          id: supportTicketsTable.id,
          subject: supportTicketsTable.subject,
          description: supportTicketsTable.description,
          status: supportTicketsTable.status,
          priority: supportTicketsTable.priority,
          createdAt: supportTicketsTable.createdAt,
          updatedAt: supportTicketsTable.updatedAt,
          userId: supportTicketsTable.userId,
          userFullName: usersTable.fullName,
          userEmail: usersTable.email,
        })
        .from(supportTicketsTable)
        .leftJoin(usersTable, eq(supportTicketsTable.userId, usersTable.id))
        .where(eq(supportTicketsTable.userId, user.id))
        .orderBy(desc(supportTicketsTable.createdAt));

  res.json(tickets.map((t) => ({ ...t, createdAt: t.createdAt.toISOString(), updatedAt: t.updatedAt.toISOString() })));
});

// POST /api/tickets — create ticket
router.post("/tickets", requireAuth, async (req, res): Promise<void> => {
  const { subject, description, priority } = req.body ?? {};
  if (!subject || !description) {
    res.status(400).json({ error: "Subject and description are required" });
    return;
  }

  const validPriorities = ["low", "medium", "high", "critical"];
  const finalPriority = validPriorities.includes(priority) ? priority : "medium";

  const [ticket] = await db
    .insert(supportTicketsTable)
    .values({
      userId: req.session!.user!.id,
      subject,
      description,
      priority: finalPriority,
      status: "open",
    })
    .returning();

  const isFeatReq = subject.startsWith("[Feature Request]");
  const displaySubject = subject.replace(/^\[Feature Request\]\s*/, "");
  createNotification({
    type:      isFeatReq ? "feature_request" : "ticket",
    title:     isFeatReq ? `New feature request: ${displaySubject}` : `New support ticket: ${subject}`,
    body:      description.length > 120 ? description.slice(0, 117) + "…" : description,
    link:      `/admin/inbox`,
    actorId:   req.session!.user!.id,
    actorName: req.session!.user!.fullName ?? req.session!.user!.username,
  }).catch(() => {});

  res.status(201).json({ ...ticket, createdAt: ticket.createdAt.toISOString(), updatedAt: ticket.updatedAt.toISOString() });
});

// GET /api/tickets/:id — get ticket with replies
router.get("/tickets/:id", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ticket ID" }); return; }

  const user = req.session!.user!;
  const isAdmin = user.role === "super_admin" || user.role === "admin";

  const [ticket] = await db
    .select({
      id: supportTicketsTable.id,
      subject: supportTicketsTable.subject,
      description: supportTicketsTable.description,
      status: supportTicketsTable.status,
      priority: supportTicketsTable.priority,
      createdAt: supportTicketsTable.createdAt,
      updatedAt: supportTicketsTable.updatedAt,
      userId: supportTicketsTable.userId,
      userFullName: usersTable.fullName,
      userEmail: usersTable.email,
    })
    .from(supportTicketsTable)
    .leftJoin(usersTable, eq(supportTicketsTable.userId, usersTable.id))
    .where(eq(supportTicketsTable.id, id));

  if (!ticket) { res.status(404).json({ error: "Ticket not found" }); return; }
  if (!isAdmin && ticket.userId !== user.id) { res.status(403).json({ error: "Forbidden" }); return; }

  const replies = await db
    .select({
      id: ticketRepliesTable.id,
      message: ticketRepliesTable.message,
      isAdmin: ticketRepliesTable.isAdmin,
      createdAt: ticketRepliesTable.createdAt,
      userId: ticketRepliesTable.userId,
      authorName: usersTable.fullName,
    })
    .from(ticketRepliesTable)
    .leftJoin(usersTable, eq(ticketRepliesTable.userId, usersTable.id))
    .where(eq(ticketRepliesTable.ticketId, id))
    .orderBy(asc(ticketRepliesTable.createdAt));

  res.json({
    ...ticket,
    createdAt: ticket.createdAt.toISOString(),
    updatedAt: ticket.updatedAt.toISOString(),
    replies: replies.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
  });
});

// PUT /api/tickets/:id — update status (admin) or description (owner)
router.put("/tickets/:id", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ticket ID" }); return; }

  const user = req.session!.user!;
  const isAdmin = user.role === "super_admin" || user.role === "admin";

  const [ticket] = await db.select(ticketColumns).from(supportTicketsTable).where(eq(supportTicketsTable.id, id));
  if (!ticket) { res.status(404).json({ error: "Ticket not found" }); return; }
  if (!isAdmin && ticket.userId !== user.id) { res.status(403).json({ error: "Forbidden" }); return; }

  const updates: Partial<typeof supportTicketsTable.$inferInsert> = { updatedAt: new Date() };
  const validStatuses = ["open", "in_progress", "resolved", "closed"];
  const validPriorities = ["low", "medium", "high", "critical"];

  if (isAdmin && req.body?.status && validStatuses.includes(req.body.status)) updates.status = req.body.status;
  if (isAdmin && req.body?.priority && validPriorities.includes(req.body.priority)) updates.priority = req.body.priority;
  if (req.body?.subject && ticket.userId === user.id) updates.subject = req.body.subject;

  const [updated] = await db.update(supportTicketsTable).set(updates).where(eq(supportTicketsTable.id, id)).returning();
  res.json({ ...updated, createdAt: updated.createdAt.toISOString(), updatedAt: updated.updatedAt.toISOString() });
});

// POST /api/tickets/:id/replies — add reply
router.post("/tickets/:id/replies", requireAuth, async (req, res): Promise<void> => {
  const ticketId = parseInt(req.params["id"] as string, 10);
  if (isNaN(ticketId)) { res.status(400).json({ error: "Invalid ticket ID" }); return; }

  const { message } = req.body ?? {};
  if (!message) { res.status(400).json({ error: "Message is required" }); return; }

  const user = req.session!.user!;
  const isAdmin = user.role === "super_admin" || user.role === "admin";

  const [ticket] = await db.select(ticketColumns).from(supportTicketsTable).where(eq(supportTicketsTable.id, ticketId));
  if (!ticket) { res.status(404).json({ error: "Ticket not found" }); return; }
  if (!isAdmin && ticket.userId !== user.id) { res.status(403).json({ error: "Forbidden" }); return; }

  const [reply] = await db
    .insert(ticketRepliesTable)
    .values({ ticketId, userId: user.id, message, isAdmin })
    .returning();

  // Update ticket updatedAt and optionally status
  await db.update(supportTicketsTable).set({ updatedAt: new Date(), status: isAdmin && ticket.status === "open" ? "in_progress" : ticket.status }).where(eq(supportTicketsTable.id, ticketId));

  res.status(201).json({ ...reply, createdAt: reply.createdAt.toISOString() });
});

export default router;
