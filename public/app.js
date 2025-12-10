function postJson(url, obj){
  return fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(obj)}).then(r=>r.json())
}

document.addEventListener('DOMContentLoaded',()=>{
  const formEmpresa = document.getElementById('formEmpresa')
  if (formEmpresa) {
    formEmpresa.addEventListener('submit',async e=>{
      e.preventDefault()
      const nome = document.getElementById('empresaNome').value
      const res = await postJson('/api/admin/company',{name:nome})
      document.getElementById('empresaResultado').textContent = 'Empresa ID '+res.id
    })
  }

  const formLinha = document.getElementById('formLinha')
  if (formLinha) {
    formLinha.addEventListener('submit',async e=>{
      e.preventDefault()
      const companyId = parseInt(document.getElementById('linhaEmpresaId').value)
      const nome = document.getElementById('linhaNome').value
      const res = await postJson('/api/admin/line',{companyId:companyId,name:nome})
      document.getElementById('linhaResultado').textContent = 'Linha ID '+res.id
    })
  }

  const formOnibus = document.getElementById('formOnibus')
  if (formOnibus) {
    formOnibus.addEventListener('submit',async e=>{
      e.preventDefault()
      const lineId = parseInt(document.getElementById('onibusLinhaId').value)
      const code = document.getElementById('onibusCodigo').value
      const res = await postJson('/api/admin/bus',{lineId:lineId,code:code})
      document.getElementById('onibusResultado').textContent = 'Ônibus ID '+res.id
    })
  }

  const formRota = document.getElementById('formRota')
  if (formRota) {
    formRota.addEventListener('submit',async e=>{
      e.preventDefault()
      const lineId = parseInt(document.getElementById('rotaLinhaId').value)
      const linhas = document.getElementById('rotaPontos').value.trim().split(/\n+/)
      const points = linhas.filter(s=>s.trim().length>0).map(s=>{const [a,b]=s.split(',');return {lat:parseFloat(a),lng:parseFloat(b)}})
      const res = await postJson('/api/admin/route',{lineId:lineId,points:points})
      document.getElementById('rotaResultado').textContent = 'Pontos: '+res.count
    })
  }

  const formHorario = document.getElementById('formHorario')
  if (formHorario) {
    formHorario.addEventListener('submit',async e=>{
      e.preventDefault()
      const lineId = parseInt(document.getElementById('horLinhaId').value)
      const linhas = document.getElementById('horarios').value.trim().split(/\n+/)
      const times = linhas.filter(s=>s.trim().length>0).map(s=>({time:s.trim()}))
      const res = await postJson('/api/admin/schedule',{lineId:lineId,times:times})
      document.getElementById('horarioResultado').textContent = 'Horários: '+res.count
    })
  }

  const formAd = document.getElementById('formAd')
  if (formAd) {
    formAd.addEventListener('submit',async e=>{
      e.preventDefault()
      const title = document.getElementById('adTitle').value
      const imageUrl = document.getElementById('adImage').value
      const linkUrl = document.getElementById('adLink').value
      const res = await postJson('/api/admin/ad',{title,imageUrl,linkUrl})
      document.getElementById('adResultado').textContent = 'Anúncio ID '+res.id
    })
  }

  const formPass = document.getElementById('formPassageiro')
  if (formPass) {
    formPass.addEventListener('submit',async e=>{
      e.preventDefault()
      const nome = document.getElementById('passNome').value
      const file = document.getElementById('passFoto').files[0]
      let dataUrl = ''
      if (file) {
        dataUrl = await toDataUrl(file)
      }
      const res = await postJson('/api/passenger/register',{name:nome,photoDataUrl:dataUrl})
      document.getElementById('passResultado').textContent = 'Passageiro ID '+res.id
    })
  }

  const btnBuscar = document.getElementById('btnBuscar')
  if (btnBuscar) {
    btnBuscar.addEventListener('click',async ()=>{
      const q = document.getElementById('buscaRotas').value
      const res = await fetch('/api/passenger/searchRoutes?q='+encodeURIComponent(q)).then(r=>r.json())
      const ul = document.getElementById('listaRotas')
      ul.innerHTML = ''
      res.forEach(item=>{
        const li = document.createElement('li')
        const name = document.createElement('span')
        name.className = 'name'
        name.textContent = item.name
        li.appendChild(name)
        const btn = document.createElement('button')
        btn.className = 'btn'
        btn.textContent = 'Verificar rota'
        btn.addEventListener('click',()=>startStream(item.id))
        li.appendChild(btn)
        const btnHor = document.createElement('button')
        btnHor.className = 'btn secondary'
        btnHor.textContent = 'Ver horários'
        btnHor.addEventListener('click',()=>loadSchedule(item.id))
        li.appendChild(btnHor)
        ul.appendChild(li)
      })
      loadAds()
    })
  }
  const btnGeo = document.getElementById('btnGeo')
  const btnProx = document.getElementById('btnProximos')
  if (btnGeo) {
    btnGeo.addEventListener('click',()=>{
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(pos=>{
          const {latitude, longitude} = pos.coords
          document.getElementById('minhaPos').value = `${latitude.toFixed(5)},${longitude.toFixed(5)}`
        })
      }
    })
  }
  if (btnProx) {
    btnProx.addEventListener('click',async ()=>{
      const val = document.getElementById('minhaPos').value
      const [lat,lng] = val.split(',').map(Number)
      const destRaw = document.getElementById('destPos').value.trim()
      let dLat=null,dLng=null
      if (destRaw){const parts=destRaw.split(',').map(Number); if (parts.length===2){dLat=parts[0]; dLng=parts[1];}}
      await loadNearbyBuses(lat,lng,dLat,dLng)
    })
  }
})

