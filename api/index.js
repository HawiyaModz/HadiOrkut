const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const store = require('./store');

const app=express();
const ROOT=path.join(__dirname,'..');
app.disable('x-powered-by');
app.use(express.json({limit:'2mb'}));
app.use(express.urlencoded({extended:true}));
app.use(session({secret:process.env.SESSION_SECRET||crypto.randomBytes(24).toString('hex'),resave:false,saveUninitialized:false,cookie:{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production'}}));
app.use((req,res,next)=>{res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Methods','GET,POST,PUT,PATCH,DELETE,OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type,X-Signature,X-Token,X-Membership,Authorization');if(req.method==='OPTIONS')return res.sendStatus(204);next();});
app.use('/front',express.static(path.join(ROOT,'public/front')));
app.use('/assets',express.static(path.join(ROOT,'public/assets')));

const now=()=>new Date().toISOString();
const id=(p='TRX')=>`${p}_${Date.now()}_${Math.floor(100+Math.random()*900)}`;
const getSettings=()=>store.all('settings');
const setting=k=>{
  const envMap={
    okeconnect_member_id:'OKECONNECT_MEMBER_ID',
    okeconnect_pin:'OKECONNECT_PIN',
    okeconnect_password:'OKECONNECT_PASSWORD',
    ppob_secret:'PPOB_SECRET',
    global_margin:'GLOBAL_MARGIN',
    telegram_bot_token_ppob:'TELEGRAM_BOT_TOKEN_PPOB',
    telegram_chat_id:'TELEGRAM_CHAT_ID',
    token_fonnte:'TOKEN_FONNTE'
  };
  const v=getSettings()[k];
  if(v!==undefined && v!=='') return v;
  return envMap[k] ? (process.env[envMap[k]]||'') : (v??'');
};
function saveSetting(k,v){const s=getSettings();s[k]=v??'';store.set('settings',s);}
function device(ua=''){const m=ua.match(/Android\s+\d+;\s+(.+?)\s+Build/i);return m?m[1].trim():'UNKNOWN';}
function adminOnly(req,res,next){if(!req.session.admin)return res.status(401).json({error:'Unauthorized'});next();}
function config(){return {...getSettings()};}

// Closed API: requests under /api/v1 require a server-side API key.
// Keep the key in .env; never hard-code it into frontend files.
const CLOSED_API_KEY=process.env.CLOSED_API_KEY||'';
function closedApi(req,res,next){
  if(!CLOSED_API_KEY)return res.status(503).json({error:'Closed API belum dikonfigurasi.'});
  const supplied=req.get('X-API-Key')||req.get('Authorization')?.replace(/^Bearer\s+/i,'');
  if(!supplied){return res.status(401).json({error:'API key tidak valid.'});} const a=Buffer.from(String(supplied)); const b=Buffer.from(String(CLOSED_API_KEY)); if(a.length!==b.length||!crypto.timingSafeEqual(a,b))
    return res.status(401).json({error:'API key tidak valid.'});
  next();
}

async function okeGet(url, opts={}){const r=await fetch(url,{...opts,signal:AbortSignal.timeout(opts.timeout||60000)});return await r.text();}
async function telegram(text){const token=setting('telegram_bot_token_ppob'),chat=setting('telegram_chat_id');if(!token||!chat)return false;try{await fetch(`https://api.telegram.org/bot${encodeURIComponent(token)}/sendMessage`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:chat,text,parse_mode:'HTML'})});return true}catch{return false}}

function joinTransactions(rows){return rows.map(t=>({...t,product_name:(store.first('products',p=>p.buyer_sku_code===t.buyer_sku_code)||{}).product_name||''}));}
function signValid(req,action){const secret=setting('ppob_secret');if(!secret)return {ok:false,status:401,error:'PPOB Secret Key belum dikonfigurasi di Admin.'};const sig=req.get('X-Signature')||req.query.sign||req.body?.sign;const token=req.get('X-Token')||req.query.token||req.body?.token;if(!sig)return {ok:false,status:401,error:'Missing Signature.'};let payload;if(req.method==='GET'){const q={...req.query};delete q.sign;delete q.token;const qs=new URLSearchParams(Object.keys(q).sort().map(k=>[k,q[k]])).toString();payload=`${qs}|${action}|${token||''}`;}else payload=`${JSON.stringify(req.body||{})}|${action}|${token||''}`;const expected=crypto.createHash('sha256').update(payload+secret).digest('hex');if(!crypto.timingSafeEqual(Buffer.from(expected),Buffer.from(sig)))return {ok:false,status:401,error:'Invalid signature.'};const used=store.all('token_signature');if(used.some(x=>x.token===token&&x.action===action&&x.signature===sig))return {ok:false,status:401,error:'Token tidak berlaku'};used.push({id:id('SIG'),token,action,signature:sig,created_at:now()});store.set('token_signature',used.slice(-5000));return {ok:true};}

function categoryMatches(p, requested){
  const q=String(requested||'').toLowerCase().trim();
  if(!q) return true;
  const hay=`${p.category||''} ${p.product_name||''} ${p.brand||''} ${p.buyer_sku_code||''}`.toLowerCase();
  if(hay.includes(q)) return true;
  const groups={
    'game':['game','games','mobile legends','free fire','pubg','valorant','steam','garena','genshin','roblox','voucher game','codm','call of duty'],
    'topup game':['game','games','mobile legends','free fire','pubg','valorant','steam','garena','genshin','roblox','voucher game','codm','call of duty'],
    'digital':['game','games','mobile legends','free fire','pubg','valorant','steam','garena','genshin','roblox','voucher game','dompet','ewallet','e-wallet','dana','ovo','gopay','shopeepay','linkaja'],
    'dompet digital':['dompet','e-money','ewallet','e-wallet','dana','ovo','gopay','go pay','shopeepay','linkaja','brizzi','bri link','bca flazz','mandiri e-money','tapcash'],
    'ewallet':['dompet','e-money','ewallet','e-wallet','dana','ovo','gopay','go pay','shopeepay','linkaja','brizzi','bri link','bca flazz','mandiri e-money','tapcash'],
    'token pln':['token pln','pln token','pln prabayar','pln prepaid','token'],
    'pln':['token pln','pln token','pln prabayar','pln prepaid','pln'],
    'sms telepon':['pulsa','telepon','sms','voice','telfon'],
    'pulsa':['pulsa','telepon','sms','voice','telfon'],
    'kuota telkomsel':['telkomsel','simpati','by.u','byu','kartu as'],
    'data':['kuota','data internet','internet','telkomsel','indosat','xl','axis','tri','smartfren'],
    'air pdam':['pdam','air'],
    'pdam':['pdam','air'],
    'tagihan pbb':['pbb','pajak bumi','pajak bangunan'],
    'pbb':['pbb','pajak bumi','pajak bangunan'],
    'tagihan':['pascabayar','postpaid','tagihan','indihome','wifi','internet','bpjs','pln pascabayar','telkom'],
    'nominal bebas':['bebas','custom nominal','nominal'],
    'pascabayar':['pascabayar','postpaid','tagihan'],
    'tv':['tv','indihome tv','vision','mnc','transvision'],
  };
  const keys=groups[q]||[];
  return keys.some(k=>hay.includes(k));
}

async function products(req,res){
  const type=req.query.type||'',category=req.query.category||'',name=req.query.name||'',brand=req.query.brand||'',membership=req.query.membership||req.get('X-Membership')||'';
  const source=req.query.source||'';
  // Jika produk lokal belum ada tetapi OkeConnect sudah dikonfigurasi, coba sync sekali agar HTML langsung mendapatkan produk.
  if(store.all('products').length===0 && setting('okeconnect_member_id') && setting('okeconnect_pin') && setting('okeconnect_password')){
    try { await fetchAndStoreProducts(); } catch(e) { console.warn('[products] auto-sync gagal:', e.message); }
  }
  let products=store.all('products').filter(p=>Number(p.display??1)===1);
  if(source) products=products.filter(p=>String(p.source||'').toLowerCase()===String(source).toLowerCase());
  if(type)products=products.filter(p=>p.product_type===type);
  if(category){ const exact=products.filter(p=>String(p.category||'').toLowerCase()===String(category).toLowerCase()); products=exact.length?exact:products.filter(p=>categoryMatches(p,category)); }
  if(name)products=products.filter(p=>String(p.product_name||'').toLowerCase().includes(name.toLowerCase()));
  if(brand)products=products.filter(p=>p.brand===brand);
  const mp=store.all('membership_prices');
  const data=products.map(p=>{const adj=membership?(mp.find(x=>x.membership_name===membership&&x.buyer_sku_code===p.buyer_sku_code)?.price_adjustment||0):0;return {...p,price:Number(p.sell_price||0)+Number(adj)}}).sort((a,b)=>String(a.brand).localeCompare(String(b.brand))||Number(a.sell_price||0)-Number(b.sell_price||0));
  res.json({data});
}

async function transaction(req,res){
  const input=req.body||{}, s=config();
  if(!s.okeconnect_member_id||!s.okeconnect_pin||!s.okeconnect_password)return res.json({error:'Konfigurasi OkeConnect belum diatur di Admin.'});
  const sku=input.buyer_sku_code||'', customer=input.customer_no||'', cmd=input.cmd||'', user=input.id_user||'', name=input.nama_user||'', amount=Number(input.amount||0);
  if(!sku||!customer)return res.json({error:'Parameter ref_id, buyer_sku_code, dan customer_no wajib diisi.'});
  if(amount>0&&(amount<10000||amount>1000000))return res.json({error:'Nominal transaksi bebas harus antara Rp 10.000 dan Rp 1.000.000.'});
  const member=store.first('members',m=>m.id_user===user);
  const ua=device(req.get('user-agent')||'');
  if(user){if(!member)return res.json({status:false,code:'USER_NOT_FOUND',message:'User tidak ditemukan'});if(member.ua&&member.ua!=='-'&&member.ua!==ua)return res.json({status:false,code:'NOT_ALLOWED',message:'Silahkan Hubungi Admin'});if(!member.ua||member.ua==='-'){member.ua=ua;store.upsert('members',m=>m.id_user===user,member);}}
  const p=store.first('products',x=>x.buyer_sku_code===sku)||{};
  const activeMembership=member?.nama_membership||input.membership||req.get('X-Membership')||'';
  let harga=amount+Number(p.sell_price||0);
  const adj=store.first('membership_prices',x=>x.membership_name===activeMembership&&x.buyer_sku_code===sku); if(adj)harga+=Number(adj.price_adjustment||0);
  if(member?.restricted_products&&member.restricted_products.split(',').map(x=>x.trim().toLowerCase()).includes(sku.toLowerCase()))return res.json({error:'Maaf, Anda tidak dapat membeli produk ini (produk dibatasi).'});
  let ref=input.ref_id||id('TRX'), dbCommand=cmd==='status'?'status':cmd==='inquiry'?'inquiry':cmd==='pay-pasca'?'pay-pasca':'topup';
  let needCut=cmd!=='status'&&cmd!=='inquiry';
  if(cmd==='pay-pasca'){const old=store.first('transactions',t=>t.ref_id===ref&&t.command==='inquiry');if(!old)return res.json({status:false,message:'Data inquiry tidak ditemukan.'});harga=Number(old.selling_price||0)+Number(p.margin||0);ref=id('PAY');}
  if(needCut&&member&&Number(member.saldo_user||0)<harga)return res.json({status:false,code:'SALDO_KURANG',message:'Saldo tidak mencukupi',saldo:Number(member.saldo_user||0),harga});
  if(needCut&&member){member.saldo_user=Number(member.saldo_user||0)-harga;member.jumlah_transaksi=Number(member.jumlah_transaksi||0)+1;store.upsert('members',m=>m.id_user===user,member);}
  const tx={ref_id:ref,id_user:user,nama_user:name,price_user:harga,buyer_user:'',buyer_sku_code:sku,customer_no:customer,command:dbCommand,status:'Pending',message:'',rc:'',sn:'',price:Number(p.price||0)+amount,selling_price:harga,customer_name:'',admin_fee:0,desc_detail:'',created_at:now(),updated_at:now(),ip:req.ip};
  let responseText='';
  try{
    const u=new URL('https://h2h.okeconnect.com/trx');u.searchParams.set('product',sku);u.searchParams.set('dest',customer);u.searchParams.set('refID',ref);u.searchParams.set('memberID',s.okeconnect_member_id);u.searchParams.set('pin',s.okeconnect_pin);u.searchParams.set('password',s.okeconnect_password);if(cmd==='status')u.searchParams.set('check','1');if(amount>0)u.searchParams.set('qty',String(amount));
    responseText=input.testing?`T#123 R#${ref} Testing ${sku}.${customer} akan diproses. Saldo`:await okeGet(u.toString());
  }catch(e){responseText='GAGAL. '+e.message;}
  let status=/SUKSES/i.test(responseText)?'Sukses':/GAGAL|Format|salah|belum terdaftar/i.test(responseText)?'Gagal':/diproses/i.test(responseText)?'Pending':'Pending';
  let sn='';let m;if(status==='Sukses'&&(m=responseText.match(/SN:\s*(.*?)\s*Saldo/i)))sn=m[1];if(status==='Gagal'&&(m=responseText.match(/KET:\s*(.*?)\s*Saldo/i)))sn=m[1];
  const clean=responseText.replace(/Saldo\s*[\d\.,]+/ig,'').trim();Object.assign(tx,{status,message:clean,sn,updated_at:now()});
  const arr=store.all('transactions');const ix=arr.findIndex(x=>x.ref_id===ref);if(ix<0)arr.push(tx);else arr[ix]={...arr[ix],...tx};store.set('transactions',arr);
  if(status==='Gagal'&&needCut&&member){member.saldo_user=Number(member.saldo_user||0)+harga;store.upsert('members',x=>x.id_user===user,member);}
  telegram(`Transaksi <b>${ref}</b>\n${sku} → ${customer}\nStatus: ${status}\nUser: ${name||user}`);
  res.json({data:{ref_id:ref,buyer_sku_code:sku,customer_no:customer,status,message:clean,price:Number(p.price||0)+amount,selling_price:harga,sn}});
}

async function fetchAndStoreProducts(){
  const s=config();
  if(!s.okeconnect_member_id||!s.okeconnect_pin||!s.okeconnect_password) throw new Error('Konfigurasi OkeConnect belum lengkap.');
  const balanceUrl=new URL('https://h2h.okeconnect.com/trx/balance');
  balanceUrl.searchParams.set('memberID',s.okeconnect_member_id); balanceUrl.searchParams.set('pin',s.okeconnect_pin); balanceUrl.searchParams.set('password',s.okeconnect_password);
  const balanceRaw=await okeGet(balanceUrl.toString());
  if(!/Saldo\s+[0-9.]+/i.test(balanceRaw)) throw new Error('Koneksi OkeConnect gagal: '+balanceRaw);
  const raw=await okeGet('https://okeconnect.com/harga/json?id=905ccd028329b0a',{timeout:60000});
  let list=JSON.parse(raw);
  if(list && !Array.isArray(list) && Array.isArray(list.data)) list=list.data;
  if(!Array.isArray(list)) throw new Error('Format data produk OkeConnect tidak valid.');
  const arr=store.all('products'), marginGlobal=Number(setting('global_margin')||0), seen=[];
  for(const x of list){
    const sku=String(x.kode||x.buyer_sku_code||x.sku||'').trim(); if(!sku) continue; seen.push(sku);
    const old=arr.find(p=>p.buyer_sku_code===sku);
    const rawPrice=Number(x.harga??x.price??x.selling_price??0);
    const margin=old?Number(old.margin||0):marginGlobal;
    const item={...(old||{}),source:'OkeConnect',buyer_sku_code:sku,product_name:String(x.keterangan||x.product_name||x.nama||sku),category:String(x.kategori||x.category||''),brand:String(x.produk||x.brand||x.operator||''),type:'Umum',seller_name:'OkeConnect',price:rawPrice,sell_price:rawPrice+margin,margin,admin:Number(x.admin||0),commission:Number(x.commission||0),buyer_product_status:Number(x.status??1)===1,seller_product_status:1,unlimited_stock:1,stock:9999,multi:0,start_cut_off:'',end_cut_off:'',description:String(x.keterangan||x.description||''),product_type:'prepaid',display:old?.display??1};
    if(old) Object.assign(old,item); else arr.push(item);
  }
  for(const p of arr) if(p.source==='OkeConnect'&&!seen.includes(p.buyer_sku_code)) p.buyer_product_status=0;
  store.set('products',arr); saveSetting('okeconnect_connected','1'); saveSetting('okeconnect_last_sync',now());
  return {total_api:list.length,processed:seen.length,product_count:arr.filter(p=>p.source==='OkeConnect').length};
}

async function syncProducts(res){
  try { const result=await fetchAndStoreProducts(); return res.json({success:true,connected:true,message:'OkeConnect terhubung dan produk berhasil diperbarui.',...result}); }
  catch(e){ saveSetting('okeconnect_connected','0'); return res.status(400).json({success:false,connected:false,message:e.message}); }
}

async function adminAction(req,res){
 const a=req.query.action||'';
 if(a==='login'){
   const {username,password}=req.body||{}, ad=store.first('admins',x=>x.username===username);
   if(!ad||!bcrypt.compareSync(password||'',ad.password))return res.status(401).json({success:false,error:'Username atau password salah'});req.session.admin={id:ad.id,username:ad.username};return res.json({success:true});
 }
 if(a==='logout'){req.session.destroy(()=>res.json({success:true}));return;}
 if(!req.session.admin)return res.status(401).json({error:'Silakan login admin.'});
 if(a==='get_config'){const ad=store.first('admins',x=>x.id===req.session.admin.id);return res.json({admin_username:ad?.username||'',okeconnect_member_id:setting('okeconnect_member_id'),okeconnect_pin:setting('okeconnect_pin'),okeconnect_password:setting('okeconnect_password'),webhook_secret:setting('okeconnect_password'),okeconnect_connected:Boolean(setting('okeconnect_connected')),okeconnect_last_sync:setting('okeconnect_last_sync'),okeconnect_product_count:store.all('products').length,margin_global:Number(setting('global_margin')||0),ppob_secret:setting('ppob_secret'),token_bo:setting('token_bo'),telegram_bot_token_ppob:setting('telegram_bot_token_ppob'),telegram_chat_id:setting('telegram_chat_id'),token_fonnte:setting('token_fonnte')});}
 if(a==='save_config'){const d=req.body||{};for(const [k,v] of Object.entries({okeconnect_member_id:d.okeconnect_member_id,okeconnect_pin:d.okeconnect_pin,okeconnect_password:d.okeconnect_password??d.webhook_secret,global_margin:d.margin_global,ppob_secret:d.ppob_secret,token_bo:d.token_bo,telegram_bot_token_ppob:d.telegram_bot_token_ppob,telegram_chat_id:d.telegram_chat_id,token_fonnte:d.token_fonnte}))if(v!==undefined)saveSetting(k,v); if(d.okeconnect_member_id&&d.okeconnect_pin&&(d.okeconnect_password??d.webhook_secret)){try{const sync=await fetchAndStoreProducts();return res.json({success:true,connected:true,message:'Konfigurasi tersimpan, OkeConnect terhubung, produk berhasil dimuat.',...sync});}catch(e){saveSetting('okeconnect_connected','0');return res.json({success:true,connected:false,message:'Konfigurasi tersimpan, tetapi koneksi/produk OkeConnect gagal: '+e.message});}} return res.json({success:true,connected:false,message:'Konfigurasi berhasil disimpan'});}
 if(a==='test_okeconnect'){const s=config();if(!s.okeconnect_member_id||!s.okeconnect_pin||!s.okeconnect_password)return res.status(400).json({success:false,connected:false,message:'Member ID, PIN, dan Password OkeConnect wajib diisi.'});try{const u=new URL('https://h2h.okeconnect.com/trx/balance');u.searchParams.set('memberID',s.okeconnect_member_id);u.searchParams.set('pin',s.okeconnect_pin);u.searchParams.set('password',s.okeconnect_password);const raw=await okeGet(u.toString());const m=raw.match(/Saldo\s+([0-9.]+)/i);if(!m)throw new Error(raw||'Respons OkeConnect tidak dikenali');saveSetting('okeconnect_connected','1');saveSetting('okeconnect_last_sync',now());return res.json({success:true,connected:true,balance:Number(m[1].replace(/\./g,'')),message:'Koneksi OkeConnect berhasil.'});}catch(e){saveSetting('okeconnect_connected','0');return res.status(400).json({success:false,connected:false,message:'Koneksi OkeConnect gagal: '+e.message});}}
 if(a==='update_security'){const d=req.body||{},ad=store.first('admins',x=>x.id===req.session.admin.id);if(!ad)return res.status(404).json({error:'Admin tidak ditemukan'});if(!bcrypt.compareSync(d.current_password||'',ad.password))return res.status(400).json({error:'Password saat ini salah'});ad.username=d.username||ad.username;if(d.new_password)ad.password=bcrypt.hashSync(d.new_password,10);store.upsert('admins',x=>x.id===ad.id,ad);req.session.admin.username=ad.username;return res.json({success:true,message:'Keamanan berhasil diperbarui'});}
 if(a==='get_categories'){const type=req.query.type||'prepaid';return res.json([...new Set(store.all('products').filter(p=>p.product_type===type&&p.category).map(p=>p.category))].sort());}
 if(a==='get_memberships')return res.json(store.all('memberships').sort((x,y)=>x.name.localeCompare(y.name)));
 if(a==='create_membership'){const name=String(req.body?.name||'').trim();if(!name)return res.json({success:false,message:'Nama membership tidak boleh kosong'});if(store.first('memberships',x=>x.name.toLowerCase()===name.toLowerCase()))return res.json({success:false,message:'Membership sudah ada'});store.all('memberships').push({id:id('MEM'),name,created_at:now()});store.set('memberships',store.all('memberships'));return res.json({success:true,message:'Membership baru berhasil disimpan'});}
 if(a==='delete_membership'){const name=String(req.body?.name||'');store.remove('memberships',x=>x.name===name);store.remove('membership_prices',x=>x.membership_name===name);return res.json({success:true});}
 if(a==='get_membership_prices'){const name=req.query.membership||'';return res.json(store.all('membership_prices').filter(x=>!name||x.membership_name===name));}
 if(a==='save_membership_price'){const d=req.body||{};store.upsert('membership_prices',x=>x.membership_name===d.membership_name&&x.buyer_sku_code===d.buyer_sku_code,{membership_name:d.membership_name,buyer_sku_code:d.buyer_sku_code,price_adjustment:Number(d.price_adjustment||0),created_at:now()});return res.json({success:true});}
 if(a==='get_products'){let p=store.all('products');if(req.query.source==='OkeConnect')p=p.filter(x=>x.source==='OkeConnect');const type=req.query.type||req.query.product_type;if(type)p=p.filter(x=>x.product_type===type);if(req.query.search){const q=req.query.search.toLowerCase();p=p.filter(x=>`${x.buyer_sku_code} ${x.product_name} ${x.category} ${x.brand}`.toLowerCase().includes(q));}return res.json({data:p,hasNext:false,total:p.length});}
 if(a==='sync_products'||a==='cron')return syncProducts(res);
 if(a==='update_margin'){const d=req.body||{},m=Number(d.margin||0),type=d.type||'';const arr=store.all('products');for(const p of arr){const yes=type==='global'&&p.product_type===(d.product_type||'prepaid')||type==='category'&&p.category===d.category&&p.product_type===(d.product_type||'prepaid')||type==='selected'&&(d.skus||[]).includes(p.buyer_sku_code);if(yes){p.margin=m;p.sell_price=Number(p.price||0)+m;}}store.set('products',arr);return res.json({success:true,message:'Margin berhasil diperbarui'});}
 if(a==='update_display'){const d=req.body||{},display=Number(d.display??1),type=d.type||'',arr=store.all('products');for(const p of arr){const yes=type==='global'&&p.product_type===(d.product_type||'prepaid')||type==='category'&&p.category===d.category&&p.product_type===(d.product_type||'prepaid')||type==='selected'&&(d.skus||[]).includes(p.buyer_sku_code);if(yes)p.display=display;}store.set('products',arr);return res.json({success:true});}
 if(a==='edit_product_name'){const d=req.body||{},p=store.first('products',x=>x.buyer_sku_code===d.buyer_sku_code);if(!p)return res.status(404).json({error:'SKU tidak ditemukan'});p.product_name=String(d.product_name||'').trim();store.upsert('products',x=>x.buyer_sku_code===p.buyer_sku_code,p);return res.json({success:true});}
 if(a==='get_transactions'){let t=joinTransactions(store.all('transactions'));const q=String(req.query.search||'').toLowerCase();if(q)t=t.filter(x=>JSON.stringify(x).toLowerCase().includes(q));t.sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));const limit=Number(req.query.limit||50),offset=Number(req.query.offset||0);return res.json({data:t.slice(offset,offset+limit),hasNext:offset+limit<t.length,total:t.length});}
 if(a==='transaction'){const input=req.body||{},ref=input.ref_id||id('TRX'),s=config();try{const u=new URL('https://h2h.okeconnect.com/trx');const sign=crypto.createHash('md5').update(`${s.okeconnect_member_id||''}${s.okeconnect_pin||''}${ref}`).digest('hex');const payload={username:s.okeconnect_member_id,buyer_sku_code:input.buyer_sku_code||'',customer_no:input.customer_no||'',ref_id:ref,sign};if(input.commands)payload.commands=input.commands;if(input.testing)payload.testing=true;const raw=await okeGet(u.toString(),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload),timeout:60000});let out;try{out=JSON.parse(raw)}catch{out={data:{ref_id:ref,status:'Pending',message:raw,buyer_sku_code:payload.buyer_sku_code,customer_no:payload.customer_no}};};if(out.data){const x=out.data,arr=store.all('transactions'),tx={ref_id:x.ref_id||ref,buyer_sku_code:x.buyer_sku_code||payload.buyer_sku_code,customer_no:x.customer_no||payload.customer_no,command:input.commands||'',status:x.status||'',message:x.message||'',rc:x.rc||'',sn:x.sn||'',price:Number(x.price||0),selling_price:Number(x.selling_price||0),customer_name:x.customer_name||'',desc_detail:x.desc||'',created_at:now(),updated_at:now()};const i=arr.findIndex(z=>z.ref_id===tx.ref_id);if(i<0)arr.push(tx);else arr[i]={...arr[i],...tx};store.set('transactions',arr);}return res.send(raw);}catch(e){return res.status(500).json({error:e.message});}}
 if(a==='get_balance'){const s=config();if(!s.okeconnect_member_id||!s.okeconnect_pin||!s.okeconnect_password)return res.json({balance:0,error:'Belum disetting'});try{const u=new URL('https://h2h.okeconnect.com/trx/balance');u.searchParams.set('memberID',s.okeconnect_member_id);u.searchParams.set('pin',s.okeconnect_pin);u.searchParams.set('password',s.okeconnect_password);const raw=await okeGet(u.toString());const m=raw.match(/Saldo\s+([0-9\.]+)/i);return res.json(m?{balance:Number(m[1].replace(/\./g,''))}:{balance:0,error:`Unknown format: ${raw}`});}catch(e){return res.json({balance:0,error:e.message});}}
 if(a==='get_members'){let m=store.all('members');const q=String(req.query.search||'').toLowerCase();if(q)m=m.filter(x=>JSON.stringify(x).toLowerCase().includes(q));return res.json({data:m,total:m.length});}
 if(a==='get_member_detail'){const m=store.first('members',x=>x.id_user===req.query.id_user);if(!m)return res.status(404).json({error:'Member tidak ditemukan'});return res.json({member:m,transactions:joinTransactions(store.all('transactions').filter(x=>x.id_user===m.id_user).sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))).slice(0,50))});}
 if(a==='save_member'){const d=req.body||{};if(!d.id_user)return res.json({error:'ID User tidak boleh kosong'});store.upsert('members',x=>x.id_user===d.id_user,{id_user:String(d.id_user),nama_user:d.nama_user||'',nomor_telepon:d.nomor_telepon||'',email_user:d.email_user||'',saldo_user:Number(d.saldo_user||0),nama_membership:d.nama_membership||'Umum',poin_member:Number(d.poin_member||0),jumlah_transaksi:Number(d.jumlah_transaksi||0),last_login:d.last_login||now(),ua:d.ua||'-',restricted_products:d.restricted_products||''});return res.json({success:true,message:'Data user berhasil disimpan'});}
 if(a==='delete_member'){const n=store.remove('members',x=>x.id_user===req.query.id_user);return res.json({success:n>0});}
 if(a==='get_stats'||a==='get_report_stats'){const t=store.all('transactions'),today=new Date().toISOString().slice(0,10);const daily=t.filter(x=>String(x.created_at).slice(0,10)===today);return res.json({total_transactions:t.length,daily_transactions:daily.length,daily_revenue:daily.reduce((s,x)=>s+Number(x.selling_price||0),0),success_count:t.filter(x=>/sukses/i.test(x.status)).length,failed_count:t.filter(x=>/gagal/i.test(x.status)).length});}
 if(a==='export_transactions'){res.setHeader('Content-Type','text/csv');res.setHeader('Content-Disposition','attachment; filename="transactions.csv"');const rows=store.all('transactions');const keys=['ref_id','id_user','nama_user','buyer_sku_code','customer_no','command','status','message','sn','price','selling_price','created_at'];return res.send([keys.join(','),...rows.map(x=>keys.map(k=>JSON.stringify(x[k]??'')).join(','))].join('\n'));}
 return res.status(404).json({error:'Aksi admin tidak valid'});
}

