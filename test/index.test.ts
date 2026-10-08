import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CloudAdapter, getAuthConfigWithDefaults } from '@microsoft/agents-hosting';
import { createApp, createTeamsTransport, cardActionResponse, dispatchAction } from '../src/index.js';
import { Store } from '../src/store.js';
import { PollService } from '../src/service.js';

test('인증 설정 누락은 헬스 체크만 성공시키지 않고 시작을 거부한다', () => {
  assert.throws(() => createApp({}), /MicrosoftAppId/);
});
test('운영 앱은 인증 없는 메시지를 차단하고 헬스 체크를 제공한다', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'poll-app-'));
  const app = createApp({ MicrosoftAppId: '00000000-0000-0000-0000-000000000001', MicrosoftAppPassword: 'test-secret', MicrosoftAppTenantId: '00000000-0000-0000-0000-000000000002', DATABASE_PATH: join(dir, 'bot.sqlite') });
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise<void>(resolve => server.once('listening', resolve));
    const { port } = server.address() as { port: number };
    assert.deepEqual(await (await fetch(`http://127.0.0.1:${port}/healthz`)).json(), { ok: true });
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 401);
  } finally { server.close(); app.locals.dispose(); rmSync(dir, { recursive: true, force: true }); }
});
test('카드 액션을 실제 서비스에 전달하며 변조 타입과 알 수 없는 동작을 거부한다', async () => {
  const store = Store.open(':memory:');
  const service = new PollService(store, { async replace() {}, async update() {} });
  const actor = { conversationId: 'chat', userId: 'owner', userName: '곰친구' };
  const now = new Date();
  const draft = service.createDraft(actor, now);
  store.setDraftMessage(draft.id, 'form-message');
  const created = await dispatchAction(service, actor, { verb: 'pollCreate', data: { draftId: draft.id, title: '점심', options: 'A\nB' } });
  assert.match(created, /시작/);
  const poll = store.pollForDraft(draft.id)!;
  await dispatchAction(service, actor, { verb: 'pollVote', data: { pollId: poll.id, choices: '1' } });
  assert.equal(store.getPoll(poll.id)!.votes.length, 1);
  for (const action of [{ verb: 'unknown', data: {} }, { verb: 'pollClose', data: { pollId: {} } }, { verb: 'pollCreate', data: null }])
    await assert.rejects(dispatchAction(service, actor, action));
  assert.equal(cardActionResponse('쏙 담았어요').type, 'application/vnd.microsoft.activity.message');
  assert.equal(cardActionResponse('다시 확인해줘요', false).statusCode, 400);
  store.close();
});

test('실제 SDK의 카드 갱신 실패가 재시도할 집계 버전을 지우지 않는다', async () => {
  const store = Store.open(':memory:');
  const adapter = new CloudAdapter(getAuthConfigWithDefaults({ clientId: 'app', clientSecret: 'secret', tenantId: 'tenant' }));
  let messages = 0;
  let updates = 0;
  const updatedIds: string[] = [];
  Object.assign(adapter, {
    createConnectorClientWithIdentity: async () => ({}),
    createUserTokenClient: async () => ({}),
    sendActivities: async (...[_context, activities]: Parameters<CloudAdapter['sendActivities']>) => { messages += activities.length; return activities.map(() => ({ id: 'message' })); },
    updateActivity: async (...[_context, activity]: Parameters<CloudAdapter['updateActivity']>) => {
      updatedIds.push(activity.id!);
      updates++;
      if (updates > 1) throw new Error('PUT failed');
    },
  });
  store.activateConversation('chat', { serviceUrl: 'https://example.invalid', channelId: 'msteams', conversation: { id: 'chat', conversationType: 'groupChat' }, agent: { id: 'bot' }, user: { id: 'owner' } });
  const service = new PollService(store, createTeamsTransport(adapter, 'app', store));
  const actor = { conversationId: 'chat', userId: 'owner', userName: '곰친구' };
  const draft = service.createDraft(actor);
  store.setDraftMessage(draft.id, 'form-message');
  const poll = await service.create(actor, draft.id, { title: '점심', options: 'A\nB' });
  assert.deepEqual(updatedIds, ['form-message']);
  assert.match(await service.vote(actor, poll.id, '1'), /투표는 저장됐어요/);
  assert.equal(store.listDirtyPolls().length, 1);
  assert.equal(messages, 0); // 카드 두 장을 보내지 않고 원래 폼을 교체함
  store.close();
});
