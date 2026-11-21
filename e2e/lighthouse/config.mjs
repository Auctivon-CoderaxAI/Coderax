import { Audit, Gatherer } from 'lighthouse';
import desktopConfig from 'lighthouse/core/config/desktop-config.js';

const auditId = 'observed-lcp-element';

class LcpCandidate extends Gatherer {
  meta = { supportedModes: ['navigation'] };

  async startInstrumentation({ driver }) {
    await driver.executionContext.evaluateOnNewDocument(
      () => {
        if (
          window !== window.top ||
          !PerformanceObserver.supportedEntryTypes.includes('largest-contentful-paint')
        ) {
          return;
        }
        // Capture the candidate at paint time, before an SPA can detach its node.
        const observer = new PerformanceObserver((list) => {
          const entry = list.getEntries().at(-1);
          if (entry) {
            window.__coderaxLcpCandidate = {
              time: entry.startTime,
              text: entry.element?.textContent?.trim().slice(0, 512) ?? '',
            };
          }
        });
        observer.observe({ type: 'largest-contentful-paint', buffered: true });
      },
      { args: [] },
    );
  }

  getArtifact({ driver }) {
    return driver.executionContext.evaluate(() => window.__coderaxLcpCandidate ?? null, {
      args: [],
      useIsolation: false,
    });
  }
}

class LcpElementAudit extends Audit {
  static get meta() {
    return {
      id: auditId,
      title: 'Observed LCP element',
      description: 'Identifies the last main-document LCP candidate during this navigation.',
      scoreDisplayMode: Audit.SCORING_MODES.INFORMATIVE,
      requiredArtifacts: ['LcpCandidate'],
    };
  }

  static audit({ LcpCandidate }) {
    return {
      score: null,
      details: { type: 'debugdata', candidate: LcpCandidate },
    };
  }
}

export default {
  ...desktopConfig,
  artifacts: [{ id: 'LcpCandidate', gatherer: LcpCandidate }],
  audits: [LcpElementAudit],
  categories: { performance: { auditRefs: [{ id: auditId, weight: 0 }] } },
};
