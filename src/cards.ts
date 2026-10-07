import type { Prefill } from './domain.js';
import type { Poll } from './store.js';

type Element = { type: string; [key: string]: unknown };
type Action = { type: string; title: string; verb: string; data: Record<string, unknown>; associatedInputs: 'auto' | 'none' };
type Card = { type: 'AdaptiveCard'; version: '1.5'; body: Element[]; actions: Action[] };
const block = (text: string, extra: Record<string, unknown> = {}): Element => ({ type: 'TextBlock', text, wrap: true, ...extra });
const escape = (text: string) => text.replace(/[\\`*_{}\[\]()#+.!|~-]/g, '\\$&').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const action = (title: string, verb: string, data: Record<string, unknown>, inputs = false): Action =>
  ({ type: 'Action.Execute', title, verb, data, associatedInputs: inputs ? 'auto' : 'none' });
const card = (body: Element[], actions: Action[]): Card => ({ type: 'AdaptiveCard', version: '1.5', body, actions });

export function buildHelpCard(invalid = false) {
  return card([
    block(invalid ? '앗, 곰곰이 생각해도 모르겠어요. 아래처럼 불러줘요 🐻' : '안녕하세요, 투표곰이에요! 함께 고를 일이 있으면 콕 불러줘요 🐻', { weight: 'Bolder' }),
    block('🐾 @투표곰 투표만들기 — 빈 준비 카드를 펼쳐요!\n🐾 @투표곰 투표만들기 제목 — 제목을 미리 담아요!'),
    block('🧺 한 번에 준비하려면 이렇게 적어줘요!\n@투표곰 투표만들기 + "점심" "식당 A" "식당 B" 마감: "금요일 18시" 복수'),
    block('투표를 시작한 뒤에는 후보를 바꿀 수 없어요. 새 투표로 다시 모아줘요 🐻', { isSubtle: true }),
  ], []);
}

export function buildCreateCard(draftId: string, prefill: Prefill = {}) {
  return card([
    block('🐻 투표곰과 선택을 모아봐요!', { weight: 'Bolder', size: 'Medium' }),
    block('아직 준비 중이에요. 이 카드를 부른 분만 시작할 수 있어요 🐾', { isSubtle: true }),
    { type: 'Input.Text', id: 'title', label: '어떤 걸 함께 골라볼까요?', value: prefill.title ?? '', maxLength: 200, isRequired: true, errorMessage: '투표 이름을 살짝 적어줘요 🐻' },
    { type: 'Input.Text', id: 'options', label: '후보를 한 줄에 하나씩 적어줘요! 2~10개예요 🧺', value: prefill.options ?? '', isMultiline: true, maxLength: 8_000, isRequired: true,
      placeholder: '땡땡식당 (https://naver.me/xxxx)\n무슨식당\n초밥집', errorMessage: '후보를 두 개 이상 담아줘요 🧺' },
    { type: 'Input.Text', id: 'deadline', label: '언제까지 고를까요? 비우면 계속 열어둘게요 ⏰', value: prefill.deadline ?? '', maxLength: 100, placeholder: '금요일 18시 / 8월 22일 18시 / 3시간' },
    { type: 'Input.Toggle', id: 'multiple', title: '여러 후보에 마음을 줘도 좋아요 🐾', value: prefill.multiple ? 'true' : 'false', valueOn: 'true', valueOff: 'false' },
  ], [action('🐻 투표 시작!', 'pollCreate', { draftId }, true)]);
}

export function buildPollCard(poll: Poll) {
  const closed = poll.status === 'closed';
  const people = poll.votes.length;
  const total = poll.votes.reduce((sum, vote) => sum + vote.choices.length, 0);
  const results = poll.options.map(option => ({ ...option, names: poll.votes.filter(vote => vote.choices.includes(option.id)).map(vote => vote.memberName) }));
  const max = Math.max(0, ...results.map(result => result.names.length));
  const winners = max ? results.filter(result => result.names.length === max) : [];
  const deadline = poll.deadline ? new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(poll.deadline)) : '마감 없이 열려 있어요';
  const body: Element[] = [
    block(`🐻 ${escape(poll.title)}`, { weight: 'Bolder', size: 'Medium' }),
    block(closed ? '이 투표는 포근하게 마감됐어요 🧸' : `⏰ ${deadline}${poll.deadline ? '까지' : ''}`, { isSubtle: true }),
    block(`만든 곰 친구: ${escape(poll.ownerName)} · ${poll.multiple ? '여러 후보를 골라도 좋아요!' : '한 후보에 마음을 주세요!'}`),
    block('공개 투표예요. 고른 후보와 이름이 이 대화방에 보여요 🐾', { isSubtle: true }),
    block(`🐾 지금 ${people}명이 마음을 모았어요 · 총 ${total}표`),
    ...(poll.multiple ? [block('비율은 참여자 기준이에요. 여러 선택이면 합계가 100%를 넘을 수 있어요 🧺', { isSubtle: true })] : []),
    ...results.flatMap(result => [
      block(`${escape(result.name)} — ${result.names.length}표 · 참여자 기준 ${people ? Math.round(result.names.length / people * 100) : 0}%`, { weight: 'Bolder', separator: true }),
      block(result.names.length ? `${result.names.slice(0, 10).map(escape).join(' · ')}${result.names.length > 10 ? ` · 외 ${result.names.length - 10}명` : ''}` : '아직 모인 마음이 없어요. 첫 발자국을 남겨줘요 🐾'),
      ...(result.url ? [{ type: 'ActionSet', actions: [{ type: 'Action.OpenUrl', title: `${result.name} 구경하기 🔗`, url: result.url }] }] : []),
    ]),
  ];
  if (closed) body.push(block(winners.length ? `🏆 ${winners.length > 1 ? '같은 만큼 사랑받았어요! 함께 1등이에요' : '가장 많은 마음을 받은 후보예요'}: ${winners.map(winner => escape(winner.name)).join(' · ')}` : '이번에는 모인 마음이 없었어요. 다음에 또 함께 골라요 🐻'));
  else body.push({ type: 'Input.ChoiceSet', id: 'choices', label: '어느 후보에 마음을 줄까요? 🐾', isMultiSelect: poll.multiple, style: 'expanded', isRequired: true,
    errorMessage: '후보를 하나 이상 콕 골라줘요 🐾', choices: poll.options.map(option => ({ title: option.name, value: option.id })) });
  return card(body, [
    ...(closed ? [] : [action('🐾 내 선택 보내기', 'pollVote', { pollId: poll.id }, true)]),
    action('🔄 최신 결과 보기', 'pollRefresh', { pollId: poll.id }),
    ...(closed ? [] : [action('🧸 이제 마감하기', 'pollClose', { pollId: poll.id })]),
  ]);
}
