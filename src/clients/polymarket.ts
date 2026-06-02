import { createPublicClient } from '@polymarket/client';

let _client: ReturnType<typeof createPublicClient> | null = null;

export function getPublicClient() {
  if (!_client) {
    _client = createPublicClient();
  }
  return _client;
}
