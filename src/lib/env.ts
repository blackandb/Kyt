function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

export const env = {
  supabaseUrl: () => required('NEXT_PUBLIC_SUPABASE_URL'),
  supabaseAnonKey: () => required('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
  serviceRoleKey: () => required('SUPABASE_SERVICE_ROLE_KEY'),
  ownerEmail: () => required('OWNER_EMAIL').trim().toLowerCase(),
  appUrl: () => (process.env.APP_URL || '').replace(/\/$/, ''),
  timezone: () => process.env.APP_TIMEZONE || 'Europe/Chisinau',
  cronSecret: () => required('CRON_SECRET'),
  trongridKey: () => process.env.TRONGRID_API_KEY || '',
  resendKey: () => process.env.RESEND_API_KEY || '',
  alertFrom: () => process.env.ALERT_FROM || 'KYT Monitor <onboarding@resend.dev>',
  sanctionsUrl: () =>
    process.env.SANCTIONS_TRX_URL ||
    'https://raw.githubusercontent.com/0xB10C/ofac-sanctioned-digital-currency-addresses/lists/sanctioned_addresses_TRX.txt',
  anthropicKey: () => required('ANTHROPIC_API_KEY'),
  anthropicModel: () => process.env.ANTHROPIC_MODEL || 'claude-haiku-5-5',
  aiConfigured: () => !!process.env.ANTHROPIC_API_KEY,
  amlbot: () => ({
    accessId: process.env.AMLBOT_ACCESS_ID || '',
    accessKey: process.env.AMLBOT_ACCESS_KEY || '',
    url: process.env.AMLBOT_API_URL || 'https://extrnlapiendpoint.silencatech.com/'
  })
};
