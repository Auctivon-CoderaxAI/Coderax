const {
  handleError,
  applyModelSpecPreset,
  resolveModelSpecForEndpoint,
  resolveModelSpecPromptPrefixVariables,
  inspectContent,
  extractChatContent,
  contentFilterBlockResponse,
  applyRequestReasoningOverride,
} = require('@coderax/api');
const { logger } = require('@coderax/data-schemas');
const {
  EndpointURLs,
  EModelEndpoint,
  isAgentsEndpoint,
  isAssistantsEndpoint,
  parseCompactConvo,
  getDefaultParamsEndpoint,
  resolveEndpointType,
  selectAutomaticChatModel,
} = require('coderax-data-provider');
const azureAssistants = require('~/server/services/Endpoints/azureAssistants');
const assistants = require('~/server/services/Endpoints/assistants');
const { getEndpointsConfig } = require('~/server/services/Config');
const agents = require('~/server/services/Endpoints/agents');
const { getModelsConfig } = require('~/server/controllers/ModelController');
const { updateFilesUsage } = require('~/models');

const buildFunction = {
  [EModelEndpoint.agents]: agents.buildOptions,
  [EModelEndpoint.assistants]: assistants.buildOptions,
  [EModelEndpoint.azureAssistants]: azureAssistants.buildOptions,
};

/** Endpoints whose models run on the deployment's own hardware. */
const LOCAL_CHAT_ENDPOINTS = new Set(['ollama', 'lmstudio', 'local', 'llamacpp']);

const CHAT_ROUTE_MESSAGES = {
  CHAT_NO_AVAILABLE_MODEL:
    'Chat could not find an available configured model. Configure an available model, then try again.',
  CHAT_PAID_MODEL_CONSENT_REQUIRED:
    'Only paid models are available. Approve paid usage for this request or configure a free or local model.',
  CHAT_MODEL_CATALOG_UNAVAILABLE:
    'Chat could not load the available model catalog. Please try again shortly.',
};

const isLocalChatEndpoint = (endpoint) => LOCAL_CHAT_ENDPOINTS.has(String(endpoint).toLowerCase());

/** Flatten the authenticated server's currently available model catalog. */
function collectChatModelSources(modelsConfig, endpointsConfig) {
  if (modelsConfig == null || typeof modelsConfig !== 'object') {
    return [];
  }
  const sources = [];
  const push = (provider, entry, defaultLocal) => {
    if (entry == null) {
      return;
    }
    if (typeof entry === 'string') {
      sources.push({
        id: entry,
        provider,
        ...(defaultLocal ? { local: true } : {}),
      });
      return;
    }
    if (typeof entry !== 'object') {
      return;
    }
    const id = entry.id ?? entry.model ?? entry.name ?? entry.value ?? entry.label;
    if (typeof id !== 'string' || id.trim() === '') {
      return;
    }
    sources.push({
      id: id.trim(),
      label: entry.label ?? entry.name ?? id,
      provider,
      ...(entry.free === true ? { free: true } : {}),
      ...(entry.local === true || defaultLocal ? { local: true } : {}),
    });
  };

  for (const [endpoint, availableModels] of Object.entries(modelsConfig)) {
    const endpointConfig = endpointsConfig?.[endpoint];
    if (
      isAgentsEndpoint(endpoint) ||
      isAssistantsEndpoint(endpoint) ||
      endpoint === EModelEndpoint.azureAssistants ||
      endpointConfig == null ||
      endpointConfig?.enabled === false
    ) {
      continue;
    }
    const local = isLocalChatEndpoint(endpoint);
    (Array.isArray(availableModels) ? availableModels : []).forEach((entry) =>
      push(endpoint, entry, local),
    );
  }
  return sources;
}

/**
 * Work owns its selection, and agents/assistants own their model definition.
 * A model spec is an administrator-authored choice, so none of them is routed
 * here.
 */
function isAutomaticallyRoutedChat(req) {
  const body = req.body ?? {};
  const chatPath = new URL(EndpointURLs[EModelEndpoint.agents], 'http://coderax.local').pathname;
  if (
    !req.baseUrl?.startsWith(chatPath) ||
    req.workContext?.isWork === true ||
    req.path === '/resume'
  ) {
    return false;
  }
  if (body.agent_id || body.spec || body.ephemeralAgent) {
    return false;
  }
  return !isAgentsEndpoint(body.endpoint) && !isAssistantsEndpoint(body.endpoint);
}

/**
 * Replace any client-supplied Chat provider/model with the server's own
 * free/local choice. Paid candidates are never selected automatically; when
 * none is eligible the request fails closed instead of falling back to the
 * client's value.
 */
