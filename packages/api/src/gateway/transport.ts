import type { GatewayAuthorityMode, GatewayConfig } from './config';

/**
 * Transport selection is the migration seam.
 *
 * Exactly one transport is authoritative for a conversation. A conversation is
 * never mirrored, dual-written or raced between the in-repository engine and the
 * external WorkflowEngine, because two owners of one conversation would produce
 * two divergent task histories and no trustworthy rollback point.
 *
 * Selection is intentionally reversible and stateless:
 * - `authority: 'native'` (the default) keeps everything on the existing engine.
 * - `engineConversations` moves named conversations to the external engine.
 * - `nativeConversations` always wins, so a rollback is a config edit, not data.
 * - `authority: 'engine'` moves everything except the rollback list.
 */
export type ConversationAuthority = GatewayAuthorityMode;

export type TransportSelector = {
  mode: GatewayAuthorityMode;
  authorityForConversation: (conversationId: string | undefined) => ConversationAuthority;
  authorityForNewConversation: () => ConversationAuthority;
  /** True when any conversation is currently served by the external engine. */
  engineReachable: () => boolean;
  describe: () => {
    mode: GatewayAuthorityMode;
    engineConversations: number;
    nativeConversations: number;
    reversible: true;
  };
};

export function createTransportSelector(config: GatewayConfig): TransportSelector {
  const engine = new Set(config.engineConversations);
  const native = new Set(config.nativeConversations);

  const authorityForConversation = (conversationId: string | undefined): ConversationAuthority => {
    if (conversationId == null || conversationId.length === 0) {
      return authorityForNewConversation();
    }
    if (native.has(conversationId)) {
      return 'native';
    }
    if (engine.has(conversationId)) {
      return 'engine';
    }
    return config.authority;
  };

  const authorityForNewConversation = (): ConversationAuthority => config.authority;

  return {
    mode: config.authority,
    authorityForConversation,
    authorityForNewConversation,
    engineReachable: () => config.authority === 'engine' || config.engineConversations.length > 0,
    describe: () => ({
      mode: config.authority,
      engineConversations: config.engineConversations.length,
      nativeConversations: config.nativeConversations.length,
      reversible: true,
    }),
  };
}
