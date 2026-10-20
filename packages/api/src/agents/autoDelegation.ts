type SubagentsConfig = { enabled?: boolean; [key: string]: unknown };

export type AutomaticDelegationInput = {
  text: string;
  capabilityEnabled: boolean;
  subagentsConfig?: SubagentsConfig;
  runtimeAvailable: boolean;
  additionalInstructions?: string;
};

export type AutomaticDelegationDecision = {
  delegate: boolean;
  reason:
    | 'complex-request'
    | 'simple-request'
    | 'agent-disabled'
    | 'capability-disabled'
    | 'runtime-unavailable';
};

export type AutomaticDelegationResult = AutomaticDelegationDecision & {
  subagentsConfig?: SubagentsConfig;
  additionalInstructions?: string;
};

const COMPLEX_TASK_SIGNAL =
  /\b(?:compare|contrast|trade[- ]?offs?|pros and cons|evaluate|assess|analy[sz]e|research|root cause|independent(?:ly)? verify|cross[- ]?check|audit|alternatives?|recommend(?:ation)? with rationale|design options)\b/i;
const MULTI_STAGE_SIGNAL =
  /\b(?:implement|fix|build|create|change|repair|investigate|diagnose|review|audit|plan)\b[\s\S]{0,180}\b(?:test|validate|verify|review|document|recommend|compare|then|and)\b/i;
const SPECIAL_CONTROL = /^\s*(?:approve|deny|reject|cancel|abort|stop)\b/i;
const USER_DELEGATION_OPTOUT =
  /\b(?:do not|don't|dont|never)\s+(?:(?:use|run|spawn|enable|invoke)\s+(?:any\s+)?(?:subagents?|child agents?)|delegate\b)|\bwithout\s+(?:subagents?|child agents?)\b/i;

export const AUTOMATIC_DELEGATION_INSTRUCTIONS: string = [
  'Automatic delegation is enabled for this complex turn; do not ask the user to choose an agent.',
  'First identify the useful capabilities and authorized agents already available to this run.',
  'Delegate up to two focused subtasks when they can materially improve the result. Run independent read-only reviews in parallel; run dependent work in order and pass only the context each child needs.',
  'Wait for delegated work to finish, then synthesize the results with evidence, disagreements, status, and remaining uncertainty.',
  'Use only the current run permissions and approval gates. Do not delegate secrets, approval decisions, or actions that the parent run is not authorized to perform.',
  'Keep simple follow-up questions in the parent agent. Do not recursively delegate from a child task.',
].join('\n');

export function isComplexRequest(value: unknown): value is string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length < 35 || SPECIAL_CONTROL.test(text) || USER_DELEGATION_OPTOUT.test(text)) {
    return false;
  }
  return COMPLEX_TASK_SIGNAL.test(text) || (text.length >= 100 && MULTI_STAGE_SIGNAL.test(text));
}

function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part: unknown) => {
      if (typeof part === 'string') return part;
      if (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string') {
        return part.text;
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

export function latestUserRequest(body: Record<string, unknown> = {}): string {
  for (const field of ['text', 'message', 'input']) {
    const value = body[field];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  if (Array.isArray(body.messages)) {
    for (let index = body.messages.length - 1; index >= 0; index -= 1) {
      const message = body.messages[index];
      if (
        message &&
        typeof message === 'object' &&
        'role' in message &&
        (message.role === 'user' || message.role === 'human')
      ) {
        const content = 'content' in message ? message.content : undefined;
        const parts = 'parts' in message ? message.parts : undefined;
        const text = contentText(content);
        if (text.trim()) return text.trim();
        const partsText = contentText(parts);
        if (partsText.trim()) return partsText.trim();
      }
    }
  }
  return '';
}

export function automaticDelegationDecision({
  text,
  capabilityEnabled,
  subagentsConfig,
  runtimeAvailable,
}: Pick<
  AutomaticDelegationInput,
  'text' | 'capabilityEnabled' | 'subagentsConfig' | 'runtimeAvailable'
>): AutomaticDelegationDecision {
  const candidate = isComplexRequest(text);
  const explicitlyDisabled = subagentsConfig?.enabled === false;
  const available = capabilityEnabled && runtimeAvailable && !explicitlyDisabled;
  let reason: AutomaticDelegationDecision['reason'] = 'complex-request';
  if (!candidate) reason = 'simple-request';
  else if (explicitlyDisabled) reason = 'agent-disabled';
  else if (!capabilityEnabled) reason = 'capability-disabled';
  else if (!runtimeAvailable) reason = 'runtime-unavailable';
  return { delegate: candidate && available, reason };
}

export function applyAutomaticDelegation({
  text,
  capabilityEnabled,
  subagentsConfig,
  runtimeAvailable,
  additionalInstructions,
}: AutomaticDelegationInput): AutomaticDelegationResult {
  const decision = automaticDelegationDecision({
    text,
    capabilityEnabled,
    subagentsConfig,
    runtimeAvailable,
  });
  if (!decision.delegate) return { ...decision, subagentsConfig, additionalInstructions };
  const existingInstructions = typeof additionalInstructions === 'string' ? additionalInstructions : '';
  const mergedInstructions = existingInstructions.includes(AUTOMATIC_DELEGATION_INSTRUCTIONS)
    ? existingInstructions
    : [existingInstructions, AUTOMATIC_DELEGATION_INSTRUCTIONS].filter(Boolean).join('\n\n');
  return {
    ...decision,
    subagentsConfig: subagentsConfig?.enabled
      ? subagentsConfig
      : { enabled: true, allowSelf: true, shareFiles: false },
    additionalInstructions: mergedInstructions,
  };
}
