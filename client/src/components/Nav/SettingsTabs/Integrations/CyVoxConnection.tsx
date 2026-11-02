import { useEffect, useRef, useState } from 'react';
import { Button, Input, Label, SecretInput, Spinner, useToastContext } from '@coderax/client';
import type { TCyVoxConnectionStatus, TCyVoxConnectionTestErrorCode } from 'coderax-data-provider';
import type { TranslationKeys } from '~/hooks';
import {
  useGetCyVoxConnectionQuery,
  useTestCyVoxConnectionMutation,
  useUpdateCyVoxConnectionMutation,
} from '~/data-provider';
import { useLocalize } from '~/hooks';

type TestState = 'idle' | 'checking' | 'connected' | 'failed';

function testErrorKey(code: TCyVoxConnectionTestErrorCode): TranslationKeys {
  switch (code) {
    case 'invalid_credentials':
      return 'com_ui_cyvox_test_error_invalid_credentials';
    case 'access_denied':
      return 'com_ui_cyvox_test_error_access_denied';
    case 'invalid_endpoint':
      return 'com_ui_cyvox_test_error_invalid_endpoint';
    case 'rate_limited':
      return 'com_ui_cyvox_test_error_rate_limited';
    case 'server_error':
      return 'com_ui_cyvox_test_error_server_error';
    case 'timeout':
      return 'com_ui_cyvox_test_error_timeout';
    case 'missing_configuration':
      return 'com_ui_cyvox_test_error_missing_configuration';
    case 'stored_secret_unavailable':
      return 'com_ui_cyvox_test_error_stored_secret_unavailable';
    case 'unexpected_response':
      return 'com_ui_cyvox_test_error_unexpected_response';
    case 'unreachable':
    default:
      return 'com_ui_cyvox_test_error_unreachable';
  }
}

/**
 * Tenant-wide Coderax Work connection. The access token is write-only: the
 * server returns a masked preview and never the stored value.
 */