// Public API compatibility: / and /index.php both behave like the old index.php
async function publicAction(req,res){
 const action=req.query.action||'';
 if(action==='products')return products(req,res);
 if(action==='transaction')return transaction(req,res);
 if(action==='history'){const uid=req.query.id_user;if(!uid)return res.json({error:'Parameter id_user wajib diisi.'});let t=store.all('transactions').filter(x=>x.id_user===uid);if(req.query.start_date)t=t.filter(x=>x.created_at>=req.query.start_date);if(req.query.end_date)t=t.filter(x=>x.created_at<=req.query.end_date+'T23:59:59');t.sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));return res.json({data:joinTransactions(t),success:true});}
 if(action==='update_transaction'){const d=req.body||{},t=store.first('transactions',x=>x.ref_id===d.ref_id);if(!t)return res.json({code:500,message:'Transaksi tidak ditemukan.'});Object.assign(t,{buyer_user:d.buyer_user||'',price_user:Number(d.price_user||0),updated_at:now()});store.upsert('transactions',x=>x.ref_id===t.ref_id,t);return res.json({code:200,message:'Transaksi berhasil diperbarui.'});}
 if(action==='delete_transaction'){const n=store.remove('transactions',x=>x.ref_id===req.query.ref_id);return res.json({code:n?200:500,message:n?'Transaksi berhasil dihapus.':'Gagal menghapus transaksi.'});}
 if(action==='trx'){const t=store.all('transactions').filter(x=>x.ref_id===req.query.ref_id);return res.json({data:joinTransactions(t)});}
 if(action==='cron')return syncProducts(res);
 if(action==='Member'){const d=req.body||{};if(!d.id_user)return res.json({error:'ID User tidak boleh kosong'});const existing=store.first('members',x=>x.id_user===d.id_user);const ua=device(req.get('user-agent')||'');const val={id_user:String(d.id_user),nama_user:String(d.nama_user||''),nomor_telepon:String(d.nomor_telepon||''),email_user:String(d.email_user||''),saldo_user:Number(d.saldo_user||0),nama_membership:String(d.nama_membership||'Umum'),poin_member:Number(d.poin_member||0),jumlah_transaksi:Number(d.jumlah_transaksi||0),last_login:now(),ua:existing?.ua&&existing.ua!=='-'?existing.ua:ua,restricted_products:existing?.restricted_products||''};store.upsert('members',x=>x.id_user===d.id_user,val);return res.json({success:true,message:existing?'Data user diupdate':'Data user berhasil disimpan'});}
 if(action)return res.status(400).json({error:'Aksi tidak valid'});
 return res.sendFile(path.join(ROOT,'views','home.html'));
}

