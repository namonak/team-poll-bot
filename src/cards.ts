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
    block('🐻 투표곰 사용 방법', { weight: 'Bolder', size: 'Medium' }),
    ...(invalid ? [block('입력하신 내용은 처리할 수 없어요. 아래 사용 방법을 확인해 주세요.')] : []),
    block('@투표곰만 멘션해 보내면 투표 만들기 카드가 열려요.'),
    block('카드에 제목, 후보(2~10개), 마감 시간, 복수 선택 여부를 적고 [투표 시작]을 눌러주세요.'),
    block('마감 시간 예: 3시간, 금요일 18시, 8월 22일 18시, 2026-10-09 18:00 (비워두면 직접 마감할 때까지 열려 있어요)'),
    block('투표를 시작한 뒤에는 제목과 후보를 바꿀 수 없어요.', { isSubtle: true }),
  ], []);
}

export function buildCreateCard(draftId: string) {
  return card([
    block('🐻 새 투표 만들기', { weight: 'Bolder', size: 'Medium' }),
    block('내용을 채우고 [투표 시작]을 눌러주세요. 이 카드를 연 사람만 시작할 수 있어요.', { isSubtle: true }),
    { type: 'Input.Text', id: 'title', label: '투표 제목을 적어주세요', maxLength: 200, isRequired: true, errorMessage: '투표 제목을 적어주세요.' },
    { type: 'Input.Text', id: 'options', label: '후보를 한 줄에 하나씩 적어주세요 (2~10개, 링크는 괄호 안에)', isMultiline: true, maxLength: 8_000, isRequired: true,
      placeholder: '식당 A (https://naver.me/xxxx)\n식당 B\n식당 C', errorMessage: '후보를 2개 이상 적어주세요.' },
    { type: 'Input.Text', id: 'deadline', label: '마감 시간 (비워두면 직접 마감할 때까지 열려 있어요)', maxLength: 100, placeholder: '예: 3시간, 금요일 18시, 8월 22일 18시' },
    { type: 'Input.Toggle', id: 'multiple', title: '여러 후보 선택 허용 (복수 투표)', value: 'false', valueOn: 'true', valueOff: 'false' },
  ], [action('🐻 투표 시작', 'pollCreate', { draftId }, true)]);
}

export function buildPollCard(poll: Poll) {
  const closed = poll.status === 'closed';
  const people = poll.votes.length;
  const total = poll.votes.reduce((sum, vote) => sum + vote.choices.length, 0);
  const results = poll.options.map(option => ({ ...option, names: poll.votes.filter(vote => vote.choices.includes(option.id)).map(vote => vote.memberName) }));
  const max = Math.max(0, ...results.map(result => result.names.length));
  const winners = max ? results.filter(result => result.names.length === max) : [];
  const deadline = poll.deadline ? new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(poll.deadline)) : '마감 시간 없음 (만든 사람이 직접 마감)';
  const body: Element[] = [
    block(`🐻 ${escape(poll.title)}`, { weight: 'Bolder', size: 'Medium' }),
    block(closed ? '마감된 투표예요.' : `⏰ ${deadline}${poll.deadline ? '까지' : ''}`, { isSubtle: true }),
    block(`만든 사람: ${escape(poll.ownerName)} · ${poll.multiple ? '여러 개 선택 가능' : '1개만 선택'}`),
    block('공개 투표예요. 누가 어떤 후보를 골랐는지 대화방 모두에게 보여요.', { isSubtle: true }),
    block(`참여 ${people}명 · 총 ${total}표`),
    ...(poll.multiple ? [block('비율은 참여자 수 기준이라 합계가 100%를 넘을 수 있어요.', { isSubtle: true })] : []),
    ...results.flatMap(result => [
      block(`${escape(result.name)} — ${result.names.length}표 · ${people ? Math.round(result.names.length / people * 100) : 0}%`, { weight: 'Bolder', separator: true }),
      block(result.names.length ? `${result.names.slice(0, 10).map(escape).join(' · ')}${result.names.length > 10 ? ` · 외 ${result.names.length - 10}명` : ''}` : '아직 표가 없어요.'),
      ...(result.url ? [{ type: 'ActionSet', actions: [{ type: 'Action.OpenUrl', title: `${result.name} 링크 열기 🔗`, url: result.url }] }] : []),
    ]),
  ];
  if (closed) body.push(block(winners.length ? `🏆 ${winners.length > 1 ? '공동 1위' : '1위'} (${max}표): ${winners.map(winner => escape(winner.name)).join(' · ')}` : '참여한 사람 없이 마감됐어요.'));
  else body.push({ type: 'Input.ChoiceSet', id: 'choices', label: poll.multiple ? '원하는 후보를 모두 골라주세요' : '1개를 골라주세요', isMultiSelect: poll.multiple, style: 'expanded', isRequired: true,
    errorMessage: '후보를 1개 이상 골라주세요.', choices: poll.options.map(option => ({ title: option.name, value: option.id })) });
  return card(body, [
    ...(closed ? [] : [action('🗳️ 투표하기', 'pollVote', { pollId: poll.id }, true)]),
    action('🔄 최신 결과 보기', 'pollRefresh', { pollId: poll.id }),
    ...(closed ? [] : [action('🔒 투표 마감 (만든 사람만)', 'pollClose', { pollId: poll.id })]),
  ]);
}
