import { createContext, useContext } from 'react';
import type { AutomaticChatModel, ModelRouteCandidate } from 'coderax-data-provider';
import type { AutomaticChatTransportController } from './automaticChatTransport';

export type ChatModelRouting = AutomaticChatTransportController & {
  selection: AutomaticChatModel;
  consentModel: ModelRouteCandidate | null;
  unavailable: boolean;
};

export const ChatModelRoutingContext = createContext<ChatModelRouting | null>(null);

export function useChatModelRouting(): ChatModelRouting | null {
  return useContext(ChatModelRoutingContext);
}
