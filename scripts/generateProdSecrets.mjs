import crypto from 'node:crypto';

console.log('# ============================================================================');
console.log('# Fresh Cryptographic Secrets for Vercel Environment Variables / Local .env');
console.log('# (Generated locally in memory — never commit these values to Git)');
console.log('# ============================================================================');
console.log(`SESSION_SECRET="${crypto.randomBytes(32).toString('hex')}"`);
console.log(`TOKEN_VAULT_KEY="${crypto.randomBytes(32).toString('hex')}"`);
console.log(`CRON_SECRET="${crypto.randomBytes(24).toString('hex')}"`);