export default function CyVoxConnection() {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const { data, isLoading, isError, refetch, isFetching } = useGetCyVoxConnectionQuery();
  const updateMutation = useUpdateCyVoxConnectionMutation();
  const testMutation = useTestCyVoxConnectionMutation();

  const [status, setStatus] = useState<TCyVoxConnectionStatus>();
  const [baseUrl, setBaseUrl] = useState('');
  const [authToken, setAuthToken] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [editingToken, setEditingToken] = useState(false);
  const [testState, setTestState] = useState<TestState>('idle');
  const [testMessage, setTestMessage] = useState('');
  const [details, setDetails] = useState<{
    capabilities?: string[];
    apiVersion?: string;
    latencyMs?: number;
  }>({});
  const tokenInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (data) {
      setStatus(data);
    }
  }, [data]);

  useEffect(() => {
    if (!status) {
      return;
    }
    setBaseUrl(status.baseUrl ?? '');
    setEnabled(status.enabled);
  }, [status]);

  useEffect(() => {
    if (editingToken) {
      tokenInputRef.current?.focus();
    }
  }, [editingToken]);

  const trimmedBaseUrl = baseUrl.trim();
  const trimmedToken = authToken.trim();
  const busy = updateMutation.isLoading || testMutation.isLoading;
  const canSave =
    trimmedBaseUrl !== '' && (trimmedToken !== '' || status?.tokenConfigured === true);

  const handleSave = () => {
    if (!canSave || busy) {
      return;
    }
    updateMutation.mutate(
      {
        enabled,
        baseUrl: trimmedBaseUrl,
        ...(trimmedToken ? { authToken: trimmedToken } : {}),
      },
      {
        onSuccess: (next) => {
          setStatus(next);
          setAuthToken('');
          setEditingToken(false);
          setTestState('idle');
          setTestMessage('');
          showToast({ message: localize('com_ui_cyvox_saved'), status: 'success' });
        },
        onError: () => {
          showToast({ message: localize('com_ui_cyvox_save_error'), status: 'error' });
        },
      },
    );
  };

  const handleTest = () => {
    if (busy) {
      return;
    }
    setTestState('checking');
    setTestMessage('');
    testMutation.mutate(
      trimmedBaseUrl
        ? { baseUrl: trimmedBaseUrl, ...(trimmedToken ? { authToken: trimmedToken } : {}) }
        : {},
      {
        onSuccess: (result) => {
          if (result.success) {
            setTestState('connected');
            setTestMessage('');
            setDetails({
              capabilities: result.capabilities,
              apiVersion: result.apiVersion,
              latencyMs: result.latencyMs,
            });
            return;
          }
          setDetails({});
          setTestState('failed');
          setTestMessage(localize(testErrorKey(result.errorCode)));
        },
        onError: () => {
          setTestState('failed');
          setTestMessage(localize('com_ui_cyvox_test_error'));
        },
      },
    );
  };

  if (isLoading && status == null) {
    return (
      <div className="border-border-light flex items-center justify-center rounded-xl border py-12">
        <Spinner className="h-6 w-6" />
        <span className="sr-only">{localize('com_ui_loading')}</span>
      </div>
    );
  }

  if (isError && status == null) {
    return (
      <div className="border-border-light flex flex-col items-center gap-3 rounded-xl border px-6 py-10 text-center">
        <p className="text-text-secondary text-sm">{localize('com_ui_cyvox_load_error')}</p>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          {localize('com_ui_retry')}
        </Button>
      </div>
    );
  }

  let statusLabel = localize('com_ui_cyvox_status_not_configured');
  if (testState === 'checking') {
    statusLabel = localize('com_ui_cyvox_status_checking');
  } else if (testState === 'connected') {
    statusLabel = localize('com_ui_cyvox_status_connected');
  } else if (testState === 'failed') {
    statusLabel = testMessage || localize('com_ui_cyvox_status_failed');
  } else if (status?.enabled) {
    statusLabel = localize('com_ui_cyvox_status_configured');
  } else if (status?.configured) {
    statusLabel = localize('com_ui_cyvox_status_disabled');
  }

  let dotClass = 'border border-border-medium';
  if (testState === 'connected') {
    dotClass = 'bg-status-success';
  } else if (testState === 'failed') {
    dotClass = 'bg-status-error';
  } else if (testState === 'checking') {
    dotClass = 'bg-status-warning';
  } else if (status?.enabled) {
    dotClass = 'bg-status-success';
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <div className="font-medium">{localize('com_ui_cyvox_title')}</div>
          <p className="text-text-secondary mt-1 text-sm">{localize('com_ui_cyvox_description')}</p>
        </div>
        <div
          className="text-text-secondary ml-auto flex max-w-full shrink-0 items-start justify-end gap-1.5 text-right text-xs sm:max-w-[50%]"
          aria-live="polite"
        >
          {testState === 'checking' ? (
            <Spinner className="h-3 w-3" />
          ) : (
            <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${dotClass}`} />
          )}
          <span>{statusLabel}</span>
        </div>
      </div>

      {details.apiVersion || details.latencyMs != null || details.capabilities?.length ? (
        <dl className="border-border-light bg-surface-primary-alt grid gap-1 rounded-lg border p-3 text-xs">
          {details.apiVersion ? (
            <div className="flex flex-wrap gap-x-2">
              <dt className="text-text-secondary">{localize('com_ui_cyvox_api_version')}</dt>
              <dd className="font-mono">{details.apiVersion}</dd>
            </div>
          ) : null}
          {details.latencyMs != null ? (
            <div className="flex flex-wrap gap-x-2">
              <dt className="text-text-secondary">{localize('com_ui_cyvox_latency')}</dt>
              <dd>{details.latencyMs}</dd>
            </div>
          ) : null}
          {details.capabilities?.length ? (
            <div className="flex flex-wrap gap-x-2">
              <dt className="text-text-secondary">{localize('com_ui_cyvox_capabilities')}</dt>
              <dd>
                {details.capabilities.length} · {details.capabilities.slice(0, 8).join(', ')}
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      {status?.lastProbe && testState === 'idle' ? (
        <p className="text-text-secondary text-xs">
          {localize('com_ui_cyvox_last_check')}{' '}
          {new Date(status.lastProbe.checkedAt).toLocaleString()} —{' '}
          {status.lastProbe.success
            ? localize('com_ui_cyvox_last_check_ok')
            : localize(testErrorKey(status.lastProbe.errorCode ?? 'unreachable'))}
        </p>
      ) : null}

      {status?.source === 'environment' && (
        <p className="border-border-light bg-surface-primary-alt rounded-lg border p-3 text-sm">
          {localize('com_ui_cyvox_environment_note')}
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="cyvox-base-url">{localize('com_ui_cyvox_service_url')}</Label>
        <Input
          id="cyvox-base-url"
          autoComplete="off"
          value={baseUrl}
          disabled={busy}
          placeholder="https://cyvox.example.com"
          onChange={(event) => {
            setBaseUrl(event.target.value);
            setTestState('idle');
            setTestMessage('');
          }}
        />
        <p className="text-text-secondary text-xs">{localize('com_ui_cyvox_service_url_hint')}</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="cyvox-auth-token">{localize('com_ui_cyvox_auth_token')}</Label>
        {status?.tokenConfigured === true && !editingToken ? (
          <button
            type="button"
            className="border-border-light hover:border-border-medium focus-visible:ring-ring-primary w-full rounded-lg border px-3 py-2 text-left focus-visible:ring-2 focus-visible:outline-hidden"
            aria-label={localize('com_ui_cyvox_edit_token')}
            disabled={busy}
            onClick={() => setEditingToken(true)}
          >
            <code className="text-text-primary block min-w-0 truncate font-mono text-sm">
              {status.tokenPreview || localize('com_ui_cyvox_token_stored')}
            </code>
            <span className="text-text-secondary text-xs">
              {localize('com_ui_cyvox_edit_token')}
            </span>
          </button>
        ) : (
          <SecretInput
            ref={tokenInputRef}
            id="cyvox-auth-token"
            autoComplete="off"
            data-lpignore="true"
            data-1p-ignore="true"
            data-bwignore="true"
            data-form-type="other"
            value={authToken}
            disabled={busy}
            placeholder={localize('com_ui_cyvox_auth_token_placeholder')}
            onChange={(event) => {
              setAuthToken(event.target.value);
              setTestState('idle');
              setTestMessage('');
            }}
          />
        )}
        <p className="text-text-secondary text-xs">{localize('com_ui_cyvox_auth_token_hint')}</p>
      </div>

      <label className="flex items-center gap-2 text-sm" htmlFor="cyvox-enabled">
        <input
          id="cyvox-enabled"
          type="checkbox"
          className="h-4 w-4"
          checked={enabled}
          disabled={busy}
          onChange={(event) => setEnabled(event.target.checked)}
        />
        {localize('com_ui_cyvox_enable')}
      </label>

      <div className="flex min-h-9 flex-wrap items-center justify-end gap-2">
        <Button variant="outline" disabled={busy} onClick={handleTest}>
          {testMutation.isLoading ? (
            <span className="flex items-center gap-2">
              <Spinner className="h-4 w-4" />
              {localize('com_ui_cyvox_testing')}
            </span>
          ) : (
            localize('com_ui_cyvox_test')
          )}
        </Button>
        <Button variant="submit" disabled={!canSave || busy} onClick={handleSave}>
          {localize('com_ui_cyvox_save')}
        </Button>
      </div>
    </div>
  );
}
