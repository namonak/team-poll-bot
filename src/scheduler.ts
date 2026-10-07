import type { PollService } from './service.js';

export function startScheduler(service: PollService) {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try { await service.runScheduledTasks(); }
    catch { console.error('투표곰 주기 작업을 다시 확인해줘요 🐻'); }
    finally { running = false; }
  }, 30_000);
  timer.unref();
  return () => clearInterval(timer);
}
