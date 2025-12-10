const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const http = require('http' );
const socketIo = require('socket.io');
const multer = require('multer');
const session = require('express-session');
const crypto = require('crypto');
const app = express();
const server = http.createServer(app );
const io = socketIo(server);
const port = process.env.PORT ? Number(process.env.PORT) : 3001;
const flags = require('./src/config/featureFlags')
const ride = require('./src/services/ride')
const models = require('./src/models')

// Configuração do Multer para Upload de Fotos
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = path.join(__dirname, 'public', 'uploads');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: function (req, file, cb) {
        const filetypes = /jpeg|jpg|png|gif/;
        const mimetype = filetypes.test(file.mimetype);
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
        
        if (mimetype && extname) {
            return cb(null, true);
        }
        cb(new Error('Apenas imagens são permitidas (jpeg, jpg, png, gif)'));
    }
});

// Configuração do Banco de Dados SQLite
const dbPath = path.join(__dirname, 'onibus.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Erro ao abrir o banco de dados:', err.message);
    } else {
        console.log('Conectado ao banco de dados SQLite.');
        
        // 1. Tabela de Usuários (Users)
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE,
            password TEXT,
            role TEXT,
            saldo REAL DEFAULT 0.00,
            banned INTEGER DEFAULT 0,
            foto TEXT DEFAULT NULL,
            nome TEXT,
            sobrenome TEXT,
            cpf TEXT UNIQUE
        )`, (err) => {
            if (err) {
                console.error('Erro ao criar tabela users:', err.message);
            } else {
                db.run(`ALTER TABLE users ADD COLUMN nome TEXT`, (e)=>{ if (e && !/duplicate column name/i.test(e.message)) console.error('Erro migrando coluna nome:', e.message) })
                db.run(`ALTER TABLE users ADD COLUMN sobrenome TEXT`, (e)=>{ if (e && !/duplicate column name/i.test(e.message)) console.error('Erro migrando coluna sobrenome:', e.message) })
                db.run(`ALTER TABLE users ADD COLUMN cpf TEXT`, (e)=>{ if (e && !/duplicate column name/i.test(e.message)) console.error('Erro migrando coluna cpf:', e.message) })
                db.get(`SELECT * FROM users WHERE email = 'admin@bus.com'`, (err, row) => {
                    if (!row) {
                        db.run(`INSERT INTO users (email, password, role) VALUES (?, ?, ?)`, 
                            ['admin@bus.com', 'admin', 'admin'], 
                            (err) => {
                                if (err) {
                                    console.error('Erro ao inserir admin padrão:', err.message);
                                } else {
                                    console.log('Usuário admin padrão criado: admin@bus.com / admin');
                                }
                            }
                        );
                    }
                });
            }
        });

        // 2. Tabela de Linhas
        db.run(`CREATE TABLE IF NOT EXISTS linhas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT NOT NULL,
            origem TEXT NOT NULL,
            destino TEXT NOT NULL
        )`, (err) => {
            if (err) console.error('Erro ao criar tabela linhas:', err.message);
        });

        // 3. Tabela de Ônibus
        db.run(`CREATE TABLE IF NOT EXISTS onibus (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            placa TEXT UNIQUE NOT NULL,
            modelo TEXT,
            capacidade INTEGER
        )`, (err) => {
            if (err) console.error('Erro ao criar tabela onibus:', err.message);
        });

        db.run(`CREATE TABLE IF NOT EXISTS onibus_linhas (
            onibus_id INTEGER NOT NULL,
            linha_id INTEGER NOT NULL,
            UNIQUE(onibus_id)
        )`, (err) => {
            if (err) console.error('Erro ao criar tabela onibus_linhas:', err.message);
        });

        db.run(`CREATE TABLE IF NOT EXISTS horarios_linha (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            linha_id INTEGER NOT NULL,
            hora TEXT NOT NULL
        )`, (err) => {
            if (err) console.error('Erro ao criar tabela horarios_linha:', err.message);
        });

        db.run(`CREATE TABLE IF NOT EXISTS automation_config (
            id INTEGER PRIMARY KEY CHECK (id=1),
            tick_ms INTEGER DEFAULT 1000,
            step_points INTEGER DEFAULT 1,
            auto_dispatch INTEGER DEFAULT 1
        )`, (err) => {
            if (err) console.error('Erro ao criar tabela automation_config:', err.message);
            db.get(`SELECT * FROM automation_config WHERE id=1`, (e,row)=>{
                if(!row){ db.run(`INSERT INTO automation_config(id,tick_ms,step_points,auto_dispatch) VALUES(1,1000,1,1)`) }
            })
        });

        db.run(`CREATE TABLE IF NOT EXISTS panic_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            bus_id INTEGER NOT NULL,
            motorista_id INTEGER,
            level TEXT DEFAULT 'panic',
            message TEXT,
            ts TEXT NOT NULL,
            resolved INTEGER DEFAULT 0
        )`, (err) => {
            if (err) console.error('Erro ao criar tabela panic_events:', err.message);
        });

        // 4. Tabela de Motoristas
        db.run(`CREATE TABLE IF NOT EXISTS motoristas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT NOT NULL,
            cpf TEXT UNIQUE NOT NULL,
            telefone TEXT,
            foto TEXT DEFAULT NULL,
            password TEXT
        )`, (err) => {
            if (err) console.error('Erro ao criar tabela motoristas:', err.message);
            db.run(`ALTER TABLE motoristas ADD COLUMN password TEXT`, (e)=>{
                if (e && !/duplicate column name/i.test(e.message)) console.error('Erro ao migrar coluna password:', e.message)
            })
        });
        // 5. Sessões de Motoristas
        db.run(`CREATE TABLE IF NOT EXISTS driver_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            motorista_id INTEGER NOT NULL,
            onibus_id INTEGER NOT NULL,
            linha_id INTEGER NOT NULL,
            ts_start TEXT NOT NULL,
            active INTEGER DEFAULT 1,
            ts_end TEXT
        )`, (err) => {
            if (err) console.error('Erro ao criar tabela driver_sessions:', err.message);
            db.run(`ALTER TABLE driver_sessions ADD COLUMN ts_end TEXT`, (e)=>{
                if (e && !/duplicate column name/i.test(e.message)) console.error('Erro ao migrar coluna ts_end:', e.message)
            })
        });
        // 6. Pontos de Rastreamento (opcional)
        db.run(`CREATE TABLE IF NOT EXISTS tracking_points (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            motorista_id INTEGER,
            onibus_id INTEGER NOT NULL,
            linha_id INTEGER,
            ts TEXT NOT NULL,
            lat REAL NOT NULL,
            lng REAL NOT NULL,
            speed_kmh REAL,
            accuracy_m REAL
        )`, (err)=>{ if (err) console.error('Erro ao criar tabela tracking_points:', err.message) })

        // 7. Pontos de rota reais
        db.run(`CREATE TABLE IF NOT EXISTS route_points (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            linha_id INTEGER NOT NULL,
            seq INTEGER NOT NULL,
            lat REAL NOT NULL,
            lng REAL NOT NULL
        )`, (err)=>{ if (err) console.error('Erro ao criar tabela route_points:', err.message) })
    }
});

// Configuração do Express
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/public', express.static(path.join(__dirname, 'public')));

// Configuração de Sessões
app.use(session({
    secret: 'rastreamento-onibus-palhoca-2024',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: false, // true apenas em HTTPS
        maxAge: 24 * 60 * 60 * 1000 // 24 horas
    }
}));
// Configuração do Socket.IO
io.on('connection', (socket) => {
    console.log('Passageiro conectado:', socket.id);
    socket.on('disconnect', () => {
        console.log('Passageiro desconectado:', socket.id);
    });
});

function hashPassword(p){
    const salt = crypto.randomBytes(16).toString('hex')
    const h = crypto.createHash('sha256').update(salt+p).digest('hex')
    return salt+':'+h
}
function verifyPassword(p, stored){
    const parts = String(stored||'').split(':')
    if (parts.length!==2) return false
    const h = crypto.createHash('sha256').update(parts[0]+p).digest('hex')
    return h===parts[1]
}

const rotas = {
    1: [
        {lat:-27.595, lng:-48.548}, {lat:-27.620, lng:-48.600}, {lat:-27.650, lng:-48.650},
        {lat:-27.660, lng:-48.660}, {lat:-27.670, lng:-48.670}, {lat:-27.680, lng:-48.670},
        {lat:-27.690, lng:-48.660}, {lat:-27.640, lng:-48.665}, {lat:-27.613, lng:-48.655}
    ],
    2: [
        {lat:-27.613, lng:-48.655}, {lat:-27.640, lng:-48.665}, {lat:-27.690, lng:-48.660},
        {lat:-27.680, lng:-48.670}, {lat:-27.670, lng:-48.670}, {lat:-27.660, lng:-48.660},
        {lat:-27.650, lng:-48.650}, {lat:-27.620, lng:-48.600}, {lat:-27.595, lng:-48.548}
    ]
}
const busStates = new Map()
const waypointMap = {
    'florianopolis': {lat:-27.595, lng:-48.548},
    'florianópolis': {lat:-27.595, lng:-48.548},
    'centro florianópolis': {lat:-27.595, lng:-48.548},
    'fpolis': {lat:-27.595, lng:-48.548},
    'centro florianopolis': {lat:-27.595, lng:-48.548},
    'palhoca': {lat:-27.613, lng:-48.655},
    'palhoça': {lat:-27.613, lng:-48.655},
    'centro ph': {lat:-27.613, lng:-48.655},
    'ponte do imaruim': {lat:-27.645, lng:-48.657},
    'rio grande': {lat:-27.607, lng:-48.660},
    'pachecos': {lat:-27.580, lng:-48.650},
    'bela vista': {lat:-27.625, lng:-48.669},
    'portal': {lat:-27.630, lng:-48.660},
    'hospital regional': {lat:-27.613, lng:-48.635},
    'via expressa': {lat:-27.620, lng:-48.580},
    'br 101': {lat:-27.640, lng:-48.650},
    'fazenda': {lat:-27.600, lng:-48.630},
    'aquarius': {lat:-27.620, lng:-48.640},
    'eldorado': {lat:-27.620, lng:-48.650},
    'shopping continente': {lat:-27.620, lng:-48.620},
    'alto aririu': {lat:-27.622, lng:-48.658},
    'aririu': {lat:-27.628, lng:-48.657},
    'aririu formiga': {lat:-27.635, lng:-48.660},
    'barra': {lat:-27.591, lng:-48.635},
    'barreiros': {lat:-27.589, lng:-48.624},
    'sao jose': {lat:-27.613, lng:-48.627},
    'são josé': {lat:-27.613, lng:-48.627},
    'saojose': {lat:-27.613, lng:-48.627},
    'sãojose': {lat:-27.613, lng:-48.627},
    'centro sao jose': {lat:-27.613, lng:-48.627},
    'centro são josé': {lat:-27.613, lng:-48.627},
    'aniceto zacchi': {lat:-27.620, lng:-48.653},
    'claudete': {lat:-27.604, lng:-48.656},
    'ivo silveira': {lat:-27.595, lng:-48.570},
    'enseada': {lat:-27.687, lng:-48.658},
    'marivone': {lat:-27.700, lng:-48.669},
    'pontal': {lat:-27.705, lng:-48.673},
    'praia de fora': {lat:-27.722, lng:-48.672},
    'area industrial': {lat:-27.610, lng:-48.640},
    'fazenda santo antonio': {lat:-27.609, lng:-48.633},
    'entrada do eldorado': {lat:-27.618, lng:-48.648},
    'vila nova': {lat:-27.619, lng:-48.659}
}
function normalizeToken(s){
    return String(s||'').toLowerCase().replace(/[^a-z0-9áéíóúãõç ]/g,'').trim()
}
function buildRouteFromLine(nome, origem, destino){
    const via = []
    const idx = String(nome||'').toLowerCase().indexOf('via')
    if (idx>=0){
        const seg = nome.slice(idx+3)
        seg.split('/').forEach(t=>{ const k=normalizeToken(t); if(waypointMap[k]) via.push(waypointMap[k]) })
    }
    const oKey = normalizeToken(origem)
    const dKey = normalizeToken(destino)
    const oPt = waypointMap[oKey] || waypointMap['palhoca']
    const dPt = waypointMap[dKey] || waypointMap['florianopolis']
    const points = [oPt, ...via, dPt]
    return points
}
const routesCache = new Map()
const lineNames = new Map()
const busPlateMap = new Map()
function loadLineNames(){
    db.all(`SELECT id,nome FROM linhas`, [], (err, rows)=>{
        if (!err && rows) { rows.forEach(r=> lineNames.set(Number(r.id), r.nome)) }
    })
}
function loadBusPlates(){
    db.all(`SELECT id,placa FROM onibus`, [], (err, rows)=>{
        if (!err && rows) { rows.forEach(r=> busPlateMap.set(Number(r.id), r.placa)) }
    })
}
function loadRouteFromDB(lineId, cb){
    db.all(`SELECT lat,lng FROM route_points WHERE linha_id=? ORDER BY seq ASC`, [lineId], (e, rows)=>{
        if (!e && rows && rows.length>0){
            const pts = rows.map(r=> ({ lat:r.lat, lng:r.lng }))
            routesCache.set(Number(lineId), pts)
        }
        if (cb) cb()
    })
}
let tickerInterval = null
let automationCache = { tick_ms: 1000, step_points: 1, auto_dispatch: 1 }
const busLastPos = new Map()
function loadAutomationConfig(cb){
    db.get(`SELECT tick_ms, step_points, auto_dispatch FROM automation_config WHERE id=1`, (e,row)=>{
        if(row){ automationCache = { tick_ms: row.tick_ms||1000, step_points: row.step_points||1, auto_dispatch: row.auto_dispatch||1 } }
        cb && cb(automationCache)
    })
}

function seedIfEmpty() {
    db.get(`SELECT COUNT(1) c FROM linhas`, [], (e, r) => {
        if (!e && r && r.c === 0) {
            db.run(`INSERT INTO linhas (nome, origem, destino) VALUES (?,?,?)`, ['Florianópolis → Palhoça','Centro Florianópolis','Centro Palhoça'])
            db.run(`INSERT INTO linhas (nome, origem, destino) VALUES (?,?,?)`, ['Palhoça → Florianópolis','Centro Palhoça','Centro Florianópolis'])
        }
    })
    db.get(`SELECT COUNT(1) c FROM onibus`, [], (e, r) => {
        if (!e && r && r.c === 0) {
            db.run(`INSERT INTO onibus (placa, modelo, capacidade) VALUES (?,?,?)`, ['SIM-101','Simulado Urbano',80])
            db.run(`INSERT INTO onibus (placa, modelo, capacidade) VALUES (?,?,?)`, ['SIM-102','Simulado Urbano',80])
            db.run(`INSERT INTO onibus (placa, modelo, capacidade) VALUES (?,?,?)`, ['SIM-201','Simulado Urbano',80])
            db.run(`INSERT INTO onibus (placa, modelo, capacidade) VALUES (?,?,?)`, ['SIM-202','Simulado Urbano',80])
        }
    })
    db.get(`SELECT COUNT(1) c FROM onibus_linhas`, [], (e, r) => {
        if (!e && r && r.c === 0) {
            db.all(`SELECT id FROM linhas ORDER BY id ASC`, [], (err, ls) => {
                db.all(`SELECT id FROM onibus ORDER BY id ASC`, [], (err2, bs) => {
                    const l1 = ls?.[0]?.id || 1, l2 = ls?.[1]?.id || 2
                    if (bs?.[0]) db.run(`INSERT OR IGNORE INTO onibus_linhas (onibus_id, linha_id) VALUES (?,?)`, [bs[0].id, l1])
                    if (bs?.[1]) db.run(`INSERT OR IGNORE INTO onibus_linhas (onibus_id, linha_id) VALUES (?,?)`, [bs[1].id, l1])
                    if (bs?.[2]) db.run(`INSERT OR IGNORE INTO onibus_linhas (onibus_id, linha_id) VALUES (?,?)`, [bs[2].id, l2])
                    if (bs?.[3]) db.run(`INSERT OR IGNORE INTO onibus_linhas (onibus_id, linha_id) VALUES (?,?)`, [bs[3].id, l2])
                })
            })
        }
    })
}

function startTicker() {
    seedIfEmpty()
    loadLineNames()
    loadBusPlates()
    db.all(`SELECT onibus.id AS id, ol.linha_id AS linha_id FROM onibus LEFT JOIN onibus_linhas ol ON ol.onibus_id = onibus.id`, [], (err, rows) => {
        rows?.forEach(r => {
            if (!busStates.has(r.id)) busStates.set(r.id, { idx: Math.floor(Math.random()*5), linha_id: r.linha_id||1 })
        })
    })
    if (tickerInterval) clearInterval(tickerInterval)
    loadAutomationConfig(cfg=>{
        tickerInterval = setInterval(() => {
            busStates.forEach((state, busId) => {
                const rota = routesCache.get(state.linha_id) || rotas[state.linha_id] || rotas[1]
                state.idx = (state.idx + (cfg.step_points||1)) % rota.length
                const p = rota[state.idx]
                busLastPos.set(busId, { lat: p.lat, lng: p.lng, linha_id: state.linha_id, ts: Date.now() })
                models.updateBusPosition(String(busId), p.lat, p.lng, 0, 0)
                io.emit('bus_location_update', { onibus_id: busId, latitude: p.lat, longitude: p.lng, timestamp: new Date().toISOString() })
                if (flags.get('ENABLE_AUTOPILOT')) {
                    const accepted = models.rideRequests.filter(r=> r.busId===String(busId) && r.status==='accepted')
                    accepted.forEach(r=>{
                        const stop = models.stops.find(s=> s.id===r.stopId) || models.stops[0]
                        const dLat = stop.lat - p.lat
                        const dLng = stop.lng - p.lng
                        const dist = Math.sqrt(dLat*dLat + dLng*dLng) * 111000
                        if (!r.qr && dist <= 200) {
                            const qr = ride.generateQr(r.id)
                            if (qr) io.emit('boarding:start', { rideId: r.id, busId: r.busId, qrId: qr.id, expiresAt: qr.expires })
                        }
                        if (r.qr && flags.get('ENABLE_AUTOBOARDING') && dist <= 10) {
                            const ok = ride.validateQr({ rideId: r.id, hash: r.qr.hash })
                            if (ok) io.emit('boarding:complete', { rideId: r.id, busId: r.busId })
                        }
                    })
                }
            })
        }, cfg.tick_ms||1000)
    })
}

startTicker()

// Rota de Simulação GPS

// Rota de Login (GET)
app.get('/', (req, res) => {
    if (req.session.loggedInUser) {
        if (req.session.loggedInUser.role === 'admin') {
            return res.redirect('/admin/dashboard');
        } else if (req.session.loggedInUser.role === 'passenger') {
            return res.redirect('/passageiro/dashboard');
        }
    }
    res.set('Cache-Control','no-store');
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});


// Rota de Login (POST)
app.post('/login', (req, res) => {
    const { email, password } = req.body;

    db.get(`SELECT * FROM users WHERE email = ? AND password = ?`, [email, password], (err, user) => {
        if (err) {
            return res.status(500).send('Erro interno do servidor.');
        }

        if (user) {
            if (user.banned === 1) {
                return res.send(`
                    <script>
                        alert('Acesso negado. Sua conta foi banida do sistema.');
                        window.location.href = '/';
                    </script>
                `);
            }
            
            // Armazena o usuário na sessão
            req.session.loggedInUser = user;
            
            if (user.role === 'admin') {
                return res.redirect('/admin/dashboard');
            } else if (user.role === 'passenger') {
                return res.redirect('/passageiro/dashboard');
            }
        } else {
            res.sendFile(path.join(__dirname, 'public', 'login.html'));
        }
    });
});


// Rota de Registro (GET)
app.get('/register', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="pt-BR">
        <head>
            <meta charset="UTF-8">
            <title>Registro - Rastreamento de Ônibus</title>
            <style>
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
                .container { background: white; padding: 40px; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.2); width: 100%; max-width: 450px; }
                h2 { color: #5B2C91; margin-bottom: 10px; font-size: 28px; text-align: center; }
                p { color: #666; margin-bottom: 25px; text-align: center; font-size: 14px; }
                label { display: block; color: #333; font-weight: 600; margin-bottom: 8px; margin-top: 15px; }
                input[type="email"], input[type="password"], input[type="file"] { width: 100%; padding: 12px; border: 2px solid #e0e0e0; border-radius: 8px; font-size: 14px; transition: border 0.3s; }
                input:focus { outline: none; border-color: #5B2C91; }
                button { width: 100%; padding: 14px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border: none; border-radius: 8px; font-size: 16px; font-weight: 600; cursor: pointer; margin-top: 25px; transition: transform 0.2s; }
                button:hover { transform: translateY(-2px); }
                .back-link { text-align: center; margin-top: 20px; }
                .back-link a { color: #5B2C91; text-decoration: none; font-weight: 600; }
                .back-link a:hover { text-decoration: underline; }
            </style>
        </head>
        <body>
            <div class="container">
                <h2>📝 Criar Conta</h2>
                <p>Registre-se para acessar o sistema de rastreamento</p>
                <form action="/register" method="POST" enctype="multipart/form-data">
                    <label for="nome">Nome</label>
                    <input type="text" id="nome" name="nome" required>

                    <label for="sobrenome">Sobrenome</label>
                    <input type="text" id="sobrenome" name="sobrenome" required>

                    <label for="cpf">CPF</label>
                    <input type="text" id="cpf" name="cpf" placeholder="Somente números" required>

                    <label for="email">Email</label>
                    <input type="email" id="email" name="email" required>

                    <label for="password">Senha</label>
                    <input type="password" id="password" name="password" required>

                    <label for="foto">Foto de Perfil (opcional)</label>
                    <input type="file" id="foto" name="foto" accept="image/*">

                    <button type="submit">Registrar</button>
                </form>
                <div class="back-link">
                    <a href="/">← Voltar ao Login</a>
                </div>
            </div>
        </body>
        </html>
    `);
});

