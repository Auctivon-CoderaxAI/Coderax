import { Suspense } from 'react';
import type { ComponentProps } from 'react';
import { lazyWithRecovery } from '~/lib/assets/lazy';

const MarkdownLiteContent = lazyWithRecovery(() => import('./MarkdownLiteContent'));

type MarkdownLiteProps = ComponentProps<typeof MarkdownLiteContent>;

function MarkdownLiteFallback({ content }: { content?: string }) {
  return <span className="whitespace-pre-wrap">{content}</span>;
}

export default function MarkdownLite(props: MarkdownLiteProps) {
  return (
    <Suspense fallback={<MarkdownLiteFallback content={props.content} />}>
      <MarkdownLiteContent {...props} />
    </Suspense>
  );
}
