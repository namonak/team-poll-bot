import type { PollService } from './service.js';

export function startScheduler(service: PollService) {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try { await service.runScheduledTasks(); }
    catch { console.error('주기 작업(자동 마감, 카드 갱신) 실패'); }
    finally { running = false; }
  }, 30_000);
  timer.unref();
  return () => clearInterval(timer);
}
