import { processMessage } from '../ai/orchestrator.js';
import { emitToClinic } from '../socket/socket.js';

// Cooldown tracker: { [phone]: timestamp }
const cooldowns = {};
const COOLDOWN_MS = 3000; // 3 seconds cooldown to prevent rapid multi-triggers

/**
 * Handles an incoming message received via Baileys.
 */
export async function handleIncomingMessage(clinicId, sock, msg) {
  try {
    // 1. Ignore if no message content
    if (!msg.message) return;

    const jid = msg.key.remoteJid;

    // 2. Ignore group chats
    if (jid.endsWith('@g.us')) return;

    // 3. Ignore status updates / broadcast
    if (jid === 'status@broadcast') return;

    // 4. Ignore messages sent by ourselves (me)
    if (msg.key.fromMe) return;

    // 5. Extract text content
    const text = msg.message.conversation || msg.message.extendedTextMessage?.text;
    if (!text || !text.trim()) return;

    // 6. Extract sender phone number from JID
    const phone = jid.split('@')[0];

    // 7. Prevent rapid double-triggers (Spam/Anti-loop cooldown)
    const now = Date.now();
    if (cooldowns[phone] && (now - cooldowns[phone]) < COOLDOWN_MS) {
      console.log(`⏳ Anti-spam: Message from +${phone} ignored due to cooldown.`);
      return;
    }
    cooldowns[phone] = now;

    // 8. Log message reception
    console.log(`📩 Incoming message from +${phone} [Clinic: ${clinicId}]: "${text}"`);

    // 10. Process message via AI Orchestrator
    const socketEmitter = (event, data) => emitToClinic(clinicId, event, data);
    const aiResponse = await processMessage({
      phone,
      messageText: text.trim(),
      clinicId,
      socketEmitter
    });

    // If AI is paused (human takeover active), skip responding automatically
    if (!aiResponse) {
      return;
    }

    // 11. Send response on WhatsApp
    await sock.sendPresenceUpdate('composing', jid);
    await new Promise(r => setTimeout(r, 1000)); // Brief simulated delay
    await sock.sendPresenceUpdate('paused', jid);
    
    await sock.sendMessage(jid, { text: aiResponse });
    console.log(`📤 Dispatched AI reply to +${phone}.`);


  } catch (err) {
    console.error('Error inside handleIncomingMessage:', err.message);
  }
}
