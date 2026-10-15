import { Postgres, migrate } from './db.js';
import { AgentService } from './service.js';
import { TestGenerator } from './generator.js';
import { SafeBrowser } from './browser.js';
import { createApp } from './app.js';

async function main() {
  const url = process.env.DATABASE_URL,
    token = process.env.ADMIN_TOKEN;
  if (!url || !token)
    throw new Error('Configure DATABASE_URL and ADMIN_TOKEN locally before starting');
  const db = new Postgres(url);
  await migrate(db);
  const generator = new TestGenerator({
    key: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL,
  });
  const service = new AgentService(
    db,
    generator,
    new SafeBrowser(),
    undefined,
    !!process.env.OPENAI_API_KEY,
  );
  const app = await createApp(service, {
    adminToken: token,
    webOrigin: process.env.WEB_ORIGIN ?? 'http://127.0.0.1:5173',
  });
  let stopping = false,
    active: Promise<unknown> = Promise.resolve();
  const timer = setInterval(() => {
    if (stopping) return;
    stopping = true;
    active = service
      .processNext()
      .catch(() => console.error('Worker poll failed; check database availability'))
      .finally(() => {
        stopping = false;
      });
  }, 500);
  await app.listen(Number(process.env.PORT ?? 3001), process.env.BIND_ADDRESS ?? '127.0.0.1');
  console.log('Testing Agent API ready');
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(timer);
    await active;
    await app.close();
    await db.close();
  };
  process.once('SIGTERM', () => void shutdown());
  process.once('SIGINT', () => void shutdown());
}
main().catch(() => {
  console.error('Startup failed; check local environment, database, and migrations');
  process.exitCode = 1;
});
