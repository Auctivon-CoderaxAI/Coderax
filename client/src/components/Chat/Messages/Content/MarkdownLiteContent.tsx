import './markdownSetup';
import { memo } from 'react';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import supersub from 'remark-supersub';
import rehypeHighlight from 'rehype-highlight';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import type { PluggableList } from 'unified';
import { code, codeNoExecution, a, p, img, table } from './MarkdownComponents';
import { CodeBlockProvider, ArtifactProvider } from '~/Providers';
import MarkdownErrorBoundary from './MarkdownErrorBoundary';
import { remarkApproxTilde } from '~/utils/tilde';
import { langSubset } from '~/utils/languages';

type MarkdownLiteProps = {
  content?: string;
  codeExecution?: boolean;
  components?: { [nodeType: string]: React.ElementType };
  className?: string;
};

const liteUrlTransform = (url: string): string =>
  url.toLowerCase().startsWith('tel:') ? url : defaultUrlTransform(url);

const MarkdownLite = memo(
  ({ content = '', codeExecution = true, components, className }: MarkdownLiteProps) => {
    const rehypePlugins: PluggableList = [
      [rehypeKatex],
      [
        rehypeHighlight,
        {
          detect: true,
          ignoreMissing: true,
          subset: langSubset,
        },
      ],
    ];

    return (
      <MarkdownErrorBoundary content={content} codeExecution={codeExecution}>
        <ArtifactProvider>
          <CodeBlockProvider>
            <ReactMarkdown
              remarkPlugins={[
                remarkApproxTilde,
                /** @ts-ignore */
                supersub,
                remarkGfm,
                [remarkMath, { singleDollarTextMath: false }],
              ]}
              /** @ts-ignore */
              rehypePlugins={rehypePlugins}
              urlTransform={liteUrlTransform}
              className={className ?? 'markdown prose light w-full break-words'}
              components={
                {
                  code: codeExecution ? code : codeNoExecution,
                  a,
                  p,
                  img,
                  table,
                  ...components,
                } as {
                  [nodeType: string]: React.ElementType;
                }
              }
            >
              {content}
            </ReactMarkdown>
          </CodeBlockProvider>
        </ArtifactProvider>
      </MarkdownErrorBoundary>
    );
  },
);

export default MarkdownLite;
