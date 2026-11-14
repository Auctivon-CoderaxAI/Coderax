import { features, how, security, faq } from './content';
import { Reveal, SectionHeading, Tag } from './primitives';

export function Features() {
  return (
    <section id="product" className="border-t border-border-light py-20 sm:py-28">
      <div className="mx-auto w-full max-w-6xl px-5 sm:px-8">
        <Reveal>
          <SectionHeading eyebrow={features.eyebrow} title={features.title} description={features.description} />
        </Reveal>
        <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-border-light bg-border-light sm:grid-cols-2 lg:grid-cols-3">
          {features.items.map((item, index) => (
            <Reveal key={item.title} delay={index * 50} className="bg-surface-primary">
              <article className="group h-full p-6 transition-colors hover:bg-surface-hover">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-base font-medium tracking-tight text-text-primary">
                    {item.title}
                  </h3>
                  <Tag>{item.tag}</Tag>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-text-secondary">
                  {item.description}
                </p>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

export function HowItWorks() {
  return (
    <section id="how" className="border-t border-border-light py-20 sm:py-28">
      <div className="mx-auto w-full max-w-6xl px-5 sm:px-8">
        <div className="grid gap-12 lg:grid-cols-[0.85fr_1.15fr]">
          <Reveal>
            <SectionHeading eyebrow={how.eyebrow} title={how.title} />
          </Reveal>
          <ol className="space-y-8">
            {how.steps.map((step, index) => (
              <Reveal key={step.title} delay={index * 60}>
                <li className="grid grid-cols-[auto_1fr] gap-5 border-t border-border-light pt-6">
                  <span className="font-mono text-xs text-accent-primary">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <div>
                    <h3 className="text-base font-medium text-text-primary">{step.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-text-secondary">{step.body}</p>
                  </div>
                </li>
              </Reveal>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

export function Security() {
  return (
    <section id="security" className="border-t border-border-light bg-surface-secondary py-20 sm:py-28">
      <div className="mx-auto w-full max-w-6xl px-5 sm:px-8">
        <Reveal>
          <SectionHeading eyebrow={security.eyebrow} title={security.title} />
        </Reveal>
        <div className="mt-12 grid gap-8 sm:grid-cols-2">
          {security.points.map((point, index) => (
            <Reveal key={point.title} delay={index * 60}>
              <div className="border-l border-border-medium pl-5">
                <h3 className="text-sm font-medium text-text-primary">{point.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-text-secondary">{point.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

export function Faq() {
  return (
    <section id="faq" className="border-t border-border-light py-20 sm:py-28">
      <div className="mx-auto w-full max-w-4xl px-5 sm:px-8">
        <Reveal>
          <SectionHeading eyebrow={faq.eyebrow} title={faq.title} />
        </Reveal>
        <div className="mt-10 divide-y divide-border-light border-y border-border-light">
          {faq.items.map((item) => (
            <details key={item.q} className="group py-1 [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-5 text-sm font-medium text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring-primary">
                {item.q}
                <span className="relative h-3 w-3 shrink-0" aria-hidden="true">
                  <span className="absolute left-0 top-1/2 h-px w-3 -translate-y-1/2 bg-accent-primary" />
                  <span className="absolute left-1/2 top-0 h-3 w-px -translate-x-1/2 bg-accent-primary transition-transform duration-300 group-open:scale-y-0 motion-reduce:transition-none" />
                </span>
              </summary>
              <p className="max-w-2xl pb-5 text-sm leading-relaxed text-text-secondary">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