// Closed API endpoints (server-to-server / trusted clients only)
app.use('/api/v1',closedApi);
app.get('/api/v1/products',products);
app.post('/api/v1/transaction',transaction);
app.get('/api/v1/history',(req,res)=>{const uid=req.query.id_user;if(!uid)return res.status(400).json({error:'Parameter id_user wajib diisi.'});let t=store.all('transactions').filter(x=>x.id_user===uid);if(req.query.start_date)t=t.filter(x=>x.created_at>=req.query.start_date);if(req.query.end_date)t=t.filter(x=>x.created_at<=req.query.end_date+'T23:59:59');t.sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));res.json({data:joinTransactions(t),success:true});});
app.get('/api/v1/trx',(req,res)=>{const t=store.all('transactions').filter(x=>x.ref_id===req.query.ref_id);res.json({data:joinTransactions(t)});});
app.post('/api/v1/member',(req,res)=>{const d=req.body||{};if(!d.id_user)return res.status(400).json({error:'ID User tidak boleh kosong'});const existing=store.first('members',x=>x.id_user===d.id_user);const val={id_user:String(d.id_user),nama_user:String(d.nama_user||''),nomor_telepon:String(d.nomor_telepon||''),email_user:String(d.email_user||''),saldo_user:Number(d.saldo_user||0),nama_membership:String(d.nama_membership||'Umum'),poin_member:Number(d.poin_member||0),jumlah_transaksi:Number(d.jumlah_transaksi||0),last_login:now(),ua:existing?.ua||'-',restricted_products:existing?.restricted_products||''};store.upsert('members',x=>x.id_user===d.id_user,val);res.json({success:true,message:existing?'Data user diupdate':'Data user berhasil disimpan'});});

