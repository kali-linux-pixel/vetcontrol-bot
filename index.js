import http from 'http';
import dotenv from 'dotenv';
import app from './src/app.js';
import { initSocketServer } from './src/socket/socket.js';
import { initializeAllSessions } from './src/bot/baileys.js';
import { initScheduler } from './src/scheduler/reminders.js';
import { getDemoClinicId } from './src/services/clientService.js';

dotenv.config();

const PORT = process.env.PORT || 3001;

async function startServer() {
  try {
    // 1. Check and resolve the default organization "VetControl Demo"
    console.log('🏢 Initializing default organization...');
    const demoClinicId = await getDemoClinicId();
    console.log(`✅ Default organization "VetControl Demo" ready: ${demoClinicId}`);

    // 2. Create HTTP server from Express app
    const server = http.createServer(app);

    // 3. Initialize Socket.io server
    console.log('🔌 Initializing Socket.io server...');
    const io = initSocketServer(server);
    app.set('io', io);


    // 4. Start HTTP listening
    server.listen(PORT, () => {
      console.log(`🚀 VetControl WhatsApp Engine running on port: ${PORT}`);
    });

    // 5. Restore previous connected Baileys WhatsApp sessions
    console.log('🔄 Restoring active WhatsApp sessions...');
    await initializeAllSessions();

    // 6. Initialize automated appointment reminders cron scheduler
    console.log('⏰ Starting reminders cron scheduler...');
    initScheduler();

  } catch (err) {
    console.error('❌ Failed to start VetControl Bot Server:', err);
    process.exit(1);
  }
}

startServer();