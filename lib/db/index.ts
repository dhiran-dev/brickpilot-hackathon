import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

// Single shared connection pool for the app.
const client = postgres(url, { max: 10 });

export const db = drizzle(client);
export { client };