function applyServerChatRoute(req, endpointsConfig, modelsConfig) {
  const sources = collectChatModelSources(modelsConfig, endpointsConfig);
  const selection = selectAutomaticChatModel(sources);
  let model;
  if (selection.ok) {
    const allowed = [selection.model, ...selection.alternatives];
    const requestedProvider =
      typeof req.body?.endpoint === 'string' ? req.body.endpoint : req.params?.endpoint;
    const requestedId = typeof req.body?.model === 'string' ? req.body.model : undefined;
    model =
      allowed.find(
        (candidate) =>
          candidate.id === requestedId &&
          (requestedProvider == null || candidate.provider === requestedProvider),
      ) ?? selection.model;
  } else if (selection.paid != null && req.body?.paidModelConsent === true) {
    model = selection.paid;
  } else if (selection.paid != null) {
    return { error: 'CHAT_PAID_MODEL_CONSENT_REQUIRED' };
  } else {
    return { error: 'CHAT_NO_AVAILABLE_MODEL' };
  }

  req.body = req.body ?? {};
  delete req.body.paidModelConsent;
  req.body.endpoint = model.provider;
  req.body.model = model.id;
  req.body.modelLabel = model.label;
  const endpointType = model.provider
    ? resolveEndpointType(endpointsConfig, model.provider)
    : undefined;
  if (endpointType) {
    req.body.endpointType = endpointType;
  } else {
    delete req.body.endpointType;
  }
  return { model };
}

/**
 * Inspects only the user-authored value substituted for `{{current_user}}`.
 * The surrounding model-spec prompt is administrator-authored, so treating the
 * entire resolved prompt as user provenance would incorrectly apply user
 * content policy to static deployment configuration.
 *
 * `extractChatContent` deliberately gives prompt prefixes both prompt and
 * agent-instruction semantics, preserving the source-specific field controls
 * for the exact value that becomes model-bound.
 *
 * @param {ServerRequest} req
 * @param {unknown} promptPrefixTemplate
 * @returns {import('@coderax/api').ProtectionFinding | null}
 */
function inspectResolvedCurrentUser(req, promptPrefixTemplate) {
  if (
    typeof promptPrefixTemplate !== 'string' ||
    !/{{\s*current_user\s*}}/i.test(promptPrefixTemplate) ||
    !req.user?.name
  ) {
    return null;
  }

  return inspectContent(extractChatContent({ promptPrefix: String(req.user.name) }), {
    filters: req.config?.filters,
  });
}

