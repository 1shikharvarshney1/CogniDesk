import http from 'http';
import { createApp } from './app.js';
import { setupSocketIO } from './sockets/index.js';
import { connectDB } from './config/db.js';
import { env } from './config/env.js';

async function bootstrap() {
  try {
    await connectDB();

    const app = createApp();
    const server = http.createServer(app);

    setupSocketIO(server);

    server.listen(env.PORT, () => {
      console.log(`[SupportDesk Server] Running on http://localhost:${env.PORT}`);
    });
  } catch (err) {
    console.error('[SupportDesk Server] Failed to start:', err.message);
    process.exit(1);
  }
}

bootstrap();
