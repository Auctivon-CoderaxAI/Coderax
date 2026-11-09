import { Suspense } from 'react';
import type { ComponentProps } from 'react';
import { lazyWithRecovery } from '~/lib/assets/lazy';

const MarkdownContent = lazyWithRecovery(() => import('./MarkdownContent'));

type MarkdownProps = ComponentProps<typeof MarkdownContent>;

function MarkdownFallback({ content }: { content?: string }) {
  return <div className="whitespace-pre-wrap">{content}</div>;
}

export default function Markdown(props: MarkdownProps) {
  return (
    <Suspense fallback={<MarkdownFallback content={props.content} />}>
      <MarkdownContent {...props} />
    </Suspense>
  );
}
