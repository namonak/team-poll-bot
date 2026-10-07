import { PollError, validatePoll } from './domain.js';
import { Store, type Poll } from './store.js';

export type Actor = { conversationId: string; userId: string; userName: string };
export type Transport = { publish(poll: Poll): Promise<string>; update(poll: Poll): Promise<void> };
const pending = '선택은 잘 담았어요! 결과판은 잠깐 쉬는 중이라 곧 다시 펼쳐둘게요 🐻';

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
    if (!actor.conversationId || !actor.userId) throw new PollError('앗, 곰 친구를 확인하지 못했어요. 대화방에서 다시 눌러줘요 🐻');
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
        throw new PollError('이 준비 카드는 만든 분만 시작할 수 있어요. 새 투표는 투표곰을 불러줘요 🐻');
      let poll = this.store.pollForDraft(draftId);
      if (poll?.messageId) return poll;
      if (now.getTime() - Date.parse(draft.createdAt) >= 86_400_000) throw new PollError('앗, 준비 카드가 잠들었어요. 투표곰을 다시 불러줘요 🐻');
      poll ??= this.store.createPoll(draftId, this.name(actor), validatePoll(input, now));
      if (!this.store.beginPublish(poll.id)) throw new PollError('게시 여부를 확인 중이에요. 운영자 곰 친구에게 투표 ID를 알려줘요 🧸');
      try {
        const messageId = await this.transport.publish(poll);
        if (!messageId) throw new Error('missing-message-id');
        this.store.markPublished(poll.id, messageId, poll.revision);
        return this.store.getPoll(poll.id)!;
      } catch (error) {
        const failure = error as { status?: number; statusCode?: number } | null;
        const status = failure?.status ?? failure?.statusCode;
        if (status && [400, 401, 403, 404, 413, 422].includes(status)) this.store.allowPublishRetry(poll.id);
        console.error('투표 게시 확인 필요:', poll.id, status ?? 'unknown');
        throw new PollError(`앗, 투표 시작을 확인하지 못했어요. 운영자에게 이 ID를 알려줘요: ${poll.id} 🐻`);
      }
    });
  }
  private name(actor: Actor) { return [...(actor.userName || '곰 친구')].slice(0, 100).join('').replace(/[\r\n\t]/g, ' '); }
  private poll(actor: Actor, id: string, now: Date) {
    this.checkActor(actor);
    const poll = this.store.getPoll(id);
    if (!poll || poll.conversationId !== actor.conversationId || !poll.messageId || poll.status === 'publishing')
      throw new PollError('이 대화방의 열린 투표를 찾지 못했어요. 카드를 다시 확인해줘요 🐻');
    if (poll.status === 'open' && poll.deadline && Date.parse(poll.deadline) <= now.getTime()) {
      this.store.closePoll(poll.id);
      return this.store.getPoll(poll.id)!;
    }
    return poll;
  }
  async vote(actor: Actor, id: string, choices: unknown, now = new Date()) {
    const poll = this.poll(actor, id, now);
    if (poll.status !== 'open') throw new PollError('이 투표는 포근하게 마감됐어요. 모인 마음은 결과판에서 봐줘요 🧸');
    if (typeof choices !== 'string' || choices.length > 100) throw new PollError('후보를 하나 이상 콕 골라줘요 🐾');
    const selected = choices.split(',').map(choice => choice.trim());
    if (!selected.length || selected.length > poll.options.length || new Set(selected).size !== selected.length || selected.some(choice => !poll.options.some(option => option.id === choice)) || (!poll.multiple && selected.length !== 1))
      throw new PollError('선택한 후보를 다시 확인해줘요. 이 투표의 후보만 골라줘요 🐾');
    selected.sort((a, b) => Number(a) - Number(b));
    const changed = this.store.saveVote(id, actor.userId, this.name(actor), selected, now);
    return await this.update(id) ? (changed ? '마음이 바뀌었군요! 새 선택으로 바꿔 담았어요 🧺' : '소중한 한 표, 곰 주머니에 쏙 담았어요! 🐾') : pending;
  }
  async close(actor: Actor, id: string, now = new Date()) {
    const poll = this.poll(actor, id, now);
    if (poll.ownerId !== actor.userId) throw new PollError('마감은 이 투표를 만든 곰 친구만 할 수 있어요 🧸');
    this.store.closePoll(id);
    return await this.update(id) ? '선택을 모두 모았어요! 결과판을 함께 봐줘요 🧸' : '투표는 마감했어요! 결과판은 곧 다시 펼쳐둘게요 🧸';
  }
  async refresh(actor: Actor, id: string, now = new Date()) {
    this.poll(actor, id, now);
    return await this.update(id) ? '새로 모인 마음을 펼쳐봤어요! 🐻' : '결과판이 잠깐 쉬는 중이에요. 조금 뒤에 다시 눌러줘요 🐻';
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
