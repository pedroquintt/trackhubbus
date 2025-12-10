const jwt=require('jsonwebtoken')
const SECRET=process.env.JWT_SECRET||'dev_secret'
function authMiddleware(req,res,next){ const h=req.headers.authorization||''; const m=h.match(/^Bearer\s+(.+)$/); if(!m) return res.status(401).json({error:'missing_token'}); try{ req.user=jwt.verify(m[1],SECRET); next() }catch(e){ return res.status(401).json({error:'invalid_token'}) } }
function sign(payload,opts){ return jwt.sign(payload,SECRET,opts||{ expiresIn:'2h' }) }
module.exports={ authMiddleware, sign }
