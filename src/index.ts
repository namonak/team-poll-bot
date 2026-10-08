import express from 'express';
import { pathToFileURL } from 'node:url';
import {
  ActivityHandler, CardFactory, MessageFactory, CloudAdapter, authorizeJWT, getAuthConfigWithDefaults,
  type TurnContext, type AdaptiveCardInvokeValue, type AdaptiveCardInvokeResponse,
} from '@microsoft/agents-hosting';
import { buildCreateCard, buildHelpCard, buildPollCard } from './cards.js';
import { parseCommand, PollError } from './domain.js';
import { PollService, type Actor, type Transport } from './service.js';
import { Store } from './store.js';
import { startScheduler } from './scheduler.js';

export function cardActionResponse(message: string, accepted = true) {
  return accepted
    ? { statusCode: 200, type: 'application/vnd.microsoft.activity.message', value: message }
    : { statusCode: 400, type: 'application/vnd.microsoft.error', value: { code: 'BadRequest', message } };
}

export async function dispatchAction(service: PollService, actor: Actor, action: unknown): Promise<string> {
  if (!action || typeof action !== 'object') throw new PollError('앗, 버튼을 다시 눌러줘요 🐾');
  const { verb, data } = action as { verb?: unknown; data?: unknown };
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new PollError('앗, 카드 내용을 다시 확인해줘요 🐻');
  const fields = data as Record<string, unknown>;
  if (verb === 'pollCreate' && typeof fields.draftId === 'string' && fields.draftId.length <= 100) {
    await service.create(actor, fields.draftId, fields);
    return '투표를 시작했어요! 아래 결과판에 마음을 모아줘요 🐻';
  }
  if (typeof fields.pollId !== 'string' || fields.pollId.length > 100) throw new PollError('앗, 투표 카드를 다시 확인해줘요 🐻');
  if (verb === 'pollVote') return service.vote(actor, fields.pollId, fields.choices);
  if (verb === 'pollClose') return service.close(actor, fields.pollId);
  if (verb === 'pollRefresh') return service.refresh(actor, fields.pollId);
  throw new PollError('이 버튼은 아직 모르겠어요. 투표곰을 다시 불러줘요 🐻');
}

export class PollBot extends ActivityHandler {
  constructor(private service: PollService, private store: Store) {
    super();
    this.onMessage(async (context, next) => {
      try {
        const actor = this.remember(context);
        context.activity.removeRecipientMention();
        const command = parseCommand(context.activity.text ?? '');
        if (command === 'create') {
          const draft = service.createDraft(actor);
          const sent = await context.sendActivity(MessageFactory.attachment(CardFactory.adaptiveCard(buildCreateCard(draft.id))));
          if (sent?.id) store.setDraftMessage(draft.id, sent.id);
        } else await context.sendActivity(MessageFactory.attachment(CardFactory.adaptiveCard(buildHelpCard(command === 'invalid'))));
      } catch (error) {
        await context.sendActivity(error instanceof PollError ? error.message : '앗, 준비 카드를 펼치지 못했어요. 잠시 뒤 다시 불러줘요 🐻');
      }
      await next();
    });
  }
  private remember(context: TurnContext): Actor {
    const activity = context.activity;
    if (activity.channelId !== 'msteams' || activity.conversation?.conversationType !== 'groupChat' || !activity.conversation.id || !activity.from?.id)
      throw new PollError('투표곰은 Teams 단체 대화방에서 함께해요. 대화방으로 불러줘요 🐻');
    this.store.activateConversation(activity.conversation.id, activity.getConversationReference());
    return { conversationId: activity.conversation.id, userId: activity.from.id, userName: activity.from.name ?? '곰 친구' };
  }
  protected override async onAdaptiveCardInvoke(context: TurnContext, invoke: AdaptiveCardInvokeValue): Promise<AdaptiveCardInvokeResponse> {
    try {
      const actor = this.remember(context);
      return cardActionResponse(await dispatchAction(this.service, actor, invoke.action)) as unknown as AdaptiveCardInvokeResponse;
    } catch (error) {
      if (!(error instanceof PollError)) console.error('투표곰 카드 동작을 다시 확인해줘요 🐻');
      return cardActionResponse(error instanceof PollError ? error.message : '앗, 선택을 확인하지 못했어요. 잠시 뒤 다시 눌러줘요 🐻', false) as AdaptiveCardInvokeResponse;
    }
  }
}

export function createTeamsTransport(adapter: CloudAdapter, appId: string, store: Store): Transport {
  // SDK 기본 처리기는 오류를 삼키므로 저장된 집계의 재시도 판단까지 전파한다.
  adapter.onTurnError = async (_context, error) => { throw error; };
  const withConversation = async (conversationId: string, work: (context: TurnContext) => Promise<void>) => {
    const reference = store.conversationReference(conversationId);
    if (!reference) throw new Error('missing-conversation-reference');
    await adapter.continueConversation(appId, reference as Parameters<CloudAdapter['continueConversation']>[1], work);
  };
  return {
    async publish(poll) {
      let messageId: string | undefined;
      await withConversation(poll.conversationId, async context => {
        const sent = await context.sendActivity(MessageFactory.attachment(CardFactory.adaptiveCard(buildPollCard(poll))));
        messageId = sent?.id;
      });
      if (!messageId) throw new Error('missing-message-id');
      return messageId;
    },
    async update(poll) {
      await withConversation(poll.conversationId, async context => {
        const message = MessageFactory.attachment(CardFactory.adaptiveCard(buildPollCard(poll)));
        message.id = poll.messageId!;
        message.conversation = context.activity.conversation;
        await context.updateActivity(message);
      });
    },
  };
}

export function createApp(env: NodeJS.ProcessEnv = process.env) {
  for (const key of ['MicrosoftAppId', 'MicrosoftAppPassword', 'MicrosoftAppTenantId'])
    if (!env[key]?.trim()) throw new Error(`투표곰을 깨우려면 ${key} 설정이 필요해요 🐻`);
  const appId = env.MicrosoftAppId!;
  const auth = getAuthConfigWithDefaults({ clientId: appId, clientSecret: env.MicrosoftAppPassword, tenantId: env.MicrosoftAppTenantId });
  const adapter = new CloudAdapter(auth);
  const store = Store.open(env.DATABASE_PATH ?? './data/team-poll-bot.sqlite');
  const service = new PollService(store, createTeamsTransport(adapter, appId, store));
  const bot = new PollBot(service, store);
  const stopScheduler = startScheduler(service);
  const app = express();
  app.locals.dispose = () => { stopScheduler(); store.close(); };
  app.get('/healthz', (_request, response) => response.json({ ok: true }));
  app.post('/api/messages', authorizeJWT(auth), express.json({ limit: '64kb' }), async (request, response) => {
    await adapter.process(request, response, context => bot.run(context));
  });
  app.use((error: { status?: number }, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    const status = error.status === 413 ? 413 : error.status === 400 ? 400 : 500;
    response.status(status).json({ error: '앗, 요청을 확인하지 못했어요. 잠시 뒤 다시 불러줘요 🐻' });
  });
  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const app = createApp();
  const port = Number(process.env.PORT ?? 3978);
  const server = app.listen(port, () => console.log(`🐻 투표곰이 ${port}번 문을 열었어요!`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close(() => { app.locals.dispose(); process.exit(0); }));
}
