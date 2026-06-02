import { getPrisma } from './client.js';

export async function getConfig(key: string): Promise<string | null> {
  const row = await getPrisma().config.findUnique({ where: { key } });
  return row?.value ?? null;
}

export async function setConfig(key: string, value: string): Promise<void> {
  await getPrisma().config.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
}
