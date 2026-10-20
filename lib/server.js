import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCipheriv, createECDH, createHash, createHmac, createPrivateKey, randomBytes, scryptSync, sign as cryptoSign, timingSafeEqual } from 'node:crypto';

const apiDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(apiDir, '..');
const publicDir = path.join(root, 'public');
const dataDir = process.env.DATA_DIR || (process.env.VERCEL ? '/tmp' : path.join(root, 'data'));
const dataFile = path.join(dataDir, 'db.json');
const port = Number(process.env.PORT || 3000);
const loginAttempts = new Map();

const seed = {
  products: [
    { id: 'PRD-001', userId: 'USR-ADMIN', name: 'Kopi Arabika Gayo 250g', category: 'Minuman', sku: 'KOP-AR-250', location: 'Rak A-01', stock: 48, minStock: 12, unit: 'pcs', cost: 68000, expiryDate: new Date(Date.now() + 86400000 * 22).toISOString().slice(0,10), updatedAt: new Date().toISOString() },
    { id: 'PRD-002', userId: 'USR-ADMIN', name: 'Teh Hijau Premium', category: 'Minuman', sku: 'TEH-HJ-100', location: 'Rak A-02', stock: 32, minStock: 10, unit: 'pcs', cost: 42000, expiryDate: new Date(Date.now() + 86400000 * 48).toISOString().slice(0,10), updatedAt: new Date().toISOString() },
    { id: 'PRD-003', userId: 'USR-ADMIN', name: 'Madu Hutan 500ml', category: 'Sembako', sku: 'MAD-HU-500', location: 'Rak B-01', stock: 16, minStock: 8, unit: 'botol', cost: 95000, expiryDate: new Date(Date.now() + 86400000 * 150).toISOString().slice(0,10), updatedAt: new Date().toISOString() },
    { id: 'PRD-004', userId: 'USR-ADMIN', name: 'Granola Almond 300g', category: 'Makanan', sku: 'GRA-AL-300', location: 'Rak C-02', stock: 7, minStock: 10, unit: 'pcs', cost: 55000, expiryDate: new Date(Date.now() + 86400000 * 12).toISOString().slice(0,10), updatedAt: new Date().toISOString() },
    { id: 'PRD-005', userId: 'USR-ADMIN', name: 'Minyak Kelapa Murni', category: 'Kesehatan', sku: 'VCO-MR-250', location: 'Rak D-01', stock: 24, minStock: 6, unit: 'botol', cost: 78000, expiryDate: new Date(Date.now() + 86400000 * 180).toISOString().slice(0,10), updatedAt: new Date().toISOString() },
    { id: 'PRD-006', userId: 'USR-ADMIN', name: 'Cokelat Dark 70%', category: 'Makanan', sku: 'COK-DK-100', location: 'Rak C-01', stock: 3, minStock: 8, unit: 'pcs', cost: 38000, expiryDate: new Date(Date.now() + 86400000 * 90).toISOString().slice(0,10), updatedAt: new Date().toISOString() },
    { id: 'PRD-007', userId: 'USR-ADMIN', name: 'Susu Oat Barista', category: 'Minuman', sku: 'SUS-OT-1L', location: 'Rak A-03', stock: 19, minStock: 8, unit: 'karton', cost: 32000, expiryDate: new Date(Date.now() + 86400000 * 19).toISOString().slice(0,10), updatedAt: new Date().toISOString() },
    { id: 'PRD-008', userId: 'USR-ADMIN', name: 'Beras Organik 5kg', category: 'Sembako', sku: 'BRS-OR-5K', location: 'Rak B-03', stock: 12, minStock: 5, unit: 'karung', cost: 112000, expiryDate: new Date(Date.now() + 86400000 * 240).toISOString().slice(0,10), updatedAt: new Date().toISOString() }
  ],
  sessions: [
    { id: 'SO-2026-001', userId: 'USR-ADMIN', name: 'Stock Opname Gudang Utama', location: 'Gudang Utama', date: new Date(Date.now() - 86400000 * 2).toISOString().slice(0,10), status: 'Selesai', itemsChecked: 128, totalItems: 128, discrepancies: 3, createdBy: 'Admin Gudang', createdAt: new Date(Date.now() - 86400000 * 2).toISOString() },
    { id: 'SO-2026-002', userId: 'USR-ADMIN', name: 'Stock Opname Toko Jakarta', location: 'Toko Jakarta', date: new Date(Date.now() - 86400000 * 3).toISOString().slice(0,10), status: 'Selesai', itemsChecked: 86, totalItems: 86, discrepancies: 1, createdBy: 'Siti Nurhaliza', createdAt: new Date(Date.now() - 86400000 * 3).toISOString() },
    { id: 'SO-2025-003', userId: 'USR-ADMIN', name: 'Opname Rak Minuman', location: 'Rak A', date: new Date().toISOString().slice(0,10), status: 'Berlangsung', itemsChecked: 4, totalItems: 21, discrepancies: 1, createdBy: 'Budi Santoso', createdAt: new Date(Date.now() - 3600000 * 3).toISOString() }
  ],
  movements: [],
  activities: [
    { id: 'ACT-1', userId: 'USR-ADMIN', text: 'Stock Opname Gudang Utama selesai', user: 'Admin Gudang', time: new Date(Date.now()-3600000*2).toISOString(), type: 'complete' },
    { id: 'ACT-2', userId: 'USR-ADMIN', text: 'Penyesuaian stok Kopi Arabika Gayo', user: 'Budi Santoso', time: new Date(Date.now()-3600000*5).toISOString(), type: 'edit' },
    { id: 'ACT-3', userId: 'USR-ADMIN', text: 'Opname Rak Minuman dimulai', user: 'Budi Santoso', time: new Date(Date.now()-3600000*8).toISOString(), type: 'start' },
    { id: 'ACT-4', userId: 'USR-ADMIN', text: 'Produk baru ditambahkan: Beras Organik', user: 'Siti Nurhaliza', time: new Date(Date.now()-86400000).toISOString(), type: 'add' }
  ],
  approvals: [
    { id: 'APP-101', userId: 'USR-ADMIN', type: 'transfer', title: 'Permintaan Transfer Stok ke Toko Jakarta', requester: 'Siti Nurhaliza', sku: 'KOP-AR-250', productName: 'Kopi Arabika Gayo 250g', quantity: 15, from: 'Gudang Utama', to: 'Toko Jakarta', createdAt: new Date(Date.now() - 3600000 * 4).toISOString(), status: 'pending' },
    { id: 'APP-102', userId: 'USR-ADMIN', type: 'order', title: 'Persetujuan Restock Beras Organik 5kg', requester: 'Budi Santoso', sku: 'BRS-OR-5K', productName: 'Beras Organik 5kg', quantity: 30, from: 'Supplier Makmur', to: 'Gudang Utama', createdAt: new Date(Date.now() - 3600000 * 12).toISOString(), status: 'pending' }
  ]
};