// Rota de Registro (POST)
app.post('/register', upload.single('foto'), (req, res) => {
    const { nome, sobrenome, cpf, email, password } = req.body;
    const role = 'passenger';
    const fotoPath = req.file ? `/uploads/${req.file.filename}` : null;

    if (!nome || !sobrenome || !cpf || !email || !password) {
        return res.send(`<script>alert('Preencha Nome, Sobrenome, CPF, Email e Senha.'); window.location.href='/register';</script>`)
    }
    db.run(`INSERT INTO users (nome, sobrenome, cpf, email, password, role, foto) VALUES (?, ?, ?, ?, ?, ?, ?)`, [nome, sobrenome, cpf, email, password, role, fotoPath], function(err) {
        if (err) {
            return res.send(`
                <script>
                    alert('Erro ao registrar: verifique se CPF ou Email já estão em uso.');
                    window.location.href = '/register';
                </script>
            `);
        }
        res.send(`
            <script>
                alert('Registro realizado com sucesso! Faça login agora.');
                window.location.href = '/';
            </script>
        `);
    });
});

// Rota de Logout
app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Erro ao destruir sessão:', err);
        }
        res.redirect('/');
    });
});


// Middlewares
function isAdmin(req, res, next) {
    if (req.session.loggedInUser && req.session.loggedInUser.role === 'admin') {
        next();
    } else {
        res.status(403).send('Acesso negado. Você não é um administrador.');
    }
}

function isPassenger(req, res, next) {
    if (req.session.loggedInUser && req.session.loggedInUser.role === 'passenger') {
        next();
    } else {
        res.redirect('/');
    }
}

function isDriver(req, res, next) {
    if (req.session.loggedInUser && req.session.loggedInUser.role === 'driver') {
        next();
    } else {
        res.redirect('/motorista/login');
    }
}

// =================================================================
// ROTAS DO ADMINISTRADOR
// =================================================================

const adminStyles = `
<style>
body{font-family:system-ui;background:#f5f7fb;margin:0}
.sidebar{position:fixed;top:0;left:0;height:100vh;width:260px;background:#111827;color:#fff;padding:20px}
.sidebar a{display:block;color:#fff;text-decoration:none;padding:10px 12px;border-radius:8px;margin-bottom:6px}
.sidebar a:hover{background:rgba(255,255,255,0.12)}
.sidebar .logout{margin-top:16px;display:block;background:rgba(255,255,255,0.14)}
.content{margin-left:280px;padding:20px}
.action-link{color:#2563eb;text-decoration:none}
.action-link:hover{text-decoration:underline}
.form-container{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin-bottom:16px}
label{font-weight:600;display:block;margin:10px 0 6px}
input,select,textarea{width:100%;padding:10px;border:1px solid #e5e7eb;border-radius:8px}
button{padding:10px 14px;border:none;border-radius:10px;background:#2563eb;color:#fff;font-weight:600;cursor:pointer}
table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden}
th,td{padding:12px 14px;border-bottom:1px solid #e5e7eb;text-align:left}
th{background:#f3f4f6;font-weight:600}
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:16px 0}
.stat-card{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:16px;text-align:center}
</style>
`;

app.get('/admin/dashboard', isAdmin, (req, res) => {
    db.all("SELECT * FROM linhas", [], (err, linhas) => {
        db.all("SELECT * FROM onibus", [], (err, onibus) => {
            db.all("SELECT * FROM motoristas", [], (err, motoristas) => {
                res.send(`
                    <!DOCTYPE html>
                    <html lang="pt-BR">
                    <head>
                        <meta charset="UTF-8">
                        <title>Dashboard Admin</title>
                        ${adminStyles}
                    </head>
                    <body>
                        <div class="sidebar">
                            <h3><span style="display:flex;align-items:center;gap:8px"><svg width="22" height="22" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="8" y="18" width="48" height="24" rx="8" fill="#3b82f6"/><rect x="12" y="22" width="40" height="12" rx="6" fill="#93c5fd"/><circle cx="20" cy="46" r="5" fill="#0ea5e9"/><circle cx="44" cy="46" r="5" fill="#0ea5e9"/><rect x="50" y="26" width="6" height="8" rx="2" fill="#60a5fa"/></svg> PAINEL DO ADMINISTRADOR • TRUCK HUB BUS</span></h3>
                            <a href="/admin/dashboard">📊 Dashboard</a>
                            <a href="/admin/linhas">🛣️ Gerenciar Linhas</a>
                            <a href="/admin/onibus">🚌 Gerenciar Ônibus</a>
                            <a href="/admin/motoristas">👨‍✈️ Gerenciar Motoristas</a>
                            <a href="/admin/passageiros">👥 Gerenciar Passageiros</a>
                            <a href="/admin/relatorios/motoristas">📄 Relatório de Motoristas</a>
                            
                            <a href="/logout" class="logout">🚪 Sair</a>
                        </div>
                        <div class="content">
                            <h1>Dashboard do Administrador</h1>
                            <p class="subtitle">Bem-vindo, ${req.session.loggedInUser.email}</p>
                            
                            <div class="stats">
                                <div class="stat-card">
                                    <h3>${linhas.length}</h3>
                                    <p>Linhas Cadastradas</p>
                                </div>
                                <div class="stat-card">
                                    <h3>${onibus.length}</h3>
                                    <p>Ônibus na Frota</p>
                                </div>
                                <div class="stat-card">
                                    <h3>${motoristas.length}</h3>
                                    <p>Motoristas Ativos</p>
                                </div>
                            </div>
                            
                <div class="form-container">
                    <h2>🎯 Ações</h2>
                    <p style="color:#666">Escolha abaixo a área desejada</p>
                    <div style="display:grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap:12px; margin-top:12px">
                        <a href="/admin/linhas" class="action-link">🛣️ Gerenciar Linhas</a>
                        <a href="/admin/onibus" class="action-link">🚌 Gerenciar Ônibus</a>
                        <a href="/admin/motoristas" class="action-link">👨‍✈️ Gerenciar Motoristas</a>
                        <a href="/admin/passageiros" class="action-link">👥 Gerenciar Passageiros</a>
                        <a href="/admin/monitor" class="action-link">🗺️ Monitoramento em Tempo Real</a>
                        <a href="/admin/relatorios/motoristas" class="action-link">📄 Relatório de Motoristas</a>
                        <a href="/admin/horarios" class="action-link">⏱️ Horários</a>
                        <a href="/admin/automacao" class="action-link">⚙️ Automação</a>
                        
                    </div>
                    <form action="/admin/seed/populate" method="POST" style="margin-top:14px">
                        <input type="hidden" name="buses" value="50" />
                        <input type="hidden" name="drivers" value="70" />
                        <button type="submit">🌱 Popular dados (50 ônibus, 70 motoristas)</button>
                    </form>
                        <form action="/admin/seed/passengers" method="POST" style="margin-top:10px">
                            <input type="hidden" name="count" value="40" />
                            <button type="submit">🌱 Criar passageiros genéricos (40)</button>
                        </form>
                        <form action="/admin/reset/minimal" method="POST" style="margin-top:10px" onsubmit="return confirm('Tem certeza que deseja ZERAR o banco? Isso apagará ônibus, motoristas, linhas, rotas e registros, mantendo apenas o admin e criando um passageiro padrão.')">
                            <button type="submit" style="background:#ef4444">🧨 Zerar banco (mínimo: admin + passageiro)</button>
                        </form>
                    </div>
                </div>
            </body>
            </html>
        `);
            });
        });
    });
});


app.get('/admin/linhas', isAdmin, (req, res) => {
    db.all("SELECT * FROM linhas", [], (err, rows) => {
        if (err) {
            return res.status(500).send('Erro ao buscar linhas.');
        }
        
        let linhasList = rows.map(linha => `
            <tr>
                <td>${linha.id}</td>
                <td><strong>${linha.nome}</strong></td>
                <td>${linha.origem}</td>
                <td>${linha.destino}</td>
                <td>
                    <a href="/admin/linhas/route/${linha.id}" class="action-link">🗺️ Rota</a>
                    <a href="/admin/linhas/edit/${linha.id}" class="action-link">✏️ Editar</a>
                    <a href="/admin/linhas/delete/${linha.id}" class="action-link" onclick="return confirm('Tem certeza?');" style="color: #dc3545;">🗑️ Excluir</a>
                </td>
            </tr>
        `).join('');

        res.send(`
            <!DOCTYPE html>
            <html lang="pt-BR">
            <head>
                <meta charset="UTF-8">
                <title>Gerenciar Linhas</title>
                ${adminStyles}
            </head>
            <body>
                <div class="sidebar">
                    <h3><span style="display:flex;align-items:center;gap:8px"><svg width="22" height="22" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="8" y="18" width="48" height="24" rx="8" fill="#3b82f6"/><rect x="12" y="22" width="40" height="12" rx="6" fill="#93c5fd"/><circle cx="20" cy="46" r="5" fill="#0ea5e9"/><circle cx="44" cy="46" r="5" fill="#0ea5e9"/><rect x="50" y="26" width="6" height="8" rx="2" fill="#60a5fa"/></svg> PAINEL DO ADMINISTRADOR • TRUCK HUB BUS</span></h3>
                    <a href="/admin/dashboard">📊 Dashboard</a>
                    <a href="/admin/linhas" style="background: rgba(255,255,255,0.1); border-left-color: white;">🛣️ Gerenciar Linhas</a>
                    <a href="/admin/onibus">🚌 Gerenciar Ônibus</a>
                    <a href="/admin/motoristas">👨‍✈️ Gerenciar Motoristas</a>
                    <a href="/admin/passageiros">👥 Gerenciar Passageiros</a>
                    <a href="/admin/horarios">⏱️ Horários</a>
                    <a href="/admin/monitor">🗺️ Monitoramento</a>
                    <a href="/admin/automacao">⚙️ Automação</a>
                    
                    <a href="/logout" class="logout">🚪 Sair</a>
                </div>
                <div class="content">
                    <h1>Gerenciar Linhas</h1>
                    <p class="subtitle">Cadastre e gerencie as linhas de ônibus</p>
                    
                    <div class="form-container">
                        <h2>➕ Adicionar Nova Linha</h2>
                        <form action="/admin/linhas" method="POST">
                            <label for="nome">Nome da Linha</label>
                            <input type="text" id="nome" name="nome" placeholder="Ex: 01 - Palhoça/Floripa" required>
                            
                            <label for="origem">Origem</label>
                            <input type="text" id="origem" name="origem" placeholder="Ex: Terminal Palhoça" required>
                            
                            <label for="destino">Destino</label>
                            <input type="text" id="destino" name="destino" placeholder="Ex: Centro Florianópolis" required>
                            
                            <button type="submit">💾 Salvar Linha</button>
                        </form>
                    </div>

                    <div class="form-container">
                        <h2>⬇️ Importar Linhas (Jotur)</h2>
                        <form action="/admin/linhas/import" method="POST">
                            <label for="lista">Cole a lista de linhas (uma por linha)</label>
                            <textarea id="lista" name="lista" rows="12" style="width:100%;padding:12px;border:2px solid #e0e0e0;border-radius:8px;"></textarea>
                            <button type="submit">Importar</button>
                        </form>
                    </div>

                    <div class="form-container">
                        <h2>🧹 Manter apenas linhas principais</h2>
                        <p class="subtitle">Palhoça/São José/Florianópolis</p>
                        <form action="/admin/linhas/reset" method="POST" onsubmit="return confirm('Tem certeza que deseja manter apenas as linhas principais? Isto excluirá as demais.');">
                            <button type="submit" style="background:#ef4444">Aplicar reset de linhas</button>
                        </form>
                    </div>

                    <h2 style="color: #5B2C91; margin-bottom: 15px;">📋 Linhas Cadastradas</h2>
                    <table>
                        <thead>
                            <tr>
                                <th>ID</th>
                                <th>Nome</th>
                                <th>Origem</th>
                                <th>Destino</th>
                                <th>Ações</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${linhasList || '<tr><td colspan="5" style="text-align: center; color: #999;">Nenhuma linha cadastrada</td></tr>'}
                        </tbody>
                    </table>
                </div>
            </body>
            </html>
        `);
    });
});