function toDataUrl(file){
  return new Promise((resolve)=>{
    const fr = new FileReader()
    fr.onload = ()=>resolve(fr.result)
    fr.readAsDataURL(file)
  })
}

let es
let currentProjection = null
let currentPolyline = []
async function startStream(lineId){
  if (es) es.close()
  const canvas = document.getElementById('mapa')
  const ctx = canvas.getContext('2d')
  const status = document.getElementById('statusRota')
  const w = canvas.width, h = canvas.height
  ctx.clearRect(0,0,w,h)
  drawGrid(ctx,w,h)
  const route = await fetch('/api/routes/get?line='+lineId).then(r=>r.json())
  currentProjection = makeProjection(route.points, w, h)
  currentPolyline = route.points.map(p=>projectWith(currentProjection,p.lat,p.lng))
  drawGrid(ctx,w,h)
  drawPolyline(ctx,currentPolyline)
  loadSchedule(lineId)
  es = new EventSource('/api/routes/stream?line='+lineId)
  es.onmessage = e => {
    const obj = JSON.parse(e.data)
    const p = projectWith(currentProjection,obj.lat,obj.lng)
    ctx.clearRect(0,0,w,h)
    drawGrid(ctx,w,h)
    drawPolyline(ctx,currentPolyline)
    drawBus(ctx,p.x,p.y)
    status.textContent = 'lat '+obj.lat.toFixed(5)+' lng '+obj.lng.toFixed(5)
  }
}

async function loadNearbyBuses(lat,lng,dLat,dLng){
  const ul = document.getElementById('listaOnibus')
  if (!ul) return
  let url = `/api/buses/near?lat=${lat}&lng=${lng}`
  if (dLat!=null && dLng!=null) url += `&destLat=${dLat}&destLng=${dLng}`
  const res = await fetch(url).then(r=>r.json())
  ul.innerHTML = ''
  res.sort((a,b)=>a.etaMinutes-b.etaMinutes)
  res.forEach(item=>{
    const li = document.createElement('li')
    const name = document.createElement('span')
    name.className = 'name'
    name.textContent = `${item.name} • ETA ${item.etaMinutes} min • Chegada ${item.arrivalTime}`
    li.appendChild(name)
    const btn = document.createElement('button')
    btn.className = 'btn'
    btn.textContent = 'Acompanhar'
    btn.addEventListener('click',()=>trackBus(item.busId,item.lineId,lat,lng))
    li.appendChild(btn)
    ul.appendChild(li)
  })
}

let esBus
async function trackBus(busId,lineId,tLat,tLng){
  if (esBus) esBus.close()
  const canvas = document.getElementById('mapa')
  const ctx = canvas.getContext('2d')
  const w = canvas.width, h = canvas.height
  const route = await fetch('/api/routes/get?line='+lineId).then(r=>r.json())
  currentProjection = makeProjection(route.points, w, h)
  currentPolyline = route.points.map(p=>projectWith(currentProjection,p.lat,p.lng))
  const stopIdx = nearestIndexLocal(route.points,tLat,tLng)
  const stopP = projectWith(currentProjection,route.points[stopIdx].lat,route.points[stopIdx].lng)
  ctx.clearRect(0,0,w,h)
  drawGrid(ctx,w,h)
  drawPolyline(ctx,currentPolyline)
  drawStop(ctx,stopP.x,stopP.y)
  esBus = new EventSource(`/api/bus/stream?id=${busId}&targetLat=${tLat}&targetLng=${tLng}`)
  esBus.onmessage = e => {
    const obj = JSON.parse(e.data)
    const p = projectWith(currentProjection,obj.lat,obj.lng)
    ctx.clearRect(0,0,w,h)
    drawGrid(ctx,w,h)
    drawPolyline(ctx,currentPolyline)
    drawStop(ctx,stopP.x,stopP.y)
    drawBus(ctx,p.x,p.y)
    document.getElementById('statusRota').textContent = `ETA ${obj.etaMinutes} min • Chegada ${obj.arrivalTime}`
  }
}

