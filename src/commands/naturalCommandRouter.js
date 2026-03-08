import { parseNaturalCommandRequest, executeCommandRequestFromMessage } from './commandRuntime.js';

// TCG natural routing is intentionally disabled after full TCG runtime removal.
export function matchNaturalTcgCommand() {
  return null;
}

async function tryHandleNaturalMemoryStatus({ message, content }) {
  const parsed = parseNaturalCommandRequest(content || message.content || '', {
    actorId: message.author.id,
  });
  if (!parsed) return false;

  await executeCommandRequestFromMessage({
    message,
    request: parsed.request,
    dryRun: parsed.dryRun,
    superAdminId: process.env.SUPER_ADMIN_USER_ID,
  });

  return true;
}

export async function tryHandleNaturalCommand({ message, content }) {
  const handledMemory = await tryHandleNaturalMemoryStatus({ message, content });
  if (handledMemory) return true;
  return false;
}
