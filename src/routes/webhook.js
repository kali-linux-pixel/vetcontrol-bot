import express from 'express';
import * as baileysManager from '../bot/baileys.js';
import { sendAutomatedReminders } from '../scheduler/reminders.js';
import { sql } from '../database/supabase.js';
import { emitToClinic } from '../socket/socket.js';

const router = express.Router();

/**
 * POST /session/init
 */
router.post('/session/init', async (req, res) => {
  const { clinicId } = req.body;
  if (!clinicId) {
    return res.status(400).json({ success: false, error: 'clinicId is required' });
  }
  try {
    await baileysManager.startSession(clinicId);
    res.json({ success: true, message: 'Session initialization triggered' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /session/close
 */
router.post('/session/close', async (req, res) => {
  const { clinicId } = req.body;
  if (!clinicId) {
    return res.status(400).json({ success: false, error: 'clinicId is required' });
  }
  try {
    await baileysManager.closeSession(clinicId);
    res.json({ success: true, message: 'Session closed and logged out' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /session/status/:clinicId
 */
router.get('/session/status/:clinicId', async (req, res) => {
  const { clinicId } = req.params;
  try {
    const sessionRecord = await sql`
      SELECT status, qr FROM whatsapp_sessions
      WHERE clinic_id = ${clinicId}
      LIMIT 1
    `;
    if (sessionRecord.length === 0) {
      return res.json({ success: true, status: 'disconnected', qr: null });
    }
    res.json({
      success: true,
      status: sessionRecord[0].status,
      qr: sessionRecord[0].qr
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /message/send
 * Sends a manual WhatsApp message from dashboard (receptionist agent).
 */
router.post('/message/send', async (req, res) => {
  const { clinicId, phone, message } = req.body;
  if (!clinicId || !phone || !message) {
    return res.status(400).json({ success: false, error: 'clinicId, phone, and message are required' });
  }
  try {
    const sent = await baileysManager.sendMessage(clinicId, phone, message);
    res.json({ success: true, data: sent });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /conversations/:clinicId
 * Fetches all unique conversations for a clinic.
 */
router.get('/conversations/:clinicId', async (req, res) => {
  const { clinicId } = req.params;
  try {
    const conversations = await sql`
      WITH uniq_conv AS (
        SELECT DISTINCT ON (phone)
          phone,
          message as last_message,
          role as last_message_role,
          status as last_message_status,
          created_at as last_message_time
        FROM messages
        WHERE clinic_id = ${clinicId}
        ORDER BY phone, created_at DESC
      )
      SELECT 
        uc.*,
        c.name as client_name,
        c.id as client_id,
        c.conversation_mode,
        c.last_seen_at,
        (
          SELECT COUNT(*)::int FROM messages m2
          WHERE m2.clinic_id = ${clinicId} 
            AND m2.phone = uc.phone 
            AND m2.role = 'user' 
            AND m2.status != 'read'
        ) as unread_count
      FROM uniq_conv uc
      LEFT JOIN clients c ON uc.phone = c.phone AND c.organization_id = ${clinicId}
      ORDER BY uc.last_message_time DESC
    `;
    res.json({ success: true, data: conversations });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /messages/:clinicId/:phone
 * Fetches all messages for a specific client chat thread.
 * Automatically marks all incoming user messages as read when loaded.
 */
router.get('/messages/:clinicId/:phone', async (req, res) => {
  const { clinicId, phone } = req.params;
  try {
    // Mark client messages as read
    await sql`
      UPDATE messages 
      SET status = 'read'
      WHERE clinic_id = ${clinicId} AND phone = ${phone} AND role = 'user' AND status != 'read'
    `;

    // Fetch messages list
    const messages = await sql`
      SELECT * FROM messages
      WHERE clinic_id = ${clinicId} AND phone = ${phone}
      ORDER BY created_at ASC
    `;

    res.json({ success: true, data: messages });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /conversation/mode
 * Toggles AI vs Human mode.
 */
router.post('/conversation/mode', async (req, res) => {
  const { clinicId, phone, mode } = req.body;
  if (!clinicId || !phone || !mode) {
    return res.status(400).json({ success: false, error: 'clinicId, phone, and mode are required' });
  }
  try {
    const updated = await sql`
      UPDATE clients 
      SET conversation_mode = ${mode}
      WHERE organization_id = ${clinicId} AND phone = ${phone}
      RETURNING *
    `;

    // Broadcast change via Socket.io
    const eventName = mode === 'human' ? 'conversation_taken' : 'conversation_ai_enabled';
    emitToClinic(clinicId, eventName, { phone, mode });

    res.json({ success: true, data: updated[0] || null });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /client/notes
 * Saves internal clinic notes.
 */
router.post('/client/notes', async (req, res) => {
  const { clinicId, clientId, notes } = req.body;
  if (!clinicId || !clientId) {
    return res.status(400).json({ success: false, error: 'clinicId and clientId are required' });
  }
  try {
    const updated = await sql`
      UPDATE clients
      SET internal_notes = ${notes}
      WHERE organization_id = ${clinicId} AND id = ${clientId}
      RETURNING id, internal_notes
    `;
    res.json({ success: true, data: updated[0] || null });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /client/profile/:clinicId/:clientId
 * Returns detailed client profile, pets, and appointments context.
 */
router.get('/client/profile/:clinicId/:clientId', async (req, res) => {
  const { clinicId, clientId } = req.params;
  try {
    const client = await sql`
      SELECT id, name, phone, email, dni, address, joined_date, conversation_mode, internal_notes, last_seen_at 
      FROM clients 
      WHERE organization_id = ${clinicId} AND id = ${clientId} 
      LIMIT 1
    `;
    if (client.length === 0) {
      return res.status(404).json({ success: false, error: 'Client not found' });
    }

    const pets = await sql`
      SELECT id, name, species, breed, age, sex, weight, avatar_url 
      FROM pets 
      WHERE organization_id = ${clinicId} AND client_id = ${clientId}
    `;

    let appointments = [];
    const petIds = pets.map(p => p.id);
    if (petIds.length > 0) {
      appointments = await sql`
        SELECT a.id, a.pet_id, a.date, a.time, a.type, a.status, a.veterinarian, a.notes, p.name as pet_name
        FROM appointments a
        JOIN pets p ON a.pet_id = p.id
        WHERE a.organization_id = ${clinicId} AND a.pet_id IN (${petIds})
        ORDER BY a.date DESC, a.time DESC
      `;
    }

    res.json({
      success: true,
      data: {
        client: client[0],
        pets,
        appointments
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /test-reminder
 */
router.get('/test-reminder', async (req, res) => {
  try {
    await sendAutomatedReminders();
    res.json({ success: true, message: 'Manual reminders check triggered successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
