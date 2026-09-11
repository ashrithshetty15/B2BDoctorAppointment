import type { Job } from 'bullmq';
import { broadcastQueuePositions } from '../../services/notifications';
import { logger } from '../../utils/logger';
import { parseDateOnly } from '../../utils/time';
import type { TokenEventJob } from '../queues';

/**
 * Recalculates the whole day's token queue and pushes updates to patients whose
 * position changed (requirement 4). Runs off the webhook request path so a slow
 * broadcast never delays the patient's own confirmation.
 */
export async function processTokenEvent(job: Job<TokenEventJob>): Promise<void> {
  const date = parseDateOnly(job.data.date);
  if (!date) {
    logger.error({ data: job.data }, 'Token event job has an unparseable date; dropping');
    return;
  }

  const { notified } = await broadcastQueuePositions({
    doctorId: job.data.doctorId,
    date,
    ...(job.data.originAppointmentId
      ? { originAppointmentId: job.data.originAppointmentId }
      : {}),
    // A delay announcement changes ETAs without changing positions, so bypass
    // the "position unchanged" suppression.
    force: job.data.trigger === 'DELAY_ANNOUNCED',
  });

  logger.info(
    { doctorId: job.data.doctorId, trigger: job.data.trigger, notified },
    'Processed token queue event',
  );
}