function drawGrid(ctx,w,h){
  ctx.fillStyle = '#0b1220'
  ctx.fillRect(0,0,w,h)
  ctx.strokeStyle = '#334155'
  ctx.lineWidth = 1
  for(let i=0;i<w;i+=40){ctx.beginPath();ctx.moveTo(i,0);ctx.lineTo(i,h);ctx.stroke()}
  for(let j=0;j<h;j+=40){ctx.beginPath();ctx.moveTo(0,j);ctx.lineTo(w,j);ctx.stroke()}
}

function drawBus(ctx,x,y){
  ctx.fillStyle = '#22c55e'
  ctx.beginPath()
  ctx.arc(x,y,8,0,Math.PI*2)
  ctx.fill()
}

function drawStop(ctx,x,y){
  ctx.fillStyle = '#fbbf24'
  ctx.beginPath()
  ctx.rect(x-6,y-6,12,12)
  ctx.fill()
}

function drawPolyline(ctx,pts){
  if (!pts || pts.length<2) return
  ctx.strokeStyle = '#06b6d4'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(pts[0].x, pts[0].y)
  for(let i=1;i<pts.length;i++){ctx.lineTo(pts[i].x, pts[i].y)}
  ctx.stroke()
}

function makeProjection(points,w,h){
  if (!points || points.length===0) return {baseLat:-27.67,baseLng:-48.67,scale:8000,ox:80,oy:80}
  let minLat=points[0].lat,maxLat=points[0].lat,minLng=points[0].lng,maxLng=points[0].lng
  for(const p of points){minLat=Math.min(minLat,p.lat);maxLat=Math.max(maxLat,p.lat);minLng=Math.min(minLng,p.lng);maxLng=Math.max(maxLng,p.lng)}
  const pad = 40
  const latRange = Math.max(0.0001, maxLat-minLat)
  const lngRange = Math.max(0.0001, maxLng-minLng)
  const scaleX = (w - pad*2) / lngRange
  const scaleY = (h - pad*2) / latRange
  const scale = Math.min(scaleX, scaleY)
  const ox = pad - minLng*scale
  const oy = pad + maxLat*scale
  return {baseLat:minLat,baseLng:minLng,scale:scale,ox:ox,oy:oy}
}

function projectWith(prj,lat,lng){
  const x = lng*prj.scale + prj.ox
  const y = -lat*prj.scale + prj.oy
  return {x,y}
}

function nearestIndexLocal(points,lat,lng){
  let idx=0,best=Infinity
  for(let i=0;i<points.length;i++){const p=points[i];const d=(p.lat-lat)*(p.lat-lat)+(p.lng-lng)*(p.lng-lng);if(d<best){best=d;idx=i}}
  return idx
}

async function loadSchedule(lineId){
  const box = document.getElementById('horariosBox')
  if (!box) return
  const data = await fetch('/api/line/schedule?line='+lineId).then(r=>r.json())
  box.innerHTML = ''
  const next = document.createElement('div')
  next.className = 'badge'
  next.textContent = 'Próximo: '+data.next
  box.appendChild(next)
  data.times.forEach(t=>{
    const item = document.createElement('div')
    item.className = 'list'
    item.textContent = t
    box.appendChild(item)
  })
}

async function loadAds(){
  const box = document.getElementById('adsBox')
  if (!box) return
  const ads = await fetch('/api/ads').then(r=>r.json())
  box.innerHTML = ''
  ads.forEach(a=>{
    const card = document.createElement('div')
    card.className = 'card'
    const img = document.createElement('img')
    img.src = a.imageUrl
    img.alt = a.title
    img.style.maxWidth = '100%'
    const title = document.createElement('div')
    title.className = 'label'
    title.textContent = a.title
    const link = document.createElement('a')
    link.href = a.linkUrl
    link.textContent = 'Saiba mais'
    link.className = 'btn'
    card.appendChild(img)
    card.appendChild(title)
    card.appendChild(link)
    box.appendChild(card)
  })
}
  const formPlan = document.getElementById('formPlan')
  if (formPlan) {
    formPlan.addEventListener('submit',async e=>{
      e.preventDefault()
      const [oLat,oLng] = document.getElementById('planOrig').value.split(',').map(Number)
      const [dLat,dLng] = document.getElementById('planDest').value.split(',').map(Number)
      const data = await fetch(`/api/plan?originLat=${oLat}&originLng=${oLng}&destLat=${dLat}&destLng=${dLng}`).then(r=>r.json())
      const canvas = document.getElementById('mapa')
      const ctx = canvas.getContext('2d')
      const w = canvas.width, h = canvas.height
      currentProjection = makeProjection(data.segment, w, h)
      currentPolyline = data.segment.map(p=>projectWith(currentProjection,p.lat,p.lng))
      ctx.clearRect(0,0,w,h)
      drawGrid(ctx,w,h)
      drawPolyline(ctx,currentPolyline)
      document.getElementById('planResultado').textContent = `Linha ${data.name} • Estimativa ${data.estimatedMinutes} min • Próximo ${data.nextDeparture}`
    })
  }
