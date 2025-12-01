import { Pool } from "pg";

// Determine the connection string: use the secure DATABASE_URL from environment variables (Vercel)
// or fallback to a local development connection string if needed, although using the ENV variable
// in development too is preferred practice.
const connectionString =
  process.env.DATABASE_URL ||
  "postgresql://postgres:musictutor@localhost:8080/90Database";

// IMPORTANT: Neon requires SSL/TLS. This configuration is essential for Vercel/Node.js connections.
const isProduction = process.env.NODE_ENV === "production";

const pool = new Pool({
  connectionString: connectionString,
  // Use SSL only in production environments (like Vercel) where connectionString includes 'sslmode=require' or similar setup.
  // The 'rejectUnauthorized: false' is often needed to bypass self-signed certificate issues in some environments.
  ssl: isProduction ? { rejectUnauthorized: false } : false,
});

pool.on("error", (err, client) => {
  console.error("Unexpected error on idle client", err);
  process.exit(-1);
});

export default pool;
