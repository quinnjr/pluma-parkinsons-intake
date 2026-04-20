// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Request } from 'express';
import { audit, recentFailureCount } from './audit.js';
import type { PrismaClient } from '../prisma/client.js';

function makePrismaStub() {
  const createCalls: unknown[] = [];
  const countCalls: unknown[] = [];
  const prisma = {
    auditLog: {
      create: vi.fn(async (args: unknown) => {
        createCalls.push(args);
        return {};
      }),
      count: vi.fn(async (args: unknown) => {
        countCalls.push(args);
        return 3;
      }),
    },
  } as unknown as PrismaClient;
  return { prisma, createCalls, countCalls };
}

function makeReq(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    ip: '203.0.113.7',
    auth: { sub: 'u1', email: 'alice@example.com', role: 'patient', confirmed: true },
    get: (name: string) => (name === 'user-agent' ? 'test-ua/1.0' : undefined),
    ...overrides,
  } as unknown as Request;
}

describe('audit', () => {
  afterEach(() => vi.restoreAllMocks());

  it('writes an audit row with actor + target + UA', async () => {
    const { prisma, createCalls } = makePrismaStub();
    const req = makeReq();
    await audit(prisma, { action: 'submission_view', req, targetType: 'submission', targetId: 's1' });
    expect(createCalls).toHaveLength(1);
    const args = createCalls[0] as { data: Record<string, unknown> };
    expect(args.data['action']).toBe('submission_view');
    expect(args.data['actorId']).toBe('u1');
    expect(args.data['actorEmail']).toBe('alice@example.com');
    expect(args.data['actorRole']).toBe('patient');
    expect(args.data['targetType']).toBe('submission');
    expect(args.data['targetId']).toBe('s1');
    expect(args.data['success']).toBe(true);
    expect(args.data['ip']).toBe('203.0.113.7');
    expect(args.data['userAgent']).toBe('test-ua/1.0');
  });

  it('honors explicit actorEmail when req.auth is absent', async () => {
    const { prisma, createCalls } = makePrismaStub();
    const req = makeReq({ auth: null });
    await audit(prisma, {
      action: 'login_failed',
      req,
      targetType: 'email',
      targetId: 'bob@example.com',
      actorEmail: 'bob@example.com',
      success: false,
    });
    const args = createCalls[0] as { data: Record<string, unknown> };
    expect(args.data['actorEmail']).toBe('bob@example.com');
    expect(args.data['actorId']).toBeNull();
    expect(args.data['success']).toBe(false);
  });

  it('serializes metadata to JSON', async () => {
    const { prisma, createCalls } = makePrismaStub();
    await audit(prisma, {
      action: 'grant_researcher',
      metadata: { grantId: 'g1', granted: true },
    });
    const args = createCalls[0] as { data: Record<string, unknown> };
    expect(args.data['metadata']).toBe('{"grantId":"g1","granted":true}');
  });

  it('runs without a req (pre-auth events)', async () => {
    const { prisma, createCalls } = makePrismaStub();
    await audit(prisma, { action: 'signup', actorEmail: 'noreq@example.com' });
    const args = createCalls[0] as { data: Record<string, unknown> };
    expect(args.data['actorId']).toBeNull();
    expect(args.data['ip']).toBeNull();
    expect(args.data['userAgent']).toBeNull();
    expect(args.data['actorEmail']).toBe('noreq@example.com');
  });

  it('truncates long user-agents to 512 chars', async () => {
    const { prisma, createCalls } = makePrismaStub();
    const longUa = 'x'.repeat(1000);
    const req = makeReq({ get: (n: string) => (n === 'user-agent' ? longUa : undefined) });
    await audit(prisma, { action: 'login', req });
    const args = createCalls[0] as { data: Record<string, unknown> };
    expect((args.data['userAgent'] as string).length).toBe(512);
  });

  it('truncates IPv6 at 45 chars', async () => {
    const { prisma, createCalls } = makePrismaStub();
    const ipv6 = '2001:0db8:85a3:0000:0000:8a2e:0370:7334';
    const req = makeReq({ ip: ipv6.repeat(2) });
    await audit(prisma, { action: 'login', req });
    const args = createCalls[0] as { data: Record<string, unknown> };
    expect((args.data['ip'] as string).length).toBe(45);
  });

  it('swallows Prisma errors without throwing', async () => {
    const prisma = {
      auditLog: { create: vi.fn(async () => { throw new Error('DB down'); }) },
    } as unknown as PrismaClient;
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(audit(prisma, { action: 'login' })).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();
  });
});

describe('recentFailureCount', () => {
  it('passes action + target + time-window gt to prisma.count', async () => {
    const { prisma, countCalls } = makePrismaStub();
    const result = await recentFailureCount(prisma, {
      action: 'login_failed',
      targetType: 'email',
      targetId: 'alice@example.com',
      windowMs: 5 * 60 * 1000,
    });
    expect(result).toBe(3);
    expect(countCalls).toHaveLength(1);
    const args = countCalls[0] as { where: Record<string, unknown> };
    expect(args.where['action']).toBe('login_failed');
    expect(args.where['targetType']).toBe('email');
    expect(args.where['targetId']).toBe('alice@example.com');
    const gt = (args.where['createdAt'] as { gt: Date }).gt;
    expect(gt).toBeInstanceOf(Date);
    expect(Date.now() - gt.getTime()).toBeLessThan(5 * 60 * 1000 + 1000);
  });
});
