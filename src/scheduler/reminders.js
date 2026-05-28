import cron from 'node-cron';
import { sql } from '../database/supabase.js';
import { sendMessage } from '../bot/baileys.js';

/**
 * Checks for scheduled appointments for tomorrow and sends reminders to clients.
 */
export async function sendAutomatedReminders() {
  try {
    console.log('⏰ Running automated reminder job...');

    // Calculate tomorrow's date in YYYY-MM-DD format
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];

    // Find all appointments scheduled for tomorrow
    const appointments = await sql`
      SELECT 
        a.id as appointment_id,
        a.organization_id as clinic_id,
        a.date,
        a.time,
        p.name as pet_name,
        c.name as client_name,
        c.phone as client_phone
      FROM appointments a
      JOIN pets p ON a.pet_id = p.id
      JOIN clients c ON p.client_id = c.id
      WHERE a.date = ${tomorrowStr} AND a.status = 'Scheduled'
    `;

    console.log(`🔎 Found ${appointments.length} appointments for tomorrow (${tomorrowStr}).`);

    for (const appt of appointments) {
      const { clinic_id, client_name, pet_name, client_phone, time, appointment_id } = appt;

      // Clean phone number
      const phoneDigits = client_phone.replace(/\D/g, '');
      if (!phoneDigits) continue;

      // Check if we already sent a reminder for this appointment today
      const alreadySent = await sql`
        SELECT id FROM whatsapp_queue
        WHERE organization_id = ${clinic_id} 
          AND phone = ${phoneDigits}
          AND message LIKE ${`%recordamos la cita de ${pet_name}%`}
          AND created_at >= NOW() - interval '20 hours'
        LIMIT 1
      `;

      if (alreadySent.length > 0) {
        console.log(`ℹ️ Reminder already sent today to +${phoneDigits} for ${pet_name}. Skipping.`);
        continue;
      }

      // Format reminder message
      const message = `Hola ${client_name} 👋\n\nLe recordamos la cita de ${pet_name} mañana a las ${time}.\n\n¿Confirma asistencia?\n\nResponda:\nSI\nNO`;

      try {
        // Send WhatsApp using Baileys
        await sendMessage(clinic_id, phoneDigits, message);

        // Log to whatsapp_queue (matching panel schemas)
        await sql`
          INSERT INTO whatsapp_queue (organization_id, phone, message, status, scheduled_at, sent_at)
          VALUES (${clinic_id}, ${phoneDigits}, ${message}, 'sent', NOW(), NOW())
        `;

        console.log(`✅ Reminder successfully sent to +${phoneDigits} for ${pet_name}.`);
      } catch (sendErr) {
        console.error(`❌ Failed to send reminder to +${phoneDigits}:`, sendErr.message);
        
        // Log error to whatsapp_queue
        await sql`
          INSERT INTO whatsapp_queue (organization_id, phone, message, status, error_message, attempts)
          VALUES (${clinic_id}, ${phoneDigits}, ${message}, 'error', ${sendErr.message}, 1)
        `;
      }
    }
  } catch (err) {
    console.error('Error in automated reminder cron:', err.message);
  }
}

/**
 * Initializes the node-cron scheduler.
 * Runs once every hour.
 */
export function initScheduler() {
  // Pattern: runs at minute 0 of every hour
  cron.schedule('0 * * * *', () => {
    sendAutomatedReminders();
  });
  console.log('📅 Reminder Scheduler initialized (running hourly).');
}
