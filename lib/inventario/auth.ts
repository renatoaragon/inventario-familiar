// Inventário Familiar: authentication.
//
// First access: a one-time code, after which the member creates a password.
// From then on: phone + password. Password reset is admin-only and blocks
// the account immediately (blocked=true) while revoking every active
// session (sessionEpoch++).
//
// The admin is a regular member with extra powers: whoever owns the phone
// in INVENTARIO_ADMIN_PHONE gets the admin view on top of the member rules,
// so every member feature (payment key, statement, password) applies to the
// admin as well.
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { createHash, randomInt } from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/inventario/prisma";

const rawSecret = process.env.AUTH_SECRET;
if (!rawSecret) throw new Error("AUTH_SECRET environment variable is required");
const SECRET = new TextEncoder().encode(`inventario:${rawSecret}`);
const COOKIE = "inventario_session";
const SESSION_DAYS = 30;
const OTP_TTL_MIN = 10;
const OTP_MAX_ATTEMPTS = 5;

export type InvRole = "HEIR" | "LAWYER";
export type InvSession =
  | { kind: "admin"; viaMember?: boolean }
  | { kind: "member"; memberId: string; name: string; role: InvRole; pixKey: string | null };

/** Phone (digits only, with country code) whose member gets the admin view. */
export const ADMIN_PHONE = (process.env.INVENTARIO_ADMIN_PHONE ?? "").replace(/\D+/g, "");

/** Normalizes a phone to digits only with country code (e.g. 5511987654321). */
export function normalizePhone(v: string): string {
  const digits = v.replace(/\D+/g, "");
  // No country code and looks Brazilian (10-11 digits): assume 55.
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

export function hashCode(code: string): string {
  return createHash("sha256").update(`inv:${code}`).digest("hex");
}

export function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/** Creates a one-time code for the member and returns it in clear text (for delivery). */
export async function createOtp(memberId: string): Promise<string> {
  const code = generateCode();
  await prisma.invOtp.create({
    data: {
      memberId,
      codeHash: hashCode(code),
      expiresAt: new Date(Date.now() + OTP_TTL_MIN * 60_000),
    },
  });
  return code;
}

/** How many codes the member requested in the last 10 minutes (rate limit). */
export async function recentOtpCount(memberId: string): Promise<number> {
  return prisma.invOtp.count({
    where: { memberId, createdAt: { gte: new Date(Date.now() - 10 * 60_000) } },
  });
}

/** Verifies the code; consumes it and returns true when valid. */
export async function verifyOtp(memberId: string, code: string): Promise<boolean> {
  const otp = await prisma.invOtp.findFirst({
    where: { memberId, consumedAt: null, expiresAt: { gte: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (!otp || otp.attempts >= OTP_MAX_ATTEMPTS) return false;
  if (otp.codeHash !== hashCode(code)) {
    await prisma.invOtp.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
    return false;
  }
  await prisma.invOtp.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });
  return true;
}

// ── Passwords (bcrypt) ──────────────────────────────────────────────
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash).catch(() => false);
}

export async function createMemberSession(member: {
  id: string;
  name: string;
  role: string;
  sessionEpoch: number;
}) {
  const token = await new SignJWT({
    mid: member.id,
    name: member.name,
    role: member.role,
    epoch: member.sessionEpoch,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(SECRET);
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV !== "development",
    sameSite: "lax",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
    path: "/",
  });
}

export async function clearMemberSession() {
  const jar = await cookies();
  jar.delete(COOKIE);
}

/** Effective portal session, resolved from the member JWT. */
export async function getInvSession(): Promise<InvSession | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, SECRET);
    const memberId = typeof payload.mid === "string" ? payload.mid : null;
    if (!memberId) return null;
    // Immediate revocation: inactive, blocked (password reset) or stale epoch.
    const member = await prisma.invMember.findUnique({ where: { id: memberId } });
    if (!member || !member.active || member.blocked) return null;
    if ((typeof payload.epoch === "number" ? payload.epoch : -1) !== member.sessionEpoch) return null;
    // The admin member's own login opens the full admin view.
    if (ADMIN_PHONE && member.phone === ADMIN_PHONE) return { kind: "admin", viaMember: true };
    return {
      kind: "member",
      memberId: member.id,
      name: member.name,
      role: member.role as InvRole,
      pixKey: member.pixKey,
    };
  } catch {
    return null;
  }
}

/** API guard: returns the session or a ready 401 Response. */
export async function requireInv(): Promise<InvSession | Response> {
  const s = await getInvSession();
  if (!s) return Response.json({ message: "Não autorizado." }, { status: 401 });
  return s;
}

/** Admin-only guard. */
export async function requireInvAdmin(): Promise<{ kind: "admin" } | Response> {
  const s = await getInvSession();
  if (!s || s.kind !== "admin") {
    return Response.json({ message: "Apenas o administrador." }, { status: 403 });
  }
  return s;
}

/** The admin's own member record (the admin is a member too). */
export async function getAdminMember() {
  if (!ADMIN_PHONE) return null;
  return prisma.invMember.findUnique({ where: { phone: ADMIN_PHONE } });
}

/**
 * Resolves the "effective" member of a request: the session's own member;
 * for the admin, the member given in ?viewAs= ("view as" mode) or, without
 * it, the admin's own member record.
 */
export async function resolveViewMember(
  session: InvSession,
  request: Request,
): Promise<{ memberId: string; name: string; impersonated: boolean } | null> {
  if (session.kind === "member") {
    return { memberId: session.memberId, name: session.name, impersonated: false };
  }
  const viewAs = new URL(request.url).searchParams.get("viewAs");
  if (!viewAs) {
    const self = await getAdminMember();
    if (!self) return null;
    return { memberId: self.id, name: self.name, impersonated: false };
  }
  const member = await prisma.invMember.findUnique({ where: { id: viewAs } });
  if (!member) return null;
  return { memberId: member.id, name: member.name, impersonated: true };
}
