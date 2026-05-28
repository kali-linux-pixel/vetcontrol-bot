import { Server } from 'socket.io';
import { sql } from '../database/supabase.js';

let io = null;


export function initSocketServer(server) {
  io = new Server(server, {
    cors: {
      origin: '*', // For development, allow all origins
      methods: ['GET', 'POST']
    }
  });

  io.on('connection', (socket) => {
    console.log(`🔌 Panel Socket connected: ${socket.id}`);
    console.log("⚡ Dashboard connected:", socket.id);


    // Multi-tenant Room isolation: join specific clinic room
    socket.on('join_clinic', (clinicId) => {
      if (clinicId) {
        const roomName = `clinic_${clinicId}`;
        socket.join(roomName);
        console.log(`🏢 Socket ${socket.id} joined room: ${roomName}`);
        
        // Return initial connection success message
        socket.emit('joined', { room: roomName, success: true });
      }
    });

    // Live chat typing indicators
    socket.on('typing_start', (data) => {
      if (data.clinicId && data.phone) {
        emitToClinic(data.clinicId, 'typing_start', data);
      }
    });

    socket.on('typing_stop', (data) => {
      if (data.clinicId && data.phone) {
        emitToClinic(data.clinicId, 'typing_stop', data);
      }
    });

    // Mark messages as read by human receptionist agent
    socket.on('message_seen', async (data) => {
      const { clinicId, phone } = data;
      if (clinicId && phone) {
        try {
          // Update status to read for user messages
          await sql`
            UPDATE messages 
            SET status = 'read'
            WHERE clinic_id = ${clinicId} AND phone = ${phone} AND role = 'user' AND status != 'read'
          `;
          emitToClinic(clinicId, 'message_seen', { phone });
        } catch (err) {
          console.error('Socket error in message_seen database transaction:', err.message);
        }
      }
    });

    socket.on('disconnect', () => {
      console.log(`❌ Panel Socket disconnected: ${socket.id}`);
    });
  });

  return io;
}

/**
 * Broadcasts an event to all connected sockets in a specific clinic's room.
 */
export function emitToClinic(clinicId, eventName, data) {
  if (!io) {
    console.warn('⚠️ Socket.io server not initialized yet.');
    return;
  }
  const roomName = `clinic_${clinicId}`;
  console.log(`📡 Emitting [${eventName}] to room [${roomName}]:`, data);
  io.to(roomName).emit(eventName, data);
}

export const initializeSocket = initSocketServer;

