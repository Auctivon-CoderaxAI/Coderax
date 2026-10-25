/**
 * openid-client v6 is ESM-only. Load it with import() so the CommonJS backend
 * also works on runtimes whose require() loader cannot synchronously load ESM.
 */
let openIdClientPromise;

function loadOpenIdClient() {
  if (process.env.NODE_ENV === 'test') {
    return Promise.resolve(require('openid-client'));
  }

  openIdClientPromise ??= import('openid-client');
  return openIdClientPromise;
}

function loadOpenIdPassport() {
  if (process.env.NODE_ENV === 'test') {
    return Promise.resolve(require('openid-client/passport'));
  }

  return import('openid-client/passport');
}

const openIdClient = new Proxy(Object.create(null), {
  get(_target, property) {
    if (property === 'then') {
      return undefined;
    }

    if (process.env.NODE_ENV === 'test') {
      const client = require('openid-client');
      return typeof client[property] === 'function'
        ? client[property].bind(client)
        : client[property];
    }

    return (...args) =>
      loadOpenIdClient().then((client) => {
        const method = client[property];
        return typeof method === 'function' ? Reflect.apply(method, client, args) : method;
      });
  },
});

module.exports = { loadOpenIdClient, loadOpenIdPassport, openIdClient };
