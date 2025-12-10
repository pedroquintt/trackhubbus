const tokenKey='uberbus_token'
document.addEventListener('DOMContentLoaded',()=>{
  const msg=document.getElementById('msg')
  document.getElementById('btnRegister').onclick=()=>{
    const name=document.getElementById('name').value.trim()
    const phone=document.getElementById('phone').value.trim()
    const email=document.getElementById('email').value.trim()
    fetch('/api/passenger/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,phone,email})}).then(r=>r.json()).then(d=>{msg.textContent='Registrado: '+d.id})
  }
  document.getElementById('btnLogin').onclick=()=>{
    const phone=document.getElementById('loginPhone').value.trim()
    fetch('/api/passenger/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone})}).then(r=>r.json()).then(d=>{msg.textContent='OTP: '+d.otp; store('pid',d.passengerId)})
  }
  document.getElementById('btnVerify').onclick=()=>{
    const otp=document.getElementById('otp').value.trim()
    const passengerId=localStorage.getItem('pid')
    fetch('/api/passenger/verify-otp',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({passengerId,otp})}).then(r=>r.json()).then(d=>{localStorage.setItem(tokenKey,d.token);msg.textContent='Logado'; window.location.href='/public/passenger_map.html'})
  }
})
function store(k,v){ localStorage.setItem(k,v) }
