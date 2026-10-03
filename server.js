require('dotenv').config();

const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mysql = require('mysql2/promise');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const isProd = process.env.NODE_ENV === 'production';

if (!process.env.MYSQL_HOST || !process.env.MYSQL_USER || !process.env.MYSQL_DATABASE) {
  console.error('MYSQL_HOST, MYSQL_USER e MYSQL_DATABASE precisam estar configurados.');
  process.exit(1);
}
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 20) {
  console.error('JWT_SECRET precisa ter pelo menos 20 caracteres.');
  process.exit(1);
}
if (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length < 10) {
  console.error('ADMIN_PASSWORD precisa ter pelo menos 10 caracteres.');
  process.exit(1);
}

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_DATABASE,
  waitForConnections: true,
  connectionLimit: 10,
  charset: 'utf8mb4',
  multipleStatements: true
});

app.use(express.json({ limit: '8mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

const q = async (text, params = []) => {
  const sql = text.replace(/\$\d+/g, '?');
  const [result] = await pool.query(sql, params);
  if (Array.isArray(result)) return { rows: result, rowCount: result.length };
  return { rows: [], rowCount: result.affectedRows || 0, insertId: result.insertId, affectedRows: result.affectedRows || 0 };
};

async function initDb() {
  await q(`
    CREATE TABLE IF NOT EXISTS admins (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(80) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS settings (
      key VARCHAR(80) PRIMARY KEY,
      value TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      slug VARCHAR(120) UNIQUE NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS products (
      id INT AUTO_INCREMENT PRIMARY KEY,
      category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
      name VARCHAR(180) NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      price NUMERIC(10,2) NOT NULL DEFAULT 0,
      image_url TEXT NOT NULL DEFAULT '',
      image_data TEXT NOT NULL DEFAULT '',
      available BOOLEAN NOT NULL DEFAULT TRUE,
      options JSON NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS extras (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      price NUMERIC(10,2) NOT NULL DEFAULT 0,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS delivery_areas (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      fee NUMERIC(10,2) NOT NULL DEFAULT 0,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INT AUTO_INCREMENT PRIMARY KEY,
      customer_name VARCHAR(160) NOT NULL,
      customer_phone VARCHAR(40) NOT NULL,
      service_type VARCHAR(20) NOT NULL,
      delivery_area_id INTEGER REFERENCES delivery_areas(id) ON DELETE SET NULL,
      address TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      payment_method VARCHAR(30) NOT NULL DEFAULT 'pix',
      subtotal NUMERIC(10,2) NOT NULL,
      delivery_fee NUMERIC(10,2) NOT NULL DEFAULT 0,
      total NUMERIC(10,2) NOT NULL,
      status VARCHAR(40) NOT NULL DEFAULT 'novo',
      items JSON NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  const admin = await q('SELECT id FROM admins WHERE username=$1', ['admin']);
  if (!admin.rowCount) {
    const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 12);
    await q('INSERT INTO admins (username, password_hash) VALUES ($1,$2)', ['admin', hash]);
  }

  const settingsSeed = [
    ['store_name', process.env.STORE_NAME || 'Moraes Delivery'],
    ['whatsapp', process.env.WHATSAPP_NUMBER || ''],
    ['store_phone', process.env.STORE_PHONE || ''],
    ['store_open', process.env.STORE_OPEN ?? 'true'],
    ['min_order', process.env.MIN_ORDER || '0'],
    ['delivery_time', process.env.DELIVERY_TIME || '40'],
    ['payment_methods', process.env.PAYMENT_METHODS || '[\"pix\",\"dinheiro\",\"debito\",\"credito\"]']
  ];
  for (const [key,value] of settingsSeed) {
    await q(`INSERT IGNORE INTO settings(`key`,value) VALUES($1,$2)`, [key,value]);
  }

  const cats = [
    ['Açaí', 'acai', 1],
    ['Bebidas', 'bebidas', 2],
    ['Cervejas', 'cervejas', 3],
    ['Copão & Whisky', 'copao', 4],
    ['Fumo', 'fumo', 5],
    ['Cigarros', 'cigarros', 6],
    ['Bomboniere', 'bomboniere', 7],
    ['Salgados de Forno', 'salgados', 8],
    ['Fandangos', 'fandangos', 9]
  ];

  for (const [name, slug, order] of cats) {
    await q(`
      INSERT INTO categories (name, slug, sort_order)
      VALUES ($1,$2,$3)
      ON DUPLICATE KEY UPDATE name=VALUES(name), sort_order=VALUES(sort_order)
    `, [name, slug, order]);
  }

  // Migração: doces passam para Bomboniere e a categoria Doces é removida.
  const bomboniereCat = await q("SELECT id FROM categories WHERE slug='bomboniere' LIMIT 1");
  const docesCat = await q("SELECT id FROM categories WHERE slug='doces' LIMIT 1");
  if (bomboniereCat.rowCount && docesCat.rowCount) {
    await q('UPDATE products SET category_id=$1 WHERE category_id=$2', [bomboniereCat.rows[0].id, docesCat.rows[0].id]);
    await q("DELETE FROM categories WHERE id=$1", [docesCat.rows[0].id]);
  }

  const areas = [
    ['Banquete', 3, 1],
    ['Bom Jardim', 15, 2],
    ['Conselheiro', 17, 3]
  ];
  for (const [name, fee, order] of areas) {
    const exists = await q('SELECT id FROM delivery_areas WHERE lower(name)=lower($1)', [name]);
    if (!exists.rowCount) await q('INSERT INTO delivery_areas (name,fee,sort_order) VALUES ($1,$2,$3)', [name, fee, order]);
  }

  const extraSeed = [
    ['Leite em pó', 2.50],
    ['Morango', 3.00],
    ['Banana', 2.00],
    ['Granola', 2.00],
    ['Paçoca', 1.50]
  ];
  for (const [name, price] of extraSeed) {
    const exists = await q('SELECT id FROM extras WHERE lower(name)=lower($1)', [name]);
    if (!exists.rowCount) await q('INSERT INTO extras (name,price) VALUES ($1,$2)', [name, price]);
  }

  const productCount = await q('SELECT COUNT(*) AS n FROM products');
  if (productCount.rows[0].n === 0) {
    const cat = async (slug) => (await q('SELECT id FROM categories WHERE slug=$1', [slug])).rows[0].id;
    const seed = [
      ['acai','Açaí Batidão 300ml','Garrafa 300ml',12,'',true,{type:'acai',size:'300ml'}],
      ['acai','Açaí Batidão 500ml','Garrafa 500ml',18,'',true,{type:'acai',size:'500ml'}],
      ['acai','Açaí Batidão 1 Litro','Garrafa 1 litro',35,'',true,{type:'acai',size:'1L'}],
      ['acai','Açaí Copo 400ml','Monte com caldas e adicionais.',0,'',false,{type:'acai',size:'400ml'}],
      ['acai','Açaí Copo 500ml','Monte com caldas e adicionais.',0,'',false,{type:'acai',size:'500ml'}],
      ['acai','Açaí Copo 700ml','Monte com caldas e adicionais.',0,'',false,{type:'acai',size:'700ml'}],
      ['acai','Sacolê Ninho com Nutella','Sacolê gourmet',4,'',true,{}],
      ['acai','Sacolê Chocolate com Nutella','Sacolê gourmet',4,'',true,{}],
      ['acai','Sacolê Maracujá com Nutella','Sacolê gourmet',4,'',true,{}],
      ['acai','Sacolê Morango com Nutella','Sacolê gourmet',4,'',true,{}],
      ['acai','Sacolê Paçoca com Chocolate','Sacolê gourmet',4,'',true,{}],
      ['acai','Sacolê Coco com Chocolate','Sacolê gourmet',4,'',true,{}],
      ['acai','Sacolê Oreo','Sacolê gourmet',4,'',true,{}],
      ['acai','Açaí com Granola e Chocolate Branco','Especial',6,'',true,{}],
      ['acai','Sacolê Pedacinho do Céu','Sacolê gourmet',4,'',true,{}],
      ['acai','Sacolê Milho Verde','Sacolê gourmet',4,'',true,{}],
      ['acai','Sacolê Abacaxi com Doce de Abacaxi','Sacolê gourmet',6,'',true,{}],
      ['acai','Sacolê Pudim','Sacolê gourmet',6,'',true,{}],
      ['bebidas','Antarctica Lata','Bebida gelada',8,'',true,{}],
      ['bebidas','Budweiser Lata','Bebida gelada',10,'',true,{}],
      ['bebidas','Heineken Lata','Bebida gelada',10,'',true,{}],
      ['bebidas','Red Bull','Energético',14,'',true,{}],
      ['bebidas','Guaravita','Bebida',2,'',true,{}],
      ['cervejas','Heineken','Cerveja',10,'',true,{}],
      ['cervejas','Brahma','Cerveja',0,'',false,{}],
      ['cervejas','Antarctica','Cerveja',8,'',true,{}],
      ['cervejas','Skol','Cerveja',0,'',false,{}],
      ['cervejas','Budweiser','Cerveja',10,'',true,{}],
      ['copao','Copão de Whisky','Copão',25,'',true,{}],
      ['copao','Baldão de Whisky','Baldão',50,'',true,{}],
      ['copao','Ballantine’s','Whisky',0,'',false,{}],
      ['copao','Red Label','Whisky',0,'',false,{}],
      ['copao','Black Label','Whisky',0,'',false,{}],
      ['fumo','Seda','Papel para enrolar',0,'',false,{}],
      ['cigarros','Minister','Cigarro',1.50,'',true,{}],
      ['cigarros','Derby','Cigarro',0,'',false,{}],
      ['cigarros','Carlton','Cigarro',0,'',false,{}],
      ['bomboniere','Trento Dark','Chocolate',4,'',true,{}],
      ['bomboniere','Trento Torta de Limão','Chocolate',4,'',true,{}],
      ['bomboniere','Trento Trufa de Chocolate','Chocolate',4,'',true,{}],
      ['bomboniere','Trento Avelã','Chocolate',4,'',true,{}],
      ['bomboniere','Trento Cheesecake de Morango','Chocolate',4,'',true,{}],
      ['bomboniere','Trento Chocolate','Chocolate',4,'',true,{}],
      ['bomboniere','Trento Milk','Chocolate',4,'',true,{}],
      ['bomboniere','Trento Branco Dark','Chocolate',4,'',true,{}],
      ['bomboniere','Trento Morango','Chocolate',4,'',true,{}],
      ['bomboniere','Trento Mousse de Maracujá','Chocolate',4,'',true,{}],
      ['salgados','Misto','Salgado de forno',7,'',true,{}],
      ['salgados','X-Tudo','Salgado de forno',7,'',true,{}],
      ['salgados','Croissant','Salgado de forno',8,'',true,{}],
      ['fandangos','Fandangos Cebola','Salgado',3,'',true,{}],
      ['fandangos','Fandangos Presunto','Salgado',3,'',true,{}],
      ['fandangos','Fandangos Requeijão','Salgado',3,'',true,{}],
      ['fandangos','Fandangos Queijo','Salgado',3,'',true,{}]
    ];
    for (const item of seed) {
      const [slug,name,desc,price,image,available,options] = item;
      await q(`INSERT INTO products
        (category_id,name,description,price,image_url,available,options)
        VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [await cat(slug), name, desc, price, image, available, JSON.stringify(options)]);
    }
  }

  const acai = await q(`SELECT id, options FROM products WHERE name LIKE 'Açaí %' OR name LIKE 'Açaí Batidão%'`);
  const syrups = ['Leite condensado','Chocolate','Morango','Uva','Banana','Menta'];
  for (const p of acai.rows) {
    const options = p.options || {};
    if (options.type === 'acai') {
      options.syrups = syrups;
      options.extraIds = (await q('SELECT id FROM extras WHERE active=true ORDER BY sort_order,id')).rows.map(r => r.id);
      await q('UPDATE products SET options=$1 WHERE id=$2', [JSON.stringify(options), p.id]);
    }
  }
}

function signAdmin(id) {
  return jwt.sign({ sub: String(id), role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '12h' });
}
function auth(req,res,next) {
  try {
    const token = req.cookies.admin_token;
    if (!token) return res.status(401).json({error:'Não autenticado'});
    req.admin = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({error:'Sessão expirada'});
  }
}

function normalizeWhatsApp(value) {
  let digits=String(value||'').replace(/\D/g,'');
  if (!digits) return '';
  if (!digits.startsWith('55') && (digits.length===10 || digits.length===11)) digits='55'+digits;
  return digits;
}
function cleanPaymentMethods(value) {
  const allowed=['pix','dinheiro','debito','credito'];
  const arr=Array.isArray(value)?value:[];
  return [...new Set(arr.filter(x=>allowed.includes(x)))];
}
const paymentLabels={pix:'PIX',dinheiro:'Dinheiro',debito:'Cartão de débito',credito:'Cartão de crédito'};

app.get('/api/config', async (req,res) => {
  const r=await q(`SELECT `key`,value FROM settings WHERE key IN ('store_name','whatsapp','store_phone','store_open','min_order','delivery_time','payment_methods')`);
  const cfg=Object.fromEntries(r.rows.map(x=>[x.key,x.value]));
  let paymentMethods=['pix','dinheiro','debito','credito'];
  try { paymentMethods=JSON.parse(cfg.payment_methods||'[]'); } catch {}
  const allowedPayments=['pix','dinheiro','debito','credito'];
  paymentMethods=Array.isArray(paymentMethods)?paymentMethods.filter(x=>allowedPayments.includes(x)):[];
  const whatsapp=normalizeWhatsApp(cfg.whatsapp||'');
  res.json({
    storeName:cfg.store_name||'Moraes Delivery',
    whatsapp,
    storePhone:cfg.store_phone||'',
    storeOpen:String(cfg.store_open||'true')==='true',
    minOrder:Math.max(0,Number(cfg.min_order||0)),
    deliveryTime:String(cfg.delivery_time||'40'),
    paymentMethods
  });
});

app.get('/api/catalog', async (req,res) => {
  const [cats, products, extras, areas] = await Promise.all([
    q('SELECT id,name,slug,sort_order FROM categories WHERE active=true ORDER BY sort_order,id'),
    q(`SELECT p.id,p.name,p.description,p.price,p.image_url,p.available,p.options,c.name category,c.slug category_slug
       FROM products p LEFT JOIN categories c ON c.id=p.category_id
       WHERE c.active=true ORDER BY c.sort_order,p.id`),
    q('SELECT id,name,price FROM extras WHERE active=true ORDER BY sort_order,id'),
    q('SELECT id,name,fee FROM delivery_areas WHERE active=true ORDER BY sort_order,id')
  ]);
  res.json({categories:cats.rows,products:products.rows,extras:extras.rows,areas:areas.rows});
});

app.post('/api/orders', async (req,res) => {
  const {customerName,customerPhone,serviceType,areaId,address,notes,items,paymentMethod} = req.body;
  if (!customerName || !customerPhone || !Array.isArray(items) || !items.length) return res.status(400).json({error:'Preencha cliente, telefone e produtos.'});
  if (!['delivery','pickup'].includes(serviceType)) return res.status(400).json({error:'Forma de recebimento inválida.'});
  if (serviceType === 'delivery' && (!areaId || !address)) return res.status(400).json({error:'Informe local e endereço para entrega.'});

  const settingRows=await q("SELECT `key`,value FROM settings WHERE key IN ('store_open','min_order','delivery_time','payment_methods')");
  const settings=Object.fromEntries(settingRows.rows.map(x=>[x.key,x.value]));
  if (String(settings.store_open||'true') !== 'true') return res.status(409).json({error:'A loja está fechada no momento. Tente novamente mais tarde.'});
  const minOrder=Math.max(0,Number(settings.min_order||0));
  let paymentMethods=['pix','dinheiro','debito','credito'];
  try { paymentMethods=cleanPaymentMethods(JSON.parse(settings.payment_methods||'[]')); } catch {}
  if (!paymentMethods.length) paymentMethods=['pix','dinheiro','debito','credito'];
  if (!paymentMethods.includes(paymentMethod)) return res.status(400).json({error:'Escolha uma forma de pagamento disponível.'});

  const ids = items.map(x => Number(x.productId)).filter(Boolean);
  const dbProducts = await q(`SELECT p.*, c.name category FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.id IN (${ids.map(()=>'?').join(',')})`, ids);
  const byId = new Map(dbProducts.rows.map(p => [p.id,p]));
  let subtotal = 0;
  const normalized = [];

  for (const item of items) {
    const p = byId.get(Number(item.productId));
    const qty = Math.max(1, Math.min(50, Number(item.quantity || 1)));
    if (!p || !p.available) return res.status(400).json({error:`Produto indisponível: ${item.name || 'produto'}`});
    let lineExtra = 0;
    const extras = Array.isArray(item.extras) ? item.extras : [];
    const extraIds = extras.map(e => Number(e.id)).filter(Boolean);
    if (extraIds.length) {
      const er = await q(`SELECT id,name,price FROM extras WHERE active=true AND id IN (${extraIds.map(()=>'?').join(',')})`, extraIds);
      for (const e of er.rows) {
        const found = extras.find(x => Number(x.id) === e.id);
        const eqty = Math.max(1, Math.min(20, Number(found.qty || 1)));
        lineExtra += Number(e.price) * eqty;
      }
    }
    const unit = Number(p.price) + lineExtra;
    subtotal += unit * qty;
    normalized.push({
      productId:p.id,name:p.name,quantity:qty,unitPrice:Number(p.price),
      extras: extras.map(e => ({id:Number(e.id),name:String(e.name),qty:Number(e.qty||1),price:Number(e.price||0)})),
      lineTotal: unit * qty
    });
  }

  if (subtotal < minOrder) return res.status(400).json({error:`O valor mínimo do pedido é ${Number(minOrder).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}.`});

  let deliveryFee = 0;
  let areaName='';
  if (serviceType === 'delivery') {
    const area = (await q('SELECT id,name,fee FROM delivery_areas WHERE id=$1 AND active=true',[Number(areaId)])).rows[0];
    if (!area) return res.status(400).json({error:'Área de entrega inválida.'});
    deliveryFee = Number(area.fee);
    areaName=area.name;
  }
  const total = subtotal + deliveryFee;

  const order = await q(`INSERT INTO orders
    (customer_name,customer_phone,service_type,delivery_area_id,address,notes,payment_method,subtotal,delivery_fee,total,status,items)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'novo',$11)
    RETURNING id,created_at`,
    [customerName.trim(),customerPhone.trim(),serviceType,serviceType==='delivery'?Number(areaId):null,address||'',notes||'',paymentMethod,subtotal,deliveryFee,total,JSON.stringify(normalized)]);

  res.status(201).json({orderId:order.rows[0].id,subtotal,deliveryFee,total,createdAt:order.rows[0].created_at,items:normalized,paymentMethod,paymentLabel:paymentLabels[paymentMethod],areaName,deliveryTime:String(settings.delivery_time||'40')});
});

app.post('/api/admin/login', async (req,res) => {
  const {password} = req.body;
  const admin = (await q('SELECT id,password_hash FROM admins WHERE username=$1',['admin'])).rows[0];
  if (!admin || !(await bcrypt.compare(String(password||''), admin.password_hash))) return res.status(401).json({error:'Senha inválida.'});
  res.cookie('admin_token', signAdmin(admin.id), {
    httpOnly:true, sameSite:'lax', secure:isProd, maxAge:12*60*60*1000
  });
  res.json({ok:true});
});

app.post('/api/admin/logout', auth, (req,res) => {
  res.clearCookie('admin_token');
  res.json({ok:true});
});

app.get('/api/admin/me', auth, (req,res)=>res.json({ok:true,username:'admin'}));

app.get('/api/admin/settings', auth, async (req,res)=>{
  const r=await q(`SELECT `key`,value FROM settings WHERE key IN ('store_name','whatsapp','store_phone','store_open','min_order','delivery_time','payment_methods')`);
  const cfg=Object.fromEntries(r.rows.map(x=>[x.key,x.value]));
  let paymentMethods=['pix','dinheiro','debito','credito'];
  try { paymentMethods=cleanPaymentMethods(JSON.parse(cfg.payment_methods||'[]')); } catch {}
  res.json({
    store_name:cfg.store_name||'Moraes Delivery',
    whatsapp:normalizeWhatsApp(cfg.whatsapp||''),
    store_phone:cfg.store_phone||'',
    store_open:String(cfg.store_open||'true')==='true',
    min_order:Math.max(0,Number(cfg.min_order||0)),
    delivery_time:String(cfg.delivery_time||'40'),
    payment_methods:paymentMethods
  });
});

app.post('/api/admin/settings', auth, async (req,res)=>{
  const storeName=String(req.body.store_name??'').trim() || 'Moraes Delivery';
  const whatsapp=normalizeWhatsApp(req.body.whatsapp||'');
  if (whatsapp && !/^55\d{10,11}$/.test(whatsapp)) return res.status(400).json({error:'WhatsApp inválido. Use DDD + número, por exemplo 22999999999.'});
  const minOrder=Math.max(0,Number(req.body.min_order??0));
  if(!Number.isFinite(minOrder)) return res.status(400).json({error:'Valor mínimo inválido.'});
  const deliveryTime=String(req.body.delivery_time??'40').trim() || '40';
  if(deliveryTime.length>60) return res.status(400).json({error:'Tempo estimado inválido.'});
  const paymentMethods=cleanPaymentMethods(req.body.payment_methods);
  if(!paymentMethods.length) return res.status(400).json({error:'Selecione pelo menos uma forma de pagamento.'});
  const values={
    store_name:storeName, whatsapp, store_phone:String(req.body.store_phone??'').trim(),
    store_open:String(req.body.store_open)==='true'?'true':'false',
    min_order:String(minOrder), delivery_time:deliveryTime, payment_methods:JSON.stringify(paymentMethods)
  };
  for(const [key,value] of Object.entries(values)) await q(`INSERT INTO settings(`key`,value) VALUES($1,$2) ON DUPLICATE KEY UPDATE value=VALUES(value)`,[key,value]);
  res.json({ok:true});
});

app.post('/api/admin/change-password', auth, async (req,res)=>{
  const {currentPassword,newPassword}=req.body;
  if(!newPassword || String(newPassword).length<10) return res.status(400).json({error:'A nova senha precisa ter pelo menos 10 caracteres.'});
  const admin=(await q('SELECT id,password_hash FROM admins WHERE id=$1',[Number(req.admin.sub)])).rows[0];
  if(!admin || !(await bcrypt.compare(String(currentPassword||''),admin.password_hash))) return res.status(401).json({error:'Senha atual incorreta.'});
  const hash=await bcrypt.hash(String(newPassword),12);
  await q('UPDATE admins SET password_hash=$1 WHERE id=$2',[hash,admin.id]);
  res.json({ok:true});
});

app.get('/api/admin/dashboard', auth, async (req,res) => {
  const [summary,monthly,statuses,recent] = await Promise.all([
    q(`SELECT COUNT(*) orders,
      COALESCE(SUM(total),0) revenue,
      COALESCE(SUM(delivery_fee),0) delivery_revenue
      FROM orders WHERE status <> 'cancelado'`),
    q(`SELECT DATE_FORMAT(created_at,'%Y-%m') AS `month`,
      COUNT(*) orders, COALESCE(SUM(total),0) revenue
      FROM orders WHERE status <> 'cancelado'
      GROUP BY 1 ORDER BY 1 DESC LIMIT 12`),
    q(`SELECT status,COUNT(*) count FROM orders GROUP BY status ORDER BY count DESC`),
    q(`SELECT o.id,o.customer_name,o.customer_phone,o.service_type,o.address,o.payment_method,o.subtotal,o.delivery_fee,o.total,o.status,o.created_at,
      da.name area,o.items
      FROM orders o LEFT JOIN delivery_areas da ON da.id=o.delivery_area_id
      ORDER BY o.created_at DESC LIMIT 50`)
  ]);
  res.json({summary:summary.rows[0],monthly:monthly.rows,statuses:statuses.rows,recent:recent.rows});
});

app.get('/api/product-image/:id', async (req,res) => {
  const r = await q('SELECT image_data FROM products WHERE id=$1', [Number(req.params.id)]);
  if (!r.rowCount || !r.rows[0].image_data) return res.status(404).end();
  const data = String(r.rows[0].image_data);
  const match = data.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) return res.status(404).end();
  const mime = match[1];
  const buffer = Buffer.from(match[2], 'base64');
  res.set('Content-Type', mime);
  res.set('Cache-Control', 'public, max-age=86400');
  res.send(buffer);
});

