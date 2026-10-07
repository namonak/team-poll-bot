import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Store } from '../src/store.js';
import { validatePoll } from '../src/domain.js';

test('재시작 후 응답 유지, 초안과 응답 재전송에서 중복 방지', () => {
  const dir = mkdtempSync(join(tmpdir(), 'poll-store-'));
  try {
    const path = join(dir, 'poll.sqlite');
    const store = Store.open(path);
    store.activateConversation('chat', { conversation: { id: 'chat' } });
    const draft = store.createDraft('chat', 'owner');
    const poll = store.createPoll(draft.id, '곰친구', validatePoll({ title: '점심', options: 'A\nB' }));
    assert.equal(store.createPoll(draft.id, '곰친구', validatePoll({ title: '다른 제목', options: 'C\nD' })).id, poll.id);
    store.markPublished(poll.id, 'message', poll.revision);
    store.saveVote(poll.id, 'member', '친구', ['1']);
    store.saveVote(poll.id, 'member', '친구', ['2']);
    const revision = store.getPoll(poll.id)!.revision;
    store.saveVote(poll.id, 'member', '친구', ['2']);
    assert.equal(store.getPoll(poll.id)!.revision, revision);
    store.close();
    const reopened = Store.open(path);
    assert.deepEqual(reopened.getPoll(poll.id)!.votes.map(v => v.choices), [['2']]);
    assert.equal(reopened.getPoll(poll.id)!.messageId, 'message');
    assert.equal(reopened.listDirtyPolls().length, 1);
    reopened.markUpdated(poll.id, revision);
    assert.equal(reopened.listDirtyPolls().length, 0);
    assert.deepEqual(reopened.conversationReference('chat'), { conversation: { id: 'chat' } });
    reopened.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
