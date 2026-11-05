import ChatRoute from './ChatRoute';

/** Preserve legacy deep links without creating a second shell or composer. */
export default function WorkRoute() {
  return <ChatRoute workMode />;
}
