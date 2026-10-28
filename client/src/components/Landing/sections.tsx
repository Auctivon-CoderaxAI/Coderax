import { features, how, security, faq } from './content';
import { Reveal, SectionHeading, Tag } from './primitives';

export function Features() {
  return (
    <section id="product" className="border-t border-[#e4e7db] py-20 dark:border-white/10 sm:py-28">
      <div className="mx-auto w-full max-w-6xl px-5 sm:px-8">
        <Reveal>
          <SectionHeading eyebrow={features.eyebrow} title={features.title} description={features.description} />
        </Reveal>
        <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-[#e4e7db] bg-[#e4e7db] sm:grid-cols-2 lg:grid-cols-3 dark:border-white/10 dark:bg-white/10">
          {features.items.map((item, index) => (
            <Reveal key={item.title} delay={index * 50} className="bg-[#fbfcf7] dark:bg-[#0a0b09]">
              <article className="group h-full p-6 transition-colors hover:bg-[#f4f6ec] dark:hover:bg-white/[0.03]">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-[15px] font-medium tracking-[-0.01em] text-[#12140f] dark:text-[#f0f3ea]">
                    {item.title}
                  </h3>
                  <Tag>{item.tag}</Tag>
                </div>
                <p className="mt-3 text-[13px] leading-relaxed text-[#5c6650] dark:text-[#9aa68f]">
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
    <section id="how" className="border-t border-[#e4e7db] py-20 dark:border-white/10 sm:py-28">
      <div className="mx-auto w-full max-w-6xl px-5 sm:px-8">
        <div className="grid gap-12 lg:grid-cols-[0.85fr_1.15fr]">
          <Reveal>
            <SectionHeading eyebrow={how.eyebrow} title={how.title} />
          </Reveal>
          <ol className="space-y-8">
            {how.steps.map((step, index) => (
              <Reveal key={step.title} delay={index * 60}>
                <li className="grid grid-cols-[auto_1fr] gap-5 border-t border-[#e4e7db] pt-6 dark:border-white/10">
                  <span className="font-mono text-[11px] text-[#7c8a6a] dark:text-[#b6f24a]">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <div>
                    <h3 className="text-[15px] font-medium text-[#12140f] dark:text-[#f0f3ea]">{step.title}</h3>
                    <p className="mt-2 text-[13px] leading-relaxed text-[#5c6650] dark:text-[#9aa68f]">{step.body}</p>
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
    <section id="security" className="border-t border-[#e4e7db] bg-[#f4f6ec] py-20 dark:border-white/10 dark:bg-[#0a0b09] sm:py-28">
      <div className="mx-auto w-full max-w-6xl px-5 sm:px-8">
        <Reveal>
          <SectionHeading eyebrow={security.eyebrow} title={security.title} />
        </Reveal>
        <div className="mt-12 grid gap-8 sm:grid-cols-2">
          {security.points.map((point, index) => (
            <Reveal key={point.title} delay={index * 60}>
              <div className="border-l border-[#c9d0ba] pl-5 dark:border-white/15">
                <h3 className="text-[14px] font-medium text-[#12140f] dark:text-[#f0f3ea]">{point.title}</h3>
                <p className="mt-2 text-[13px] leading-relaxed text-[#5c6650] dark:text-[#9aa68f]">{point.body}</p>
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
    <section id="faq" className="border-t border-[#e4e7db] py-20 dark:border-white/10 sm:py-28">
      <div className="mx-auto w-full max-w-4xl px-5 sm:px-8">
        <Reveal>
          <SectionHeading eyebrow={faq.eyebrow} title={faq.title} />
        </Reveal>
        <div className="mt-10 divide-y divide-[#e4e7db] border-y border-[#e4e7db] dark:divide-white/10 dark:border-white/10">
          {faq.items.map((item) => (
            <details key={item.q} className="group py-1 [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-5 text-[14px] font-medium text-[#12140f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7c8a6a] dark:text-[#f0f3ea] dark:focus-visible:ring-[#b6f24a]">
                {item.q}
                <span className="relative h-3 w-3 shrink-0" aria-hidden="true">
                  <span className="absolute left-0 top-1/2 h-px w-3 -translate-y-1/2 bg-[#7c8a6a] dark:bg-[#b6f24a]" />
                  <span className="absolute left-1/2 top-0 h-3 w-px -translate-x-1/2 bg-[#7c8a6a] transition-transform duration-300 group-open:scale-y-0 dark:bg-[#b6f24a]" />
                </span>
              </summary>
              <p className="max-w-2xl pb-5 text-[13px] leading-relaxed text-[#5c6650] dark:text-[#9aa68f]">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
