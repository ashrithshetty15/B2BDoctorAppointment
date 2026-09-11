import { env } from '../config/env';
import { ConsoleAdapter } from './adapters/console';
import { WhatsAppCloudAdapter } from './adapters/whatsappCloud';
import type { MessagingAdapter } from './types';

let instance: MessagingAdapter | null = null;

/**
 * Single place that decides which provider is live. To add a BSP:
 * write an adapter implementing MessagingAdapter, add a case here, and add its
 * value to the MESSAGING_PROVIDER enum in config/env.ts.
 */
export function getMessagingAdapter(): MessagingAdapter {
  if (instance) return instance;

  switch (env.MESSAGING_PROVIDER) {
    case 'whatsapp_cloud':
      instance = new WhatsAppCloudAdapter();
      break;
    case 'console':
    default:
      instance = new ConsoleAdapter();
      break;
  }
  return instance;
}

/** Test seam — inject a fake adapter. */
export function setMessagingAdapter(adapter: MessagingAdapter): void {
  instance = adapter;
}

export * from './types';
