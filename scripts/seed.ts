/**
 * Phase 1 seed: create or refresh the two invite-only demo accounts.
 *
 * Run with: bun run db:seed
 */
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import { db, client } from "@/lib/db";
import { accounts, users } from "@/lib/db/schema";

type SeedUser = {
  email: string;
  password: string;
  name: string;
  role: "owner" | "judge";
};

function required(name: "SEED_OWNER_PASSWORD" | "SEED_JUDGE_PASSWORD") {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be set in .env.local before seeding.`);
  return value;
}

const seedUsers: SeedUser[] = [
  {
    email: process.env.SEED_OWNER_EMAIL?.trim() || "owner@brickpilot.demo",
    password: required("SEED_OWNER_PASSWORD"),
    name: "BrickPilot Owner",
    role: "owner",
  },
  {
    email: process.env.SEED_JUDGE_EMAIL?.trim() || "judge@brickpilot.demo",
    password: required("SEED_JUDGE_PASSWORD"),
    name: "BrickPilot Judge",
    role: "judge",
  },
];

async function seedUser(seed: SeedUser) {
  const now = new Date();
  const password = await hashPassword(seed.password);

  await db.transaction(async (transaction) => {
    const [existing] = await transaction.select().from(users).where(eq(users.email, seed.email)).limit(1);
    const user = existing
      ? (
          await transaction
            .update(users)
            .set({ name: seed.name, role: seed.role, emailVerified: true, updatedAt: now })
            .where(eq(users.id, existing.id))
            .returning()
        )[0]
      : (
          await transaction
            .insert(users)
            .values({
              id: crypto.randomUUID(),
              email: seed.email,
              name: seed.name,
              role: seed.role,
              emailVerified: true,
              createdAt: now,
              updatedAt: now,
            })
            .returning()
        )[0];

    await transaction
      .insert(accounts)
      .values({
        id: crypto.randomUUID(),
        accountId: user.id,
        providerId: "credential",
        userId: user.id,
        password,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [accounts.providerId, accounts.accountId],
        set: { userId: user.id, password, updatedAt: now },
      });
  });
}

try {
  for (const seed of seedUsers) await seedUser(seed);
  console.log(`Seeded ${seedUsers.length} invite-only accounts.`);
} finally {
  await client.end({ timeout: 5 });
}
