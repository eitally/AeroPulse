const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_RE = /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g;

function redactContactPii(raw: string): string {
  return String(raw || '')
    .replace(EMAIL_RE, '[redacted-email]')
    .replace(PHONE_RE, '[redacted-phone]')
    .replace(/\s+/g, ' ')
    .trim();
}

export function formatMessageForRemindOrParentSquare(params: {
  teamShortName: string;
  teamSlug?: string;
  title?: string;
  senderName?: string;
  body: string;
  categoryLabel?: string;
  publicHubOrigin?: string;
}): string {
  const shortName = redactContactPii(params.teamShortName || 'Team');
  const titlePart = params.title
    ? redactContactPii(params.title)
    : params.categoryLabel
      ? redactContactPii(params.categoryLabel)
      : params.senderName
        ? `Update from ${redactContactPii(params.senderName)}`
        : 'Team Update';
  const cleanBody = redactContactPii(params.body);

  const lines: string[] = [`[MeetReady · ${shortName}] ${titlePart}`];
  if (cleanBody) {
    lines.push(cleanBody);
  }

  const slug = String(params.teamSlug || '').trim();
  if (slug) {
    const origin = (
      params.publicHubOrigin ||
      (typeof window !== 'undefined' && window.location?.origin
        ? window.location.origin
        : 'https://meetready.app')
    ).replace(/\/+$/, '');
    lines.push(`Schedule & Live Links: ${origin}/team/${encodeURIComponent(slug)}`);
  }

  return lines.join('\n');
}

export async function copyTextToClipboardSafe(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fallback below for restricted clipboard permissions
  }
  try {
    if (typeof document !== 'undefined' && typeof document.execCommand === 'function') {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', 'true');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand('copy');
      document.body.removeChild(textarea);
      return copied;
    }
  } catch {
    return false;
  }
  return false;
}
