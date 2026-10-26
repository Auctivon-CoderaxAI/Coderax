type OpenIdClientModule = typeof import('openid-client');
type OpenIdPassportModule = typeof import('openid-client/passport');

const loadMockableCommonJsModule = <T>(specifier: string): T => {
  // Keep Jest's CommonJS module mock interception for the OpenID strategy suite.
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Jest mocks ESM modules through require() in this CommonJS test suite.
  return require(specifier) as T;
};

let openIdClientPromise: Promise<OpenIdClientModule> | undefined;

export const loadOpenIdClient = (): Promise<OpenIdClientModule> => {
  if (process.env.NODE_ENV === 'test') {
    return Promise.resolve(loadMockableCommonJsModule<OpenIdClientModule>('openid-client'));
  }

  openIdClientPromise ??= import('openid-client');
  return openIdClientPromise;
};

export const loadOpenIdPassport = (): Promise<OpenIdPassportModule> => {
  if (process.env.NODE_ENV === 'test') {
    return Promise.resolve(
      loadMockableCommonJsModule<OpenIdPassportModule>('openid-client/passport'),
    );
  }

  return import('openid-client/passport');
};

export const openIdClient: Record<PropertyKey, unknown> = new Proxy(
  Object.create(null) as Record<PropertyKey, unknown>,
  {
    get(_target, property) {
      if (property === 'then') {
        return undefined;
      }

      if (process.env.NODE_ENV === 'test') {
        const client = loadMockableCommonJsModule<OpenIdClientModule>('openid-client');
        const member = client[property as keyof OpenIdClientModule];
        return typeof member === 'function'
          ? (...args: unknown[]) => Reflect.apply(member, client, args)
          : member;
      }

      return (...args: unknown[]) =>
        loadOpenIdClient().then((client) => {
          const member = client[property as keyof OpenIdClientModule];
          return typeof member === 'function' ? Reflect.apply(member, client, args) : member;
        });
    },
  },
);
