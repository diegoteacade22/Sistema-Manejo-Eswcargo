import { timingSafeEqual } from 'node:crypto';

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function hasValidCompanyAgentKey(request: Request) {
  const expected = (process.env.COMPANY_OS_API_KEY ?? '').trim();
  if (!expected) return false;

  const direct = request.headers.get('x-agent-key')?.trim();
  const authorization = request.headers.get('authorization')?.trim();
  const bearer = authorization?.toLowerCase().startsWith('bearer ')
    ? authorization.slice(7).trim()
    : '';
  const provided = direct || bearer || '';

  return provided.length > 0 && safeEqual(provided, expected);
}
