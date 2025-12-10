const { addPassenger, findPassengerByPhone, otpStore } = require('../models')
const { sign } = require('../middleware/auth')

function register({name,phone,email}){ if(!name||!phone) throw new Error('invalid_payload'); const p={ id:'p_'+Math.random().toString(36).slice(2,8), name, phone, email:email||'', createdAt:Date.now() }; addPassenger(p); return p }
function login({phone}){ const p=findPassengerByPhone(phone); if(!p) throw new Error('not_found'); const otp=String(Math.floor(100000+Math.random()*900000)); const expires=Date.now()+10*60*1000; otpStore.set(p.id,{otp,expires,tries:0}); return { passengerId:p.id, otp } }
function verify({passengerId,otp}){ const entry=otpStore.get(passengerId); if(!entry) throw new Error('otp_not_requested'); if(Date.now()>entry.expires) throw new Error('otp_expired'); entry.tries++; if(entry.otp!==otp) throw new Error('otp_invalid'); otpStore.delete(passengerId); return { token: sign({ sub: passengerId, role:'passenger' }) } }

module.exports={ register, login, verify }