app.get('/api/admin/products', auth, async (req,res) => {
  const r=await q(`SELECT p.*,c.name category,c.slug category_slug FROM products p LEFT JOIN categories c ON c.id=p.category_id ORDER BY c.sort_order,p.id`);
  res.json(r.rows);
});

app.post('/api/admin/products', auth, async (req,res) => {
  const {id,categoryId,name,description,price,imageUrl,available,options}=req.body;
  if (!name || !categoryId) return res.status(400).json({error:'Nome e categoria são obrigatórios.'});
  const priceNum = Number(price||0);
  if (!Number.isFinite(priceNum) || priceNum < 0) return res.status(400).json({error:'Preço inválido.'});
  if (id) {
    await q(`UPDATE products SET category_id=$1,name=$2,description=$3,price=$4,image_url=$5,available=$6,options=$7,updated_at=NOW() WHERE id=$8`,
      [Number(categoryId),String(name).trim(),description||'',priceNum,imageUrl||'',Boolean(available),JSON.stringify(options||{}),Number(id)]);
    return res.json({ok:true,id:Number(id)});
  }
  const r=await q(`INSERT INTO products(category_id,name,description,price,image_url,available,options) VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [Number(categoryId),String(name).trim(),description||'',priceNum,imageUrl||'',Boolean(available),JSON.stringify(options||{})]);
  res.json({ok:true,id:r.insertId});
});

app.post('/api/admin/products/:id/image', auth, async (req,res) => {
  const {imageData}=req.body;
  if (!imageData || typeof imageData !== 'string') return res.status(400).json({error:'Imagem não enviada.'});
  if (!/^data:image\/(jpeg|jpg|png|webp);base64,/i.test(imageData)) return res.status(400).json({error:'Formato de imagem inválido. Use JPG, PNG ou WebP.'});
  if (Buffer.byteLength(imageData, 'utf8') > 7 * 1024 * 1024) return res.status(400).json({error:'Imagem muito grande. Escolha uma foto menor.'});
  const id=Number(req.params.id);
  const r=await q('SELECT id FROM products WHERE id=$1',[id]);
  if(!r.rowCount) return res.status(404).json({error:'Produto não encontrado.'});
  await q("UPDATE products SET image_data=$1,image_url=$2,updated_at=NOW() WHERE id=$3",[imageData,`/api/product-image/${id}`,id]);
  res.json({ok:true,imageUrl:`/api/product-image/${id}`});
});

app.delete('/api/admin/products/:id/image', auth, async (req,res) => {
  const id=Number(req.params.id);
  await q("UPDATE products SET image_data='',image_url='' ,updated_at=NOW() WHERE id=$1",[id]);
  res.json({ok:true});
});

app.patch('/api/admin/products/:id/availability', auth, async (req,res) => {
  await q('UPDATE products SET available=$1,updated_at=NOW() WHERE id=$2',[Boolean(req.body.available),Number(req.params.id)]);
  res.json({ok:true});
});

app.delete('/api/admin/products/:id', auth, async (req,res) => {
  await q('DELETE FROM products WHERE id=$1',[Number(req.params.id)]);
  res.json({ok:true});
});

app.get('/api/admin/categories', auth, async (req,res) => {
  const r=await q('SELECT * FROM categories ORDER BY sort_order,id'); res.json(r.rows);
});

app.post('/api/admin/categories', auth, async (req,res) => {
  const {id,name,slug,sortOrder,active}=req.body;
  if(!name||!slug) return res.status(400).json({error:'Nome e slug obrigatórios.'});
  try {
    if(id) await q('UPDATE categories SET name=$1,slug=$2,sort_order=$3,active=$4 WHERE id=$5',[name,slug,Number(sortOrder||0),Boolean(active),Number(id)]);
    else await q('INSERT INTO categories(name,slug,sort_order,active) VALUES($1,$2,$3,$4)',[name,slug,Number(sortOrder||0),Boolean(active)]);
    res.json({ok:true});
  } catch(e) { res.status(400).json({error:'Slug já existe ou dados inválidos.'}); }
});

app.get('/api/admin/extras', auth, async (req,res)=>res.json((await q('SELECT * FROM extras ORDER BY sort_order,id')).rows));
app.post('/api/admin/extras', auth, async (req,res)=>{
  const {id,name,price,active}=req.body;
  if(!name) return res.status(400).json({error:'Nome obrigatório.'});
  if(id) await q('UPDATE extras SET name=$1,price=$2,active=$3 WHERE id=$4',[name,Number(price||0),Boolean(active),Number(id)]);
  else await q('INSERT INTO extras(name,price,active) VALUES($1,$2,$3)',[name,Number(price||0),Boolean(active)]);
  res.json({ok:true});
});
app.delete('/api/admin/extras/:id', auth, async (req,res)=>{await q('DELETE FROM extras WHERE id=$1',[Number(req.params.id)]);res.json({ok:true});});

app.get('/api/admin/delivery', auth, async (req,res)=>res.json((await q('SELECT * FROM delivery_areas ORDER BY sort_order,id')).rows));
app.post('/api/admin/delivery', auth, async (req,res)=>{
  const {id,name,fee,active}=req.body;
  if(!name) return res.status(400).json({error:'Nome obrigatório.'});
  if(id) await q('UPDATE delivery_areas SET name=$1,fee=$2,active=$3 WHERE id=$4',[name,Number(fee||0),Boolean(active),Number(id)]);
  else await q('INSERT INTO delivery_areas(name,fee,active) VALUES($1,$2,$3)',[name,Number(fee||0),Boolean(active)]);
  res.json({ok:true});
});
app.delete('/api/admin/delivery/:id', auth, async (req,res)=>{await q('DELETE FROM delivery_areas WHERE id=$1',[Number(req.params.id)]);res.json({ok:true});});

app.patch('/api/admin/orders/:id/status', auth, async (req,res)=>{
  const allowed=['novo','confirmado','em_preparo','saiu_entrega','pronto_retirada','entregue','retirado','cancelado'];
  if(!allowed.includes(req.body.status)) return res.status(400).json({error:'Status inválido.'});
  await q('UPDATE orders SET status=$1,updated_at=NOW() WHERE id=$2',[req.body.status,Number(req.params.id)]);
  res.json({ok:true});
});

app.delete('/api/admin/orders/:id', auth, async (req,res)=>{
  const id=Number(req.params.id);
  if(!Number.isInteger(id) || id<=0) return res.status(400).json({error:'Pedido inválido.'});
  const r=await q('DELETE FROM orders WHERE id=$1',[id]);
  if(!r.affectedRows) return res.status(404).json({error:'Pedido não encontrado.'});
  res.json({ok:true});
});

app.get('/api/admin/orders/:id', auth, async (req,res)=>{
  const r=await q(`SELECT o.*,da.name area FROM orders o LEFT JOIN delivery_areas da ON da.id=o.delivery_area_id WHERE o.id=$1`,[Number(req.params.id)]);
  if(!r.rowCount) return res.status(404).json({error:'Pedido não encontrado'});
  res.json(r.rows[0]);
});

// Página administrativa: /admin e /admin/
app.get(['/admin','/admin/'], (req,res) => {
  res.sendFile(path.join(__dirname,'public','admin.html'));
});

// Fallback apenas para páginas públicas
app.get('*', (req,res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({error:'Rota não encontrada'});
  res.sendFile(path.join(__dirname,'public','index.html'));
});

initDb()
  .then(()=>app.listen(PORT,()=>console.log(`Moraes Delivery rodando na porta ${PORT}`)))
  .catch(err=>{console.error('Falha ao iniciar:',err);process.exit(1);});
