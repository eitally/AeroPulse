import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Request, type Response, type Router } from 'express';
import { getPublicTeamHubBySlugOrCode } from '../athleticSyncService.ts';
import { escapeHtml } from '../securityUtils.ts';
import { previewTeamJoinInvite } from '../teamService.ts';
import {
  decodeSharedWorkoutPayload,
  formatSharedWorkoutOgSummary,
} from '../../src/utils/shareWorkoutCodec.ts';
import type { PublicTeamHubPayload, TeamInvitePreviewPayload } from '../../src/types.ts';

const CANONICAL_ORIGIN = 'https://meetready.app';
const STATIC_OG_IMAGE = 'https://meetready.app/brand/meetready-og-1200x630.png';

const MINIMAL_FALLBACK_HTML_SHELL = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <title>MeetReady — Track &amp; Field &amp; Cross Country</title>
    <meta name="description" content="Every mark. Every mile. Meet ready. Track, Field &amp; Cross Country team platform." />
    <link rel="canonical" href="https://meetready.app/" />
    <meta property="og:title" content="MeetReady — Track &amp; Field &amp; Cross Country" />
    <meta property="og:description" content="Every mark. Every mile. Meet ready. Track, Field &amp; Cross Country team platform." />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="https://meetready.app/" />
    <meta property="og:image" content="${STATIC_OG_IMAGE}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="MeetReady — Track &amp; Field &amp; Cross Country" />
    <meta name="twitter:description" content="Offline 0.01s splits, jumps/throws/vaults field sheets, auto-scaled pace pods, and SafeSport guardrails." />
    <meta name="twitter:image" content="${STATIC_OG_IMAGE}" />
    <link rel="icon" type="image/svg+xml" href="/icon.svg?v=7" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>`;

export interface OgMetadataInput {
  title: string;
  description: string;
  canonicalUrl: string;
  ogUrl: string;
}

export interface OgPreviewRouterOptions {
  indexHtmlPath?: string;
  htmlShell?: string;
  loadTeamHub?: (slugOrCode: string) => Promise<PublicTeamHubPayload>;
  loadTeamJoinPreview?: (codeOrSlug: string) => Promise<TeamInvitePreviewPayload>;
}

function resolveDistIndexHtml(customPath?: string): string {
  const candidates: string[] = [];
  if (customPath) {
    candidates.push(customPath);
  }
  candidates.push(path.resolve(process.cwd(), 'dist', 'index.html'));
  try {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    candidates.push(path.resolve(dir, '../dist/index.html'));
    candidates.push(path.resolve(dir, '../../dist/index.html'));
  } catch {
    // ignore URL resolution errors in non-file runtimes
  }

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return fs.readFileSync(candidate, 'utf8');
      }
    } catch {
      // try next candidate
    }
  }
  return MINIMAL_FALLBACK_HTML_SHELL;
}

function replaceOrInsertHeadTag(
  html: string,
  pattern: RegExp,
  replacementTag: string
): string {
  if (pattern.test(html)) {
    return html.replace(pattern, () => replacementTag);
  }
  const headCloseIdx = html.search(/<\/head>/i);
  if (headCloseIdx !== -1) {
    return `${html.slice(0, headCloseIdx)}    ${replacementTag}\n  ${html.slice(headCloseIdx)}`;
  }
  return html;
}

export function injectOgMetadataIntoHtml(templateHtml: string, meta: OgMetadataInput): string {
  const safeTitle = escapeHtml(meta.title);
  const safeDesc = escapeHtml(meta.description);
  const safeCanonical = escapeHtml(meta.canonicalUrl);
  const safeOgUrl = escapeHtml(meta.ogUrl);

  let out = templateHtml;
  out = replaceOrInsertHeadTag(out, /<title>[\s\S]*?<\/title>/i, `<title>${safeTitle}</title>`);
  out = replaceOrInsertHeadTag(
    out,
    /<meta\b[^>]*\bname=["']description["'][^>]*\/?>/i,
    `<meta name="description" content="${safeDesc}" />`
  );
  out = replaceOrInsertHeadTag(
    out,
    /<link\b[^>]*\brel=["']canonical["'][^>]*\/?>/i,
    `<link rel="canonical" href="${safeCanonical}" />`
  );
  out = replaceOrInsertHeadTag(
    out,
    /<meta\b[^>]*\bproperty=["']og:title["'][^>]*\/?>/i,
    `<meta property="og:title" content="${safeTitle}" />`
  );
  out = replaceOrInsertHeadTag(
    out,
    /<meta\b[^>]*\bproperty=["']og:description["'][^>]*\/?>/i,
    `<meta property="og:description" content="${safeDesc}" />`
  );
  out = replaceOrInsertHeadTag(
    out,
    /<meta\b[^>]*\bproperty=["']og:url["'][^>]*\/?>/i,
    `<meta property="og:url" content="${safeOgUrl}" />`
  );
  out = replaceOrInsertHeadTag(
    out,
    /<meta\b[^>]*\bproperty=["']og:image["'][^>]*\/?>/i,
    `<meta property="og:image" content="${STATIC_OG_IMAGE}" />`
  );
  out = replaceOrInsertHeadTag(
    out,
    /<meta\b[^>]*\bname=["']twitter:title["'][^>]*\/?>/i,
    `<meta name="twitter:title" content="${safeTitle}" />`
  );
  out = replaceOrInsertHeadTag(
    out,
    /<meta\b[^>]*\bname=["']twitter:description["'][^>]*\/?>/i,
    `<meta name="twitter:description" content="${safeDesc}" />`
  );
  out = replaceOrInsertHeadTag(
    out,
    /<meta\b[^>]*\bname=["']twitter:image["'][^>]*\/?>/i,
    `<meta name="twitter:image" content="${STATIC_OG_IMAGE}" />`
  );
  return out;
}

function buildPublicTeamOgMetadata(slug: string, payload: PublicTeamHubPayload | null): OgMetadataInput {
  const safeSlugSegment = encodeURIComponent(payload?.brand?.slug || slug);
  const url = `${CANONICAL_ORIGIN}/team/${safeSlugSegment}`;

  if (payload?.found && payload.brand) {
    const teamName = payload.brand.name;
    const sportLabel = payload.brand.primarySport || 'Running';
    const meetCount = payload.stats?.meetCount ?? 0;
    const resultCount = payload.stats?.officialResultCount ?? 0;
    const athleteCount = payload.stats?.athleteCount ?? 0;
    return {
      title: `${teamName} — MeetReady Team Hub`,
      description: `${teamName} (${sportLabel}) public meet schedule and official FAT results (${meetCount} meets, ${resultCount} official marks, ${athleteCount} athletes) on MeetReady.`,
      canonicalUrl: url,
      ogUrl: url,
    };
  }

  return {
    title: 'MeetReady — Public Team Hub & Schedule',
    description:
      'Public Track, Field & Cross Country meet schedule, official FAT results, and team announcements on MeetReady.',
    canonicalUrl: url,
    ogUrl: url,
  };
}

function buildJoinOgMetadata(slug: string, preview: TeamInvitePreviewPayload | null): OgMetadataInput {
  const safeSlugSegment = encodeURIComponent(preview?.brand?.slug || slug);
  // Strictly strip ?t= invite token, email, and query params from canonical & og:url
  const cleanJoinUrl = `${CANONICAL_ORIGIN}/join/${safeSlugSegment}`;

  if (preview?.found && preview.brand) {
    const teamName = preview.brand.name;
    const sportLabel = preview.brand.primarySport || 'Running';
    return {
      title: `Join ${teamName} on MeetReady`,
      description: `Join ${teamName} (${sportLabel}) on MeetReady for watchless splits, field sheets, auto-scaled pace pods, and U18 SafeSport & FERPA protection.`,
      canonicalUrl: cleanJoinUrl,
      ogUrl: cleanJoinUrl,
    };
  }

  return {
    title: 'Join Team Roster — MeetReady',
    description:
      'Accept your MeetReady Track, Field & Cross Country team roster invite with built-in SafeSport & FERPA guardrails.',
    canonicalUrl: cleanJoinUrl,
    ogUrl: cleanJoinUrl,
  };
}

export function createOgPreviewRouter(options: OgPreviewRouterOptions = {}): Router {
  const router = express.Router();
  let cachedHtmlShell: string | null = options.htmlShell ?? null;

  const getHtmlShell = (): string => {
    if (cachedHtmlShell !== null) {
      return cachedHtmlShell;
    }
    cachedHtmlShell = resolveDistIndexHtml(options.indexHtmlPath);
    return cachedHtmlShell;
  };

  const loadHub = options.loadTeamHub ?? getPublicTeamHubBySlugOrCode;
  const loadJoin = options.loadTeamJoinPreview ?? ((codeOrSlug: string) => previewTeamJoinInvite(codeOrSlug));

  router.get('/team/:slug', async (req: Request, res: Response) => {
    const slug = String(req.params.slug || '').trim();
    let payload: PublicTeamHubPayload | null = null;
    if (slug) {
      try {
        payload = await loadHub(slug);
      } catch {
        payload = null;
      }
    }
    const meta = buildPublicTeamOgMetadata(slug || 'team', payload);
    const html = injectOgMetadataIntoHtml(getHtmlShell(), meta);
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    res.type('text/html; charset=utf-8');
    res.status(200).send(html);
  });

  router.get('/join/:slug', async (req: Request, res: Response) => {
    const slug = String(req.params.slug || '').trim();
    const rawToken = typeof req.query.t === 'string' ? req.query.t.trim() : '';
    const hasInviteToken = rawToken.length > 0;

    let preview: TeamInvitePreviewPayload | null = null;
    if (slug) {
      try {
        // Never pass ?t= token or caller email to public OG metadata projection
        preview = await loadJoin(slug);
      } catch {
        preview = null;
      }
    }

    const meta = buildJoinOgMetadata(slug || 'team', preview);
    const html = injectOgMetadataIntoHtml(getHtmlShell(), meta);
    res.setHeader(
      'Cache-Control',
      hasInviteToken ? 'private, no-store' : 'public, s-maxage=300, stale-while-revalidate=600'
    );
    res.type('text/html; charset=utf-8');
    res.status(200).send(html);
  });

  router.get('/share/workout', (req: Request, res: Response) => {
    const rawPayloadParam = typeof req.query.w === 'string' ? req.query.w.trim() : '';
    const decoded = rawPayloadParam ? decodeSharedWorkoutPayload(rawPayloadParam) : null;

    let meta: OgMetadataInput;
    if (decoded) {
      const summary = formatSharedWorkoutOgSummary(decoded);
      const safeShareUrl = `${CANONICAL_ORIGIN}/share/workout?w=${encodeURIComponent(rawPayloadParam)}`;
      meta = {
        title: summary.title,
        description: summary.description,
        canonicalUrl: `${CANONICAL_ORIGIN}/share/workout`,
        ogUrl: safeShareUrl,
      };
    } else {
      meta = {
        title: 'Shared Workout & Stopwatch Splits — MeetReady',
        description:
          'Clean-Room structured workout & 0.01s stopwatch splits shared via MeetReady. Zero third-party telemetry leakage.',
        canonicalUrl: `${CANONICAL_ORIGIN}/share/workout`,
        ogUrl: `${CANONICAL_ORIGIN}/share/workout`,
      };
    }

    const html = injectOgMetadataIntoHtml(getHtmlShell(), meta);
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    res.type('text/html; charset=utf-8');
    res.status(200).send(html);
  });

  return router;
}

export const ogPreviewRouter = createOgPreviewRouter();
