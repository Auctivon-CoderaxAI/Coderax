import { useMemo, useCallback } from 'react';
import { SquareTerminal } from 'lucide-react';
import { EModelEndpoint, Constants } from 'coderax-data-provider';
import {
  useGetAssistantDocsQuery,
  useGetEndpointsQuery,
  useGetStartupConfig,
} from '~/data-provider';
import { useChatContext, useAgentsMapContext, useAssistantsMapContext } from '~/Providers';
import { getIconEndpoint, getEntity, getModelSpec } from '~/utils';
import { useSubmitMessage, useLocalize } from '~/hooks';

const ConversationStarters = () => {
  const { conversation } = useChatContext();
  const agentsMap = useAgentsMapContext();
  const assistantMap = useAssistantsMapContext();
  const { data: endpointsConfig } = useGetEndpointsQuery();
  const { data: startupConfig } = useGetStartupConfig();

  const endpointType = useMemo(() => {
    let ep = conversation?.endpoint ?? '';
    if (ep === EModelEndpoint.azureOpenAI) {
      ep = EModelEndpoint.openAI;
    }
    return getIconEndpoint({
      endpointsConfig,
      iconURL: conversation?.iconURL,
      endpoint: ep,
    });
  }, [conversation?.endpoint, conversation?.iconURL, endpointsConfig]);

  const { data: documentsMap = new Map() } = useGetAssistantDocsQuery(endpointType, {
    select: (data) => new Map(data.map((dbA) => [dbA.assistant_id, dbA])),
  });

  const { entity, isAgent } = getEntity({
    endpoint: endpointType,
    agentsMap,
    assistantMap,
    agent_id: conversation?.agent_id,
    assistant_id: conversation?.assistant_id,
  });

  const modelSpec = useMemo(
    () => getModelSpec({ specName: conversation?.spec, startupConfig }),
    [conversation?.spec, startupConfig],
  );

  const conversation_starters = useMemo(() => {
    if (entity?.conversation_starters?.length) {
      return entity.conversation_starters;
    }

    if (modelSpec?.conversation_starters?.length) {
      return modelSpec.conversation_starters;
    }

    if (isAgent) {
      return [];
    }

    return documentsMap.get(entity?.id ?? '')?.conversation_starters ?? [];
  }, [documentsMap, isAgent, entity, modelSpec]);

  const localize = useLocalize();
  const { submitMessage } = useSubmitMessage();
  const sendConversationStarter = useCallback(
    (text: string) => submitMessage({ text }),
    [submitMessage],
  );

  /* A deployment with no configured starters still offers one actionable prompt,
     as in the approved design, rather than leaving the band empty. */
  const starters = conversation_starters.length
    ? conversation_starters.slice(0, Constants.MAX_CONVO_STARTERS)
    : [localize('com_ui_default_starter')];

  return (
    <div className="mt-1 mb-8 flex w-full flex-col items-center gap-1.5 px-4">
      {starters.map((text: string, index: number) => (
        <button
          key={index}
          onClick={() => sendConversationStarter(text)}
          style={{ animationDelay: `${index * 75}ms`, animationFillMode: 'backwards' }}
          className="text-text-secondary hover:text-text-primary focus-visible:ring-text-primary fade-in flex max-w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm outline-hidden transition-colors duration-200 focus-visible:ring-2"
        >
          <span
            aria-hidden="true"
            className="bg-status-info-subtle text-status-info flex size-6 shrink-0 items-center justify-center rounded-md"
          >
            <SquareTerminal className="size-4" />
          </span>
          <span className="truncate">{text}</span>
        </button>
      ))}
    </div>
  );
};

export default ConversationStarters;
