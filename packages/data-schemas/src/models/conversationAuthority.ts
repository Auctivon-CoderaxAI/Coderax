import { Model } from 'mongoose';
import type { IConversationAuthority } from '~/types/conversationAuthority';
import conversationAuthoritySchema from '~/schema/conversationAuthority';

/** Durable conversation authority shared by every API replica. */
export function createConversationAuthorityModel(
  mongoose: typeof import('mongoose'),
): Model<IConversationAuthority> {
  return (
    mongoose.models.ConversationAuthority ||
    mongoose.model<IConversationAuthority>('ConversationAuthority', conversationAuthoritySchema)
  );
}
