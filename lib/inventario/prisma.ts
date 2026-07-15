// Prisma client singleton. The schema is owned by scripts/init.sql; the
// Prisma models in prisma/schema.prisma map onto those tables.
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
