import { getDatabase } from "../../src/lib/booking-store.ts";

/**
 * The app only seeds the admin; customers and cleaners sign up themselves.
 * Tests install these fixed demo accounts (same ids, emails and bcrypt
 * hashes as the old dev seed) right after `resetDatabaseForTesting(db)`.
 *
 *   customer@saiping.com / CustomerPassword123!
 *   cleaner@saiping.com  / CleanerPassword123!   (works every day)
 *   cleaner2@saiping.com / Cleaner2Password123!  (works Monday–Friday)
 */
export function seedTestUsers() {
  getDatabase().exec(`
    INSERT OR IGNORE INTO cleaners (id, name, available_days)
    VALUES ('cleaner-002', 'Mia Cleaner', '1,2,3,4,5');

    INSERT OR IGNORE INTO users (id, email, password_hash, name, role, cleaner_id, status, created_at)
    VALUES
      ('user-cleaner-002', 'cleaner2@saiping.com', '$2b$10$5Pp0MY.PEkPMrpdc2.QSTOvzZ0vMbZF5P5B1nmjwYnomB7rL3Z1ve', 'Mia Cleaner', 'cleaner', 'cleaner-002', 'active', '2026-01-02T00:00:00.000Z'),
      ('user-customer-001', 'customer@saiping.com', '$2b$10$ToODN36bWH81uUipsUSRyusZosG/NjJPRN1HJaEuN8hMY.5W8oqvK', 'Alice Customer', 'customer', NULL, 'active', '2026-01-01T00:00:00.000Z'),
      ('user-cleaner-001', 'cleaner@saiping.com', '$2b$10$L3zIng8mu2OrkBZWfjbtQex/goPsLYva5C3n/XqnMcRD3qt3xH/CO', 'Sai Ping Cleaner', 'cleaner', 'cleaner-001', 'active', '2026-01-01T00:00:00.000Z');
  `);
}
