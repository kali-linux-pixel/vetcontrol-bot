import { sql } from '../database/supabase.js';

/**
 * Checks if a pet already has an appointment at the given date and time.
 */
export async function hasDuplicateAppointment(petId, date, time, clinicId) {
  try {
    const appts = await sql`
      SELECT id FROM appointments
      WHERE organization_id = ${clinicId} 
        AND pet_id = ${petId}
        AND date = ${date}
        AND time = ${time}
        AND status != 'Cancelled'
      LIMIT 1
    `;
    return appts.length > 0;
  } catch (err) {
    console.error('Error checking duplicate appointment:', err.message);
    return false;
  }
}

/**
 * Creates a new appointment.
 * Ensures the status and type match the database constraints.
 */
export async function createAppointment({ petId, date, time, type = 'Consultation', status = 'Scheduled', veterinarian = 'Veterinario General', notes = null, clinicId }) {
  try {
    // Validate database constraints
    const allowedTypes = ['Consultation', 'Surgery', 'Vaccination', 'Check-up', 'Dental', 'Grooming'];
    const allowedStatuses = ['Scheduled', 'Checked-in', 'In-Progress', 'Completed', 'Cancelled'];

    const dbType = allowedTypes.includes(type) ? type : 'Consultation';
    const dbStatus = allowedStatuses.includes(status) ? status : 'Scheduled';

    const newAppts = await sql`
      INSERT INTO appointments (organization_id, pet_id, date, time, type, status, veterinarian, notes)
      VALUES (${clinicId}, ${petId}, ${date}, ${time}, ${dbType}, ${dbStatus}, ${veterinarian}, ${notes})
      RETURNING *
    `;
    return newAppts[0];
  } catch (err) {
    console.error('Error creating appointment:', err.message);
    throw err;
  }
}

/**
 * Cancels an appointment.
 */
export async function cancelAppointment(appointmentId, clinicId) {
  try {
    const updated = await sql`
      UPDATE appointments 
      SET status = 'Cancelled' 
      WHERE id = ${appointmentId} AND organization_id = ${clinicId}
      RETURNING *
    `;
    return updated.length > 0 ? updated[0] : null;
  } catch (err) {
    console.error('Error cancelling appointment:', err.message);
    throw err;
  }
}

/**
 * Cancels the most recent active appointment for a pet.
 * Useful when client requests cancellation without specifying ID.
 */
export async function cancelLastAppointmentForPet(petId, clinicId) {
  try {
    const active = await sql`
      SELECT id FROM appointments 
      WHERE pet_id = ${petId} AND organization_id = ${clinicId} AND status = 'Scheduled'
      ORDER BY date DESC, time DESC
      LIMIT 1
    `;
    if (active.length === 0) return null;
    return await cancelAppointment(active[0].id, clinicId);
  } catch (err) {
    console.error('Error cancelling last appointment:', err.message);
    throw err;
  }
}

/**
 * Confirms an appointment (updates status to 'Checked-in').
 */
export async function confirmAppointment(appointmentId, clinicId) {
  try {
    const updated = await sql`
      UPDATE appointments 
      SET status = 'Checked-in' 
      WHERE id = ${appointmentId} AND organization_id = ${clinicId}
      RETURNING *
    `;
    return updated.length > 0 ? updated[0] : null;
  } catch (err) {
    console.error('Error confirming appointment:', err.message);
    throw err;
  }
}

/**
 * Confirms the most recent active appointment for a pet.
 * Useful when client replies "SI" to confirmation message.
 */
export async function confirmLastAppointmentForPet(petId, clinicId) {
  try {
    const active = await sql`
      SELECT id FROM appointments 
      WHERE pet_id = ${petId} AND organization_id = ${clinicId} AND status = 'Scheduled'
      ORDER BY date DESC, time DESC
      LIMIT 1
    `;
    if (active.length === 0) return null;
    return await confirmAppointment(active[0].id, clinicId);
  } catch (err) {
    console.error('Error confirming last appointment:', err.message);
    throw err;
  }
}

/**
 * Reschedules an appointment.
 */
export async function rescheduleAppointment(appointmentId, newDate, newTime, clinicId) {
  try {
    const updated = await sql`
      UPDATE appointments 
      SET date = ${newDate}, time = ${newTime}, status = 'Scheduled'
      WHERE id = ${appointmentId} AND organization_id = ${clinicId}
      RETURNING *
    `;
    return updated.length > 0 ? updated[0] : null;
  } catch (err) {
    console.error('Error rescheduling appointment:', err.message);
    throw err;
  }
}

/**
 * Reschedules the last scheduled appointment for a pet.
 */
export async function rescheduleLastAppointmentForPet(petId, newDate, newTime, clinicId) {
  try {
    const active = await sql`
      SELECT id FROM appointments 
      WHERE pet_id = ${petId} AND organization_id = ${clinicId} AND status = 'Scheduled'
      ORDER BY date DESC, time DESC
      LIMIT 1
    `;
    if (active.length === 0) return null;
    return await rescheduleAppointment(active[0].id, newDate, newTime, clinicId);
  } catch (err) {
    console.error('Error rescheduling last appointment:', err.message);
    throw err;
  }
}

/**
 * Gets the next scheduled appointment for a pet.
 */
export async function getNextAppointmentForPet(petId, clinicId) {
  try {
    const appts = await sql`
      SELECT * FROM appointments 
      WHERE pet_id = ${petId} AND organization_id = ${clinicId} AND status = 'Scheduled'
      ORDER BY date ASC, time ASC
      LIMIT 1
    `;
    return appts.length > 0 ? appts[0] : null;
  } catch (err) {
    console.error('Error in getNextAppointmentForPet:', err.message);
    return null;
  }
}