app.get('/admin/linhas/route/:id', isAdmin, (req,res)=>{
    const id = Number(req.params.id)
    db.get(`SELECT id,nome,origem,destino FROM linhas WHERE id=?`, [id], (e,row)=>{
        if (e || !row) return res.status(404).send('Linha não encontrada')
        db.all(`SELECT seq,lat,lng FROM route_points WHERE linha_id=? ORDER BY seq ASC`, [id], (e2, pts)=>{
            const text = (pts||[]).map(p=> `${p.lat},${p.lng}`).join('\n')
            res.send(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Rota da Linha</title>${adminStyles}<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/></head><body>
            <div class="sidebar"><h3><span style="display:flex;align-items:center;gap:8px"><svg width="22" height="22" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="8" y="18" width="48" height="24" rx="8" fill="#3b82f6"/><rect x="12" y="22" width="40" height="12" rx="6" fill="#93c5fd"/><circle cx="20" cy="46" r="5" fill="#0ea5e9"/><circle cx="44" cy="46" r="5" fill="#0ea5e9"/><rect x="50" y="26" width="6" height="8" rx="2" fill="#60a5fa"/></svg> PAINEL DO ADMINISTRADOR • TRUCK HUB BUS</span></h3>
            <a href="/admin/dashboard">📊 Dashboard</a><a href="/admin/linhas" style="background: rgba(255,255,255,0.1); border-left-color: white;">🛣️ Gerenciar Linhas</a><a href="/logout" class="logout">🚪 Sair</a></div>
            <div class="content"><h1>Rota da Linha #${row.id} — ${row.nome}</h1><p class="subtitle">Cole pontos reais (lat,lng por linha). Ex.: -27.61,-48.65</p>
            <div class="form-container"><form action="/admin/linhas/route/${row.id}" method="POST"><textarea name="points" rows="12" style="width:100%;padding:12px;border:2px solid #e0e0e0;border-radius:8px;">${text}</textarea><button type="submit">💾 Salvar Rota</button></form></div>
            <div id="map" style="height:420px;margin-top:12px;border-radius:12px;overflow:hidden"></div></div>
            <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
            <script>const map=L.map('map').setView([-27.65,-48.65],12);L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(map);fetch('/api/line/route?id=${row.id}').then(r=>r.json()).then(d=>{if(d.points&&d.points.length>1){const latlngs=d.points.map(p=>[p.lat,p.lng]);L.polyline(latlngs,{color:'#5B2C91',weight:4}).addTo(map);map.fitBounds(latlngs)}})</script>
            </body></html>`)
        })
    })
})

app.post('/admin/linhas/route/:id', isAdmin, (req,res)=>{
    const id = Number(req.params.id)
    const raw = String(req.body.points||'')
    const lines = raw.split(/\r?\n/).map(s=> s.trim()).filter(Boolean)
    db.serialize(()=>{
        db.run(`DELETE FROM route_points WHERE linha_id=?`, [id])
        const stmt = db.prepare(`INSERT INTO route_points (linha_id,seq,lat,lng) VALUES (?,?,?,?)`)
        let seq = 1
        lines.forEach(line=>{
            const parts = line.split(',').map(Number)
            if (parts.length===2 && !isNaN(parts[0]) && !isNaN(parts[1])) stmt.run([id, seq++, parts[0], parts[1]])
        })
        stmt.finalize(()=>{
            loadRouteFromDB(id, ()=> res.redirect(`/admin/linhas/route/${id}`))
        })
    })
})

app.get('/admin/monitor', isAdmin, (req,res)=>{
    res.send(`
        <!DOCTYPE html>
        <html lang="pt-BR">
        <head>
            <meta charset="UTF-8">
            <title>Monitoramento</title>
            ${adminStyles}
            <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
            <script src="/socket.io/socket.io.js"></script>
            <style>
                #map { position: fixed; top: 0; left: 250px; right: 0; bottom: 0; z-index: 1; }
                .alerts { position: fixed; top: 20px; right: 20px; width: 360px; background: white; border-radius: 12px; box-shadow: 0 2px 10px rgba(0,0,0,0.08); overflow: hidden; }
                .alerts h3{ background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color:#fff; padding:12px; }
                .alerts .item{ padding:12px; border-bottom:1px solid #f0f0f0 }
                .alerts .item .meta{ color:#666; font-size:12px }
                .legend { position: fixed; bottom: 20px; right: 20px; background: white; border-radius: 8px; padding: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.08); }
                .legend div{ margin:4px 0 }
                .dot{ display:inline-block; width:10px; height:10px; border-radius:50%; margin-right:6px }
            </style>
        </head>
        <body>
                    <div class="sidebar">
                        <h3><span style="display:flex;align-items:center;gap:8px"><svg width="22" height="22" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="8" y="18" width="48" height="24" rx="8" fill="#3b82f6"/><rect x="12" y="22" width="40" height="12" rx="6" fill="#93c5fd"/><circle cx="20" cy="46" r="5" fill="#0ea5e9"/><circle cx="44" cy="46" r="5" fill="#0ea5e9"/><rect x="50" y="26" width="6" height="8" rx="2" fill="#60a5fa"/></svg> PAINEL DO ADMINISTRADOR • TRUCK HUB BUS</span></h3>
                <a href="/admin/dashboard">📊 Dashboard</a>
                <a href="/admin/linhas">🛣️ Gerenciar Linhas</a>
                <a href="/admin/onibus">🚌 Gerenciar Ônibus</a>
                <a href="/admin/motoristas">👨‍✈️ Gerenciar Motoristas</a>
                <a href="/admin/passageiros">👥 Gerenciar Passageiros</a>
                <a href="/admin/horarios">⏱️ Horários</a>
                <a href="/admin/monitor" style="background: rgba(255,255,255,0.1); border-left-color: white;">🗺️ Monitoramento</a>
                <a href="/logout" class="logout">🚪 Sair</a>
            </div>
            <div id="map"></div>
            <div class="alerts">
                <h3>Alertas & Pânico</h3>
                <div id="alertList"></div>
            </div>
            <div class="legend">
                <div><span class="dot" style="background:#22c55e"></span>Em movimento</div>
                <div><span class="dot" style="background:#f59e0b"></span>Parado</div>
                <div><span class="dot" style="background:#ef4444"></span>Pânico</div>
            </div>
            <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
            <script>
                const map = L.map('map').setView([-27.659, -48.675], 13);
                L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom: 19, attribution: '© OpenStreetMap'} ).addTo(map);
                const socket = io();
                const markers = new Map();
                const last = new Map();
                function setMarker(busId, lat, lng){
                    const key = String(busId)
                    const prev = last.get(key)
                    const now = { lat, lng, ts: Date.now() }
                    last.set(key, now)
                    let status = 'moving'
                    if (prev){
                        const d = Math.sqrt( Math.pow(prev.lat-lat,2)+Math.pow(prev.lng-lng,2) )
                        const dt = (now.ts - prev.ts)/1000
                        if (d < 0.00005 && dt > 30) status = 'stopped'
                    }
                    const color = status==='moving' ? '#22c55e' : '#f59e0b'
                    const html = '<div style="font-size:22px;filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3))"><span style="color:'+color+'">🚌</span></div>'
                    const icon = L.divIcon({ className:'bus-admin', html: html, iconSize:[22,22] })
                    if (markers.has(key)) markers.get(key).setLatLng([lat,lng])
                    else markers.set(key, L.marker([lat,lng], {icon}).addTo(map))
                }
                socket.on('bus_location_update', (data)=>{
                    setMarker(data.onibus_id, data.latitude, data.longitude)
                })
                socket.on('panic_event', (evt)=>{
                    const list = document.getElementById('alertList')
                    const div = document.createElement('div')
                    div.className = 'item'
                    div.innerHTML = '<div><strong>ALERTA Ônibus #'+evt.bus_id+'</strong></div><div class="meta">'+evt.ts+'</div><div>'+(evt.message||'')+'</div><form method="POST" action="/admin/panic/resolve/'+evt.id+'"><button type="submit">Resolver</button></form>'
                    list.prepend(div)
                })
                fetch('/api/admin/busesLast').then(r=>r.json()).then(arr=>{ arr.forEach(b=> setMarker(b.onibus_id, b.lat, b.lng)) })
                fetch('/api/admin/panic?resolved=0').then(r=>r.json()).then(rows=>{
                    const list = document.getElementById('alertList')
                    rows.forEach(evt=>{
                        const div = document.createElement('div')
                        div.className = 'item'
                        div.innerHTML = '<div><strong>ALERTA Ônibus #'+evt.bus_id+'</strong></div><div class="meta">'+evt.ts+'</div><div>'+(evt.message||'')+'</div><form method="POST" action="/admin/panic/resolve/'+evt.id+'"><button type="submit">Resolver</button></form>'
                        list.appendChild(div)
                    })
                })
            </script>
        </body>
        </html>
    `)
})

app.get('/admin/automacao', isAdmin, (req,res)=>{
    db.get(`SELECT tick_ms, step_points, auto_dispatch FROM automation_config WHERE id=1`, (e,row)=>{
        const cfg = row || {tick_ms:1000,step_points:1,auto_dispatch:1}
        res.send(`
            <!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Automação</title>${adminStyles}</head>
            <body>
                <div class="sidebar">
                    <h3><span style="display:flex;align-items:center;gap:8px"><svg width="22" height="22" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="8" y="18" width="48" height="24" rx="8" fill="#3b82f6"/><rect x="12" y="22" width="40" height="12" rx="6" fill="#93c5fd"/><circle cx="20" cy="46" r="5" fill="#0ea5e9"/><circle cx="44" cy="46" r="5" fill="#0ea5e9"/><rect x="50" y="26" width="6" height="8" rx="2" fill="#60a5fa"/></svg> PAINEL DO ADMINISTRADOR • TRUCK HUB BUS</span></h3>
                    <a href="/admin/dashboard">📊 Dashboard</a>
                    <a href="/admin/linhas">🛣️ Gerenciar Linhas</a>
                    <a href="/admin/onibus">🚌 Gerenciar Ônibus</a>
                    <a href="/admin/motoristas">👨‍✈️ Gerenciar Motoristas</a>
                    <a href="/admin/passageiros">👥 Gerenciar Passageiros</a>
                    <a href="/admin/horarios">⏱️ Horários</a>
                    <a href="/admin/automacao" style="background: rgba(255,255,255,0.1); border-left-color: white;">⚙️ Automação</a>
                    <a href="/logout" class="logout">🚪 Sair</a>
                </div>
                <div class="content">
                    <h1>Configuração de Automação</h1>
                    <p class="subtitle">Defina parâmetros do simulador para operação automática</p>
                    <div class="form-container" style="max-width:600px">
                        <form method="POST" action="/admin/automacao">
                            <label>Intervalo do tick (ms)</label>
                            <input type="number" name="tick_ms" value="${cfg.tick_ms}" min="200" step="100" />
                            <label>Passos por tick (pontos da rota)</label>
                            <input type="number" name="step_points" value="${cfg.step_points}" min="1" step="1" />
                            <label>Despacho automático</label>
                            <input type="number" name="auto_dispatch" value="${cfg.auto_dispatch}" min="0" max="1" />
                            <button type="submit">💾 Salvar Configuração</button>
                        </form>
                    </div>
                </div>
            </body></html>
        `)
    })
})

app.post('/admin/automacao', isAdmin, (req,res)=>{
    const tick = Math.max(200, Number(req.body.tick_ms||1000))
    const step = Math.max(1, Number(req.body.step_points||1))
    const auto = Number(req.body.auto_dispatch||1) ? 1 : 0
    db.run(`UPDATE automation_config SET tick_ms=?, step_points=?, auto_dispatch=? WHERE id=1`, [tick,step,auto], (e)=>{
        startTicker()
        res.redirect('/admin/automacao')
    })
})

app.post('/admin/linhas', isAdmin, (req, res) => {
    const { nome, origem, destino } = req.body;
    db.run(`INSERT INTO linhas (nome, origem, destino) VALUES (?, ?, ?)`, [nome, origem, destino], (err) => {
        if (err) {
            return res.status(500).send('Erro ao adicionar linha: ' + err.message);
        }
        db.get(`SELECT id FROM linhas WHERE nome=? AND origem=? AND destino=? ORDER BY id DESC`, [nome,origem,destino], (e, row) => {
            if (row) routesCache.set(row.id, buildRouteFromLine(nome, origem, destino))
            loadLineNames()
            res.redirect('/admin/linhas');
        })
    });
});

app.get('/admin/diagrams', isAdmin, (req,res)=>{
    res.send(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Diagramas</title>${adminStyles}
    <style>.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.card{background:#fff;border-radius:12px;box-shadow:0 2px 10px rgba(0,0,0,0.08);padding:16px}.btn{padding:10px 14px;border:none;border-radius:8px;background:#5B2C91;color:#fff;font-weight:700;cursor:pointer}</style></head><body>
    <div class="sidebar">
        <h3><span style="display:flex;align-items:center;gap:8px"><svg width="22" height="22" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="8" y="18" width="48" height="24" rx="8" fill="#3b82f6"/><rect x="12" y="22" width="40" height="12" rx="6" fill="#93c5fd"/><circle cx="20" cy="46" r="5" fill="#0ea5e9"/><circle cx="44" cy="46" r="5" fill="#0ea5e9"/><rect x="50" y="26" width="6" height="8" rx="2" fill="#60a5fa"/></svg> PAINEL DO ADMINISTRADOR • TRUCK HUB BUS</span></h3>
        <a href="/admin/dashboard">📊 Dashboard</a>
        <a href="/admin/linhas">🛣️ Gerenciar Linhas</a>
        <a href="/admin/onibus">🚌 Gerenciar Ônibus</a>
        <a href="/admin/diagrams" style="background: rgba(255,255,255,0.1); border-left-color: white;">📐 Diagramas</a>
        <a href="/logout" class="logout">🚪 Sair</a>
    </div>
    <div class="content">
        <h1>Diagramas</h1>
        <p class="subtitle">Baixar em PNG</p>
        <div class="grid">
            <div class="card">
                <h2>Diagrama de Classe</h2>
                <p>Exportado a partir do SVG.</p>
                <div><button class="btn" id="btnClassPng">Baixar PNG</button></div>
            </div>
            <div class="card">
                <h2>Diagrama de Caso de Uso</h2>
                <p>Exportado a partir do SVG.</p>
                <div><button class="btn" id="btnUseCasePng">Baixar PNG</button></div>
            </div>
        </div>
    </div>
    <script>
    async function svgToPng(url, filename){
        const svgText = await fetch(url).then(r=>r.text())
        const blob = new Blob([svgText], { type:'image/svg+xml' })
        const urlObj = URL.createObjectURL(blob)
        const img = new Image()
        img.onload = function(){
            const canvas = document.createElement('canvas')
            canvas.width = img.width; canvas.height = img.height
            const ctx = canvas.getContext('2d')
            ctx.drawImage(img, 0, 0)
            canvas.toBlob(function(pngBlob){
                const a = document.createElement('a')
                a.href = URL.createObjectURL(pngBlob)
                a.download = filename
                a.click()
                URL.revokeObjectURL(urlObj)
            }, 'image/png')
        }
        img.src = urlObj
    }
    document.getElementById('btnClassPng').onclick = ()=> svgToPng('/docs/class_diagram.svg', 'class_diagram.png')
    document.getElementById('btnUseCasePng').onclick = ()=> svgToPng('/docs/use_case_diagram.svg', 'use_case_diagram.png')
    </script>
    </body></html>`)
})

app.get('/docs/:name', (req,res)=>{
    const name = String(req.params.name||'')
    if (!/^[a-z_]+\.svg$/i.test(name)) return res.status(400).send('Nome inválido')
    const fp = path.join(__dirname, 'docs', name)
    fs.readFile(fp, (err, data)=>{
        if (err) return res.status(404).send('Arquivo não encontrado')
        res.setHeader('Content-Type','image/svg+xml')
        res.send(data)
    })
})

app.post('/admin/reset/minimal', isAdmin, (req,res)=>{
    db.serialize(()=>{
        db.run(`DELETE FROM tracking_points`)
        db.run(`DELETE FROM route_points`)
        db.run(`DELETE FROM horarios_linha`)
        db.run(`DELETE FROM onibus_linhas`)
        db.run(`DELETE FROM linhas`)
        db.run(`DELETE FROM onibus`)
        db.run(`DELETE FROM driver_sessions`)
        db.run(`DELETE FROM motoristas`)
        db.run(`UPDATE automation_config SET auto_dispatch=0, tick_ms=1000, step_points=1 WHERE id=1`)
        db.run(`DELETE FROM users WHERE email!='admin@bus.com'`, [], (e)=>{
            db.get(`SELECT id FROM users WHERE email='admin@bus.com'`, (eA, rowA)=>{
                if (!rowA){ db.run(`INSERT INTO users (email,password,role) VALUES (?,?,?)`, ['admin@bus.com','admin','admin']) }
                db.get(`SELECT id FROM users WHERE email='passageiro@bus.com'`, (eP, rowP)=>{
                    if (!rowP){ db.run(`INSERT INTO users (email,password,role) VALUES (?,?,?)`, ['passageiro@bus.com','1234','passenger']) }
                    busStates.clear(); busLastPos.clear(); routesCache.clear(); lineNames.clear(); loadLineNames();
                    res.send(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Reset concluído</title>${adminStyles}</head><body><div class="content"><h1>Banco zerado</h1><p class="subtitle">Mantidos: admin@bus.com / admin e criado passageiro@bus.com / 1234</p><p><a class="action-link" href="/admin/dashboard">← Voltar ao Dashboard</a></p></div></body></html>`)
                })
            })
        })
    })
})

app.get('/admin/linhas/edit/:id', isAdmin, (req, res) => {
    const id = req.params.id
    db.get(`SELECT * FROM linhas WHERE id=?`, [id], (err, linha) => {
        if (err || !linha) return res.status(404).send('Linha não encontrada')
        res.send(`
            <!DOCTYPE html>
            <html lang="pt-BR">
            <head>
                <meta charset="UTF-8"><title>Editar Linha</title>${adminStyles}
            </head>
            <body>
                <div class="content" style="margin-left:20px;max-width:700px">
                    <h1>✏️ Editar Linha (ID: ${linha.id})</h1>
                    <p class="subtitle">Atualize nome, origem e destino</p>
                    <div class="form-container">
                        <form action="/admin/linhas/edit/${linha.id}" method="POST">
                            <label>Nome</label>
                            <input type="text" name="nome" value="${linha.nome}" required />
                            <label>Origem</label>
                            <input type="text" name="origem" value="${linha.origem}" required />
                            <label>Destino</label>
                            <input type="text" name="destino" value="${linha.destino}" required />
                            <button type="submit">💾 Salvar</button>
                        </form>
                        <p style="margin-top: 20px;"><a href="/admin/linhas" style="color:#5B2C91;font-weight:600">← Voltar</a></p>
                    </div>
                </div>
            </body></html>
        `)
    })
})

app.post('/admin/linhas/edit/:id', isAdmin, (req,res)=>{
    const id = req.params.id
    const { nome, origem, destino } = req.body
    db.run(`UPDATE linhas SET nome=?, origem=?, destino=? WHERE id=?`, [nome,origem,destino,id], (err)=>{
        if (err) return res.status(500).send('Erro ao atualizar linha: '+err.message)
        routesCache.set(Number(id), buildRouteFromLine(nome, origem, destino))
        loadLineNames()
        res.redirect('/admin/linhas')
    })
})

app.get('/admin/linhas/delete/:id', isAdmin, (req,res)=>{
    const id = Number(req.params.id)
    db.run(`DELETE FROM horarios_linha WHERE linha_id=?`, [id], ()=>{
        db.run(`DELETE FROM onibus_linhas WHERE linha_id=?`, [id], ()=>{
            db.run(`DELETE FROM linhas WHERE id=?`, [id], (err)=>{
                routesCache.delete(id)
                if (err) return res.status(500).send('Erro ao excluir linha: '+err.message)
                lineNames.delete(id)
                res.redirect('/admin/linhas')
            })
        })
    })
})
app.post('/admin/linhas/import', isAdmin, (req, res) => {
    const { lista } = req.body;
    const lines = String(lista||'').split(/\n+/).map(s=>s.trim()).filter(Boolean);
    const stmt = db.prepare(`INSERT INTO linhas (nome, origem, destino) VALUES (?,?,?)`);
    lines.forEach(name => {
        const parts = name.split(' - ');
        const label = parts.length>1 ? parts[1] : name;
        const segs = label.split(' / ');
        const origem = segs[0]||'Palhoça';
        const destino = segs[1]||'Florianópolis';
        stmt.run([name, origem, destino]);
    });
    stmt.finalize(()=>{
        db.all(`SELECT id,nome,origem,destino FROM linhas ORDER BY id DESC LIMIT ?`, [lines.length], (e, rows)=>{
            if (rows) rows.forEach(r=> routesCache.set(r.id, buildRouteFromLine(r.nome, r.origem, r.destino)) );
            loadLineNames()
            res.redirect('/admin/linhas');
        });
    });
});

app.post('/admin/linhas/reset', isAdmin, (req,res)=>{
    const base = [
        { nome: 'Palhoça → São José', origem: 'Palhoça', destino: 'São José' },
        { nome: 'São José → Palhoça', origem: 'São José', destino: 'Palhoça' },
        { nome: 'São José → Florianópolis', origem: 'São José', destino: 'Florianópolis' },
        { nome: 'Florianópolis → São José', origem: 'Florianópolis', destino: 'São José' },
        { nome: 'Palhoça → Florianópolis', origem: 'Palhoça', destino: 'Florianópolis' },
        { nome: 'Florianópolis → Palhoça', origem: 'Florianópolis', destino: 'Palhoça' }
    ]
    db.serialize(()=>{
        db.run(`DELETE FROM horarios_linha`)
        db.run(`DELETE FROM onibus_linhas`)
        db.run(`DELETE FROM linhas`)
        const stmt = db.prepare(`INSERT INTO linhas (nome, origem, destino) VALUES (?,?,?)`)
        base.forEach(l=> stmt.run([l.nome, l.origem, l.destino]))
        stmt.finalize(()=>{
            db.all(`SELECT id,nome,origem,destino FROM linhas ORDER BY id ASC`, [], (e, rows)=>{
                routesCache.clear()
                rows?.forEach(r=> routesCache.set(r.id, buildRouteFromLine(r.nome, r.origem, r.destino)))
                loadLineNames()
                db.all(`SELECT id FROM onibus ORDER BY id ASC`, [], (errB, buses)=>{
                    const lineIds = rows?.map(r=> r.id) || []
                    buses?.forEach((b,i)=>{
                        const lid = lineIds.length? lineIds[i % lineIds.length] : null
                        if (lid){
                            db.run(`INSERT OR REPLACE INTO onibus_linhas(onibus_id,linha_id) VALUES(?,?)`, [b.id, lid])
                            busStates.set(b.id, { idx: Math.floor(Math.random()*3), linha_id: lid })
                            const rota = routesCache.get(lid) || rotas[lid] || rotas[1]
                            const p = rota[0]
                            busLastPos.set(b.id, { lat: p.lat, lng: p.lng, linha_id: lid, ts: Date.now() })
                            io.emit('bus_location_update', { onibus_id: b.id, latitude: p.lat, longitude: p.lng, timestamp: new Date().toISOString() })
                        }
                    })
                    res.send(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Linhas Resetadas</title>${adminStyles}</head><body><div class="content"><h1>Linhas atualizadas</h1><p class="subtitle">Mantidas apenas Palhoça/São José/Florianópolis</p><p><a class="action-link" href="/admin/linhas">Gerenciar Linhas</a> • <a class="action-link" href="/admin/dashboard">Dashboard</a></p></div></body></html>`)
                })
            })
        })
    })
})

app.get('/admin/motoristas', isAdmin, (req, res) => {
    db.all("SELECT * FROM motoristas", [], (err, rows) => {
        if (err) {
            return res.status(500).send('Erro ao buscar motoristas.');
        }
        
        let motoristasList = rows.map(motorista => `
            <tr>
                <td>${motorista.id}</td>
                <td>${motorista.foto ? `<img src="${motorista.foto}" width="50" height="50">` : '👤'}</td>
                <td><strong>${motorista.nome}</strong></td>
                <td>${motorista.cpf}</td>
                <td>${motorista.telefone || '-'}</td>
                <td>${motorista.password ? '<span class="badge badge-active">OK</span>' : '<span class="badge badge-banned">Sem senha</span>'}</td>
                <td>
                    <a href="/admin/motoristas/edit/${motorista.id}" class="action-link">✏️ Editar</a>
                    <a href="/admin/motoristas/delete/${motorista.id}" class="action-link" onclick="return confirm('Tem certeza?');" style="color: #dc3545;">🗑️ Excluir</a>
                    ${motorista.password ? '' : `<form action="/admin/motoristas/resetpass/${motorista.id}" method="POST" style="display:inline" onsubmit="return confirm('Gerar senha temporária?')"><button type="submit" class="action-link" style="background:none;border:none;color:#5B2C91;cursor:pointer">🔑 Gerar senha</button></form>`}
                </td>
            </tr>
        `).join('');

        res.send(`
            <!DOCTYPE html>
            <html lang="pt-BR">
            <head>
                <meta charset="UTF-8">
                <title>Gerenciar Motoristas</title>
                ${adminStyles}
            </head>
            <body>
                <div class="sidebar">
                    <h3>🚍 Admin Panel</h3>
                    <a href="/admin/dashboard">📊 Dashboard</a>
                    <a href="/admin/linhas">🛣️ Gerenciar Linhas</a>
                    <a href="/admin/onibus">🚌 Gerenciar Ônibus</a>
                    <a href="/admin/motoristas" style="background: rgba(255,255,255,0.1); border-left-color: white;">👨‍✈️ Gerenciar Motoristas</a>
                    <a href="/admin/relatorios/motoristas">📄 Relatório de Motoristas</a>
                    <a href="/admin/passageiros">👥 Gerenciar Passageiros</a>
                    
                    <a href="/logout" class="logout">🚪 Sair</a>
                </div>
                <div class="content">
                    <h1>Gerenciar Motoristas</h1>
                    <p class="subtitle">Cadastre e gerencie os motoristas da frota</p>
                    
                    <div class="form-container">
                        <h2>➕ Adicionar Novo Motorista</h2>
                        <form action="/admin/motoristas" method="POST" enctype="multipart/form-data">
                            <label for="nome">Nome Completo</label>
                            <input type="text" id="nome" name="nome" placeholder="Ex: João Silva" required>
                            
                            <label for="cpf">CPF</label>
                            <input type="text" id="cpf" name="cpf" placeholder="Ex: 123.456.789-00" required>
                            <label for="password">Senha</label>
                            <input type="password" id="password" name="password" placeholder="Crie uma senha segura" required>
                            
                            <label for="telefone">Telefone</label>
                            <input type="text" id="telefone" name="telefone" placeholder="Ex: (48) 99999-9999">
                            
                            <label for="foto">Foto do Motorista</label>
                            <input type="file" id="foto" name="foto" accept="image/*">
                            
                            <button type="submit">💾 Salvar Motorista</button>
                        </form>
                        <form action="/admin/motoristas/migrate_passwords" method="POST" style="margin-top:12px">
                            <button type="submit">🔄 Migrar senhas para motoristas sem senha</button>
                        </form>
                    </div>

                    <h2 style="color: #5B2C91; margin-bottom: 15px;">📋 Motoristas Cadastrados</h2>
                    <table>
                        <thead>
                            <tr>
                                <th>ID</th>
                                <th>Foto</th>
                                <th>Nome</th>
                                <th>CPF</th>
                                <th>Telefone</th>
                                <th>Senha</th>
                                <th>Ações</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${motoristasList || '<tr><td colspan="6" style="text-align: center; color: #999;">Nenhum motorista cadastrado</td></tr>'}
                        </tbody>
                    </table>
                </div>
            </body>
            </html>
        `);
    });
});

app.get('/admin/horarios', isAdmin, (req, res) => {
    db.all(`SELECT * FROM linhas`, [], (err, linhas) => {
        db.all(`SELECT linha_id, GROUP_CONCAT(hora, '\n') AS horas FROM horarios_linha GROUP BY linha_id`, [], (err2, rows) => {
            const mapa = new Map(rows?.map(r => [r.linha_id, r.horas]) || [])
            const lista = (linhas||[]).map(l => `
                <div class="form-container">
                    <h2>Horários • ${l.nome}</h2>
                    <form action="/admin/horarios" method="POST">
                        <input type="hidden" name="linha_id" value="${l.id}" />
                        <label>Horários (um por linha, formato HH:MM)</label>
                        <textarea name="horas" rows="6" style="width:100%;padding:12px;border:2px solid #e0e0e0;border-radius:8px;">${mapa.get(l.id)||''}</textarea>
                        <button type="submit">💾 Salvar Horários</button>
                    </form>
                </div>
            `).join('')
            res.send(`
                <!DOCTYPE html>
                <html lang="pt-BR"><head><meta charset="UTF-8"><title>Horários</title>${adminStyles}</head>
                <body>
                <div class="sidebar">
                    <h3>🚍 Admin Panel</h3>
                    <a href="/admin/dashboard">📊 Dashboard</a>
                    <a href="/admin/linhas">🛣️ Gerenciar Linhas</a>
                    <a href="/admin/onibus">🚌 Gerenciar Ônibus</a>
                    <a href="/admin/motoristas">👨‍✈️ Gerenciar Motoristas</a>
                    <a href="/admin/passageiros">👥 Gerenciar Passageiros</a>
                    <a href="/admin/horarios" style="background: rgba(255,255,255,0.1); border-left-color: white;">⏱️ Horários</a>
                    <a href="/admin/relatorios/motoristas">📄 Relatório de Motoristas</a>
                    <a href="/logout" class="logout">🚪 Sair</a>
                </div>
                    <div class="content">
                        <h1>Horários por Linha</h1>
                        <p class="subtitle">Cadastre horários baseados na operação real</p>
                        <div class="form-container">
                            <form action="/admin/horarios/import" method="POST">
                                <button type="submit">⬇️ Importar Horários Jotur (exemplo)</button>
                            </form>
                        </div>
                        ${lista || '<div class="card">Nenhuma linha cadastrada</div>'}
                    </div>
                </body></html>
            `)
        })
    })
})

app.post('/admin/horarios', isAdmin, (req, res) => {
    const { linha_id, horas } = req.body
    db.run(`DELETE FROM horarios_linha WHERE linha_id=?`, [linha_id], () => {
        const arr = (horas||'').split(/\n+/).map(s => s.trim()).filter(Boolean)
        const stmt = db.prepare(`INSERT INTO horarios_linha (linha_id, hora) VALUES (?,?)`)
        arr.forEach(h => stmt.run([linha_id, h]))
        stmt.finalize(() => res.redirect('/admin/horarios'))
    })
})

app.post('/admin/horarios/import', isAdmin, (req, res) => {
    db.all(`SELECT id, nome FROM linhas`, [], (err, linhas) => {
        const base = ['06:00','07:00','08:00','12:00','17:30','19:00']
        const stmt = db.prepare(`INSERT INTO horarios_linha (linha_id, hora) VALUES (?,?)`)
        linhas.forEach(l => base.forEach(h => stmt.run([l.id, h])))
        stmt.finalize(() => res.redirect('/admin/horarios'))
    })
})

app.get('/api/line/schedule', (req, res) => {
    const linha = Number(req.query.line||0)
    db.all(`SELECT hora FROM horarios_linha WHERE linha_id=? ORDER BY hora ASC`, [linha], (err, rows) => {
        const times = rows?.map(r => r.hora) || []
        let next = ''
        if (times.length) {
            const now = new Date()
            next = times.find(t => { const [h,m] = t.split(':').map(Number); const dt=new Date(); dt.setHours(h,m,0,0); return dt>now }) || times[0]
        }
        res.json({ times, next })
    })
})

app.get('/api/line/route', (req,res)=>{
    const id = Number(req.query.id||0)
    db.get(`SELECT id,nome,origem,destino FROM linhas WHERE id=?`, [id], (e,row)=>{
        if (!row) return res.json({points:[]})
        db.get(`SELECT COUNT(1) c FROM route_points WHERE linha_id=?`, [id], (e2, r2)=>{
            if (!e2 && r2 && r2.c>0){
                loadRouteFromDB(id, ()=> res.json({points: routesCache.get(id)||[]}) )
            } else {
                if (!routesCache.has(row.id)) routesCache.set(row.id, buildRouteFromLine(row.nome,row.origem,row.destino))
                res.json({points: routesCache.get(row.id) || []})
            }
        })
    })
})

app.get('/api/line/segment', (req,res)=>{
    const id = Number(req.query.id||0)
    const fLat = Number(req.query.fromLat)
    const fLng = Number(req.query.fromLng)
    const tLat = Number(req.query.toLat)
    const tLng = Number(req.query.toLng)
    db.get(`SELECT id,nome,origem,destino FROM linhas WHERE id=?`, [id], (e,row)=>{
        if (!row) return res.json({points:[]})
        db.get(`SELECT COUNT(1) c FROM route_points WHERE linha_id=?`, [id], (e2, r2)=>{
            if (!e2 && r2 && r2.c>0){ loadRouteFromDB(id) } else { if (!routesCache.has(row.id)) routesCache.set(row.id, buildRouteFromLine(row.nome,row.origem,row.destino)) }
        })
        const pts = routesCache.get(row.id) || []
        if (!pts.length) return res.json({points:[]})
        const fromIdx = (!isNaN(fLat)&&!isNaN(fLng)) ? nearestIndex(pts, fLat, fLng) : 0
        const toIdx = (!isNaN(tLat)&&!isNaN(tLng)) ? nearestIndex(pts, tLat, tLng) : pts.length-1
        const out = []
        let i = fromIdx
        while(i!==toIdx){ out.push(pts[i]); i=(i+1)%pts.length; if (out.length>2000) break }
        out.push(pts[toIdx])
        res.json({points: out})
    })
})

app.get('/api/waypoints', (req,res)=>{
    const out = []
    for (const k in waypointMap) {
        const p = waypointMap[k]
        out.push({ name: k, lat: p.lat, lng: p.lng })
    }
    res.json(out)
})
app.get('/api/lines', (req,res)=>{
    db.all(`SELECT id,nome,origem,destino FROM linhas ORDER BY id ASC`, [], (e, rows)=>{
        if (e) return res.status(500).json({error:'db_error'})
        res.json(rows||[])
    })
})

app.post('/api/ride/request', (req,res)=>{
    const payload = req.body||{}
    const busIdStr = String(payload.busId||'')
    const last = busLastPos.get(Number(payload.busId||0))
    if (last && !models.getBusById(busIdStr)) { models.updateBusPosition(busIdStr, last.lat, last.lng, 0, 0) }
    const r = ride.request({ passengerId: payload.passengerId, busId: busIdStr, stopId: payload.stopId })
    if (flags.get('ENABLE_AUTOPILOT')) {
        const d = ride.decide(r)
        io.emit(d.decision==='accepted' ? 'ride:accepted' : 'ride:rejected', { rideId: r.id, busId: r.busId, decision: d.decision, reason: d.reason, eta: d.eta })
        const cur = models.getRideById(r.id)
        if ((cur.status==='pending' || cur.status==='rejected') && busLastPos.has(Number(payload.busId))){
            models.updateRideStatus(r.id,'accepted')
            models.audit('autopilot','force_accept_demo',{ rideId:r.id })
            io.emit('ride:accepted', { rideId: r.id, busId: r.busId, decision: 'accepted', eta: 5 })
        }
    }
    const r2 = models.getRideById(r.id)
    res.json({ id: r.id, status: r2?.status || r.status })
})

app.get('/healthz', (req,res)=>{
    const ok = { server:true, socket_clients: io.engine ? io.engine.clientsCount : 0, ticker_running: !!tickerInterval }
    res.json(ok)
})

app.get('/metrics', (req,res)=>{
    const rides = models.rideRequests
    const counts = { buses: busLastPos.size, rides_total: rides.length, rides_pending: rides.filter(r=>r.status==='pending').length, rides_accepted: rides.filter(r=>r.status==='accepted').length, rides_complete: rides.filter(r=>r.status==='complete').length, audits: models.audits.length }
    res.json(counts)
})

app.post('/admin/feature-toggle', isAdmin, (req,res)=>{
    const flag = String(req.body.flag||'')
    const valRaw = String(req.body.value||'')
    const value = valRaw==='true' || valRaw==='1'
    flags.set(flag, value)
    models.audit('feature_toggle','admin',{ flag, value, admin: req.session.loggedInUser?.id })
    res.json({ ok:true, flag, value })
})

app.post('/admin/config', isAdmin, (req,res)=>{
    const key = String(req.body.key||'')
    const val = String(req.body.value||'')
    const allowed = new Set(['MAX_DIST','MAX_OCC'])
    if (!allowed.has(key)) return res.status(400).json({ error:'key_not_allowed' })
    process.env[key] = val
    models.audit('config_update','admin',{ key, value: val, admin: req.session.loggedInUser?.id })
    res.json({ ok:true, key, value: val })
})

// Scheduler de manutenção e supervisor
let lastTickTs = Date.now()
setInterval(()=>{ lastTickTs = Date.now() }, 1000)
setInterval(()=>{
    // Limpeza de QR expirados
    models.rideRequests.forEach(r=>{ if (r.qr && Date.now()>r.qr.expires) { r.qr=null; models.audit('maintenance','qr_expired_cleanup',{ rideId:r.id }) } })
    // Compactação de audits
    if (models.audits.length>5000){ const keep = models.audits.slice(-1000); models.audits.length=0; Array.prototype.push.apply(models.audits, keep); }
    // Supervisor do ticker
    const estMs = (automationCache.tick_ms||1000) * 3
    const diff = Date.now() - lastTickTs
    if (diff > estMs){ try { startTicker(); models.audit('supervisor','ticker_restart',{ diff }) } catch(e){ /* noop */ } }
}, 5000)

function haversine(a,b){
    const R=6371000
    const dLat=(b.lat-a.lat)*Math.PI/180
    const dLng=(b.lng-a.lng)*Math.PI/180
    const sa=Math.sin(dLat/2), sb=Math.sin(dLng/2)
    const h=sa*sa+Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*sb*sb
    return 2*R*Math.asin(Math.min(1,Math.sqrt(h)))
}
function nearestIndex(points,lat,lng){
    let idx=0,best=Infinity
    for(let i=0;i<points.length;i++){const p=points[i];const d=(p.lat-lat)*(p.lat-lat)+(p.lng-lng)*(p.lng-lng);if(d<best){best=d;idx=i}} return idx
}
function distanceAlong(points,fromIdx,toIdx){
    let sum=0, i=fromIdx
    while(i!==toIdx){ const a=points[i%points.length], b=points[(i+1)%points.length]; sum+=haversine(a,b); i=(i+1)%points.length; if(sum>1e7)break }
    return sum
}

app.get('/api/buses/near',(req,res)=>{
    const lat = Number(req.query.lat||-27.65)
    const lng = Number(req.query.lng||-48.65)
    const dLat = req.query.destLat? Number(req.query.destLat) : null
    const dLng = req.query.destLng? Number(req.query.destLng) : null
    const lineFilter = req.query.lineId? Number(req.query.lineId) : null
    const speedMps = 5
    const out = []
    const sources = []
    busLastPos.forEach((v,busId)=>{
        if (lineFilter!=null && v.linha_id!=null && Number(v.linha_id)!==lineFilter) return
        const effLine = (v.linha_id!=null) ? v.linha_id : (lineFilter!=null? lineFilter : v.linha_id)
        sources.push({ busId, linha_id: effLine, lat: v.lat, lng: v.lng, hasReal:true })
    })
    if (sources.length===0){
        busStates.forEach((state,busId)=>{
            if (lineFilter!=null && Number(state.linha_id)!==lineFilter) return
            const rota = routesCache.get(state.linha_id) || rotas[state.linha_id] || rotas[1]
            const p = rota[state.idx]
            sources.push({ busId, linha_id: state.linha_id, lat: p.lat, lng: p.lng, hasReal:false, idx: state.idx })
        })
    }
    const fakeCount = 3
    const baseLine = (lineFilter!=null ? lineFilter : 1)
    for (let i=0;i<fakeCount;i++){
        const jitterLat = (Math.random()-0.5) * 0.003
        const jitterLng = (Math.random()-0.5) * 0.003
        sources.push({ busId: `fake_${i}`, linha_id: baseLine, lat: lat + jitterLat, lng: lng + jitterLng, hasReal:false })
    }
    sources.forEach(src=>{
        const lineId = src.linha_id
        const isFake = String(src.busId).startsWith('fake_')
        const points = isFake ? null : (routesCache.get(lineId) || rotas[lineId])
        let dist = 0, distDest = 0
        if (points && points.length>1){
            const stopIdx = nearestIndex(points, lat, lng)
            const destIdx = (dLat!=null && dLng!=null) ? nearestIndex(points, dLat, dLng) : stopIdx
            const currIdx = src.hasReal ? nearestIndex(points, src.lat, src.lng) : (src.idx||0)
            if (dLat!=null && dLng!=null && currIdx > destIdx) return
            dist = distanceAlong(points, currIdx, stopIdx)
            if (dLat!=null && dLng!=null) distDest = distanceAlong(points, stopIdx, destIdx)
        } else {
            dist = haversine({lat:src.lat,lng:src.lng}, {lat,lng})
            if (dLat!=null && dLng!=null) distDest = haversine({lat, lng}, {lat:dLat, lng:dLng})
        }
        const eta = Math.round(dist / (speedMps*60))
        const etaDest = Math.round(distDest / (speedMps*60))
        const etaTotal = eta + etaDest
        const arrival = new Date(Date.now()+eta*60000).toTimeString().slice(0,5)
        const arrivalTotal = new Date(Date.now()+etaTotal*60000).toTimeString().slice(0,5)
        out.push({ onibus_id:src.busId, linha_id:lineId, linha_nome: isFake? 'Simulado' : (lineNames.get(Number(lineId))||String(lineId)), placa: isFake? null : (busPlateMap.get(Number(src.busId))||null), lat:src.lat, lng:src.lng, etaMinutes:eta, arrivalTime:arrival, distMeters: Math.round(dist), etaToDest: etaDest, etaTotal: etaTotal, arrivalTimeTotal: arrivalTotal })
    })
    out.sort((a,b)=>a.etaMinutes-b.etaMinutes)
    res.json(out)
})

app.post('/api/track/point', (req,res)=>{
    const busId = Number(req.body.onibus_id||0)
    const motoristaId = req.body.motorista_id ? Number(req.body.motorista_id) : null
    const providedLineId = req.body.linha_id ? Number(req.body.linha_id) : null
    const lat = Number(req.body.lat)
    const lng = Number(req.body.lng)
    const speed_kmh = req.body.speed_kmh? Number(req.body.speed_kmh) : null
    const accuracy_m = req.body.accuracy_m? Number(req.body.accuracy_m) : null
    const ts = req.body.ts? String(req.body.ts) : new Date().toISOString()
    if (!busId || isNaN(lat) || isNaN(lng)) return res.status(400).json({ error: 'onibus_id, lat, lng obrigatórios' })
    const setAndRespond = (linha_id)=>{
        db.run(`INSERT INTO tracking_points(motorista_id,onibus_id,linha_id,ts,lat,lng,speed_kmh,accuracy_m) VALUES (?,?,?,?,?,?,?,?)`, [motoristaId, busId, linha_id, ts, lat, lng, speed_kmh, accuracy_m], ()=>{})
        busLastPos.set(busId, { lat, lng, linha_id, ts: Date.now() })
        if (!busStates.has(busId)) busStates.set(busId, { idx: 0, linha_id })
        io.emit('bus_location_update', { onibus_id: busId, latitude: lat, longitude: lng, timestamp: ts })
        res.json({ ok:true })
    }
    if (providedLineId){
        db.run(`INSERT INTO onibus_linhas(onibus_id,linha_id) VALUES(?,?) ON CONFLICT(onibus_id) DO UPDATE SET linha_id=excluded.linha_id`, [busId, providedLineId], ()=> setAndRespond(providedLineId))
    } else {
        db.get(`SELECT linha_id FROM onibus_linhas WHERE onibus_id=?`, [busId], (e,row)=>{
            const linha_id = row?.linha_id || 1
            setAndRespond(linha_id)
        })
    }
})

app.get('/api/admin/busesLast', (req,res)=>{
    const out = []
    busLastPos.forEach((v,k)=> out.push({ onibus_id:k, lat:v.lat, lng:v.lng, linha_id:v.linha_id, ts:v.ts }) )
    res.json(out)
})

app.get('/api/buses/list', (req,res)=>{
    db.all(`SELECT o.id, o.placa, ol.linha_id FROM onibus o LEFT JOIN onibus_linhas ol ON ol.onibus_id=o.id ORDER BY o.id ASC`, [], (e, rows)=>{
        if (e) return res.status(500).json({ error: 'db_error' })
        res.json(rows||[])
    })
})

app.post('/api/bus/panic', (req,res)=>{
    const busId = Number(req.body.bus_id||0)
    const motoristaId = req.body.motorista_id ? Number(req.body.motorista_id) : null
    const message = String(req.body.message||'')
    if (!busId) return res.status(400).json({ error: 'bus_id obrigatório' })
    const ts = new Date().toISOString()
    db.run(`INSERT INTO panic_events(bus_id,motorista_id,level,message,ts,resolved) VALUES(?,?,?,?,?,0)`, [busId,motoristaId,'panic',message,ts], function(err){
        if (err) return res.status(500).json({ error: err.message })
        const id = this.lastID
        io.emit('panic_event', { id, bus_id: busId, motorista_id: motoristaId, message, ts })
        res.json({ id })
    })
})

app.get('/api/admin/panic', (req,res)=>{
    const resolved = req.query.resolved ? Number(req.query.resolved) : 0
    db.all(`SELECT * FROM panic_events WHERE resolved=? ORDER BY ts DESC`, [resolved], (err, rows)=>{
        if (err) return res.status(500).json({ error: err.message })
        res.json(rows||[])
    })
})

app.post('/admin/panic/resolve/:id', isAdmin, (req,res)=>{
    const id = Number(req.params.id)
    db.run(`UPDATE panic_events SET resolved=1 WHERE id=?`, [id], (err)=>{
        if (err) return res.status(500).send('Erro ao resolver alerta: '+err.message)
        res.redirect('/admin/monitor')
    })
})

app.post('/admin/motoristas', isAdmin, upload.single('foto'), (req, res) => {
    let { nome, cpf, telefone, password } = req.body;
    cpf = String(cpf||'').replace(/\D/g,'')
    const fotoPath = req.file ? `/uploads/${req.file.filename}` : null;
    const passHash = hashPassword(String(password||''))
    db.run(`INSERT INTO motoristas (nome, cpf, telefone, foto, password) VALUES (?, ?, ?, ?, ?)`, [nome, cpf, telefone, fotoPath, passHash], (err) => {
        if (err) {
            return res.status(500).send('Erro ao adicionar motorista: ' + err.message);
        }
        res.redirect('/admin/motoristas');
    });
});

app.get('/admin/motoristas/edit/:id', isAdmin, (req, res) => {
    const id = req.params.id
    db.get(`SELECT * FROM motoristas WHERE id=?`, [id], (err, m) => {
        if (err || !m) return res.status(404).send('Motorista não encontrado')
        res.send(`
            <!DOCTYPE html>
            <html lang="pt-BR">
            <head>
                <meta charset="UTF-8">
                <title>Editar Motorista</title>
                ${adminStyles}
            </head>
            <body>
                <div class="sidebar">
                    <h3>🚍 Admin Panel</h3>
                    <a href="/admin/dashboard">📊 Dashboard</a>
                    <a href="/admin/linhas">🛣️ Gerenciar Linhas</a>
                    <a href="/admin/onibus">🚌 Gerenciar Ônibus</a>
                    <a href="/admin/motoristas" style="background: rgba(255,255,255,0.1); border-left-color: white;">👨‍✈️ Gerenciar Motoristas</a>
                    <a href="/admin/passageiros">👥 Gerenciar Passageiros</a>
                    <a href="/logout" class="logout">🚪 Sair</a>
                </div>
                <div class="content">
                    <h1>✏️ Editar Motorista (ID: ${m.id})</h1>
                    <p class="subtitle">Atualize dados e foto do motorista</p>
                    <div class="form-container">
                        <form action="/admin/motoristas/edit/${m.id}" method="POST" enctype="multipart/form-data">
                            <label>Nome</label>
                            <input type="text" name="nome" value="${m.nome}" required />
                            <label>CPF</label>
                            <input type="text" name="cpf" value="${m.cpf}" required />
                            <label>Senha</label>
                            ${!m.password ? '<div class="badge badge-banned" style="margin-bottom:6px">Senha não definida — obrigatório definir</div>' : ''}
                            <input type="password" name="password" placeholder="Digite para alterar" ${!m.password ? 'required' : ''} />
                            <label>Telefone</label>
                            <input type="text" name="telefone" value="${m.telefone||''}" />
                            <label>Foto</label>
                            ${m.foto ? `<img src="${m.foto}" width="60" height="60" style="border-radius:50%;border:2px solid #e0e0e0;object-fit:cover" />` : ''}
                            <input type="file" name="foto" accept="image/*" />
                            <button type="submit">💾 Salvar</button>
                        </form>
                        <p style="margin-top: 20px;"><a href="/admin/motoristas" class="action-link">← Voltar</a></p>
                    </div>
                </div>
            </body>
            </html>
        `)
    })
})

app.post('/admin/motoristas/edit/:id', isAdmin, upload.single('foto'), (req, res) => {
    const id = req.params.id
    const { nome, cpf, telefone, password } = req.body
    db.get(`SELECT foto FROM motoristas WHERE id=?`, [id], (e, row) => {
        db.get(`SELECT password FROM motoristas WHERE id=?`, [id], (e2, prow)=>{
        const oldFoto = row?.foto || null
        const oldPass = prow?.password || null
        const newFoto = req.file ? `/uploads/${req.file.filename}` : oldFoto
        if (req.file && oldFoto) {
            try { const p = path.join(__dirname, 'public', oldFoto); if (fs.existsSync(p)) fs.unlinkSync(p) } catch {}
        }
        const newPass = password && password.trim() ? hashPassword(password.trim()) : oldPass
        db.run(`UPDATE motoristas SET nome=?, cpf=?, telefone=?, foto=?, password=? WHERE id=?`, [nome, cpf, telefone, newFoto, newPass, id], (err) => {
            if (err) return res.status(500).send('Erro ao atualizar motorista: ' + err.message)
            res.redirect('/admin/motoristas')
        })
        })
    })
})

app.post('/admin/motoristas/resetpass/:id', isAdmin, (req,res)=>{
    const id = Number(req.params.id)
    const temp = Math.random().toString(36).slice(2,10)
    const hashed = hashPassword(temp)
    db.run(`UPDATE motoristas SET password=? WHERE id=?`, [hashed, id], (err)=>{
        if (err) return res.status(500).send('Erro ao gerar senha: '+err.message)
        res.send(`<script>alert('Senha temporária: ${temp}'); window.location.href='/admin/motoristas';</script>`)
    })
})

app.post('/admin/motoristas/migrate_passwords', isAdmin, (req,res)=>{
    db.all(`SELECT id,nome FROM motoristas WHERE password IS NULL OR TRIM(password)=''`, [], (e, rows)=>{
        if (e) return res.status(500).send('Erro ao buscar motoristas: '+e.message)
        if (!rows || rows.length===0) return res.send(`<script>alert('Todos os motoristas já possuem senha.'); window.location.href='/admin/motoristas';</script>`)
        const created = []
        let pending = rows.length
        rows.forEach(m=>{
            const temp = Math.random().toString(36).slice(2,10)
            const hashed = hashPassword(temp)
            db.run(`UPDATE motoristas SET password=? WHERE id=?`, [hashed, m.id], (err)=>{
                created.push({ id:m.id, nome:m.nome, senha:temp })
                if (--pending===0){
                    const list = created.map(c=>`<tr><td>${c.id}</td><td>${c.nome}</td><td>${c.senha}</td></tr>`).join('')
                    res.send(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Senhas migradas</title>${adminStyles}</head><body><div class="content"><h1>Senhas temporárias</h1><p class="subtitle">Entregue estas senhas aos respectivos motoristas e peça para alterarem depois.</p><table><thead><tr><th>ID</th><th>Nome</th><th>Senha Temporária</th></tr></thead><tbody>${list}</tbody></table><p style="margin-top:16px"><a href="/admin/motoristas" class="action-link">← Voltar</a></p></div></body></html>`)
                }
            })
        })
    })
})

app.get('/admin/motoristas/delete/:id', isAdmin, (req, res) => {
    const id = req.params.id;
    db.get(`SELECT foto FROM motoristas WHERE id=?`, [id], (e,row)=>{
        const oldFoto = row?.foto || null
        if (oldFoto){ try { const p = path.join(__dirname, 'public', oldFoto); if (fs.existsSync(p)) fs.unlinkSync(p) } catch {} }
        db.run(`DELETE FROM motoristas WHERE id = ?`, [id], (err) => {
            if (err) {
                return res.status(500).send('Erro ao excluir motorista: ' + err.message);
            }
            res.redirect('/admin/motoristas');
        });
    })
});

app.get('/admin/passageiros', isAdmin, (req, res) => {
    const emailQ = req.query.email || '';
    const nomeQ = req.query.nome || '';
    const cpfQ = req.query.cpf || '';
    let sql = "SELECT id, email, saldo, banned, foto, nome, sobrenome, cpf, password FROM users WHERE role = 'passenger'";
    let params = [];
    if (emailQ) { sql += " AND email LIKE ?"; params.push(`%${emailQ}%`) }
    if (nomeQ) { sql += " AND (nome LIKE ? OR sobrenome LIKE ? OR (nome || ' ' || sobrenome) LIKE ?)"; params.push(`%${nomeQ}%`, `%${nomeQ}%`, `%${nomeQ}%`) }
    if (cpfQ) { sql += " AND cpf LIKE ?"; params.push(`%${cpfQ}%`) }
    db.all(sql, params, (err, rows) => {
        if (err) {
            return res.status(500).send('Erro ao buscar passageiros.');
        }
        
        let passageirosList = rows.map(user => `
            <tr>
                <td>${user.id}</td>
                <td>${user.foto ? `<img src="${user.foto}" width="50" height="50">` : '👤'}</td>
                <td><strong>${(user.nome||'')+' '+(user.sobrenome||'')}</strong></td>
                <td>${user.cpf||'-'}</td>
                <td>${user.email}</td>
                <td>R$ ${user.saldo.toFixed(2)}</td>
                <td>${user.banned === 1 ? '<span class="badge badge-banned">BANIDO</span>' : '<span class="badge badge-active">ATIVO</span>'}</td>
                <td>
                    <a href="/admin/passageiros/edit/${user.id}" class="action-link">✏️ Editar</a>
                    <a href="/admin/passageiros/toggle-ban/${user.id}" class="action-link" onclick="return confirm('Tem certeza?');" style="color: ${user.banned === 1 ? '#28a745' : '#dc3545'};">${user.banned === 1 ? '✅ Desbanir' : '🚫 Banir'}</a>
                    ${user.password ? '' : `<form action="/admin/passageiros/resetpass/${user.id}" method="POST" style="display:inline" onsubmit="return confirm('Gerar senha temporária para este passageiro?')"><button type="submit" class="action-link" style="background:none;border:none;color:#5B2C91;cursor:pointer">🔑 Gerar senha</button></form>`}
                </td>
            </tr>
        `).join('');

        res.send(`
            <!DOCTYPE html>
            <html lang="pt-BR">
            <head>
                <meta charset="UTF-8">
                <title>Gerenciar Passageiros</title>
                ${adminStyles}
            </head>
            <body>
                <div class="sidebar">
                    <h3><span style="display:flex;align-items:center;gap:8px"><svg width="22" height="22" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="8" y="18" width="48" height="24" rx="8" fill="#3b82f6"/><rect x="12" y="22" width="40" height="12" rx="6" fill="#93c5fd"/><circle cx="20" cy="46" r="5" fill="#0ea5e9"/><circle cx="44" cy="46" r="5" fill="#0ea5e9"/><rect x="50" y="26" width="6" height="8" rx="2" fill="#60a5fa"/></svg> PAINEL DO ADMINISTRADOR • TRUCK HUB BUS</span></h3>
                <a href="/admin/dashboard">📊 Dashboard</a>
                <a href="/admin/linhas">🛣️ Gerenciar Linhas</a>
                <a href="/admin/onibus">🚌 Gerenciar Ônibus</a>
                    <a href="/admin/motoristas">👨‍✈️ Gerenciar Motoristas</a>
                    <a href="/admin/passageiros" style="background: rgba(255,255,255,0.1); border-left-color: white;">👥 Gerenciar Passageiros</a>
                    
                    <a href="/logout" class="logout">🚪 Sair</a>
                </div>
                <div class="content">
                    <h1>Gerenciar Passageiros</h1>
                    <p class="subtitle">Visualize e gerencie os passageiros cadastrados</p>
                    <div class="search-container" style="display:grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap:12px;">
                        <form action="/admin/passageiros" method="GET" style="display: flex; gap: 10px;">
                            <input type="text" name="email" placeholder="🔍 Buscar por email..." value="${emailQ}">
                            <button type="submit">Buscar</button>
                            ${emailQ ? '<a href="/admin/passageiros" style="padding: 12px 25px; background: #6c757d; color: white; text-decoration: none; border-radius: 8px; font-weight: 600;">Limpar</a>' : ''}
                        </form>
                        <form action="/admin/passageiros" method="GET" style="display: flex; gap: 10px;">
                            <input type="text" name="nome" placeholder="🔍 Buscar por nome..." value="${nomeQ}">
                            <button type="submit">Buscar</button>
                            ${nomeQ ? '<a href="/admin/passageiros" style="padding: 12px 25px; background: #6c757d; color: white; text-decoration: none; border-radius: 8px; font-weight: 600;">Limpar</a>' : ''}
                        </form>
                        <form action="/admin/passageiros" method="GET" style="display: flex; gap: 10px;">
                            <input type="text" name="cpf" placeholder="🔍 Buscar por CPF..." value="${cpfQ}">
                            <button type="submit">Buscar</button>
                            ${cpfQ ? '<a href="/admin/passageiros" style="padding: 12px 25px; background: #6c757d; color: white; text-decoration: none; border-radius: 8px; font-weight: 600;">Limpar</a>' : ''}
                        </form>
                    </div>
                    
                    <h2 style="color: #5B2C91; margin-bottom: 15px;">📋 Passageiros Cadastrados</h2>
                    <table>
                        <thead>
                            <tr>
                                <th>ID</th>
                                <th>Foto</th>
                                <th>Nome</th>
                                <th>CPF</th>
                                <th>Email</th>
                                <th>Saldo</th>
                                <th>Status</th>
                                <th>Ações</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${passageirosList || '<tr><td colspan="7" style="text-align: center; color: #999;">Nenhum passageiro encontrado</td></tr>'}
                        </tbody>
                    </table>
                </div>
            </body>
            </html>
        `);
    });
});

app.get('/admin/passageiros/toggle-ban/:id', isAdmin, (req, res) => {
    const id = req.params.id;
    
    db.get("SELECT banned FROM users WHERE id = ?", [id], (err, user) => {
        if (err || !user) {
            return res.status(404).send('Passageiro não encontrado.');
        }
        
        const newStatus = user.banned === 1 ? 0 : 1;
        
        db.run(`UPDATE users SET banned = ? WHERE id = ?`, [newStatus, id], (err) => {
            if (err) {
                return res.status(500).send('Erro ao atualizar status: ' + err.message);
            }
            res.redirect('/admin/passageiros');
        });
    });
});

// removed admin guide

app.get('/admin/passageiros/edit/:id', isAdmin, (req, res) => {
    const id = Number(req.params.id)
    db.get(`SELECT id,email,nome,sobrenome,cpf,saldo,foto,password,banned FROM users WHERE id=? AND role='passenger'`, [id], (err, user) => {
        if (err || !user) return res.status(404).send('Passageiro não encontrado')
        res.send(`
            <!DOCTYPE html>
            <html lang="pt-BR">
            <head>
                <meta charset="UTF-8">
                <title>Editar Passageiro</title>
                ${adminStyles}
            </head>
            <body>
                <div class="sidebar">
                    <h3>🚍 Admin Panel</h3>
                    <a href="/admin/dashboard">📊 Dashboard</a>
                    <a href="/admin/passageiros" style="background: rgba(255,255,255,0.1); border-left-color: white;">👥 Gerenciar Passageiros</a>
                    <a href="/logout" class="logout">🚪 Sair</a>
                </div>
                <div class="content" style="max-width:720px">
                    <h1>✏️ Editar Passageiro (ID: ${user.id})</h1>
                    <p class="subtitle">Atualize os dados do passageiro</p>
                    <div class="form-container">
                        <form action="/admin/passageiros/edit/${user.id}" method="POST" enctype="multipart/form-data">
                            <label>Nome</label>
                            <input type="text" name="nome" value="${user.nome||''}" required />
                            <label>Sobrenome</label>
                            <input type="text" name="sobrenome" value="${user.sobrenome||''}" required />
                            <label>CPF</label>
                            <input type="text" name="cpf" value="${user.cpf||''}" required />
                            <label>E-mail</label>
                            <input type="email" name="email" value="${user.email}" required />
                            <label>Senha</label>
                            ${!user.password ? '<div class="badge badge-banned" style="margin-bottom:6px">Senha não definida — obrigatório definir</div>' : ''}
                            <input type="password" name="password" placeholder="Digite para alterar" ${!user.password ? 'required' : ''} />
                            <label>Saldo (R$)</label>
                            <input type="number" step="0.01" name="saldo" value="${Number(user.saldo||0).toFixed(2)}" />
                            <label>Foto</label>
                            ${user.foto ? `<img src="${user.foto}" width="60" height="60" style="border-radius:50%;border:2px solid #e0e0e0;object-fit:cover" />` : ''}
                            <input type="file" name="foto" accept="image/*" />
                            <button type="submit">💾 Salvar</button>
                        </form>
                        <p style="margin-top: 20px;"><a href="/admin/passageiros" class="action-link">← Voltar</a></p>
                    </div>
                </div>
            </body>
            </html>
        `)
    })
})

app.post('/admin/passageiros/edit/:id', isAdmin, upload.single('foto'), (req, res) => {
    const id = Number(req.params.id)
    let { nome, sobrenome, cpf, email, password, saldo } = req.body
    cpf = String(cpf||'').replace(/\D/g,'')
    db.get(`SELECT foto,password FROM users WHERE id=? AND role='passenger'`, [id], (e, row) => {
        const oldFoto = row?.foto || null
        const oldPass = row?.password || null
        const newFoto = req.file ? `/uploads/${req.file.filename}` : oldFoto
        if (req.file && oldFoto) { try { const p = path.join(__dirname, 'public', oldFoto); if (fs.existsSync(p)) fs.unlinkSync(p) } catch {} }
        const newPass = password && password.trim() ? password.trim() : oldPass
        const newSaldo = isNaN(parseFloat(saldo)) ? row?.saldo || 0 : parseFloat(saldo)
        db.run(`UPDATE users SET nome=?, sobrenome=?, cpf=?, email=?, password=?, saldo=?, foto=? WHERE id=?`, [nome, sobrenome, cpf, email, newPass, newSaldo, newFoto, id], (err) => {
            if (err) return res.status(500).send('Erro ao atualizar passageiro: ' + err.message)
            res.redirect('/admin/passageiros')
        })
    })
})

app.post('/admin/passageiros/resetpass/:id', isAdmin, (req,res)=>{
    const id = Number(req.params.id)
    const temp = Math.random().toString(36).slice(2,10)
    db.run(`UPDATE users SET password=? WHERE id=? AND role='passenger'`, [temp, id], (err)=>{
        if (err) return res.status(500).send('Erro ao gerar senha: '+err.message)
        res.send(`<script>alert('Senha temporária: ${temp}'); window.location.href='/admin/passageiros';</script>`)
    })
})
// =================================================================
// ROTAS DE GERENCIAR ÔNIBUS
// =================================================================

app.get('/admin/onibus', isAdmin, (req, res) => {
    db.all("SELECT * FROM linhas", [], (errL, linhas) => {
    db.all("SELECT * FROM onibus", [], (err, rows) => {
        if (err) {
            return res.status(500).send('Erro ao buscar ônibus.');
        }
        db.all(`SELECT ds.onibus_id, m.nome FROM driver_sessions ds JOIN motoristas m ON m.id=ds.motorista_id WHERE ds.active=1`, [], (eS, sessRows)=>{
        const sessMap = new Map((sessRows||[]).map(r=>[String(r.onibus_id), r.nome]))
        let onibusList = rows.map(onibus => `
            <tr>
                <td>${onibus.id}</td>
                <td><strong>${onibus.placa}</strong></td>
                <td>${onibus.modelo}</td>
                <td>${onibus.capacidade} passageiros</td>
                <td id="mot-${onibus.id}">${sessMap.get(String(onibus.id))||'-'}</td>
                <td>
                    <a href="/admin/onibus/edit/${onibus.id}" class="action-link">✏️ Editar</a>
                    <a href="/admin/onibus/delete/${onibus.id}" class="action-link" onclick="return confirm('Tem certeza?');" style="color: #dc3545;">🗑️ Excluir</a>
                    <button type="button" onclick="showOnMap(${onibus.id})" style="margin-left:8px;padding:6px 10px;border:none;border-radius:8px;background:#667eea;color:#fff;cursor:pointer">Ver no mapa</button>
                    <span id="panic-${onibus.id}" class="panic-badge" style="display:none;margin-left:8px;">EMERGÊNCIA</span>
                </td>
            </tr>
        `).join('');

        res.send(`
            <!DOCTYPE html>
            <html lang="pt-BR">
            <head>
                <meta charset="UTF-8">
                <title>Gerenciar Ônibus</title>
                ${adminStyles}
                <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
                <script src="/socket.io/socket.io.js"></script>
                <style>
                    #fleetMap { width: 100%; height: 360px; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.08); margin-bottom: 20px; }
                    .panic-badge { display:inline-block; padding:6px 10px; border-radius:8px; background:#ef4444; color:#fff; font-weight:700; animation: blink 1s infinite; }
                    @keyframes blink { 0%,100%{ opacity:1 } 50%{ opacity:0.3 } }
                </style>
            </head>
            <body>
                <div class="sidebar">
                    <h3>🚍 Admin Panel</h3>
                    <a href="/admin/dashboard">📊 Dashboard</a>
                    <a href="/admin/linhas">🛣️ Gerenciar Linhas</a>
                    <a href="/admin/onibus" style="background: rgba(255,255,255,0.1); border-left-color: white;">🚌 Gerenciar Ônibus</a>
                    <a href="/admin/motoristas">👨‍✈️ Gerenciar Motoristas</a>
                    <a href="/admin/passageiros">👥 Gerenciar Passageiros</a>
                    <a href="/admin/relatorios/motoristas">📄 Relatório de Motoristas</a>
                    
                    <a href="/logout" class="logout">🚪 Sair</a>
                </div>
                <div class="content">
                    <h1>Gerenciar Ônibus</h1>
                    <p class="subtitle">Cadastre e gerencie a frota de ônibus</p>
                    <div id="fleetMap"></div>
                    <div class="form-container">
                        <h2>Definir linha e posicionar ônibus</h2>
                        <form action="/admin/onibus/assign" method="POST" id="assignBusForm">
                            <label for="assign_bus_id">Ônibus</label>
                            <select id="assign_bus_id" name="bus_id" required>
                                ${(rows||[]).map(b=>`<option value="${b.id}">#${b.id} • ${b.placa}</option>`).join('')}
                            </select>
                            <label for="assign_linha_id">Linha</label>
                            <select id="assign_linha_id" name="linha_id" required>
                                ${(linhas||[]).map(l=>`<option value="${l.id}">${l.nome}</option>`).join('')}
                            </select>
                            <label for="assign_lat">Latitude</label>
                            <input type="text" id="assign_lat" name="lat" placeholder="-27.65" required/>
                            <label for="assign_lng">Longitude</label>
                            <input type="text" id="assign_lng" name="lng" placeholder="-48.65" required/>
                            <div style="display:flex; gap:8px; margin-top:8px">
                                <button type="button" id="btnUseMap">Usar clique no mapa</button>
                                <button type="button" id="btnUseGeo">Usar minha localização</button>
                                <button type="submit">Aplicar</button>
                            </div>
                        </form>
                    </div>
                    
                    <div class="form-container">
                        <h2>➕ Adicionar Novo Ônibus</h2>
                        <form action="/admin/onibus" method="POST">
                            <label for="placa">Placa</label>
                            <input type="text" id="placa" name="placa" placeholder="Ex: ABC-1234" required>
                            
                            <label for="modelo">Modelo</label>
                            <input type="text" id="modelo" name="modelo" placeholder="Ex: Marcopolo Viale BRT" required>
                            
                            <label for="capacidade">Capacidade (passageiros)</label>
                            <input type="number" id="capacidade" name="capacidade" placeholder="Ex: 80" required>
                            
                            <label for="linha_id">Linha</label>
                            <select id="linha_id" name="linha_id" required>
                                ${(linhas||[]).map(l=>`<option value="${l.id}">${l.nome}</option>`).join('')}
                            </select>
                            
                            <button type="submit">💾 Salvar Ônibus</button>
                        </form>
                    </div>

                    <h2 style="color: #5B2C91; margin-bottom: 15px;">📋 Frota Cadastrada</h2>
                    <table>
                        <thead>
                            <tr>
                                <th>ID</th>
                                <th>Placa</th>
                                <th>Modelo</th>
                                <th>Capacidade</th>
                                <th>Motorista</th>
                                <th>Ações</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${onibusList || '<tr><td colspan="5" style="text-align: center; color: #999;">Nenhum ônibus cadastrado</td></tr>'}
                        </tbody>
                    </table>
                </div>
                <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
                <script>
                    const map = L.map('fleetMap').setView([-27.659, -48.675], 13);
                    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom: 19, attribution: '© OpenStreetMap'} ).addTo(map);
                    const socket = io();
                    const markers = new Map();
                    function setMarker(busId, lat, lng){
                        const key = String(busId);
                        const icon = L.divIcon({ className:'bus-admin', html: '<div style="font-size:22px;filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3))"><span style="color:#22c55e">🚌</span></div>', iconSize:[22,22] });
                        if (markers.has(key)) { markers.get(key).setLatLng([lat,lng]); }
                        else { markers.set(key, L.marker([lat,lng], {icon}).addTo(map).bindPopup('Ônibus #'+busId)); }
                    }
                    window.showOnMap = function(id){
                        const key = String(id);
                        const m = markers.get(key);
                        if (m) { map.setView(m.getLatLng(), 15); m.openPopup(); return }
                        fetch('/api/admin/busesLast').then(r=>r.json()).then(arr=>{
                            const b = arr.find(x=> String(x.onibus_id)===key)
                            if (b) { setMarker(b.onibus_id, b.lat, b.lng); const mm = markers.get(key); if (mm) { map.setView(mm.getLatLng(), 15); mm.openPopup(); } }
                            else { alert('Posição ainda não disponível para o ônibus #'+id) }
                        }).catch(()=> alert('Não foi possível obter posição do ônibus #'+id))
                    }
                    socket.on('bus_location_update', function(data){ setMarker(data.onibus_id, data.latitude, data.longitude); });
                    fetch('/api/admin/busesLast').then(r=>r.json()).then(arr=>{ arr.forEach(b=> setMarker(b.onibus_id, b.lat, b.lng)); });
                    function markPanic(busId){ var el = document.getElementById('panic-'+busId); if (el) el.style.display='inline-block'; }
                    fetch('/api/admin/panic?resolved=0').then(r=>r.json()).then(rows=>{ rows.forEach(evt=> markPanic(evt.bus_id)); });
                    socket.on('panic_event', function(evt){ markPanic(evt.bus_id); });
                    socket.on('driver_session_update', function(evt){ var el=document.getElementById('mot-'+evt.onibus_id); if(el){ el.textContent = evt.active ? (evt.motorista_nome||('ID '+evt.motorista_id)) : '-' } });
                    window.map = map; window.markers = markers;
                    (function(){
                        const latEl = document.getElementById('assign_lat');
                        const lngEl = document.getElementById('assign_lng');
                        const btnMap = document.getElementById('btnUseMap');
                        const btnGeo = document.getElementById('btnUseGeo');
                        if (btnMap) {
                            btnMap.onclick = function(){
                                map.once('click', function(e){ latEl.value = e.latlng.lat.toFixed(6); lngEl.value = e.latlng.lng.toFixed(6); })
                                alert('Clique no mapa para definir a posição')
                            }
                        }
                        if (btnGeo && navigator.geolocation){
                            btnGeo.onclick = function(){ navigator.geolocation.getCurrentPosition(function(p){ latEl.value = p.coords.latitude.toFixed(6); lngEl.value = p.coords.longitude.toFixed(6); }) }
                        }
                    })()
                </script>
            </body>
            </html>
        `);
        })
    });
    })
});

app.post('/admin/onibus', isAdmin, (req, res) => {
    const { placa, modelo, capacidade, linha_id } = req.body;
    db.run(`INSERT INTO onibus (placa, modelo, capacidade) VALUES (?, ?, ?)`, [placa, modelo, capacidade], function(err) {
        if (err) {
            return res.status(500).send('Erro ao adicionar ônibus: ' + err.message);
        }
        const busId = this.lastID
        busPlateMap.set(Number(busId), placa)
        db.run(`INSERT OR IGNORE INTO onibus_linhas (onibus_id, linha_id) VALUES (?,?)`, [busId, linha_id], (e)=>{
            if (!busStates.has(busId)) busStates.set(busId, { idx: 0, linha_id: Number(linha_id) })
            res.redirect('/admin/onibus');
        })
    });
});

app.post('/admin/onibus/assign', isAdmin, (req,res)=>{
    const busId = Number(req.body.bus_id||0)
    const linhaId = Number(req.body.linha_id||0)
    const lat = Number(req.body.lat)
    const lng = Number(req.body.lng)
    if (!busId || !linhaId || isNaN(lat) || isNaN(lng)) return res.status(400).send('Dados inválidos')
    db.run(`INSERT INTO onibus_linhas(onibus_id,linha_id) VALUES(?,?) ON CONFLICT(onibus_id) DO UPDATE SET linha_id=excluded.linha_id`, [busId, linhaId], (e)=>{
        const points = routesCache.get(linhaId) || rotas[linhaId] || rotas[1]
        const idx = Array.isArray(points) && points.length? nearestIndex(points, lat, lng) : 0
        busStates.set(busId, { idx, linha_id: linhaId })
        busLastPos.set(busId, { lat, lng, linha_id: linhaId, ts: Date.now() })
        io.emit('bus_location_update', { onibus_id: busId, latitude: lat, longitude: lng, timestamp: new Date().toISOString() })
        res.redirect('/admin/onibus')
    })
})

app.get('/admin/onibus/edit/:id', isAdmin, (req, res) => {
    const id = req.params.id;
    db.get("SELECT * FROM onibus WHERE id = ?", [id], (err, onibus) => {
        if (err || !onibus) {
            return res.status(404).send('Ônibus não encontrado.');
        }

        res.send(`
            <!DOCTYPE html>
            <html lang="pt-BR">
            <head>
                <meta charset="UTF-8">
                <title>Editar Ônibus</title>
                ${adminStyles}
            </head>
            <body>
                <div class="content" style="margin-left: 20px;">
                    <h1>✏️ Editar Ônibus (ID: ${onibus.id})</h1>
                    <p class="subtitle">Atualize as informações do ônibus</p>
                    
                    <div class="form-container" style="max-width: 600px;">
                        <form action="/admin/onibus/edit/${onibus.id}" method="POST">
                            <label for="placa">Placa</label>
                            <input type="text" id="placa" name="placa" value="${onibus.placa}" required>
                            
                            <label for="modelo">Modelo</label>
                            <input type="text" id="modelo" name="modelo" value="${onibus.modelo}" required>
                            
                            <label for="capacidade">Capacidade (passageiros)</label>
                            <input type="number" id="capacidade" name="capacidade" value="${onibus.capacidade}" required>
                            
                            <button type="submit">💾 Salvar Alterações</button>
                        </form>
                        <p style="margin-top: 20px;"><a href="/admin/onibus" style="color: #5B2C91; font-weight: 600;">← Voltar para Gerenciar Ônibus</a></p>
                    </div>
                </div>
            </body>
            </html>
        `);
    });
});

// =============================
// Login do Motorista
// =============================
app.get('/motorista/login', (req, res) => {
    db.all(`SELECT id, nome, cpf FROM motoristas ORDER BY nome ASC`, [], (eM, motoristas)=>{
    db.all(`SELECT id, placa FROM onibus ORDER BY id ASC`, [], (eB, buses)=>{
    db.all(`SELECT id, nome FROM linhas ORDER BY id ASC`, [], (eL, linhas)=>{
        res.send(`
        <!DOCTYPE html>
        <html lang="pt-BR">
        <head>
            <meta charset="UTF-8">
            <title>Login do Motorista</title>
            <style>
                body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu; background:#f5f7fb; margin:0}
                .shell{max-width:880px; margin:60px auto; background:white; border-radius:14px; box-shadow:0 10px 30px rgba(0,0,0,0.06); overflow:hidden}
                .header{padding:20px 24px; background:linear-gradient(135deg,#667eea,#764ba2); color:#fff; font-weight:700}
                .content{padding:24px}
                label{display:block; font-weight:600; margin-top:12px}
                input,select{width:100%; padding:12px 14px; margin-top:6px; border:1px solid #e5e7eb; border-radius:10px}
                button{margin-top:16px; padding:12px 18px; border:none; border-radius:10px; background:#22c55e; color:#fff; font-weight:700; cursor:pointer}
                a{color:#5B2C91; font-weight:600; text-decoration:none}
            </style>
        </head>
        <body>
            <div class="shell">
                <div class="header">👨‍✈️ Login do Motorista</div>
                <div class="content">
                    <form action="/motorista/login" method="POST">
                        <label for="cpf">CPF do Motorista</label>
                        <input id="cpf" name="cpf" placeholder="Somente números" required>
                        <label for="password">Senha</label>
                        <input id="password" type="password" name="password" placeholder="Digite sua senha" required>
                        <label for="onibus_id">Ônibus</label>
                        <select id="onibus_id" name="onibus_id" required>
                            ${(buses||[]).map(b=>`<option value="${b.id}">#${b.id} • ${b.placa}</option>`).join('')}
                        </select>
                        <label for="linha_id">Linha</label>
                        <select id="linha_id" name="linha_id" required>
                            ${(linhas||[]).map(l=>`<option value="${l.id}">${l.nome}</option>`).join('')}
                        </select>
                        <button type="submit">Entrar e iniciar turno</button>
                    </form>
                    <p style="margin-top:12px"><a href="/">← Voltar</a></p>
                </div>
            </div>
        </body>
        </html>
        `)
    })
    })
    })
})

app.post('/motorista/login', (req,res)=>{
    const rawCpf = String(req.body.cpf||'').trim()
    const cpf = rawCpf.replace(/\D/g,'')
    const password = String(req.body.password||'').trim()
    const onibus_id = Number(req.body.onibus_id||0)
    const linha_id = Number(req.body.linha_id||0)
    if (!cpf || !password || !onibus_id || !linha_id) return res.status(400).send('Dados inválidos')
    db.get(`SELECT * FROM motoristas WHERE REPLACE(REPLACE(REPLACE(cpf,'.',''),'-',''),' ','')=?`, [cpf], (e, m)=>{
        if (e || !m) return res.status(401).send('Motorista não encontrado ou senha inválida')
        if (!m.password) return res.status(401).send('Motorista sem senha. Peça ao Admin para definir sua senha.')
        if (!verifyPassword(password, m.password)) return res.status(401).send('Motorista não encontrado ou senha inválida')
        const ts = new Date().toISOString()
        db.run(`UPDATE driver_sessions SET active=0 WHERE motorista_id=?`, [m.id], ()=>{
            db.run(`INSERT INTO driver_sessions(motorista_id,onibus_id,linha_id,ts_start,active) VALUES(?,?,?,?,1)`, [m.id,onibus_id,linha_id,ts], (err)=>{
                if (err) return res.status(500).send('Erro ao iniciar sessão: '+err.message)
                db.run(`INSERT INTO onibus_linhas(onibus_id,linha_id) VALUES(?,?) ON CONFLICT(onibus_id) DO UPDATE SET linha_id=excluded.linha_id`, [onibus_id, linha_id])
                busStates.set(onibus_id, { idx: 0, linha_id })
                req.session.loggedInUser = { id: m.id, role: 'driver', email: m.nome }
                req.session.driverAssignment = { onibus_id, linha_id }
                io.emit('driver_session_update', { onibus_id, motorista_id: m.id, motorista_nome: m.nome, linha_id, active: true })
                res.redirect('/motorista/dashboard')
            })
        })
    })
})

app.get('/motorista/dashboard', isDriver, (req,res)=>{
    const assign = req.session.driverAssignment || {}
    const busId = Number(assign.onibus_id||0)
    const lineId = Number(assign.linha_id||0)
    res.send(`
    <!DOCTYPE html>
    <html lang="pt-BR"><head><meta charset="UTF-8"><title>Painel do Motorista</title>
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
    <script src="/socket.io/socket.io.js"></script>
    <style>
        body{font-family:system-ui; background:#f5f7fb; margin:0}
        .top{display:flex; align-items:center; justify-content:space-between; padding:16px 20px; background:#111827; color:#fff}
        .map{height:60vh}
        .actions{padding:12px 20px; background:#fff; display:flex; gap:10px}
        button{padding:12px 16px; border:none; border-radius:10px; font-weight:700; cursor:pointer}
        .panic{background:#ef4444; color:#fff}
        .ok{background:#22c55e; color:#fff}
    </style></head>
    <body>
        <div class="top">
            <div>👨‍✈️ ${req.session.loggedInUser.email} • Ônibus #${busId} • Linha ${lineId}</div>
            <div><a href="/logout" style="color:#fff; text-decoration:none">Sair</a></div>
        </div>
        <div id="map" class="map"></div>
        <div class="actions">
            <form id="panicForm" onsubmit="return sendPanic()">
                <input type="hidden" name="bus_id" value="${busId}">
                <input type="hidden" name="motorista_id" value="${req.session.loggedInUser.id}">
                <button type="submit" class="panic">🚨 Pânico</button>
            </form>
            <button class="ok" onclick="centerBus()">Ver meu ônibus no mapa</button>
            <form action="/motorista/encerrar" method="POST" onsubmit="return confirm('Encerrar turno?')">
                <button type="submit" class="ok" style="background:#374151">Encerrar turno</button>
            </form>
        </div>
        <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
        <script>
            const map = L.map('map').setView([-27.659,-48.675], 13)
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom:19, attribution:'© OpenStreetMap'}).addTo(map)
            const socket = io()
            const key = String(${busId})
            let marker=null
            function setMarker(lat,lng){
                const icon = L.divIcon({ className:'bus-driver', html: '<div style=\"font-size:28px\">🚌</div>', iconSize:[28,28] })
                if (marker) marker.setLatLng([lat,lng])
                else marker = L.marker([lat,lng],{icon}).addTo(map).bindPopup('Meu ônibus #'+key)
            }
            function centerBus(){ if (marker) { map.setView(marker.getLatLng(), 15); marker.openPopup() } }
            socket.on('bus_location_update', (d)=>{ if (String(d.onibus_id)===key) setMarker(d.latitude, d.longitude) })
            fetch('/api/admin/busesLast').then(r=>r.json()).then(arr=>{ const b=arr.find(x=>String(x.onibus_id)===key); if(b){ setMarker(b.lat,b.lng); centerBus() } })
            function sendPanic(){
                const form = document.getElementById('panicForm')
                const data = new URLSearchParams(new FormData(form))
                fetch('/api/bus/panic', { method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body:data })
                    .then(r=>r.json()).then(() => alert('Pânico enviado'))
                return false
            }
        </script>
    </body></html>
    `)
})

app.post('/motorista/encerrar', isDriver, (req,res)=>{
    const dId = req.session.loggedInUser?.id
    const assign = req.session.driverAssignment||{}
    const busId = Number(assign.onibus_id||0)
    const ts = new Date().toISOString()
    db.run(`UPDATE driver_sessions SET active=0, ts_end=? WHERE motorista_id=? AND active=1`, [ts, dId], (err)=>{
        io.emit('driver_session_update', { onibus_id: busId, motorista_id: dId, active: false })
        req.session.loggedInUser = null
        req.session.driverAssignment = null
        res.redirect('/motorista/login')
    })
})

app.post('/admin/onibus/edit/:id', isAdmin, (req, res) => {
    const id = req.params.id;
    const { placa, modelo, capacidade } = req.body;
    db.run(`UPDATE onibus SET placa = ?, modelo = ?, capacidade = ? WHERE id = ?`, 
        [placa, modelo, capacidade, id], 
        (err) => {
            if (err) {
                return res.status(500).send('Erro ao atualizar ônibus: ' + err.message);
            }
            busPlateMap.set(Number(id), placa)
            res.redirect('/admin/onibus');
        }
    );
});

app.get('/admin/onibus/delete/:id', isAdmin, (req, res) => {
    const id = req.params.id;
    db.run(`DELETE FROM onibus WHERE id = ?`, [id], (err) => {
        if (err) {
            return res.status(500).send('Erro ao excluir ônibus: ' + err.message);
        }
        res.redirect('/admin/onibus');
    });
});
// =================================================================
// ROTAS DO PASSAGEIRO
// =================================================================

app.get('/passageiro/rotas', isPassenger, (req, res) => {
    db.all("SELECT * FROM linhas", [], (err, linhas) => {
        if (err) {
            return res.status(500).send('Erro ao buscar linhas.');
        }
        
        let linhasList = linhas.map(linha => `
            <tr>
                <td><strong>${linha.nome}</strong></td>
                <td>${linha.origem}</td>
                <td>${linha.destino}</td>
            </tr>
        `).join('');

        res.send(`
            <!DOCTYPE html>
            <html lang="pt-BR">
            <head>
                <meta charset="UTF-8">
                <title>Rotas e Horários</title>
                <style>
                    * { margin: 0; padding: 0; box-sizing: border-box; }
                    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #ffffff; min-height: 100vh; }
                    .container { max-width: 1000px; margin: 0 auto; background: #fff; padding: 20px; }
                    h1 { color: #5B2C91; margin-bottom: 10px; font-size: 32px; }
                    .subtitle { color: #666; margin-bottom: 30px; }
                    .card { background: white; padding: 30px; border-radius: 12px; box-shadow: 0 2px 10px rgba(0,0,0,0.08); }
                    table { width: 100%; border-collapse: collapse; }
                    th { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 15px; text-align: left; font-weight: 600; }
                    td { padding: 15px; border-bottom: 1px solid #f0f0f0; color: #333; }
                    tr:hover { background: #f8f9fa; }
                    .back-btn { display: inline-block; margin-top: 20px; padding: 12px 30px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-decoration: none; border-radius: 8px; font-weight: 600; transition: transform 0.2s; }
                    .back-btn:hover { transform: translateY(-2px); }
                    .floating-back { position: fixed; right: 20px; bottom: 20px; padding: 12px 16px; border-radius: 50px; background: #111827; color: #fff; text-decoration: none; box-shadow: 0 6px 16px rgba(0,0,0,0.25); font-weight: 700; }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>🛣️ Rotas e Horários</h1>
                    <p class="subtitle">Confira as linhas de ônibus disponíveis</p>
                    
                    <div class="card">
                        <table>
                            <thead>
                                <tr>
                                    <th>Linha</th>
                                    <th>Origem</th>
                                    <th>Destino</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${linhasList || '<tr><td colspan="3" style="text-align: center; color: #999;">Nenhuma linha cadastrada</td></tr>'}
                            </tbody>
                        </table>
                    </div>
                    
                    <a href="/passageiro/dashboard" class="back-btn">← Voltar ao Dashboard</a>
                </div>
                <a href="/passageiro/dashboard" class="floating-back" title="Voltar">← Voltar</a>
            </body>
            </html>
        `);
    });
});

app.get('/passageiro/creditos', isPassenger, (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="pt-BR">
        <head>
            <meta charset="UTF-8">
            <title>Adicionar Créditos</title>
            <style>
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
                .container { background: white; padding: 40px; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.2); width: 100%; max-width: 450px; }
                h1 { color: #5B2C91; margin-bottom: 10px; font-size: 28px; }
                .subtitle { color: #666; margin-bottom: 25px; font-size: 14px; }
                label { display: block; color: #333; font-weight: 600; margin-bottom: 8px; }
                input { width: 100%; padding: 12px; border: 2px solid #e0e0e0; border-radius: 8px; font-size: 14px; transition: border 0.3s; }
                input:focus { outline: none; border-color: #5B2C91; }
                button { width: 100%; padding: 14px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border: none; border-radius: 8px; font-size: 16px; font-weight: 600; cursor: pointer; margin-top: 20px; transition: transform 0.2s; }
                button:hover { transform: translateY(-2px); }
                .back-link { text-align: center; margin-top: 20px; }
                .back-link a { color: #5B2C91; text-decoration: none; font-weight: 600; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>💳 Adicionar Créditos</h1>
                <p class="subtitle">Recarregue seu saldo para usar o transporte</p>
                <form action="/passageiro/creditos" method="POST">
                    <label for="valor">Valor (R$)</label>
                    <input type="number" id="valor" name="valor" step="0.01" min="0.01" placeholder="Ex: 50.00" required>
                    
                    <button type="submit">💰 Adicionar Créditos</button>
                </form>
                <div class="back-link">
                    <a href="/passageiro/dashboard">← Voltar ao Dashboard</a>
                </div>
            </div>
        </body>
        </html>
    `);
});

app.post('/passageiro/creditos', isPassenger, (req, res) => {
    const valor = parseFloat(req.body.valor);
    
    if (isNaN(valor) || valor <= 0) {
        return res.send(`
            <script>
                alert('Valor inválido.');
                window.location.href = '/passageiro/creditos';
            </script>
        `);
    }

    db.run(`UPDATE users SET saldo = saldo + ? WHERE id = ?`, [valor, req.session.loggedInUser.id], function(err) {
        if (err) {
            console.error('ERRO SQL ao adicionar créditos:', err.message);
            return res.status(500).send('Erro ao adicionar créditos.');
        }
        
        db.get(`SELECT * FROM users WHERE id = ?`, [req.session.loggedInUser.id], (err, updatedUser) => {
            if (err || !updatedUser) {
                console.error('ERRO SQL ao buscar usuário atualizado:', err ? err.message : 'Usuário não encontrado');
                return res.status(500).send('Erro ao buscar usuário atualizado.');
            }
            
            req.session.loggedInUser = updatedUser; 
            
            res.send(`
                <script>
                    alert('R$ ${valor.toFixed(2)} adicionados com sucesso! Seu novo saldo é R$ ${req.session.loggedInUser.saldo.toFixed(2)}.');
                    window.location.href = '/passageiro/dashboard';
                </script>
            `);
        });
    });
});


app.get('/passageiro/dashboard', isPassenger, (req, res) => {
    db.get(`SELECT saldo, nome, sobrenome, email FROM users WHERE id = ?`, [req.session.loggedInUser.id], (err, user) => {
        const saldo = user ? Number(user.saldo||0).toFixed(2) : '0.00';
        const displayName = user ? ((user.nome||'') + ' ' + (user.sobrenome||'')).trim() || user.email : req.session.loggedInUser.email;
        
        fs.readFile(path.join(__dirname, 'public', 'passageiro_dashboard.html'), 'utf8', (err, data) => {
            if (err) {
                console.error('Erro ao ler arquivo do dashboard do passageiro:', err);
                return res.status(500).send('Erro interno do servidor.');
            }

            let html = data.replace('<h2>Bem-vindo, Passageiro!</h2>', `<h2>Bem-vindo, ${displayName}! <a href="/passageiro/creditos" style="margin-left:12px;background:#fff;color:#5B2C91;padding:4px 8px;border-radius:8px;text-decoration:none;font-size:14px">+ Créditos</a></h2>`);
            html = html.replace('<div id="saldo-display" class="saldo"></div>', `<div id="saldo-display" class="saldo">Saldo: R$ ${saldo}</div>`);

            res.send(html);
        });
    });
});

app.get('/passageiro/conta', isPassenger, (req, res) => {
    db.get(`SELECT id,email,nome,sobrenome,cpf,foto FROM users WHERE id=?`, [req.session.loggedInUser.id], (err, user) => {
        if (err || !user) return res.status(500).send('Erro ao carregar conta do passageiro.')
        res.send(`
            <!DOCTYPE html>
            <html lang="pt-BR">
            <head>
                <meta charset="UTF-8">
                <title>Minha Conta</title>
                <style>
                    *{margin:0;padding:0;box-sizing:border-box}
                    body{font-family:'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background:linear-gradient(135deg,#667eea,#764ba2); min-height:100vh; display:flex; align-items:center; justify-content:center; padding:20px}
                    .container{background:#fff; padding:28px; border-radius:12px; box-shadow:0 10px 30px rgba(0,0,0,0.2); width:100%; max-width:520px}
                    h1{color:#5B2C91; margin-bottom:10px; font-size:26px}
                    .subtitle{color:#666; margin-bottom:18px; font-size:14px}
                    label{display:block; color:#333; font-weight:600; margin:12px 0 6px}
                    input{width:100%; padding:12px; border:2px solid #e0e0e0; border-radius:8px; font-size:14px}
                    input:focus{outline:none; border-color:#5B2C91}
                    .row{display:grid; grid-template-columns: 1fr 1fr; gap:10px}
                    .foto{display:flex; align-items:center; gap:12px; margin-top:8px}
                    .foto img{width:60px; height:60px; border-radius:50%; object-fit:cover; border:2px solid #e0e0e0}
                    button{width:100%; padding:14px; background:linear-gradient(135deg,#667eea,#764ba2); color:#fff; border:none; border-radius:8px; font-size:16px; font-weight:600; cursor:pointer; margin-top:18px}
                    .back{ text-align:center; margin-top:12px }
                    .back a{ color:#5B2C91; text-decoration:none; font-weight:600 }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>👤 Minha Conta</h1>
                    <p class="subtitle">Atualize seus dados cadastrados</p>
                    <form action="/passageiro/conta" method="POST" enctype="multipart/form-data">
                        <div class="row">
                            <div>
                                <label>Nome</label>
                                <input type="text" name="nome" value="${user.nome||''}" required>
                            </div>
                            <div>
                                <label>Sobrenome</label>
                                <input type="text" name="sobrenome" value="${user.sobrenome||''}" required>
                            </div>
                        </div>
                        <label>CPF</label>
                        <input type="text" name="cpf" value="${user.cpf||''}" required>
                        <label>E-mail</label>
                        <input type="email" name="email" value="${user.email}" required>
                        <label>Senha</label>
                        <input type="password" name="password" placeholder="Digite para alterar (opcional)">
                        <label>Foto</label>
                        <div class="foto">
                            ${user.foto ? `<img src="${user.foto}">` : ''}
                            <input type="file" name="foto" accept="image/*">
                        </div>
                        <button type="submit">💾 Salvar alterações</button>
                    </form>
                    <div class="back"><a href="/passageiro/dashboard">← Voltar ao Dashboard</a></div>
                </div>
            </body>
            </html>
        `)
    })
})

app.post('/passageiro/conta', isPassenger, upload.single('foto'), (req,res)=>{
    const id = req.session.loggedInUser.id
    const { nome, sobrenome, cpf, email, password } = req.body
    db.get(`SELECT foto, password FROM users WHERE id=?`, [id], (e, row)=>{
        const oldFoto = row?.foto || null
        const oldPass = row?.password || null
        const newFoto = req.file ? `/uploads/${req.file.filename}` : oldFoto
        if (req.file && oldFoto){ try { const p = path.join(__dirname, 'public', oldFoto); if (fs.existsSync(p)) fs.unlinkSync(p) } catch {}
        }
        const newPass = password && password.trim() ? password.trim() : oldPass
        db.run(`UPDATE users SET nome=?, sobrenome=?, cpf=?, email=?, foto=?, password=? WHERE id=?`, [nome, sobrenome, cpf, email, newFoto, newPass, id], (err)=>{
            if (err) return res.send(`<script>alert('Erro ao salvar: verifique se CPF ou Email já estão em uso.'); window.location.href='/passageiro/conta';</script>`)
            db.get(`SELECT * FROM users WHERE id=?`, [id], (e2, updated)=>{
                if (!updated) return res.send(`<script>alert('Erro ao carregar dados atualizados.'); window.location.href='/passageiro/conta';</script>`)
                req.session.loggedInUser = updated
                res.send(`<script>alert('Dados atualizados com sucesso.'); window.location.href='/passageiro/dashboard';</script>`)
            })
        })
    })
})

// removed passenger self-account


server.listen(port, () => {
    console.log(JSON.stringify({ level:'info', msg:'server_started', url:`http://localhost:${port}` , ts:new Date().toISOString() }))
    
});
app.get('/admin/relatorios/motoristas', isAdmin, (req,res)=>{
    const startQ = String(req.query.start||'').trim()
    const endQ = String(req.query.end||'').trim()
    const motoristaQ = String(req.query.motorista||'').trim()
    const onibusQ = String(req.query.onibus||'').trim()
    const linhaQ = String(req.query.linha||'').trim()
    const params = []
    let where = 'WHERE 1=1'
    if (startQ) { where += ' AND ds.ts_start >= ?'; params.push(startQ) }
    if (endQ) { where += ' AND (ds.ts_end <= ? OR ds.active=1)'; params.push(endQ) }
    if (motoristaQ) {
        if (/^\d+$/.test(motoristaQ)) { where += ' AND ds.motorista_id = ?'; params.push(Number(motoristaQ)) }
        else { where += ' AND m.nome LIKE ?'; params.push(`%${motoristaQ}%`) }
    }
    if (onibusQ) {
        if (/^\d+$/.test(onibusQ)) { where += ' AND ds.onibus_id = ?'; params.push(Number(onibusQ)) }
        else { where += ' AND o.placa LIKE ?'; params.push(`%${onibusQ}%`) }
    }
    if (linhaQ) {
        if (/^\d+$/.test(linhaQ)) { where += ' AND ds.linha_id = ?'; params.push(Number(linhaQ)) }
        else { where += ' AND l.nome LIKE ?'; params.push(`%${linhaQ}%`) }
    }
    const sql = `SELECT ds.id, ds.motorista_id, ds.onibus_id, ds.linha_id, ds.ts_start, ds.ts_end, ds.active,
                        m.nome AS motorista_nome, o.placa AS placa, l.nome AS linha_nome
                 FROM driver_sessions ds
                 LEFT JOIN motoristas m ON m.id=ds.motorista_id
                 LEFT JOIN onibus o ON o.id=ds.onibus_id
                 LEFT JOIN linhas l ON l.id=ds.linha_id
                 ${where}
                 ORDER BY COALESCE(ds.ts_end, ds.ts_start) DESC LIMIT 500`
    db.all(sql, params, (err, rows)=>{
        if (err) return res.status(500).send('Erro ao gerar relatório: '+err.message)
        let totalMs = 0
        const now = Date.now()
        const items = (rows||[]).map(r=>{
            const start = new Date(r.ts_start).getTime()
            const end = r.ts_end ? new Date(r.ts_end).getTime() : now
            const ms = Math.max(0, end - start)
            totalMs += ms
            const h = Math.floor(ms/3600000)
            const m = Math.floor((ms%3600000)/60000)
            const dur = (h>0? h+'h ':'') + m+'m' + (r.active===1?' (ativo)':'')
            return `<tr>
                <td>${r.id}</td>
                <td>${r.motorista_nome||('ID '+r.motorista_id)}</td>
                <td>#${r.onibus_id} • ${r.placa||''}</td>
                <td>${r.linha_nome||r.linha_id}</td>
                <td>${r.ts_start}</td>
                <td>${r.ts_end||'-'}</td>
                <td><strong>${dur}</strong></td>
            </tr>`
        }).join('')
        const totalH = Math.floor(totalMs/3600000)
        const totalM = Math.floor((totalMs%3600000)/60000)
        const totalStr = (totalH>0? totalH+'h ':'')+totalM+'m'
        const startVal = startQ || ''
        const endVal = endQ || ''
        const motVal = motoristaQ || ''
        const busVal = onibusQ || ''
        const lineVal = linhaQ || ''
        res.send(`
        <!DOCTYPE html>
        <html lang="pt-BR"><head><meta charset="UTF-8"><title>Relatório de Motoristas</title>${adminStyles}</head>
        <body>
            <div class="sidebar">
                <h3>🚍 Admin Panel</h3>
                <a href="/admin/dashboard">📊 Dashboard</a>
                <a href="/admin/linhas">🛣️ Gerenciar Linhas</a>
                <a href="/admin/onibus">🚌 Gerenciar Ônibus</a>
                <a href="/admin/motoristas">👨‍✈️ Gerenciar Motoristas</a>
                <a href="/admin/passageiros">👥 Gerenciar Passageiros</a>
                <a href="/admin/monitor">🗺️ Monitoramento</a>
                <a href="/admin/relatorios/motoristas" style="background: rgba(255,255,255,0.1); border-left-color: white;">📄 Relatório de Motoristas</a>
                <a href="/logout" class="logout">🚪 Sair</a>
            </div>
            <div class="content">
                <h1>Relatório de Motoristas</h1>
                <p class="subtitle">Sessões encerradas com duração de trabalho</p>
                <div class="form-container">
                    <h2>Filtrar por período</h2>
                    <form method="GET" action="/admin/relatorios/motoristas" style="display:grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap:12px; align-items:flex-end">
                        <div>
                            <label>Início (ISO)</label>
                            <input type="datetime-local" name="start" value="${startVal.replace('Z','')}" />
                        </div>
                        <div>
                            <label>Fim (ISO)</label>
                            <input type="datetime-local" name="end" value="${endVal.replace('Z','')}" />
                        </div>
                        <div>
                            <label>Motorista (nome ou ID)</label>
                            <input type="text" name="motorista" placeholder="ex: João ou 12" value="${motVal}" />
                        </div>
                        <div>
                            <label>Ônibus (placa ou ID)</label>
                            <input type="text" name="onibus" placeholder="ex: NB-1012 ou 3" value="${busVal}" />
                        </div>
                        <div>
                            <label>Linha (nome ou ID)</label>
                            <input type="text" name="linha" placeholder="ex: Linha 01 ou 1" value="${lineVal}" />
                        </div>
                        <div>
                            <button type="submit">Aplicar filtros</button>
                        </div>
                    </form>
                    <p style="margin-top:8px; color:#666">Total do período (inclui sessões ativas): <strong>${totalStr}</strong></p>
                </div>
                <table>
                    <thead>
                        <tr>
                            <th>ID</th>
                            <th>Motorista</th>
                            <th>Ônibus</th>
                            <th>Linha</th>
                            <th>Início</th>
                            <th>Fim</th>
                            <th>Duração</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${items || '<tr><td colspan="7" style="text-align:center; color:#999">Nenhuma sessão encontrada</td></tr>'}
                    </tbody>
                </table>
            </div>
        </body></html>
        `)
    })
})

app.post('/admin/seed/populate', isAdmin, (req,res)=>{
    const busCount = Number(req.body.buses||50)
    const driverCount = Number(req.body.drivers||70)
    const modelos = ['Urbano','Executivo','Articulado','Micro','Padron']
    const firsts = ['João','Maria','Pedro','Ana','Luiz','Paulo','Carla','Marcos','Juliana','Rafael','Bruna','Gustavo','Larissa','Felipe','Camila','André','Bianca','Ricardo','Patrícia','Gabriel','Aline','Thiago','Sofia','Rodrigo','Fernanda','Bruno','Renata','Diego','Letícia','Eduardo','Isabela']
    const lasts = ['Silva','Souza','Oliveira','Santos','Rodrigues','Ferreira','Almeida','Costa','Gomes','Martins','Araújo','Melo','Barbosa','Ribeiro','Carvalho','Pereira','Correia','Dias','Teixeira','Monteiro','Lopes','Nascimento','Moreira','Cardoso','Freitas','Duarte']
    const placa = (i)=> 'NB-'+String(1000+i)
    const randInt = (a,b)=> Math.floor(a+Math.random()*(b-a+1))
    const genCpf = ()=>{
        let s=''; for(let i=0;i<11;i++) s+= String(randInt(0,9)); return s
    }
    const usedCpfs = new Set()
    let insertedB=0, insertedD=0
    const insertBuses = (done)=>{
        let i=0
        const next=()=>{
            if(i>=busCount) return done()
            const cap = randInt(40,100)
            db.run(`INSERT OR IGNORE INTO onibus (placa, modelo, capacidade) VALUES (?,?,?)`, [placa(i+1), modelos[randInt(0,modelos.length-1)], cap], (err)=>{
                if(!err) insertedB++
                i++; next()
            })
        }
        next()
    }
    const insertDrivers = (done)=>{
        let i=0
        const passHash = hashPassword('truckhub2025')
        const next=()=>{
            if(i>=driverCount) return done()
            const nome = firsts[randInt(0,firsts.length-1)]+' '+lasts[randInt(0,lasts.length-1)]
            let cpf = genCpf(); while(usedCpfs.has(cpf)) cpf = genCpf(); usedCpfs.add(cpf)
            const tel = `(48) 9${randInt(8000,9999)}-${randInt(1000,9999)}`
            db.run(`INSERT OR IGNORE INTO motoristas (nome, cpf, telefone, foto, password) VALUES (?,?,?,?,?)`, [nome, cpf, tel, null, passHash], (err)=>{
                if(!err) insertedD++
                i++; next()
            })
        }
        next()
    }
    insertBuses(()=> insertDrivers(()=>{
        db.all(`SELECT onibus.id AS id, ol.linha_id AS linha_id FROM onibus LEFT JOIN onibus_linhas ol ON ol.onibus_id = onibus.id`, [], (err, rows) => {
            rows?.forEach(r => { if (!busStates.has(r.id)) busStates.set(r.id, { idx: Math.floor(Math.random()*5), linha_id: r.linha_id||1 }) })
            // emite posição inicial para aparecer no mapa do passageiro
            busStates.forEach((state,busId)=>{
                const rota = routesCache.get(state.linha_id) || rotas[state.linha_id] || rotas[1]
                const p = rota[state.idx]
                busLastPos.set(busId, { lat: p.lat, lng: p.lng, linha_id: state.linha_id, ts: Date.now() })
                io.emit('bus_location_update', { onibus_id: busId, latitude: p.lat, longitude: p.lng, timestamp: new Date().toISOString() })
            })
        })
        res.send(`
        <!DOCTYPE html>
        <html lang="pt-BR"><head><meta charset="UTF-8"><title>Seed</title>${adminStyles}</head>
        <body>
            <div class="content">
                <h1>Dados populados</h1>
                <p class="subtitle">Foram inseridos ${insertedB} ônibus e ${insertedD} motoristas.</p>
                <p style="margin-top:10px">Senha padrão dos motoristas criados: <strong>truckhub2025</strong></p>
                <p style="margin-top:12px"><a class="action-link" href="/admin/onibus">Ver Ônibus</a> • <a class="action-link" href="/admin/motoristas">Ver Motoristas</a></p>
                <p style="margin-top:12px"><a class="action-link" href="/admin/dashboard">← Voltar ao Dashboard</a></p>
            </div>
        </body></html>
        `)
    }))
})

app.post('/admin/seed/passengers', isAdmin, (req,res)=>{
    const count = Number(req.body.count||40)
    const firsts = ['João','Maria','Pedro','Ana','Luiz','Paulo','Carla','Marcos','Juliana','Rafael','Bruna','Gustavo','Larissa','Felipe','Camila','André','Bianca','Ricardo','Patrícia','Gabriel','Aline','Thiago','Sofia','Rodrigo','Fernanda','Bruno','Renata','Diego','Letícia','Eduardo','Isabela']
    const lasts = ['Silva','Souza','Oliveira','Santos','Rodrigues','Ferreira','Almeida','Costa','Gomes','Martins','Araújo','Melo','Barbosa','Ribeiro','Carvalho','Pereira','Correia','Dias','Teixeira','Monteiro','Lopes','Nascimento','Moreira','Cardoso','Freitas','Duarte']
    const randInt = (a,b)=> Math.floor(a+Math.random()*(b-a+1))
    const genCpf = ()=>{ let s=''; for(let i=0;i<11;i++) s+= String(randInt(0,9)); return s }
    let inserted = 0
    let i=0
    const next = ()=>{
        if (i>=count) return done()
        const nome = firsts[randInt(0,firsts.length-1)]
        const sobrenome = lasts[randInt(0,lasts.length-1)]
        const cpf = genCpf()
        const email = `${nome.toLowerCase()}.${sobrenome.toLowerCase()}${randInt(100,999)}@truckhub.bus`
        const password = 'pass123'
        db.run(`INSERT OR IGNORE INTO users (nome,sobrenome,cpf,email,password,role) VALUES (?,?,?,?,?,?)`, [nome, sobrenome, cpf, email, password, 'passenger'], (err)=>{
            if (!err) inserted++
            i++; next()
        })
    }
    const done = ()=>{
        res.send(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Seed Passageiros</title>${adminStyles}</head><body><div class="content"><h1>Passageiros criados</h1><p class="subtitle">Criados ${inserted} passageiros genéricos.</p><p><a class="action-link" href="/admin/passageiros">Ver Passageiros</a></p><p style="margin-top:12px"><a class="action-link" href="/admin/dashboard">← Voltar ao Dashboard</a></p></div></body></html>`)
    }
    next()
})
// removed UberBus modules
