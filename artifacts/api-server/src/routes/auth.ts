import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { db } from "@workspace/db";
import { usersTable, userGroupMembersTable, userGroupsTable } from "@workspace/db";
import { eq, or } from "drizzle-orm";
import { logger } from "../lib/logger";
import { sendInviteEmail, sendPasswordResetEmail } from "../lib/email";
import { requireAuth } from "../middlewares/authMiddleware";
import { getEffectivePermissions } from "../lib/permissions";
import { ObjectStorageService } from "../lib/objectStorage";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();
const userColumns = {
  id: usersTable.id, email: usersTable.email, username: usersTable.username, passwordHash: usersTable.passwordHash,
  fullName: usersTable.fullName, profileImageUrl: usersTable.profileImageUrl, profileImageContentType: usersTable.profileImageContentType,
  role: usersTable.role, isActive: usersTable.isActive, mustResetPassword: usersTable.mustResetPassword,
  inviteToken: usersTable.inviteToken, inviteTokenExpiresAt: usersTable.inviteTokenExpiresAt, createdAt: usersTable.createdAt, updatedAt: usersTable.updatedAt,
};

// POST /api/auth/login
router.post("/auth/login", async (req, res): Promise<void> => {
  const { username, password } = req.body ?? {};
  if (!username || !password) {
    res.status(400).json({ error: "Username and password are required" });
    return;
  }

  const [user] = await db
    .select(userColumns)
    .from(usersTable)
    .where(or(eq(usersTable.username, username), eq(usersTable.email, username)));

  if (!user || !user.isActive) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  req.session.user = {
    id: user.id,
    username: user.username,
    email: user.email,
    fullName: user.fullName,
    profileImageUrl: user.profileImageUrl,
    role: user.role,
    mustResetPassword: user.mustResetPassword,
  };

  res.json({
    id: user.id,
    username: user.username,
    email: user.email,
    fullName: user.fullName,
    profileImageUrl: user.profileImageUrl,
    role: user.role,
    mustResetPassword: user.mustResetPassword,
  });
});

// POST /api/auth/logout
router.post("/auth/logout", (req, res): void => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.json({ ok: true });
  });
});

// GET /api/auth/me
router.get("/auth/me", async (req, res): Promise<void> => {
  if (!req.session?.user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const [user] = await db
    .select({
      id: usersTable.id,
      username: usersTable.username,
      email: usersTable.email,
      fullName: usersTable.fullName,
      profileImageUrl: usersTable.profileImageUrl,
      role: usersTable.role,
      mustResetPassword: usersTable.mustResetPassword,
    })
    .from(usersTable)
    .where(eq(usersTable.id, req.session.user.id));
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  req.session.user = user;
  res.json(user);
});

router.post("/auth/profile-image/upload-url", requireAuth, async (req, res): Promise<void> => {
  const { size, contentType } = req.body ?? {};
  if (
    typeof size !== "number" ||
    !Number.isFinite(size) ||
    size <= 0 ||
    size > 5 * 1024 * 1024 ||
    typeof contentType !== "string" ||
    !["image/jpeg", "image/png", "image/webp", "image/gif"].includes(contentType)
  ) {
    res.status(400).json({ error: "Profile image must be a JPG, PNG, WebP, or GIF no larger than 5 MB." });
    return;
  }
  try {
    const uploadURL = await objectStorageService.getObjectEntityUploadURL();
    res.json({
      uploadURL,
      objectPath: objectStorageService.normalizeObjectEntityPath(uploadURL),
    });
  } catch (error) {
    logger.error({ err: error }, "Profile image upload URL failed");
    res.status(500).json({ error: "Unable to prepare profile image upload." });
  }
});

router.put("/auth/profile-image", requireAuth, async (req, res): Promise<void> => {
  const { objectPath, contentType } = req.body ?? {};
  if (
    typeof objectPath !== "string" ||
    !objectPath.startsWith("/objects/") ||
    typeof contentType !== "string" ||
    !["image/jpeg", "image/png", "image/webp", "image/gif"].includes(contentType)
  ) {
    res.status(400).json({ error: "A valid uploaded profile image is required." });
    return;
  }
  try {
    await objectStorageService.getObjectEntityFile(objectPath);
    const userId = req.session!.user!.id;
    const [updated] = await db.update(usersTable)
      .set({ profileImageUrl: objectPath, profileImageContentType: contentType, updatedAt: new Date() })
      .where(eq(usersTable.id, userId))
      .returning({ profileImageUrl: usersTable.profileImageUrl });
    req.session!.user!.profileImageUrl = updated?.profileImageUrl ?? null;
    res.json({ profileImageUrl: updated?.profileImageUrl ?? null });
  } catch (error) {
    logger.error({ err: error }, "Profile image save failed");
    res.status(400).json({ error: "Unable to save profile image." });
  }
});

router.delete("/auth/profile-image", requireAuth, async (req, res): Promise<void> => {
  const userId = req.session!.user!.id;
  await db.update(usersTable)
    .set({ profileImageUrl: null, profileImageContentType: null, updatedAt: new Date() })
    .where(eq(usersTable.id, userId));
  req.session!.user!.profileImageUrl = null;
  res.json({ profileImageUrl: null });
});

router.get("/storage/profile-image", requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = req.session!.user!.id;
    const [user] = await db.select({
      profileImageUrl: usersTable.profileImageUrl,
      profileImageContentType: usersTable.profileImageContentType,
    })
      .from(usersTable)
      .where(eq(usersTable.id, userId));
    if (!user?.profileImageUrl) {
      res.status(404).end();
      return;
    }
    const file = await objectStorageService.getObjectEntityFile(user.profileImageUrl);
    const response = await objectStorageService.downloadObject(file, 300, user.profileImageContentType ?? undefined);
    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    if (response.body) {
      const { Readable } = await import("stream");
      Readable.fromWeb(response.body as any).pipe(res);
    } else {
      res.end();
    }
  } catch {
    res.status(404).end();
  }
});