app.all('/api/client',publicAction);
app.all(['/','/index.php'],publicAction);
app.all('/admin.php',adminAction);
app.get('/admin',(req,res)=>res.sendFile(path.join(ROOT,'views','admin.html')));
app.all('/hook.php',async(req,res)=>{const secret=setting('digiflazz_webhook_secret')||setting('okeconnect_password');if(secret&&req.get('X-Hub-Signature')&&req.get('X-Hub-Signature')!==secret)return res.status(401).json({error:'Invalid webhook secret'});const d=req.body||{};const ref=d.ref_id||d.data?.ref_id||'';if(ref){const t=store.first('transactions',x=>x.ref_id===ref);if(t){Object.assign(t,d.data||d,{updated_at:now()});store.upsert('transactions',x=>x.ref_id===ref,t);}}res.json({success:true});});
app.get('/script/detail.php', (req,res)=>{const t=store.first('transactions',x=>x.ref_id===req.query.ref_id);if(!t)return res.status(404).send('Transaksi tidak ditemukan');const p=store.first('products',x=>x.buyer_sku_code===t.buyer_sku_code)||{};res.send(`<!doctype html><html lang="id"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Detail ${t.ref_id}</title><style>body{font-family:Arial,sans-serif;background:#f5f7fb;margin:0;padding:20px}.card{max-width:520px;margin:auto;background:white;border-radius:18px;padding:22px;box-shadow:0 8px 30px #0001}h2{margin-top:0}.row{display:flex;justify-content:space-between;border-bottom:1px solid #eee;padding:10px 0}.status{font-weight:700}</style><div class="card"><h2>Detail Transaksi</h2><div class="row"><span>Ref ID</span><b>${esc(t.ref_id)}</b></div><div class="row"><span>Produk</span><b>${esc(p.product_name||t.buyer_sku_code)}</b></div><div class="row"><span>Tujuan</span><b>${esc(t.customer_no)}</b></div><div class="row"><span>Status</span><b class="status">${esc(t.status)}</b></div><div class="row"><span>SN/Keterangan</span><b>${esc(t.sn||t.message||'-')}</b></div><div class="row"><span>Total</span><b>Rp ${Number(t.selling_price||0).toLocaleString('id-ID')}</b></div></div></html>`);});
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

app.get('/health',(req,res)=>res.json({ok:true,node:process.version,storage:'json',time:now()}));
module.exports = app;
