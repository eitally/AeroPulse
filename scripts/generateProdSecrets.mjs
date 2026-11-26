import crypto from 'node:crypto';
import { generateVAPIDKeys } from 'web-push';

const vapid = generateVAPIDKeys();

console.log('# ============================================================================');
console.log('# Fresh Cryptographic & Web Push Secrets for Vercel Production / Local .env');
console.log('# (Generated locally in memory — never commit these values to Git)');
console.log('# ============================================================================');
console.log(`SESSION_SECRET="${crypto.randomBytes(32).toString('hex')}"`);
console.log(`TOKEN_VAULT_KEY="${crypto.randomBytes(32).toString('hex')}"`);
console.log(`CRON_SECRET="${crypto.randomBytes(24).toString('hex')}"`);
console.log(`VAPID_PUBLIC_KEY="${vapid.publicKey}"`);
console.log(`VAPID_PRIVATE_KEY="${vapid.privateKey}"`);
console.log('VAPID_SUBJECT="mailto:support@meetready.app"');
