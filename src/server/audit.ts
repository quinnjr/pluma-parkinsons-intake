import type { Request } from 'express';
import type { PrismaClient } from '../prisma/client.js';

export type AuditAction =
  | 'login'
  | 'login_failed'
  | 'login_rate_limited'
  | 'logout'
  | 'signup'
  | 'signup_patient'
  | 'account_delete'
  | 'submission_create'
  | 'submission_view'
  | 'submission_edit'
  | 'submission_delete'
  | 'submission_claim'
  | 'user_confirm'
  | 'user_delete'
  | 'mfa_enabled'
  | 'mfa_disabled'
  | 'mfa_challenge_failed'
  | 'mfa_recovery_used'
  | 'mfa_recovery_regenerated'
  | 'webauthn_registered'
  | 'webauthn_removed'
  | 'webauthn_authenticated'
  | 'webauthn_challenge_failed'
  | 'password_reset_requested'
  | 'password_reset'
  | 'grant_researcher'
  | 'revoke_researcher'
  | 'email_verified'
  | 'email_verification_failed';

export type TargetType = 'user' | 'submission' | 'email';

export interface AuditInput {
  action: AuditAction;
  req?: Request;
  targetType?: TargetType;
  targetId?: string | null;
  success?: boolean;
  metadata?: Record<string, unknown>;
  // Override actor — used by login_failed where req.auth is null but we know
  // the email the attacker tried.
  actorEmail?: string;
}

// Don't let an audit-log write failure break the primary request. HIPAA wants
// these records but a crash in the logger shouldn't also crash the endpoint;
// swallow & console.error so ops can see it.
export async function audit(prisma: PrismaClient, input: AuditInput): Promise<void> {
  const { req, action, targetType, targetId, success = true, metadata, actorEmail } = input;
  try {
    await prisma.auditLog.create({
      data: {
        action,
        actorId: req?.auth?.sub ?? null,
        actorEmail: req?.auth?.email ?? actorEmail ?? null,
        actorRole: req?.auth?.role ?? null,
        targetType: targetType ?? null,
        targetId: targetId ?? null,
        success,
        ip: req ? requestIp(req) : null,
        userAgent: req?.get('user-agent')?.slice(0, 512) ?? null,
        metadata: metadata ? JSON.stringify(metadata) : null,
      },
    });
  } catch (err) {
    console.error('[audit] failed to write audit log', err);
  }
}

function requestIp(req: Request): string | null {
  // Express `req.ip` respects X-Forwarded-For once `app.set('trust proxy', ...)`
  // is configured. Cap to 45 chars (IPv6 max).
  return (req.ip ?? null)?.slice(0, 45) ?? null;
}

// § 164.308(a)(5)(ii)(D): login + verification monitoring. Count rows of a
// given failure action against a given target in the last `windowMs`, used by
// both login rate-limit (`action='login_failed'`) and email-verification
// rate-limit (`action='email_verification_failed'`).
export async function recentFailureCount(
  prisma: PrismaClient,
  params: {
    action: AuditAction;
    targetType: TargetType;
    targetId: string;
    windowMs: number;
  },
): Promise<number> {
  return prisma.auditLog.count({
    where: {
      action: params.action,
      targetType: params.targetType,
      targetId: params.targetId,
      createdAt: { gt: new Date(Date.now() - params.windowMs) },
    },
  });
}
