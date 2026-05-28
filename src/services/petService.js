import { sql } from '../database/supabase.js';

/**
 * Gets all pets for a specific client.
 */
export async function getPetsByClientId(clientId, clinicId) {
  try {
    return await sql`
      SELECT * FROM pets 
      WHERE organization_id = ${clinicId} AND client_id = ${clientId}
    `;
  } catch (err) {
    console.error('Error in getPetsByClientId:', err.message);
    return [];
  }
}

/**
 * Find a specific pet by name for a client. Case-insensitive.
 */
export async function getPetByNameAndClient(name, clientId, clinicId) {
  try {
    const pets = await sql`
      SELECT * FROM pets 
      WHERE organization_id = ${clinicId} 
        AND client_id = ${clientId} 
        AND LOWER(name) = ${name.toLowerCase()}
      LIMIT 1
    `;
    return pets.length > 0 ? pets[0] : null;
  } catch (err) {
    console.error('Error in getPetByNameAndClient:', err.message);
    return null;
  }
}

/**
 * Creates a new pet.
 */
export async function createPet({ name, species, breed = 'Mestizo', age = 'Desconocido', sex = 'Macho', weight = null, clientId, clinicId }) {
  try {
    const newPets = await sql`
      INSERT INTO pets (organization_id, client_id, name, species, breed, age, sex, weight)
      VALUES (${clinicId}, ${clientId}, ${name}, ${species}, ${breed}, ${age}, ${sex}, ${weight})
      RETURNING *
    `;
    return newPets[0];
  } catch (err) {
    console.error('Error creating pet:', err.message);
    throw err;
  }
}
