import { Prisma, PrismaClient } from '@prisma/client';

export type ShipmentStatusAuditEvent =
  | 'STARTED'
  | 'SHEETS_UPDATED'
  | 'SYSTEM_UPDATED'
  | 'COMPLETED'
  | 'FAILED'
  | 'ROLLED_BACK'
  | 'ROLLBACK_FAILED';

type AuditDb = PrismaClient | Prisma.TransactionClient;

export type ShipmentStatusAuditEntry = {
  operationId: string;
  shipmentId: number;
  shipmentNumber: number;
  actorUserId?: string | null;
  actorName?: string | null;
  selectedDate: string;
  fromStatus: string;
  toStatus: string;
  eventType: ShipmentStatusAuditEvent;
  details?: Record<string, unknown>;
  error?: string | null;
};

function safeError(error: string | null | undefined) {
  return error ? error.slice(0, 1500) : null;
}

export async function appendShipmentStatusAudit(
  db: AuditDb,
  entries: ShipmentStatusAuditEntry[]
) {
  for (const entry of entries) {
    const details = JSON.stringify(entry.details ?? {});
    await db.$executeRaw(Prisma.sql`
      insert into public.shipment_status_change_log (
        operation_id,
        shipment_id,
        shipment_number,
        actor_user_id,
        actor_name,
        selected_date,
        from_status,
        to_status,
        event_type,
        details,
        error
      ) values (
        ${entry.operationId}::uuid,
        ${entry.shipmentId},
        ${entry.shipmentNumber},
        ${entry.actorUserId ?? null},
        ${entry.actorName ?? null},
        ${entry.selectedDate}::date,
        ${entry.fromStatus},
        ${entry.toStatus},
        ${entry.eventType},
        ${details}::jsonb,
        ${safeError(entry.error)}
      )
    `);
  }
}
