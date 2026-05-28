import makeWASocket, { useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import path from 'path';
import fs from 'fs';
import { sql } from '../database/supabase.js';
import { emitToClinic } from '../socket/socket.js';
import { handleIncomingMessage } from './messageHandler.js';

// Cache for active client sockets in-memory: { [clinicId]: socket }
const activeSessions = {};

/**
 * Starts or retrieves a Baileys connection for a specific clinic.
 */
export async function startSession(clinicId) {
  if (activeSessions[clinicId]) {
    console.log(`ℹ️ WhatsApp session for clinic ${clinicId} is already running.`);
    return activeSessions[clinicId];
  }

  console.log(`🚀 Starting WhatsApp session for clinic: ${clinicId}`);

  // Create clinic-specific credentials directory
  const sessionDir = path.resolve(process.cwd(), 'sessions', `clinic_${clinicId}`);
  if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true });
  }

  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

  const sock = makeWASocket({
    auth: state,
    browser: ['VetControl Panel', 'Chrome', 'Windows'],
    markOnlineOnConnect: false,
    syncFullHistory: false,
    defaultQueryTimeoutMs: undefined
  });

  activeSessions[clinicId] = sock;

  // Save credentials on update
  sock.ev.on('creds.update', saveCreds);

  // Monitor connection updates
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log(`📱 QR Code generated for clinic: ${clinicId}`);
      // Save QR code to database
      await sql`
        INSERT INTO whatsapp_sessions (clinic_id, status, qr, updated_at)
        VALUES (${clinicId}, 'qr', ${qr}, NOW())
        ON CONFLICT (clinic_id)
        DO UPDATE SET status = 'qr', qr = ${qr}, updated_at = NOW()
      `;
      // Emit to Dashboard via WebSockets
      emitToClinic(clinicId, 'whatsapp_status', { status: 'qr', qr });
    }

    if (connection === 'open') {
      console.log(`✅ WhatsApp Connected for clinic: ${clinicId}`);
      await sql`
        INSERT INTO whatsapp_sessions (clinic_id, status, qr, updated_at)
        VALUES (${clinicId}, 'connected', NULL, NOW())
        ON CONFLICT (clinic_id)
        DO UPDATE SET status = 'connected', qr = NULL, updated_at = NOW()
      `;
      emitToClinic(clinicId, 'whatsapp_status', { status: 'connected' });
    }

    if (connection === 'close') {
      const shouldReconnect = (lastDisconnect?.error instanceof Boom) 
        ? lastDisconnect.error.output?.statusCode !== DisconnectReason.loggedOut
        : true;

      console.log(`❌ WhatsApp connection closed for clinic: ${clinicId}. Reconnecting: ${shouldReconnect}`);

      // Clear from in-memory cache
      delete activeSessions[clinicId];

      // Update Database
      await sql`
        INSERT INTO whatsapp_sessions (clinic_id, status, qr, updated_at)
        VALUES (${clinicId}, 'disconnected', NULL, NOW())
        ON CONFLICT (clinic_id)
        DO UPDATE SET status = 'disconnected', qr = NULL, updated_at = NOW()
      `;
      emitToClinic(clinicId, 'whatsapp_status', { status: 'disconnected' });

      // Attempt reconnection if not logged out
      if (shouldReconnect) {
        setTimeout(() => startSession(clinicId), 5000);
      }
    }
  });

  // Handle incoming messages
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      try {
        await handleIncomingMessage(clinicId, sock, msg);
      } catch (err) {
        console.error('Error handling message:', err);
      }
    }
  });

  return sock;
}

/**
 * Returns the active Baileys socket for a clinic, or starts one if not running.
 */
export async function getSession(clinicId) {
  if (activeSessions[clinicId]) {
    return activeSessions[clinicId];
  }
  return await startSession(clinicId);
}

/**
 * Disconnects and deletes a session for a clinic.
 */
export async function closeSession(clinicId) {
  const sock = activeSessions[clinicId];
  if (sock) {
    try {
      sock.logout();
      sock.end();
    } catch (err) {
      console.error(`Error closing socket for clinic ${clinicId}:`, err.message);
    }
    delete activeSessions[clinicId];
  }

  // Delete local folder to force clean QR next time
  const sessionDir = path.resolve(process.cwd(), 'sessions', `clinic_${clinicId}`);
  if (fs.existsSync(sessionDir)) {
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }

  await sql`
    UPDATE whatsapp_sessions 
    SET status = 'disconnected', qr = NULL, updated_at = NOW()
    WHERE clinic_id = ${clinicId}
  `;
  emitToClinic(clinicId, 'whatsapp_status', { status: 'disconnected' });
}

/**
 * Sends a message using a clinic's Baileys instance.
 */
export async function sendMessage(clinicId, phone, text) {
  try {
    const sock = await getSession(clinicId);
    
    // Format JID for WhatsApp: 51987654321@s.whatsapp.net
    const sanitizedPhone = phone.replace(/\D/g, '');
    const jid = `${sanitizedPhone}@s.whatsapp.net`;

    console.log(`📤 Sending message to ${jid} via clinic ${clinicId}: "${text}"`);
    const sentMsg = await sock.sendMessage(jid, { text });

    // Save outbound message to DB
    await sql`
      INSERT INTO messages (clinic_id, phone, message, role)
      VALUES (${clinicId}, ${phone}, ${text}, 'assistant')
    `;

    // Emit event to socket.io
    emitToClinic(clinicId, 'new_message', {
      clinicId,
      phone,
      message: text,
      role: 'assistant',
      createdAt: new Date().toISOString()
    });

    return sentMsg;
  } catch (err) {
    console.error(`Error sending message for clinic ${clinicId}:`, err.message);
    throw err;
  }
}

/**
 * Startup function to initialize all sessions that were connected.
 */
export async function initializeAllSessions() {
  try {
    const sessions = await sql`
      SELECT clinic_id, status FROM whatsapp_sessions
      WHERE status = 'connected' OR status = 'qr'
    `;
    
    console.log(`🔄 Startup: Restoring ${sessions.length} active WhatsApp sessions...`);
    for (const session of sessions) {
      startSession(session.clinic_id).catch(err => {
        console.error(`Failed to restore session for clinic ${session.clinic_id}:`, err.message);
      });
    }
  } catch (err) {
    console.error('Error during initializeAllSessions:', err.message);
  }
}