async function buildEndpointOption(req, res, next) {
  let endpointsConfig;
  try {
    endpointsConfig = await getEndpointsConfig(req);
  } catch (error) {
    logger.error('Error fetching endpoints config in buildEndpointOption', error);
  }

  if (req.workContext?.isWork === true && req.workContext.workProvider) {
    req.body.endpoint = req.workContext.workProvider;
    req.body.endpointType = resolveEndpointType(endpointsConfig, req.workContext.workProvider);
  }

  /** Ordinary Chat has no picker: the server owns its model, not the request. */
  if (isAutomaticallyRoutedChat(req)) {
    let modelsConfig;
    try {
      req.automaticChatModelsPromise ??= getModelsConfig(req);
      modelsConfig = await req.automaticChatModelsPromise;
    } catch (error) {
      logger.error('Failed to load the automatic Chat model catalog', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      return res.status(503).json({
        error: 'CHAT_MODEL_CATALOG_UNAVAILABLE',
        message: CHAT_ROUTE_MESSAGES.CHAT_MODEL_CATALOG_UNAVAILABLE,
      });
    }

    const route = applyServerChatRoute(req, endpointsConfig, modelsConfig);
    if (route?.error) {
      return res.status(409).json({
        error: route.error,
        message: CHAT_ROUTE_MESSAGES[route.error],
      });
    }
  }

  const { endpoint, endpointType } = req.body;
  const isAgents =
    req.workContext?.isWork === true ||
    isAgentsEndpoint(endpoint) ||
    req.baseUrl.startsWith(EndpointURLs[EModelEndpoint.agents]);

  const defaultParamsEndpoint = getDefaultParamsEndpoint(endpointsConfig, endpoint);

  let parsedBody;
  try {
    parsedBody = parseCompactConvo({
      endpoint,
      endpointType,
      conversation: req.body,
      defaultParamsEndpoint,
    });
  } catch (error) {
    logger.error('Error parsing compact conversation', error);
    return handleError(res, { text: 'Error parsing conversation' });
  }

  const appConfig = req.config;
  let appliedModelSpecPrivateFields = new Set();
  let enforcedModelSpecFields = new Set();
  if (appConfig.modelSpecs?.list?.length && appConfig.modelSpecs?.enforce) {
    /** @type {{ list: TModelSpec[] }}*/
    const { list } = appConfig.modelSpecs;
    const rawSpec = req.body.spec;
    const spec = parsedBody.spec ?? (typeof rawSpec === 'string' ? rawSpec : undefined);
    const rawChatProjectId = req.body.chatProjectId;
    const parsedBodyForModelSpec =
      parsedBody.chatProjectId === undefined &&
      (typeof rawChatProjectId === 'string' || rawChatProjectId === null)
        ? { ...parsedBody, chatProjectId: rawChatProjectId }
        : parsedBody;

    if (!spec) {
      return handleError(res, { text: 'No model spec selected' });
    }

    const modelSpecResolution = resolveModelSpecForEndpoint({
      modelSpecs: { list },
      spec,
      endpoint,
    });
    if ('error' in modelSpecResolution) {
      return handleError(res, {
        text:
          modelSpecResolution.error === 'invalid-model-spec'
            ? 'Invalid model spec'
            : 'Model spec mismatch',
      });
    }
    const { modelSpec: currentModelSpec } = modelSpecResolution;

    try {
      const result = applyModelSpecPreset({
        modelSpec: currentModelSpec,
        parsedBody: parsedBodyForModelSpec,
        endpoint,
        endpointType,
        defaultParamsEndpoint,
        includePresetDefaults: true,
      });
      parsedBody = result.parsedBody;
      appliedModelSpecPrivateFields = result.appliedPrivateFields;
      enforcedModelSpecFields = result.enforcedFields;
    } catch (error) {
      logger.error('Error parsing model spec', error);
      return handleError(res, { text: 'Error parsing model spec' });
    }
  } else if (parsedBody.spec && appConfig.modelSpecs?.list) {
    const modelSpecResolution = resolveModelSpecForEndpoint({
      modelSpecs: appConfig.modelSpecs,
      spec: parsedBody.spec,
      endpoint,
    });
    if ('modelSpec' in modelSpecResolution) {
      const { modelSpec } = modelSpecResolution;

      try {
        const result = applyModelSpecPreset({
          modelSpec,
          parsedBody,
          endpoint,
          endpointType,
          defaultParamsEndpoint,
        });
        parsedBody = result.parsedBody;
        appliedModelSpecPrivateFields = result.appliedPrivateFields;
      } catch (error) {
        logger.error('Error parsing model spec', error);
        return handleError(res, { text: 'Error parsing model spec' });
      }
    } else if (modelSpecResolution.error === 'model-spec-mismatch') {
      return handleError(res, { text: 'Model spec mismatch' });
    }
  }

  if (!isAgents && appliedModelSpecPrivateFields.has('promptPrefix')) {
    const promptPrefixTemplate = parsedBody.promptPrefix;
    parsedBody = resolveModelSpecPromptPrefixVariables(
      parsedBody,
      req.user,
      req.body.clientTimestamp,
    );
    const finding = inspectResolvedCurrentUser(req, promptPrefixTemplate);
    if (finding != null) {
      return res.status(400).json(contentFilterBlockResponse(finding));
    }
  }

  try {
    const builder = isAgents
      ? (...args) => buildFunction[EModelEndpoint.agents](req, ...args)
      : buildFunction[endpointType ?? endpoint];

    // TODO: use object params
    req.body = req.body || {}; // Express 5: ensure req.body exists
    req.body.endpointOption = await builder(endpoint, parsedBody, endpointType);

    const reasoningApplied = await applyRequestReasoningOverride(req, {
      reasoningOverride: req.body.reasoningOverride,
      endpoint,
      endpointType,
      parsedModel: parsedBody.model,
      isAgent: isAgents,
      endpointsConfig,
      defaultParamsEndpoint,
      appliedModelSpecPrivateFields,
      enforcedModelSpecFields,
    });
    if (!reasoningApplied) {
      return handleError(res, { text: 'Invalid reasoning override' });
    }

    if (req.body.files && !isAgents) {
      req.body.endpointOption.attachments = updateFilesUsage(req.body.files, undefined, {
        user: req.user.id,
        tenantId: req.user.tenantId,
      });
    }

    next();
  } catch (error) {
    logger.error('Error building endpoint option', error);
    return handleError(res, { text: 'Error building endpoint option' });
  }
}

module.exports = buildEndpointOption;
