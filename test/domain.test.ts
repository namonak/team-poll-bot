import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCommand, parseDeadline, validatePoll } from '../src/domain.js';

const now = new Date('2026-10-07T08:00:00Z'); // 수요일 17시 KST
test('멘션만 보내면 준비 카드, 도움말은 사용 방법, 그 밖의 입력은 안내 대상이다', () => {
  for (const input of ['', '<at>투표곰</at>', ' <at>투표곰</at>&nbsp;\n', '@투표곰']) assert.equal(parseCommand(input), 'create', input);
  assert.equal(parseCommand('<at>투표곰</at> 도움말'), 'help');
  for (const input of ['<at>투표곰</at> 투표만들기', '투표곰 점심 뭐 먹지']) assert.equal(parseCommand(input), 'invalid', input);
});
test('마감은 KST의 미래 시각이며 잘못된 날짜를 보정하지 않는다', () => {
  const cases: [string, string | null][] = [
    ['', null], ['3시간', '2026-10-07T11:00:00.000Z'], ['금요일 18시', '2026-10-09T09:00:00.000Z'],
    ['수요일 17시', '2026-10-14T08:00:00.000Z'], ['8월 22일 18시', '2027-08-22T09:00:00.000Z'],
    ['2026-10-09 18:30', '2026-10-09T09:30:00.000Z'],
  ];
  for (const [input, expected] of cases) assert.equal(parseDeadline(input, now), expected);
  assert.equal(parseDeadline('1월 1일 18시', new Date('2026-12-31T08:00:00Z')), '2027-01-01T09:00:00.000Z');
  for (const input of ['2월 30일 18시', '2026-02-29 18:00', '2026-10-07 17:00', '0시간', '366일', '금요일 25시', '내일쯤'])
    assert.throws(() => parseDeadline(input, now), input);
});
test('폼은 타입·항목 수·중복·URL·유니코드 길이를 검증한다', () => {
  const config = validatePoll({ title: ' 제목 ', options: 'A (https://naver.me/xxxx)\n\nB', multiple: 'true' }, now);
  assert.equal(config.title, '제목');
  assert.deepEqual(config.options, [{ name: 'A', url: 'https://naver.me/xxxx' }, { name: 'B', url: null }]);
  assert.equal(config.multiple, true);
  assert.equal(validatePoll({ title: '🐻'.repeat(100), options: 'A\nB' }, now).title.length, 200);
  for (const input of [
    { title: {}, options: 'A\nB' }, { title: '', options: 'A\nB' }, { title: 'x', options: 'A' },
    { title: 'x', options: 'A\nA' }, { title: 'x', options: 'A (javascript:alert)\nB' },
    { title: 'x', options: 'A (https://)\nB' }, { title: '🐻'.repeat(101), options: 'A\nB' },
    { title: 'x', options: 'A\nB', multiple: 'maybe' },
  ]) assert.throws(() => validatePoll(input, now));
});