const getAdminEmails = () => [
  process.env.ADMIN_EMAIL,
  ...(process.env.ADMIN_EMAILS ? process.env.ADMIN_EMAILS.split(',') : [])
].map(s => String(s || '').trim().toLowerCase()).filter(Boolean);

export async function database() {
  const syncAdminUsers = (db) => {
    const adminEmails = getAdminEmails();
    for (const email of adminEmails) {
      const existing = db.users.find(u => u.email === email);
      if (existing) {
        existing.role = 'admin';
      } else if (process.env.ADMIN_PASSWORD) {
        const cred = passwordHash(process.env.ADMIN_PASSWORD);
        db.users.push({
          id: `USR-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name: process.env.ADMIN_NAME || 'Administrator',
          email,
          role: 'admin',
          ...cred,
          createdAt: new Date().toISOString()
        });
      }
    }
  };

  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const endpoint = `${process.env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/stockly_state?id=eq.main&select=payload`;
      const headers = { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' };
      const response = await fetch(endpoint, { headers, cache: 'no-store', signal: AbortSignal.timeout(4000) });
      if (response.ok) {
        const rows = await response.json();
        let db = rows[0]?.payload;
        if (!db) db = structuredClone(seed);
        db.movements ||= []; db.users ||= []; db.authSessions ||= []; db.feedback ||= []; db.errors ||= []; db.pushSubscriptions ||= []; db.approvals ||= structuredClone(seed.approvals);
        for (const product of db.products) {
          product.userId ||= 'USR-ADMIN';
          product.minStock ??= 10;
          if (!product.expiryDate) {
            const days = product.id === 'PRD-004' ? 12 : product.id === 'PRD-007' ? 19 : product.id === 'PRD-001' ? 22 : product.id === 'PRD-002' ? 48 : 120;
            product.expiryDate = new Date(Date.now() + 86400000 * days).toISOString().slice(0, 10);
          }
        }
        for (const s of db.sessions) s.userId ||= 'USR-ADMIN';
        for (const a of db.activities) a.userId ||= 'USR-ADMIN';
        for (const a of db.approvals) a.userId ||= 'USR-ADMIN';
        for (const m of db.movements) m.userId ||= 'USR-ADMIN';
        if (!db.vapidKeys) { const ecdh=createECDH('prime256v1'); ecdh.generateKeys(); db.vapidKeys={publicKey:ecdh.getPublicKey().toString('base64url'),privateKey:ecdh.getPrivateKey().toString('base64url')}; }
        syncAdminUsers(db);
        if (!db.users.some(user=>user.role==='admin')) db.setupToken ||= randomBytes(18).toString('base64url');
        await save(db).catch(() => {});
        return db;
      } else {
        console.warn(`Supabase belum siap (${response.status}), menggunakan penyimpanan lokal.`);
      }
    } catch (e) {
      console.warn('Supabase fetch error:', e.message);
    }
  }
  let db;
  try { db = JSON.parse(await fs.readFile(dataFile, 'utf8')); }
  catch { await fs.mkdir(dataDir, { recursive: true }).catch(() => {}); db = structuredClone(seed); }
  db.movements ||= []; db.users ||= []; db.authSessions ||= []; db.feedback ||= []; db.errors ||= []; db.pushSubscriptions ||= []; db.approvals ||= structuredClone(seed.approvals);
  for (const product of db.products) {
    product.userId ||= 'USR-ADMIN';
    product.minStock ??= 10;
    if (!product.expiryDate) {
      const days = product.id === 'PRD-004' ? 12 : product.id === 'PRD-007' ? 19 : product.id === 'PRD-001' ? 22 : product.id === 'PRD-002' ? 48 : 120;
      product.expiryDate = new Date(Date.now() + 86400000 * days).toISOString().slice(0, 10);
    }
  }
  for (const s of db.sessions) s.userId ||= 'USR-ADMIN';
  for (const a of db.activities) a.userId ||= 'USR-ADMIN';
  for (const a of db.approvals) a.userId ||= 'USR-ADMIN';
  for (const m of db.movements) m.userId ||= 'USR-ADMIN';
  if (!db.vapidKeys) { const ecdh=createECDH('prime256v1'); ecdh.generateKeys(); db.vapidKeys={publicKey:ecdh.getPublicKey().toString('base64url'),privateKey:ecdh.getPrivateKey().toString('base64url')}; }
  syncAdminUsers(db);
  if (!db.users.some(user=>user.role==='admin')) db.setupToken ||= randomBytes(18).toString('base64url');
  await save(db).catch(() => {});
  return db;
}
async function save(db) {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const base = process.env.SUPABASE_URL.replace(/\/$/, '');
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
      const response = await fetch(`${base}/rest/v1/stockly_state?on_conflict=id`, { method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ id: 'main', payload: db, updated_at: new Date().toISOString() }), signal: AbortSignal.timeout(4000) });
      if (response.ok) return;
      console.warn(`Supabase save response: ${response.status}`);
    } catch (e) {
      console.warn('Supabase save error:', e.message);
    }
  }
  try {
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(dataFile, JSON.stringify(db, null, 2));
  } catch (err) {
    console.warn('Local save warning:', err.message);
  }
}
function send(res, status, body, type='application/json; charset=utf-8', extra={}) {
  if (typeof res.status === 'function' && type.startsWith('application/json')) {
    return res.status(status).json(body);
  }
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control':'no-store', ...extra });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}
async function body(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1_000_000) throw Object.assign(new Error('Permintaan terlalu besar.'), { status: 413 });
  }
  return raw ? JSON.parse(raw) : {};
}
const emailOK = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value||'').trim());
const passwordHash = (password,salt=randomBytes(16).toString('base64url')) => ({salt,hash:scryptSync(password,salt,64).toString('base64url')});
const hashToken = token => createHash('sha256').update(token).digest('hex');
const publicUser = user => ({id:user.id,name:user.name,email:user.email,role:user.role||'user',createdAt:user.createdAt});
function cookie(res, token, secure) { res.setHeader('Set-Cookie',`stokly_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${secure?'; Secure':''}`); }
function newAuthSession(db,user,req,res) { const token=randomBytes(32).toString('base64url'),secure=req.headers['x-forwarded-proto']==='https'||Boolean(req.socket.encrypted); db.authSessions.push({tokenHash:hashToken(token),userId:user.id,expiresAt:Date.now()+7*86400000}); cookie(res,token,secure); return publicUser(user); }
function currentUser(req,db) { const token=String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('stokly_session='))?.slice('stokly_session='.length); if(!token)return null; const session=db.authSessions.find(s=>s.tokenHash===hashToken(token)&&s.expiresAt>Date.now()); return session?db.users.find(u=>u.id===session.userId)||null:null; }
function secureCompare(a,b) { const aa=Buffer.from(String(a)),bb=Buffer.from(String(b)); return aa.length===bb.length&&timingSafeEqual(aa,bb); }

function base64url(value){return Buffer.from(value).toString('base64url')}
function hkdfExpand(prk,info,length){let previous=Buffer.alloc(0),output=Buffer.alloc(0),counter=1;while(output.length<length){previous=createHmac('sha256',prk).update(Buffer.concat([previous,info,Buffer.from([counter++])])).digest();output=Buffer.concat([output,previous]);}return output.subarray(0,length)}
function vapidJwt(db,audience){const header=base64url(JSON.stringify({typ:'JWT',alg:'ES256'})),payload=base64url(JSON.stringify({aud:audience,exp:Math.floor(Date.now()/1000)+3600,sub:process.env.VAPID_SUBJECT||'mailto:admin@stokly.app'})),input=`${header}.${payload}`,d=db.vapidKeys.privateKey,pub=Buffer.from(db.vapidKeys.publicKey,'base64url'),jwk={kty:'EC',crv:'P-256',d,x:base64url(pub.subarray(1,33)),y:base64url(pub.subarray(33))},key=createPrivateKey({key:jwk,format:'jwk'}),signature=cryptoSign('sha256',Buffer.from(input),{key,dsaEncoding:'ieee-p1363'});return `${input}.${base64url(signature)}`}
function webPushBody(db,subscription,payload){
  const clientPublic=Buffer.from(subscription.keys.p256dh,'base64url'),auth=Buffer.from(subscription.keys.auth,'base64url');
  if(clientPublic.length!==65||auth.length!==16)throw new Error('Kunci notifikasi tidak valid.');
  const sender=createECDH('prime256v1');sender.generateKeys();const senderPublic=sender.getPublicKey(),shared=sender.computeSecret(clientPublic);
  const prkAuth=createHmac('sha256',auth).update(shared).digest(),info=Buffer.concat([Buffer.from('WebPush: info\0'),clientPublic,senderPublic]),ikm=hkdfExpand(prkAuth,info,32);
  const salt=randomBytes(16),prk=createHmac('sha256',salt).update(ikm).digest(),key=hkdfExpand(prk,Buffer.from('Content-Encoding: aes128gcm\0'),16),nonce=hkdfExpand(prk,Buffer.from('Content-Encoding: nonce\0'),12);
  const cipher=createCipheriv('aes-128-gcm',key,nonce),plain=Buffer.concat([Buffer.from(JSON.stringify(payload)),Buffer.from([2])]),encrypted=Buffer.concat([cipher.update(plain),cipher.final(),cipher.getAuthTag()]);const header=Buffer.alloc(21);salt.copy(header,0);header.writeUInt32BE(4096,16);header[20]=senderPublic.length;
  return Buffer.concat([header,senderPublic,encrypted]);
}
async function sendPush(db,userIds,payload){
  const subscriptions=db.pushSubscriptions.filter(s=>userIds.includes(s.userId));let changed=false;
  for(const record of subscriptions){try{const endpoint=new URL(record.subscription.endpoint);if(!allowedPushHost(endpoint.hostname))continue;const body=webPushBody(db,record.subscription,payload),jwt=vapidJwt(db,endpoint.origin),response=await fetch(record.subscription.endpoint,{method:'POST',headers:{TTL:'3600','Content-Type':'application/octet-stream','Content-Encoding':'aes128gcm',Authorization:`vapid t=${jwt}, k=${db.vapidKeys.publicKey}`},body,signal:AbortSignal.timeout(8000)});if(response.status===404||response.status===410){db.pushSubscriptions=db.pushSubscriptions.filter(s=>s.id!==record.id);changed=true;}}catch(error){console.error('Push delivery error:',error.message);}}
  if(changed)await save(db);
}
function allowedPushHost(host){return host==='fcm.googleapis.com'||host==='web.push.apple.com'||host.endsWith('.push.services.mozilla.com')||host.endsWith('.notify.windows.com')}

export async function handle(req, res) {
  if (req.method === 'OPTIONS') return send(res, 204, '');
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/api' || url.pathname === '/api/' || url.pathname === '/api/health') {
    return send(res, 200, { ok: true, app: 'Stockly' });
  }
  let db;
  try {
    db = await database();
    if (url.pathname.startsWith('/api/')) {
      if (url.pathname === '/api/auth/status' && req.method==='GET') {
        const user=currentUser(req,db);
        return send(res,200,{user:user?publicUser(user):null,setupNeeded:!db.users.some(u=>u.role==='admin'),roles:['admin','manager','staff','user'],pushPublicKey:db.vapidKeys.publicKey});
      }
      if (url.pathname === '/api/auth/setup' && req.method==='POST') {
        const input=await body(req);
        const caller=currentUser(req,db);
        const hasAdmin=db.users.some(u=>u.role==='admin');
        if (hasAdmin && (!caller || caller.role !== 'admin') && !secureCompare(input.token, db.setupToken||'')) {
          return send(res,403,{error:'Hanya admin atau pemilik kode setup yang dapat membuat akun admin baru.'});
        }
        if(!input.name||!emailOK(input.email)||String(input.password||'').length<8||String(input.password||'').length>128)
          return send(res,400,{error:'Isi nama, email yang valid, dan kata sandi minimal 8 karakter.'});
        const email=String(input.email).trim().toLowerCase();
        if(db.users.some(u=>u.email===email))return send(res,409,{error:'Email sudah terdaftar.'});
        const cred=passwordHash(input.password),user={id:`USR-${Date.now()}`,name:String(input.name).trim(),email,role:'admin',...cred,createdAt:new Date().toISOString()};
        db.users.push(user);
        if(!hasAdmin) db.setupToken=null;
        db.activities.unshift({id:`ACT-${Date.now()}`,text:`Akun Administrator baru dibuat: ${user.name}`,user:user.name,time:user.createdAt,type:'add'});
        newAuthSession(db,user,req,res);
        await save(db);
        return send(res,201,{user:publicUser(user)});
      }
      if (url.pathname === '/api/auth/register' && req.method==='POST') {
        const input=await body(req);
        if(!input.name||!emailOK(input.email)||String(input.password||'').length<8||String(input.password||'').length>128)
          return send(res,400,{error:'Isi nama, email yang valid, dan kata sandi 8–128 karakter.'});
        const email=String(input.email).trim().toLowerCase();
        if(db.users.some(u=>u.email===email))return send(res,409,{error:'Email sudah terdaftar.'});
        const adminEmails=getAdminEmails();
        const role = adminEmails.includes(email) || !db.users.some(u=>u.role==='admin') ? 'admin' : (['manager','staff','user'].includes(input.role) ? input.role : 'user');
        const cred=passwordHash(input.password);
        const user={id:`USR-${Date.now()}`,name:String(input.name).trim().slice(0,80),email,role,...cred,createdAt:new Date().toISOString()};
        db.users.push(user);
        db.activities.unshift({id:`ACT-${Date.now()}`,text:`Akun pengguna baru dibuat: ${user.name} (${role})`,user:user.name,time:user.createdAt,type:'add'});

        // Sync with Supabase Auth admin if Supabase service role is available
        if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
          try {
            const sbUrl = `${process.env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1/admin/users`;
            await fetch(sbUrl, {
              method: 'POST',
              headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ email, password: input.password, email_confirm: true, user_metadata: { name: user.name, role: user.role }, app_metadata: { role: user.role } })
            });
          } catch (e) {
            console.warn('Supabase auth register warning:', e.message);
          }
        }

        newAuthSession(db,user,req,res);
        await save(db);
        return send(res,201,{user:publicUser(user)});
      }
      if (url.pathname === '/api/auth/login' && req.method==='POST') {
        const input=await body(req),email=String(input.email||'').trim().toLowerCase(),password=String(input.password||''),ip=req.socket.remoteAddress||'unknown',attemptKey=`${ip}:${email}`,attempt=loginAttempts.get(attemptKey)||{count:0,reset:Date.now()+60000};
        if(attempt.reset<Date.now()){attempt.count=0;attempt.reset=Date.now()+60000;}
        if(attempt.count>=12)return send(res,429,{error:'Terlalu banyak percobaan masuk. Coba lagi dalam satu menit.'});
        if(password.length>128){attempt.count++;loginAttempts.set(attemptKey,attempt);return send(res,401,{error:'Email atau kata sandi tidak sesuai.'});}

        let user = null;
        const adminEmails = getAdminEmails();

        // 1. Supabase Auth Verification (if SUPABASE_URL configured)
        if (process.env.SUPABASE_URL && (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY)) {
          try {
            const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
            const sbUrl = `${process.env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1/token?grant_type=password`;
            const sbRes = await fetch(sbUrl, {
              method: 'POST',
              headers: { apikey: sbKey, 'Content-Type': 'application/json' },
              body: JSON.stringify({ email, password })
            });
            if (sbRes.ok) {
              const sbData = await sbRes.json();
              if (sbData?.user) {
                const sbUser = sbData.user;
                const sbRole = (sbUser.app_metadata?.role || sbUser.user_metadata?.role || '').toLowerCase();
                const role = adminEmails.includes(email) ? 'admin' : (['admin', 'manager', 'staff'].includes(sbRole) ? sbRole : 'user');
                let localUser = db.users.find(u => u.email === email);
                if (localUser) {
                  localUser.name = sbUser.user_metadata?.name || sbUser.user_metadata?.full_name || localUser.name;
                  if (role === 'admin') localUser.role = 'admin';
                } else {
                  localUser = {
                    id: sbUser.id || `USR-${Date.now()}`,
                    name: sbUser.user_metadata?.name || sbUser.user_metadata?.full_name || email.split('@')[0],
                    email,
                    role,
                    createdAt: sbUser.created_at || new Date().toISOString()
                  };
                  db.users.push(localUser);
                }
                user = localUser;
              }
            }
          } catch (e) {
            console.error('Supabase auth attempt error:', e.message);
          }
        }

        // 2. Fallback to local user check
        if (!user) {
          const localUser = db.users.find(u => u.email === email);
          if (localUser && localUser.hash && localUser.salt && secureCompare(passwordHash(password, localUser.salt).hash, localUser.hash)) {
            if (adminEmails.includes(email)) localUser.role = 'admin';
            user = localUser;
          }
        }

        if (!user) {
          attempt.count++;
          loginAttempts.set(attemptKey, attempt);
          return send(res, 401, { error: 'Email atau kata sandi tidak sesuai.' });
        }

        loginAttempts.delete(attemptKey);
        db.authSessions = db.authSessions.filter(s => s.expiresAt > Date.now());
        newAuthSession(db, user, req, res);
        await save(db);
        return send(res, 200, { user: publicUser(user) });
      }
      if (url.pathname === '/api/auth/forgot-password' && req.method === 'POST') {
        const input = await body(req);
        const email = String(input.email || '').trim().toLowerCase();
        if (!emailOK(email)) return send(res, 400, { error: 'Masukkan alamat email yang valid.' });
        const user = db.users.find(u => u.email === email);
        if (!user) return send(res, 404, { error: 'Email tidak ditemukan di sistem Stockly.' });

        const code = Math.floor(100000 + Math.random() * 900000).toString();
        db.passwordResetCodes ||= [];
        db.passwordResetCodes = db.passwordResetCodes.filter(r => r.expiresAt > Date.now() && r.email !== email);
        db.passwordResetCodes.push({
          email,
          code,
          expiresAt: Date.now() + 10 * 60 * 1000
        });

        console.log(`[STOCKLY AUTH] Kode Verifikasi Reset Kata Sandi untuk ${email}: ${code}`);
        await save(db);

        return send(res, 200, {
          ok: true,
          message: `Kode verifikasi telah dikirim ke email ${email}.`,
          code
        });
      }
      if (url.pathname === '/api/auth/reset-password' && req.method === 'POST') {
        const input = await body(req);
        const email = String(input.email || '').trim().toLowerCase();
        const code = String(input.code || '').trim();
        const newPassword = String(input.newPassword || '');

        if (!emailOK(email) || !code) return send(res, 400, { error: 'Email dan kode verifikasi wajib diisi.' });
        if (newPassword.length < 8 || newPassword.length > 128) return send(res, 400, { error: 'Kata sandi baru harus 8–128 karakter.' });

        db.passwordResetCodes ||= [];
        const recordIndex = db.passwordResetCodes.findIndex(r => r.email === email && r.code === code && r.expiresAt > Date.now());
        if (recordIndex === -1) {
          return send(res, 400, { error: 'Kode verifikasi tidak valid atau telah kedaluwarsa.' });
        }

        const user = db.users.find(u => u.email === email);
        if (!user) return send(res, 404, { error: 'Pengguna tidak ditemukan.' });

        const cred = passwordHash(newPassword);
        user.salt = cred.salt;
        user.hash = cred.hash;
        db.passwordResetCodes.splice(recordIndex, 1);

        if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
          try {
            const sbSearch = await fetch(`${process.env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1/admin/users`, {
              headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` }
            });
            if (sbSearch.ok) {
              const sbUsers = await sbSearch.json();
              const sbUser = (sbUsers.users || []).find(u => u.email === email);
              if (sbUser) {
                await fetch(`${process.env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1/admin/users/${sbUser.id}`, {
                  method: 'PUT',
                  headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
                  body: JSON.stringify({ password: newPassword })
                });
              }
            }
          } catch (e) {
            console.warn('Supabase password reset warning:', e.message);
          }
        }

        db.activities.unshift({
          id: `ACT-${Date.now()}`,
          userId: user.id,
          text: `Kata sandi berhasil diperbarui melalui verifikasi email`,
          user: user.name,
          time: new Date().toISOString(),
          type: 'edit'
        });

        newAuthSession(db, user, req, res);
        await save(db);
        return send(res, 200, { ok: true, message: 'Kata sandi berhasil diubah.', user: publicUser(user) });
      }
      if (url.pathname === '/api/auth/logout' && req.method==='POST') {const token=String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('stokly_session='))?.slice('stokly_session='.length);db.authSessions=db.authSessions.filter(s=>s.tokenHash!==hashToken(token||''));res.setHeader('Set-Cookie',`stokly_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${req.headers['x-forwarded-proto']==='https'||req.socket.encrypted?'; Secure':''}`);await save(db);return send(res,200,{ok:true});}
      if (url.pathname === '/api/push/key' && req.method==='GET') return send(res,200,{publicKey:db.vapidKeys.publicKey});
      const user=currentUser(req,db);
      if (url.pathname === '/api/push/subscribe' && req.method==='POST') {if(!user)return send(res,401,{error:'Silakan masuk terlebih dahulu.'});const input=await body(req),subscription=input.subscription;let host='';try{host=new URL(subscription?.endpoint).hostname}catch{}if(!host||!allowedPushHost(host)||!subscription.keys?.p256dh||!subscription.keys?.auth)return send(res,400,{error:'Data langganan notifikasi tidak valid.'});db.pushSubscriptions=db.pushSubscriptions.filter(s=>s.userId!==user.id||s.subscription.endpoint!==subscription.endpoint);db.pushSubscriptions.push({id:`PUSH-${Date.now()}`,userId:user.id,subscription,createdAt:new Date().toISOString()});await save(db);return send(res,201,{ok:true});}
      if (url.pathname === '/api/push/subscribe' && req.method==='DELETE') {if(!user)return send(res,401,{error:'Silakan masuk terlebih dahulu.'});const input=await body(req);db.pushSubscriptions=db.pushSubscriptions.filter(s=>s.userId!==user.id||s.subscription.endpoint!==input.endpoint);await save(db);return send(res,200,{ok:true});}
      if (!user) return send(res,401,{error:'Sesi Anda berakhir. Silakan masuk kembali.'});
      if (url.pathname === '/api/feedback' && req.method==='GET') return send(res,200,db.feedback.filter(f=>f.userId===user.id).slice(0,30));
      if (url.pathname === '/api/feedback' && req.method==='POST') {const input=await body(req),message=String(input.message||'').trim();if(message.length<5)return send(res,400,{error:'Kritik atau saran minimal 5 karakter.'});const item={id:`FB-${Date.now()}`,userId:user.id,name:user.name,email:user.email,category:['Saran','Masalah','Ide Fitur'].includes(input.category)?input.category:'Saran',message:message.slice(0,3000),status:'Baru',createdAt:new Date().toISOString()};db.feedback.unshift(item);await save(db);await sendPush(db,db.users.filter(u=>u.role==='admin').map(u=>u.id),{title:'Kritik & saran baru',body:`${item.name}: ${item.message.slice(0,120)}`,url:'/#admin'});return send(res,201,item);}
      if (url.pathname === '/api/client-errors' && req.method==='POST') {const input=await body(req),message=String(input.message||'JavaScript error').slice(0,500),duplicate=db.errors.some(e=>e.message===message&&Date.now()-new Date(e.createdAt)<300000);if(!duplicate){db.errors.unshift({id:`ERR-${Date.now()}`,userId:user.id,source:'browser',message,stack:String(input.stack||'').slice(0,3000),page:String(input.page||'').slice(0,250),createdAt:new Date().toISOString(),status:'Baru'});db.errors=db.errors.slice(0,300);await save(db);await sendPush(db,db.users.filter(u=>u.role==='admin').map(u=>u.id),{title:'Error aplikasi terdeteksi',body:`${message.slice(0,120)} · ${String(input.page||'').slice(0,80)}`,url:'/#admin'});}return send(res,201,{ok:true});}
      if (url.pathname==='/api/admin/overview'&&req.method==='GET') {if(user.role!=='admin')return send(res,403,{error:'Halaman ini khusus admin.'});return send(res,200,{users:db.users.map(publicUser),feedback:db.feedback.slice(0,100),errors:db.errors.slice(0,100),stats:{users:db.users.length,feedback:db.feedback.filter(f=>f.status==='Baru').length,errors:db.errors.filter(e=>e.status==='Baru').length,products:db.products.length,activeSessions:db.sessions.filter(s=>s.status==='Berlangsung').length,uptime:process.uptime(),node:process.version}});}
      
      // Multi-Admin RBAC: Change user role
      const userRoleMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/role$/);
      if (userRoleMatch && req.method === 'PUT') {
        if (user.role !== 'admin') return send(res, 403, { error: 'Halaman ini khusus admin.' });
        const targetUser = db.users.find(u => u.id === decodeURIComponent(userRoleMatch[1]));
        if (!targetUser) return send(res, 404, { error: 'Pengguna tidak ditemukan.' });
        const input = await body(req);
        const validRoles = ['admin', 'manager', 'staff', 'user'];
        const newRole = String(input.role || '').toLowerCase();
        if (!validRoles.includes(newRole)) return send(res, 400, { error: 'Role tidak valid.' });
        targetUser.role = newRole;
        db.activities.unshift({
          id: `ACT-${Date.now()}`,
          text: `Peran akun ${targetUser.name} diubah menjadi ${newRole}`,
          user: user.name,
          time: new Date().toISOString(),
          type: 'edit'
        });
        await save(db);
        return send(res, 200, publicUser(targetUser));
      }

      // Multi-Admin: Admin creates new user/admin directly
      if (url.pathname === '/api/admin/users' && req.method === 'POST') {
        if (user.role !== 'admin') return send(res, 403, { error: 'Halaman ini khusus admin.' });
        const input = await body(req);
        if (!input.name || !emailOK(input.email) || String(input.password || '').length < 8) {
          return send(res, 400, { error: 'Isi nama, email yang valid, dan password minimal 8 karakter.' });
        }
        const email = String(input.email).trim().toLowerCase();
        if (db.users.some(u => u.email === email)) return send(res, 409, { error: 'Email sudah terdaftar.' });
        const validRoles = ['admin', 'manager', 'staff', 'user'];
        const role = validRoles.includes(input.role) ? input.role : 'user';
        const cred = passwordHash(input.password);
        const newUser = { id: `USR-${Date.now()}`, name: String(input.name).trim().slice(0, 80), email, role, ...cred, createdAt: new Date().toISOString() };
        db.users.push(newUser);
        db.activities.unshift({
          id: `ACT-${Date.now()}`,
          text: `Akun baru dibuat oleh ${user.name}: ${newUser.name} (${role})`,
          user: user.name,
          time: newUser.createdAt,
          type: 'add'
        });
        await save(db);
        return send(res, 201, publicUser(newUser));
      }

      // Reset Data Modular & Granular (Strictly scoped by user.id)
      if (url.pathname === '/api/reset' && req.method === 'POST') {
        const input = await body(req);
        if (String(input.confirmation || '').trim() !== 'RESET') {
          return send(res, 400, { error: 'Konfirmasi tidak sesuai. Harap ketik "RESET" dengan huruf kapital.' });
        }
        const scope = String(input.scope || '').toLowerCase();
        let message = '';

        if (scope === 'activities') {
          // Opsi A - Reset Log Aktivitas Saja
          db.activities = db.activities.filter(a => a.userId !== user.id);
          message = 'Riwayat log aktivitas berhasil dikosongkan ("Belum ada aktivitas").';
        } else if (scope === 'products') {
          // Opsi B - Reset Data Produk/Inventaris Saja
          db.products = db.products.filter(p => p.userId !== user.id);
          message = 'Katalog produk dan inventaris Anda berhasil direset ke 0.';
        } else if (scope === 'transactions') {
          // Opsi C - Reset Transaksi / Stock Opname Saja
          db.movements = (db.movements || []).filter(m => m.userId !== user.id);
          db.sessions = db.sessions.filter(s => s.userId !== user.id);
          db.approvals = (db.approvals || []).filter(a => a.userId !== user.id);
          message = 'Riwayat transaksi mutasi dan sesi stock opname berhasil dikosongkan.';
        } else if (scope === 'full') {
          // Opsi D - Reset Menyeluruh (Full Reset)
          db.products = db.products.filter(p => p.userId !== user.id);
          db.sessions = db.sessions.filter(s => s.userId !== user.id);
          db.activities = db.activities.filter(a => a.userId !== user.id);
          db.approvals = (db.approvals || []).filter(a => a.userId !== user.id);
          db.movements = (db.movements || []).filter(m => m.userId !== user.id);
          message = 'Full reset berhasil: Seluruh data inventaris dan aktivitas akun Anda telah dikembalikan ke angka 0.';
        } else {
          return send(res, 400, { error: 'Cakupan reset tidak valid. Pilih: activities, products, transactions, atau full.' });
        }

        await save(db);
        return send(res, 200, { ok: true, scope, message });
      }

      // Approvals API (Scoped by userId)
      if (url.pathname === '/api/approvals' && req.method === 'GET') {
        db.approvals ||= [];
        return send(res, 200, db.approvals.filter(a => a.userId === user.id));
      }
      const approvalActionMatch = url.pathname.match(/^\/api\/approvals\/([^/]+)\/(approve|reject)$/);
      if (approvalActionMatch && req.method === 'POST') {
        if (user.role !== 'admin') return send(res, 403, { error: 'Halaman ini khusus admin.' });
        db.approvals ||= [];
        const item = db.approvals.find(a => a.id === decodeURIComponent(approvalActionMatch[1]) && a.userId === user.id);
        if (!item) return send(res, 404, { error: 'Permintaan persetujuan tidak ditemukan.' });
        const action = approvalActionMatch[2];
        item.status = action === 'approve' ? 'approved' : 'rejected';
        item.resolvedBy = user.name;
        item.resolvedAt = new Date().toISOString();
        db.activities.unshift({
          id: `ACT-${Date.now()}`,
          userId: user.id,
          text: `Permintaan ${item.title} ${action === 'approve' ? 'disetujui' : 'ditolak'} oleh ${user.name}`,
          user: user.name,
          time: new Date().toISOString(),
          type: action === 'approve' ? 'complete' : 'edit'
        });
        await save(db);
        return send(res, 200, item);
      }

      const adminFeedback=url.pathname.match(/^\/api\/admin\/feedback\/([^/]+)$/);if(adminFeedback&&req.method==='PUT'){if(user.role!=='admin')return send(res,403,{error:'Halaman ini khusus admin.'});const item=db.feedback.find(f=>f.id===decodeURIComponent(adminFeedback[1]));if(!item)return send(res,404,{error:'Masukan tidak ditemukan.'});const input=await body(req);item.status=['Baru','Ditinjau','Selesai'].includes(input.status)?input.status:'Ditinjau';await save(db);return send(res,200,item);}
      const adminError=url.pathname.match(/^\/api\/admin\/errors\/([^/]+)$/);if(adminError&&req.method==='PUT'){if(user.role!=='admin')return send(res,403,{error:'Halaman ini khusus admin.'});const item=db.errors.find(e=>e.id===decodeURIComponent(adminError[1]));if(!item)return send(res,404,{error:'Error tidak ditemukan.'});item.status='Ditinjau';await save(db);return send(res,200,item);}
      if(url.pathname==='/api/push/test'&&req.method==='POST'){await sendPush(db,[user.id],{title:'Notifikasi Stockly aktif',body:'Notifikasi berhasil diterima di perangkat ini.',url:'/'});return send(res,200,{ok:true});}
      
      // Dashboard Overview (Strictly isolated by user.id)
      if (url.pathname === '/api/dashboard' && req.method === 'GET') {
        const userProducts = db.products.filter(p => p.userId === user.id);
        const userSessions = db.sessions.filter(s => s.userId === user.id);
        const userActivities = db.activities.filter(a => a.userId === user.id);
        const userApprovals = (db.approvals || []).filter(a => a.userId === user.id);
        const userMovements = (db.movements || []).filter(m => m.userId === user.id);

        const value = userProducts.reduce((s, p) => s + (p.stock * p.cost), 0);
        const lowStock = userProducts.filter(p => p.stock <= (p.minStock ?? 10) && p.stock > 0).length;
        const outOfStock = userProducts.filter(p => p.stock === 0).length;
        const availableUnits = userProducts.reduce((s, p) => s + p.stock, 0);
        const activeSessions = userSessions.filter(s => s.status === 'Berlangsung').length;
        const todayStr = new Date().toISOString().slice(0, 10);
        const checkedToday = userSessions.filter(s => s.date === todayStr).reduce((a, s) => a + (s.itemsChecked || 0), 0);
        const locations = [...new Set([...userProducts.map(p => p.location), ...userSessions.map(s => s.location)].filter(Boolean))].sort();

        return send(res, 200, {
          products: userProducts,
          sessions: userSessions,
          activities: userActivities,
          approvals: userApprovals,
          locations,
          movements: userMovements.slice(0, 30),
          stats: {
            products: userProducts.length,
            value,
            availableUnits,
            lowStock,
            outOfStock,
            activeSessions,
            checkedToday
          }
        });
      }

      // Products API (Strictly scoped by user.id)
      if (url.pathname === '/api/products' && req.method === 'GET') {
        return send(res, 200, db.products.filter(p => p.userId === user.id));
      }
      if (url.pathname === '/api/products' && req.method === 'POST') {
        const p = await body(req); if (!p.name || !p.sku) return send(res, 400, { error: 'Nama dan SKU wajib diisi.' });
        if (db.products.some(x => x.userId === user.id && x.sku.toLowerCase() === p.sku.toLowerCase())) {
          return send(res, 409, { error: 'SKU sudah digunakan.' });
        }
        const product = {
          id: `PRD-${Date.now().toString().slice(-6)}`,
          userId: user.id,
          category: 'Lainnya',
          location: 'Belum diatur',
          stock: 0,
          minStock: 10,
          unit: 'pcs',
          cost: 0,
          ...p,
          updatedAt: new Date().toISOString()
        };
        db.products.unshift(product);
        db.activities.unshift({
          id: `ACT-${Date.now()}`,
          userId: user.id,
          text: `Produk baru ditambahkan: ${product.name}`,
          user: user.name,
          time: new Date().toISOString(),
          type: 'add'
        });
        await save(db);
        return send(res, 201, product);
      }
      const productMatch = url.pathname.match(/^\/api\/products\/([^/]+)$/);
      const adjustMatch = url.pathname.match(/^\/api\/products\/([^/]+)\/adjust$/);
      if (adjustMatch && req.method === 'POST') {
        const product = db.products.find(p => p.id === decodeURIComponent(adjustMatch[1]) && p.userId === user.id);
        if (!product) return send(res, 404, { error: 'Produk tidak ditemukan.' });
        const input = await body(req), delta = Number(input.delta);
        if (!Number.isInteger(delta) || delta === 0) return send(res, 400, { error: 'Jumlah penyesuaian harus berupa angka bulat selain nol.' });
        if (product.stock + delta < 0) return send(res, 400, { error: 'Stok tidak boleh kurang dari nol.' });
        const previous = product.stock;
        product.stock += delta;
        product.updatedAt = new Date().toISOString();
        const movement = {
          id: `MOV-${Date.now()}`,
          userId: user.id,
          productId: product.id,
          productName: product.name,
          sku: product.sku,
          delta,
          previous,
          next: product.stock,
          reason: String(input.reason || 'Penyesuaian stok'),
          user: user.name,
          createdAt: new Date().toISOString()
        };
        db.movements.unshift(movement);
        db.activities.unshift({
          id: `ACT-${Date.now()}`,
          userId: user.id,
          text: `Stok ${product.name} ${delta > 0 ? 'ditambah' : 'dikurangi'} ${Math.abs(delta)} ${product.unit}`,
          user: movement.user,
          time: movement.createdAt,
          type: delta > 0 ? 'add' : 'edit'
        });
        await save(db);
        if (previous > product.minStock && product.stock <= product.minStock) {
          await sendPush(db, db.users.filter(u => u.role === 'admin' && u.id === user.id).map(u => u.id), {
            title: product.stock === 0 ? 'Stok produk habis' : 'Stok mencapai batas minimum',
            body: `${product.name}: tersisa ${product.stock} ${product.unit} (minimum ${product.minStock}).`,
            url: '/#reports'
          });
        }
        return send(res, 200, { product, movement });
      }
      if (productMatch && req.method === 'PUT') {
        const i = db.products.findIndex(p => p.id === decodeURIComponent(productMatch[1]) && p.userId === user.id);
        if (i < 0) return send(res, 404, { error: 'Produk tidak ditemukan.' });
        const changes = await body(req), product = db.products[i], previous = product.stock;
        if (changes.stock !== undefined && (!Number.isInteger(Number(changes.stock)) || Number(changes.stock) < 0)) return send(res, 400, { error: 'Stok harus berupa bilangan bulat nol atau lebih.' });
        if (changes.minStock !== undefined && (!Number.isInteger(Number(changes.minStock)) || Number(changes.minStock) < 0)) return send(res, 400, { error: 'Stok minimum harus berupa bilangan bulat nol atau lebih.' });
        db.products[i] = { ...product, ...changes, id: product.id, userId: user.id, updatedAt: new Date().toISOString() };
        if (changes.stock !== undefined && Number(changes.stock) !== Number(previous)) {
          const next = Number(changes.stock), delta = next - Number(previous);
          const movement = { id: `MOV-${Date.now()}`, userId: user.id, productId: product.id, productName: product.name, sku: product.sku, delta, previous, next, reason: 'Penyesuaian dari edit produk', user: user.name, createdAt: new Date().toISOString() };
          db.movements.unshift(movement);
          db.activities.unshift({ id: `ACT-${Date.now()}`, userId: user.id, text: `Stok ${product.name} disesuaikan dari edit produk`, user: movement.user, time: movement.createdAt, type: 'edit' });
        }
        await save(db);
        return send(res, 200, db.products[i]);
      }
      if (productMatch && req.method === 'DELETE') {
        const i = db.products.findIndex(p => p.id === decodeURIComponent(productMatch[1]) && p.userId === user.id);
        if (i < 0) return send(res, 404, { error: 'Produk tidak ditemukan.' });
        const [removed] = db.products.splice(i, 1);
        await save(db);
        return send(res, 200, removed);
      }

      // Sessions API (Strictly scoped by user.id)
      if (url.pathname === '/api/sessions' && req.method === 'POST') {
        const s = await body(req); if (!s.name) return send(res, 400, { error: 'Nama sesi wajib diisi.' });
        const userProducts = db.products.filter(p => p.userId === user.id);
        const session = {
          id: `SO-${Date.now()}`,
          userId: user.id,
          name: s.name,
          location: s.location || 'Gudang Utama',
          date: new Date().toISOString().slice(0, 10),
          status: 'Berlangsung',
          itemsChecked: 0,
          totalItems: userProducts.length,
          discrepancies: 0,
          createdBy: s.createdBy || user.name,
          createdAt: new Date().toISOString()
        };
        db.sessions.unshift(session);
        db.activities.unshift({
          id: `ACT-${Date.now()}`,
          userId: user.id,
          text: `${session.name} dimulai`,
          user: session.createdBy,
          time: new Date().toISOString(),
          type: 'start'
        });
        await save(db);
        return send(res, 201, session);
      }
      if (url.pathname === '/api/sessions' && req.method === 'GET') {
        return send(res, 200, db.sessions.filter(s => s.userId === user.id));
      }
      const sessionMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/(item|complete)$/);
      if (sessionMatch && req.method === 'POST') {
        const session = db.sessions.find(s => s.id === decodeURIComponent(sessionMatch[1]) && s.userId === user.id);
        if (!session) return send(res, 404, { error: 'Sesi tidak ditemukan.' });
        if (sessionMatch[2] === 'item') {
          const item = await body(req), product = db.products.find(p => p.id === item.productId && p.userId === user.id);
          if (!product) return send(res, 404, { error: 'Produk tidak ditemukan.' });
          const qty = Number(item.counted);
          if (!Number.isFinite(qty) || qty < 0) return send(res, 400, { error: 'Jumlah fisik tidak valid.' });
          session.counts ||= {};
          const firstCount = session.counts[product.id] === undefined;
          const diff = qty - product.stock;
          session.counts[product.id] = qty;
          session.itemsChecked = Object.keys(session.counts).length;
          session.discrepancies = Object.entries(session.counts).filter(([productId, counted]) => db.products.find(p => p.id === productId && p.userId === user.id)?.stock !== counted).length;
          session.progress = (session.itemsChecked / Math.max(session.totalItems, 1)) * 100;
          db.activities.unshift({
            id: `ACT-${Date.now()}`,
            userId: user.id,
            text: `${product.name} dihitung: ${qty} ${product.unit}${diff ? ` (${diff > 0 ? '+' : ''}${diff})` : ''}`,
            user: session.createdBy,
            time: new Date().toISOString(),
            type: 'edit'
          });
          await save(db);
          return send(res, 200, { session, product, difference: diff, firstCount });
        }
        const lowCrossings = [];
        for (const [productId, counted] of Object.entries(session.counts || {})) {
          const product = db.products.find(p => p.id === productId && p.userId === user.id);
          if (product) {
            const previous = product.stock;
            product.lastCounted = counted;
            product.lastVariance = counted - product.stock;
            product.stock = counted;
            product.updatedAt = new Date().toISOString();
            if (previous > product.minStock && product.stock <= product.minStock) {
              lowCrossings.push(`${product.name}: ${product.stock} ${product.unit} (minimum ${product.minStock})`);
            }
          }
        }
        session.status = 'Selesai';
        session.completedAt = new Date().toISOString();
        db.activities.unshift({
          id: `ACT-${Date.now()}`,
          userId: user.id,
          text: `${session.name} selesai`,
          user: session.createdBy,
          time: new Date().toISOString(),
          type: 'complete'
        });
        await save(db);
        if (lowCrossings.length) {
          await sendPush(db, db.users.filter(u => u.role === 'admin' && u.id === user.id).map(u => u.id), {
            title: 'Stok minimum terdeteksi',
            body: lowCrossings.slice(0, 3).join(' · '),
            url: '/#reports'
          });
        }
        return send(res, 200, session);
      }
      return send(res,404,{error:'Endpoint tidak ditemukan.'});
    }
    const safePath = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    let filePath = path.resolve(publicDir, `.${safePath}`);
    if (!filePath.startsWith(publicDir + path.sep)) {
      filePath = path.resolve(root, `.${safePath}`);
    }
    try {
      let data;
      try {
        data = await fs.readFile(filePath);
      } catch {
        const rootPath = path.resolve(root, `.${safePath}`);
        data = await fs.readFile(rootPath);
      }
      const ext = path.extname(safePath);
      const mime = {
        '.html': 'text/html; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.svg': 'image/svg+xml',
        '.webmanifest': 'application/manifest+json; charset=utf-8'
      }[ext] || 'application/octet-stream';
      return send(res, 200, data, mime);
    } catch {
      return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
    }
  } catch (error) { console.error(error); if(db&&error.status!==413){db.errors.unshift({id:`ERR-${Date.now()}`,source:'server',userId:currentUser(req,db)?.id||null,message:String(error.message||'Server error').slice(0,500),stack:String(error.stack||'').slice(0,3000),page:url.pathname,createdAt:new Date().toISOString(),status:'Baru'});db.errors=db.errors.slice(0,300);await save(db).catch(()=>{});await sendPush(db,db.users.filter(u=>u.role==='admin').map(u=>u.id),{title:'Error server Stockly',body:`${String(error.message||'Server error').slice(0,120)} · ${url.pathname}`,url:'/#admin'}).catch(()=>{});} return send(res,error.status||500,{error:error.status===413?'Permintaan terlalu besar.':'Terjadi kesalahan pada server.'}); }
}
export default handle;

