import type { FiltersConfig } from 'coderax-data-provider';
import type { TurnConversationRequest } from './save';
import { resolveConversationTitle, SAFE_CONVERSATION_TITLE } from '~/protection/title';
import { getSafeErrorMetadata } from '~/utils/errors';
import { publishConversationTitle } from './title';
import { isEnabled } from '~/utils/common';

const TITLE_MAX_LENGTH = 80;

function fallbackTitleFromText(text: string): string | null {
  const normalized = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
  if (normalized === '') return null;
  return normalized.length > TITLE_MAX_LENGTH
    ? `${normalized.slice(0, TITLE_MAX_LENGTH - 1)}…`
    : normalized;
}

type TitleRequest = TurnConversationRequest & { config?: { filters?: FiltersConfig } };
type Publication = Parameters<typeof publishConversationTitle>[1];
type TitleOptions = Pick<
  Publication,
  'convoReady' | 'signal' | 'discardSignal' | 'onTitleGenerated'
> & {
  text: string;
  response?: { conversationId?: string };
  conversationId?: string;
  immediate?: boolean;
  client: {
    options: { titleConvo?: boolean };
    titleConvo?: (args: {
      text: string;
      abortController: AbortController;
      immediate: boolean;
    }) => Promise<string | null | undefined>;
  };
};

type Dependencies = Omit<Parameters<typeof publishConversationTitle>[0], 'titleCache'> & {
  getTitleCache: () => Parameters<typeof publishConversationTitle>[0]['titleCache'];
  titleEnabled: () => string | boolean;
  logger: {
    warn: (message: string) => void;
    error: (message: string, metadata: ReturnType<typeof getSafeErrorMetadata>) => void;
  };
};

/** Generate or derive the title without replacing a user rename or superseding run. */
export function createAgentTitleService({
  saveConvo,
  getConvo,
  getTitleCache,
  titleEnabled,
  logger,
}: Dependencies) {
  return async function addTitle(
    req: TitleRequest,
    {
      text,
      response,
      client,
      conversationId,
      immediate = false,
      convoReady,
      signal,
      discardSignal,
      onTitleGenerated,
    }: TitleOptions,
  ): Promise<void> {
    if (
      !isEnabled(titleEnabled()) ||
      client.options.titleConvo === false ||
      req.body?.isTemporary
    ) {
      return;
    }
    const userId = req.user?.id;
    if (!userId) {
      logger.warn('[addTitle] Missing user ID; skipping title generation');
      return;
    }
    const convoId = conversationId ?? response?.conversationId;
    if (!convoId) {
      logger.warn('[addTitle] Missing conversationId; skipping title generation');
      return;
    }

    try {
      let generatedTitle: string | null | undefined;
      if (typeof client.titleConvo === 'function') {
        const abortController = new AbortController();
        const abort = () => abortController.abort();
        if (signal?.aborted) abort();
        else signal?.addEventListener('abort', abort, { once: true });
        let timeoutId: NodeJS.Timeout | undefined;
        try {
          const timeout = new Promise<undefined>((resolve) => {
            timeoutId = setTimeout(() => {
              logger.warn('[addTitle] Title generation timed out');
              resolve(undefined);
            }, 45_000);
          });
          generatedTitle = await Promise.race([
            client.titleConvo({ text, abortController, immediate }).catch((error) => {
              logger.error('[addTitle] Client title error', getSafeErrorMetadata(error));
              return undefined;
            }),
            timeout,
          ]);
        } finally {
          clearTimeout(timeoutId);
          signal?.removeEventListener('abort', abort);
          abort();
        }
      }

      const title = resolveConversationTitle({
        filters: req.config?.filters,
        candidate: generatedTitle || fallbackTitleFromText(text),
      });
      if (title == null || (!generatedTitle && title === SAFE_CONVERSATION_TITLE)) return;
      await publishConversationTitle(
        { saveConvo, getConvo, titleCache: getTitleCache() },
        {
          ctx: {
            userId,
            isTemporary: req.resolvedConversation?.isTemporary ?? req.body?.isTemporary,
            expiredAt: req.resolvedConversation?.expiredAt,
            interfaceConfig: req.config?.interfaceConfig,
          },
          conversationId: convoId,
          title,
          convoReady,
          signal,
          discardSignal,
          onTitleGenerated,
        },
      );
    } catch (error) {
      logger.error('[addTitle] Error generating title', getSafeErrorMetadata(error));
    }
  };
}
