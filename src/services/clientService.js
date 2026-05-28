import { sql } from '../database/supabase.js';

/**
 * Resolves the UUID for the "VetControl Demo" organization.
 * Creates it if it doesn't exist.
 */
export async function getDemoClinicId() {
  try {
    const orgs = await sql`
      SELECT id FROM organizations WHERE name = 'VetControl Demo' LIMIT 1
    `;
    if (orgs.length > 0) {
      return orgs[0].id;
    }
    
    // Create it if not found
    const newOrgs = await sql`
      INSERT INTO organizations (name, subscription_plan, subscription_status, trial_ends_at)
      VALUES ('VetControl Demo', 'free_trial', 'active', NOW() + interval '30 days')
      RETURNING id
    `;
    console.log(`Created fallback 'VetControl Demo' organization with ID: ${newOrgs[0].id}`);
    return newOrgs[0].id;
  } catch (err) {
    console.error('Error resolving VetControl Demo organization:', err.message);
    throw err;
  }
}

/**
 * Searches for a client by phone number within a specific clinic.
 * Sanitizes search to match ending digits.
 */
export async function getClientByPhone(phone, clinicId) {
  try {
    // Extract only digits from phone
    const cleanPhoneDigits = phone.replace(/\D/g, '');
    if (!cleanPhoneDigits) return null;

    // Search where the numeric digits in the database match
    const clients = await sql`
      SELECT * FROM clients 
      WHERE organization_id = ${clinicId}
    `;

    // Perform a flexible match against digits (suffix matching for last 9 digits is common in LATAM)
    const matchedClient = clients.find(c => {
      const dbDigits = c.phone.replace(/\D/g, '');
      return dbDigits.endsWith(cleanPhoneDigits.slice(-9)) || cleanPhoneDigits.endsWith(dbDigits.slice(-9));
    });

    return matchedClient || null;
  } catch (err) {
    console.error('Error in getClientByPhone:', err.message);
    return null;
  }
}

/**
 * Searches for a client by DNI within a specific clinic.
 */
export async function getClientByDni(dni, clinicId) {
  try {
    const clients = await sql`
      SELECT * FROM clients 
      WHERE organization_id = ${clinicId} AND dni = ${dni}
      LIMIT 1
    `;
    return clients.length > 0 ? clients[0] : null;
  } catch (err) {
    console.error('Error in getClientByDni:', err.message);
    return null;
  }
}

/**
 * Creates a new client in a clinic.
 */
export async function createClient({ name, phone, dni = null, email = null, clinicId }) {
  try {
    const newClients = await sql`
      INSERT INTO clients (organization_id, name, phone, dni, email, joined_date)
      VALUES (${clinicId}, ${name}, ${phone}, ${dni}, ${email}, CURRENT_DATE)
      RETURNING *
    `;
    return newClients[0];
  } catch (err) {
    console.error('Error creating client:', err.message);
    throw err;
  }
}
