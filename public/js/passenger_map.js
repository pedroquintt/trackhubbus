import socket from './socket_handlers.js'
import { $, load, haversine } from './utils.js'
import { showDrawer } from './ui_components.js'

const tokenKey='uberbus_token'
let jwt=localStorage.getItem(tokenKey)||''
let selectedBus=null
let userLocation=null

document.addEventListener('DOMContentLoaded',()=>{
  const map = L.map('map').setView([-27.613,-48.655],13)
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(map)
  const markers={}

  if (navigator.geolocation){ navigator.geolocation.watchPosition(pos=>{ userLocation=[pos.coords.latitude,pos.coords.longitude] }) }

  function loadBuses(){ fetch('/api/buses').then(r=>r.json()).then(arr=>{ arr.forEach(b=>{ const latLng=[b.lat,b.lng]; if (!markers[b.id]){ const m=L.marker(latLng).addTo(map).bindPopup(`${b.line} • ${b.plate}`); m.on('click',()=>{ selectedBus=b; showDrawer(`<h3>${b.line}</h3><p>Placa ${b.plate}</p><p>Ocupação ${b.occupancy}</p><button class='btn' id='btnReq'>Solicitar embarque</button>`); document.getElementById('btnReq').onclick=requestBoarding }); markers[b.id]=m } else { markers[b.id].setLatLng(latLng) } }) }) }
  loadBuses(); setInterval(loadBuses,5000)

  socket.on('gps:position', ({busId,lat,lng,speed})=>{ const m=markers[busId]; if (m) m.setLatLng([lat,lng]); if (selectedBus && selectedBus.id===busId){ const d = userLocation? haversine(userLocation[0],userLocation[1],lat,lng) : 500; if (d<200){ const btn=document.getElementById('btnConfirm'); if (!btn){ showDrawer(`<h3>${selectedBus.line}</h3><p>Chegando em pouco tempo</p><button class='btn' id='btnConfirm'>Confirmar embarque</button>`); document.getElementById('btnConfirm').onclick=confirmBoarding } } } })

  function requestBoarding(){ const stopId='stop_1'; fetch('/api/ride/request',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+jwt},body:JSON.stringify({ passengerId: load('pid')||'me', busId:selectedBus.id, stopId })}).then(r=>r.json()).then(d=>{ $('status').textContent='Solicitado: '+d.id }) }
  function confirmBoarding(){ fetch('/api/ride/qr',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+jwt},body:JSON.stringify({ rideId: 'last' })}).then(r=>r.json()).then(d=>{ showDrawer(`<img src='${d.dataUrl}' style='width:220px;height:220px'><p>Expira em 90s</p>`); setTimeout(()=>{ $('status').textContent='QR expirado' }, 90000) }) }
})
