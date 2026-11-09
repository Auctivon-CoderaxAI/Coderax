import { Suspense } from 'react';
import type { ComponentProps } from 'react';
import { lazyWithRecovery } from '~/lib/assets/lazy';

const MarkdownContent = lazyWithRecovery(() => import('./MarkdownContent'));

type MarkdownProps = ComponentProps<typeof MarkdownContent>;

function MarkdownFallback({ content }: { content?: string }) {
  return <div className="whitespace-pre-wrap">{content}</div>;
}

/**
 * The thinking placeholder renders without the markdown chunk: a new answer shows
 * it on the very first token, before there is anything to parse, so waiting for
 * the chunk there would delay the one signal the user is looking for.
 */
export default function Markdown(props: MarkdownProps) {
  if (props.content === '') {
    return (
      <div className="absolute">
        <p className="relative">
          <span className={props.isLatestMessage ? 'result-thinking' : ''} />
        </p>
      </div>
    );
  }

  return (
    <Suspense fallback={<MarkdownFallback content={props.content} />}>
      <MarkdownContent {...props} />
    </Suspense>
  );
}
