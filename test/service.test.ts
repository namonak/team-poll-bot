import assert from 'node:assert/strict';
import test from 'node:test';
import { HttpError } from '@microsoft/agents-hosting';
import { Store, type Poll } from '../src/store.js';
import { PollService } from '../src/service.js';

const now = new Date('2026-10-07T08:00:00Z');
const owner = { conversationId: 'chat', userId: 'owner', userName: '곰친구' };
const friend = { ...owner, userId: 'friend', userName: '친구' };
const form = { title: '점심', options: 'A\nB', multiple: 'true', deadline: '3시간' };
function setup() {
  const store = Store.open(':memory:');
  const replaced: { poll: Poll; messageId: string }[] = [], updated: Poll[] = [];
  const transport = { async replace(poll: Poll, messageId: string) { replaced.push({ poll, messageId }); }, async update(poll: Poll) { updated.push(poll); } };
  const draft = (actor = owner, createdAt = now) => {
    const value = store.createDraft(actor.conversationId, actor.userId, createdAt);
    store.setDraftMessage(value.id, `form-${value.id}`);
    return value;
  };
  return { store, draft, replaced, updated, transport, service: new PollService(store, transport) };
}
test('폼 작성자와 대화방을 확인하고 동시 시작을 하나의 투표로 만든다', async () => {
  const { store, service, draft, replaced } = setup();
  const draftCard = draft();
  await assert.rejects(service.create(friend, draftCard.id, form, now));
  await assert.rejects(service.create({ ...owner, conversationId: 'other' }, draftCard.id, form, now));
  const [one, two] = await Promise.all([service.create(owner, draftCard.id, form, now), service.create(owner, draftCard.id, form, now)]);
  assert.equal(one.id, two.id); assert.deepEqual(replaced.map(value => value.messageId), [`form-${draftCard.id}`]);
  const old = draft(owner, new Date(now.getTime() - 86_400_000));
  await assert.rejects(service.create(owner, old.id, form, now));
  store.close();
});
test('응답 변경·재전송과 권한·마감 검증을 함께 적용한다', async () => {
  const { store, service, draft } = setup();
  const poll = await service.create(owner, draft().id, form, now);
  await service.vote(friend, poll.id, '1,2', now);
  await service.vote(friend, poll.id, '2', now);
  await service.vote(friend, poll.id, '2', now);
  assert.deepEqual(store.getPoll(poll.id)!.votes.map(v => v.choices), [['2']]);
  for (const choices of ['', '99', '1,1', ['1'], '1,,2']) await assert.rejects(service.vote(friend, poll.id, choices, now));
  await assert.rejects(service.vote({ ...friend, conversationId: 'other' }, poll.id, '1', now));
  await assert.rejects(service.close(friend, poll.id, now));
  await assert.rejects(service.vote(friend, poll.id, '1', new Date('2026-10-07T11:00:00Z')));
  await service.close(owner, poll.id, now);
  await assert.rejects(service.vote(friend, poll.id, '1', now));
  assert.equal(store.getPoll(poll.id)!.status, 'closed');
  store.close();
});
test('단일 선택 투표는 여러 선택과 잘못된 활동 사용자 정보를 거부한다', async () => {
  const { store, service, draft } = setup();
  const poll = await service.create(owner, draft().id, { ...form, multiple: false }, now);
  await assert.rejects(service.vote(friend, poll.id, '1,2', now));
  await assert.rejects(service.vote({ ...friend, userId: '' }, poll.id, '1', now));
  assert.equal(store.getPoll(poll.id)!.votes.length, 0);
  store.close();
});
test('카드 갱신 실패 후 저장된 응답과 마감 결과를 다시 게시한다', async () => {
  const { store, service, transport, updated, draft } = setup();
  const poll = await service.create(owner, draft().id, form, now);
  transport.update = async () => { throw new Error('offline'); };
  const result = await service.vote(friend, poll.id, '1', now);
  assert.match(result, /투표는 저장됐어요/);
  assert.equal(store.getPoll(poll.id)!.votes.length, 1);
  assert.equal(store.listDirtyPolls().length, 1);
  transport.update = async value => { updated.push(value); };
  await service.runScheduledTasks(new Date('2026-10-07T11:00:00Z'));
  assert.equal(updated.at(-1)!.status, 'closed');
  assert.equal(store.listDirtyPolls().length, 0);
  store.close();
});
test('동시 응답은 카드 갱신을 순서대로 실행하고 마지막 결과에 모두 포함한다', async () => {
  const { store, service, transport, updated, draft } = setup();
  const poll = await service.create(owner, draft().id, form, now);
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  let started!: () => void;
  const firstStarted = new Promise<void>(resolve => { started = resolve; });
  transport.update = async value => { if (!updated.length) { started(); await barrier; } updated.push(value); };
  const first = service.vote(friend, poll.id, '1', now);
  await firstStarted;
  const second = service.vote({ ...owner, userId: 'second' }, poll.id, '2', now);
  release(); await Promise.all([first, second]);
  assert.equal(updated.at(-1)!.votes.length, 2);
  assert.equal(store.listDirtyPolls().length, 0);
  store.close();
});
test('불확실한 게시 실패는 자동 재게시하지 않고 확실한 거절만 재시도한다', async () => {
  const { store, service, transport, replaced, draft } = setup();
  const uncertain = draft();
  transport.replace = async () => { throw new Error('response lost'); };
  await assert.rejects(service.create(owner, uncertain.id, form, now));
  transport.replace = async (poll, messageId) => { replaced.push({ poll, messageId }); };
  await assert.rejects(service.create(owner, uncertain.id, form, now), /게시 상태/);
  assert.equal(replaced.length, 0);
  const retry = draft();
  transport.replace = async () => {
    const config = { method: 'POST', url: 'https://example.invalid' };
    throw new HttpError('rejected', { status: 400, statusText: 'Bad Request', data: {}, headers: new Headers(), config }, config);
  };
  await assert.rejects(service.create(owner, retry.id, form, now));
  transport.replace = async (poll, messageId) => { replaced.push({ poll, messageId }); };
  assert.equal((await service.create(owner, retry.id, form, now)).status, 'open');
  store.close();
});
