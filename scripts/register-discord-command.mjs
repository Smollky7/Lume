import { pathToFileURL } from 'node:url';

const applicationId = process.env.DISCORD_APPLICATION_ID;
const botToken = process.env.DISCORD_BOT_TOKEN;
const dryRun = process.argv.includes('--dry-run');

export const command = {
  name: 'iniciar',
  description: 'Abrir o Lume na chamada',
  type: 4,
  handler: 2,
  integration_types: [0, 1],
  contexts: [0, 1, 2],
};

export async function registerEntryPoint({ appId, token, fetchImpl = fetch }) {
  const base = `https://discord.com/api/v10/applications/${encodeURIComponent(appId)}/commands`;
  const headers = { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' };
  const listResponse = await fetchImpl(base, { headers });
  if (!listResponse.ok) throw new Error(`Discord GET commands: HTTP ${listResponse.status}`);
  const commands = await listResponse.json();
  const current = commands.find((item) => item.type === 4);
  const url = current ? `${base}/${current.id}` : base;
  const response = await fetchImpl(url, {
    method: current ? 'PATCH' : 'POST',
    headers,
    body: JSON.stringify(command),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Discord ${current ? 'PATCH' : 'POST'} command: HTTP ${response.status} ${detail.slice(0, 300)}`);
  }
  return { action: current ? 'updated' : 'created', command: await response.json() };
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  if (dryRun) {
    console.log(JSON.stringify(command, null, 2));
  } else if (!applicationId || !botToken) {
    console.error('Defina DISCORD_APPLICATION_ID e DISCORD_BOT_TOKEN somente nesta sessão antes de executar.');
    process.exitCode = 1;
  } else {
    registerEntryPoint({ appId: applicationId, token: botToken })
      .then(({ action, command: saved }) => {
        console.log(`Primary Entry Point ${action === 'created' ? 'criado' : 'atualizado'}: ${saved.name} (${saved.id})`);
      })
      .catch((error) => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
      });
  }
}
