export default function handler(req, res) {
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({
    ok: true,
    app: 'Stockly',
    vercel: true,
    node: process.version,
    env: {
      hasSupabaseUrl: Boolean(process.env.SUPABASE_URL),
      hasSupabaseKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      hasAdminEmail: Boolean(process.env.ADMIN_EMAIL)
    }
  }));
}