// GET /api/auth/my-permissions — returns effective permissions for the logged-in user
router.get("/auth/my-permissions", requireAuth, async (req, res): Promise<void> => {
  const userId = req.session!.user!.id;
  const role = req.session!.user!.role;
  const perms = await getEffectivePermissions(userId, role);
  res.json(perms);
});

// GET /api/auth/my-groups — returns groups the current user belongs to (includes roleLabel)
router.get("/auth/my-groups", requireAuth, async (req, res): Promise<void> => {
  const userId = req.session!.user!.id;

  const rows = await db
    .select({
      id: userGroupsTable.id,
      name: userGroupsTable.name,
      roleLabel: userGroupsTable.roleLabel,
    })
    .from(userGroupMembersTable)
    .leftJoin(userGroupsTable, eq(userGroupMembersTable.groupId, userGroupsTable.id))
    .where(eq(userGroupMembersTable.userId, userId));

  res.json(rows.filter(r => r.id !== null));
});

// POST /api/auth/reset-password  — with invite/reset token
router.post("/auth/reset-password", async (req, res): Promise<void> => {
  const { token, password } = req.body ?? {};
  if (!token || !password) {
    res.status(400).json({ error: "Token and password are required" });
    return;
  }
  if (typeof password !== "string" || password.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters" });
    return;
  }

  const [user] = await db
    .select(userColumns)
    .from(usersTable)
    .where(eq(usersTable.inviteToken, token));

  if (!user) {
    res.status(400).json({ error: "Invalid or expired reset token" });
    return;
  }

  if (user.inviteTokenExpiresAt && user.inviteTokenExpiresAt < new Date()) {
    res.status(400).json({ error: "Reset token has expired" });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await db
    .update(usersTable)
    .set({
      passwordHash,
      mustResetPassword: false,
      inviteToken: null,
      inviteTokenExpiresAt: null,
      updatedAt: new Date(),
    })
    .where(eq(usersTable.id, user.id));

  res.json({ ok: true });
});

// POST /api/auth/change-password — when already logged in
router.post("/auth/change-password", requireAuth, async (req, res): Promise<void> => {
  const { currentPassword, newPassword } = req.body ?? {};
  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: "Both current and new password are required" });
    return;
  }
  if (typeof newPassword !== "string" || newPassword.length < 8) {
    res.status(400).json({ error: "New password must be at least 8 characters" });
    return;
  }

  const userId = req.session!.user!.id;
  const [user] = await db.select(userColumns).from(usersTable).where(eq(usersTable.id, userId));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) {
    res.status(400).json({ error: "Current password is incorrect" });
    return;
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await db
    .update(usersTable)
    .set({ passwordHash, mustResetPassword: false, updatedAt: new Date() })
    .where(eq(usersTable.id, userId));

  req.session!.user!.mustResetPassword = false;
  res.json({ ok: true });
});

// POST /api/auth/forgot-password  — request password reset via email
router.post("/auth/forgot-password", async (req, res): Promise<void> => {
  const { email } = req.body ?? {};
  if (!email) {
    res.status(400).json({ error: "Email is required" });
    return;
  }

  const [user] = await db.select(userColumns).from(usersTable).where(eq(usersTable.email, email));
  // Always return success to avoid user enumeration
  if (!user) {
    res.json({ ok: true });
    return;
  }

  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  await db.update(usersTable).set({ inviteToken: token, inviteTokenExpiresAt: expiresAt, updatedAt: new Date() }).where(eq(usersTable.id, user.id));

  const proto = String(req.headers["x-forwarded-proto"] ?? "https");
  const host = req.headers.host || "";
  const basePath = process.env.BASE_PATH || "";
  const appUrl = `${proto}://${host}${basePath}`;

  await sendPasswordResetEmail({ to: user.email, fullName: user.fullName, resetToken: token, appUrl });
  res.json({ ok: true });
});

export default router;
