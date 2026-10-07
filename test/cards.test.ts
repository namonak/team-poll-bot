import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCreateCard, buildPollCard } from '../src/cards.js';
import type { Poll } from '../src/store.js';
const poll: Poll = { id: 'poll', draftId: 'draft', conversationId: 'chat', ownerId: 'owner', ownerName: '곰친구', title: '[삽입](https://bad.test)', multiple: true,
  deadline: null, messageId: 'message', status: 'open', publishState: 'ready', revision: 2, publishedRevision: 1,
  options: [{ id: '1', name: 'A', url: 'https://naver.me/test' }, { id: '2', name: 'B', url: null }],
  votes: [{ memberId: 'a', memberName: '민수', choices: ['1', '2'] }, { memberId: 'b', memberName: '지연', choices: ['1'] }] };
test('집계는 참여 인원과 전체 표 수를 구분하고 입력값을 마크다운 이스케이프한다', () => {
  const card = buildPollCard(poll);
  const body = JSON.stringify(card.body);
  assert.match(body, /2명이.*3표/);
  assert.match(body, /A — 2표.*100%/);
  assert.match(body, /B — 1표.*50%/);
  assert.ok(body.includes('\\\\['));
  assert.equal(card.actions[0].verb, 'pollVote');
  const choice = card.body.find(item => item.type === 'Input.ChoiceSet')!;
  assert.equal(choice.value, undefined); // 공유 카드에 다른 사람의 선택을 채우지 않음
});
test('마감 카드는 투표 입력을 제거하고 동률 후보를 모두 표시한다', () => {
  const card = buildPollCard({ ...poll, status: 'closed', votes: [{ memberId: 'a', memberName: '민수', choices: ['1', '2'] }] });
  assert.ok(card.body.every(item => !item.type.startsWith('Input.')));
  assert.deepEqual(card.actions.map(a => a.verb), ['pollRefresh']);
  assert.match(JSON.stringify(card.body), /함께 1등.*A.*B/);
});
test('생성 폼은 사전 입력과 필수 제목·항목을 제출 액션에 연결한다', () => {
  const card = buildCreateCard('draft', { title: '점심', options: 'A\nB', multiple: true });
  assert.equal(card.body.find(item => item.id === 'title')!.value, '점심');
  assert.equal(card.body.find(item => item.id === 'options')!.isRequired, true);
  assert.equal(card.actions[0].data.draftId, 'draft');
});
