import type { NextFunction, Request, Response } from 'express';
import { idempotencyKeyAs } from './idempotencyKey';

const createResponse = () => {
  const res = {
    statusCode: 0,
    body: null as unknown,
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

describe('idempotencyKeyAs', () => {
  it('copies the standard header onto the body field the controller deduplicates by', () => {
    const req = { get: () => 'retry-42', body: { text: 'hello' } };
    const proceed = next();

    idempotencyKeyAs('clientRequestId')(
      req as unknown as Request,
      createResponse() as unknown as Response,
      proceed,
    );

    expect((req.body as { clientRequestId?: string }).clientRequestId).toBe('retry-42');
    expect(proceed).toHaveBeenCalledTimes(1);
  });

  it('keeps a key the body already carried', () => {
    const req = { get: () => 'header-key', body: { clientRequestId: 'body-key' } };
    const proceed = next();

    idempotencyKeyAs('clientRequestId')(
      req as unknown as Request,
      createResponse() as unknown as Response,
      proceed,
    );

    expect((req.body as { clientRequestId?: string }).clientRequestId).toBe('body-key');
  });

  it('does nothing without a header', () => {
    const req = { get: () => undefined, body: {} };
    const proceed = next();

    idempotencyKeyAs('clientRequestId')(
      req as unknown as Request,
      createResponse() as unknown as Response,
      proceed,
    );

    expect((req.body as { clientRequestId?: string }).clientRequestId).toBeUndefined();
    expect(proceed).toHaveBeenCalled();
  });

  it('fails closed on a malformed key instead of starting a second run', () => {
    const res = createResponse();
    const proceed = next();

    idempotencyKeyAs('clientRequestId')(
      { get: () => 'bad key!', body: {} } as unknown as Request,
      res as unknown as Response,
      proceed,
    );

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual(expect.objectContaining({ code: 'WORK_IDEMPOTENCY_KEY_INVALID' }));
    expect(proceed).not.toHaveBeenCalled();
  });

  it('rejects a key longer than the controller accepts', () => {
    const res = createResponse();

    idempotencyKeyAs('clientRequestId')(
      { get: () => 'a'.repeat(129), body: {} } as unknown as Request,
      res as unknown as Response,
      next(),
    );

    expect(res.statusCode).toBe(400);
  });
});
