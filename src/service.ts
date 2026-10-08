import { PollError, validatePoll } from './domain.js';
import { Store, type Poll } from './store.js';

export type Actor = { conversationId: string; userId: string; userName: string };
export type Transport = { replace(poll: Poll, messageId: string): Promise<void>; update(poll: Poll): Promise<void> };
const pending = '투표는 저장됐어요. 결과판 갱신이 늦어지고 있어 자동으로 다시 시도할게요.';

export class PollService {
  // ponytail: 단일 프로세스의 투표별 갱신 순서 보장, 다중 인스턴스가 필요하면 분산 작업 처리로 교체
  private jobs = new Map<string, Promise<unknown>>();
  constructor(private store: Store, private transport: Transport) {}
  private async serial<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = this.jobs.get(key) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(work);
    this.jobs.set(key, current);
    try { return await current; }
    finally { if (this.jobs.get(key) === current) this.jobs.delete(key); }
  }
  private checkActor(actor: Actor) {
    if (!actor.conversationId || !actor.userId) throw new PollError('사용자 정보를 확인하지 못했어요. 대화방에서 다시 눌러주세요.');
  }
  createDraft(actor: Actor, now = new Date()) {
    this.checkActor(actor);
    return this.store.createDraft(actor.conversationId, actor.userId, now);
  }
  async create(actor: Actor, draftId: string, input: Record<string, unknown>, now = new Date()): Promise<Poll> {
    this.checkActor(actor);
    return this.serial(`draft:${draftId}`, async () => {
      const draft = this.store.getDraft(draftId);
      if (!draft || draft.conversationId !== actor.conversationId || draft.ownerId !== actor.userId)
        throw new PollError('이 카드를 연 사람만 투표를 시작할 수 있어요. 새 투표는 @투표곰을 불러 만들어 주세요.');
      let poll = this.store.pollForDraft(draftId);
      if (poll?.messageId) return poll;
      if (now.getTime() - Date.parse(draft.createdAt) >= 86_400_000) throw new PollError('카드가 만료됐어요 (24시간 경과). @투표곰을 다시 불러주세요.');
      if (!draft.messageId) throw new PollError('준비 카드를 찾을 수 없어요. @투표곰으로 새 카드를 열어주세요.');
      poll ??= this.store.createPoll(draftId, this.name(actor), validatePoll(input, now));
      if (!this.store.beginPublish(poll.id)) throw new PollError(`투표 게시 상태를 확인하고 있어요. 관리자에게 이 ID를 알려주세요: ${poll.id}`);
      try {
        await this.transport.replace(poll, draft.messageId);
        this.store.markPublished(poll.id, draft.messageId, poll.revision);
        return this.store.getPoll(poll.id)!;
      } catch (error) {
        const failure = error as { status?: number; statusCode?: number } | null;
        const status = failure?.status ?? failure?.statusCode;
        if (status && [400, 401, 403, 404, 413, 422].includes(status)) this.store.allowPublishRetry(poll.id);
        console.error('투표 게시 확인 필요:', poll.id, status ?? 'unknown');
        throw new PollError(`투표가 게시됐는지 확인하지 못했어요. 관리자에게 이 ID를 알려주세요: ${poll.id}`);
      }
    });
  }
  private name(actor: Actor) { return [...(actor.userName || '이름 없음')].slice(0, 100).join('').replace(/[\r\n\t]/g, ' '); }
  private poll(actor: Actor, id: string, now: Date) {
    this.checkActor(actor);
    const poll = this.store.getPoll(id);
    if (!poll || poll.conversationId !== actor.conversationId || !poll.messageId || poll.status === 'publishing')
      throw new PollError('이 대화방에서 해당 투표를 찾을 수 없어요.');
    if (poll.status === 'open' && poll.deadline && Date.parse(poll.deadline) <= now.getTime()) {
      this.store.closePoll(poll.id);
      return this.store.getPoll(poll.id)!;
    }
    return poll;
  }
  async vote(actor: Actor, id: string, choices: unknown, now = new Date()) {
    const poll = this.poll(actor, id, now);
    if (poll.status !== 'open') throw new PollError('이미 마감된 투표예요. 결과는 결과판에서 확인해 주세요.');
    if (typeof choices !== 'string' || choices.length > 100) throw new PollError('후보를 1개 이상 골라주세요.');
    const selected = choices.split(',').map(choice => choice.trim());
    if (!selected.length || selected.length > poll.options.length || new Set(selected).size !== selected.length || selected.some(choice => !poll.options.some(option => option.id === choice)) || (!poll.multiple && selected.length !== 1))
      throw new PollError('선택한 후보를 확인해 주세요. 1개만 고르는 투표에서는 하나만 선택할 수 있어요.');
    selected.sort((a, b) => Number(a) - Number(b));
    const changed = this.store.saveVote(id, actor.userId, this.name(actor), selected, now);
    return await this.update(id) ? (changed ? '선택을 변경했어요.' : '투표했어요.') : pending;
  }
  async close(actor: Actor, id: string, now = new Date()) {
    const poll = this.poll(actor, id, now);
    if (poll.ownerId !== actor.userId) throw new PollError('투표를 만든 사람만 마감할 수 있어요.');
    this.store.closePoll(id);
    return await this.update(id) ? '투표를 마감했어요. 결과판에서 결과를 확인해 주세요.' : '투표를 마감했어요. 결과판 갱신이 늦어지고 있어 자동으로 다시 시도할게요.';
  }
  async refresh(actor: Actor, id: string, now = new Date()) {
    this.poll(actor, id, now);
    return await this.update(id) ? '결과판을 최신 상태로 갱신했어요.' : '결과판을 갱신하지 못했어요. 잠시 후 다시 눌러주세요.';
  }
  private async update(id: string): Promise<boolean> {
    return this.serial(`poll:${id}`, async () => {
      const poll = this.store.getPoll(id)!;
      try {
        await this.transport.update(poll);
        this.store.markUpdated(id, poll.revision);
        return true;
      } catch { console.error('투표 카드 갱신 재시도:', id); return false; }
    });
  }
  async runScheduledTasks(now = new Date()) {
    this.store.closeDuePolls(now);
    for (const poll of this.store.listDirtyPolls()) await this.update(poll.id);
  }
}
