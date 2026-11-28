import type { NextFunction, Request, Response } from 'express';
import { CODERAX_API_VERSION, CODERAX_API_VERSION_HEADER } from './apiContract';
import { apiVersionHeaders, rejectUnsupportedApiVersion } from './apiMeta';

const createResponse = () => {
  const headers: Record<string, string> = {};
  const res = {
    headers,
    statusCode: 0,
    body: null as unknown,
    set(name: string, value: string) {
      headers[name] = value;
      return res;
    },
    vary() {
      return res;
    },
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: unknown) {
      res.body = body;
      return res;
    },
  };
  return res;
};

const next = (): NextFunction => jest.fn() as unknown as NextFunction;

describe('apiVersionHeaders', () => {
  it('names the version on every API response', () => {
    const res = createResponse();
    const proceed = next();

    apiVersionHeaders({} as Request, res as unknown as Response, proceed);

    expect(res.headers[CODERAX_API_VERSION_HEADER]).toBe(String(CODERAX_API_VERSION));
    expect(proceed).toHaveBeenCalled();
  });
});

describe('rejectUnsupportedApiVersion', () => {
  it('refuses a write from another major before a handler runs', () => {
    const res = createResponse();
    const proceed = next();

    rejectUnsupportedApiVersion(
      { method: 'POST', get: () => '2' } as unknown as Request,
      res as unknown as Response,
      proceed,
    );

    expect(res.statusCode).toBe(426);
    expect(res.body).toEqual(
      expect.objectContaining({ code: 'API_VERSION_UNSUPPORTED', apiVersion: CODERAX_API_VERSION }),
    );
    expect(proceed).not.toHaveBeenCalled();
  });

  it('accepts a read from another major so the client can discover the version', () => {
    const proceed = next();

    rejectUnsupportedApiVersion(
      { method: 'GET', get: () => '99' } as unknown as Request,
      createResponse() as unknown as Response,
      proceed,
    );

    expect(proceed).toHaveBeenCalled();
  });

  it('accepts a client that declares no version', () => {
    const proceed = next();

    rejectUnsupportedApiVersion(
      { method: 'POST', get: () => undefined } as unknown as Request,
      createResponse() as unknown as Response,
      proceed,
    );

    expect(proceed).toHaveBeenCalled();
  });
});
