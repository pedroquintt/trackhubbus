const passengers=[]
const buses=[]
const rideRequests=[]
const stops=[
  { id:'stop_1', name:'Centro Florianópolis', lat:-27.595, lng:-48.548 },
  { id:'stop_2', name:'Centro Palhoça', lat:-27.613, lng:-48.655 },
  { id:'stop_3', name:'Via Expressa', lat:-27.620, lng:-48.580 }
]
const otpStore=new Map()
const audits=[]

function seed(){
  if (buses.length>0) return
  buses.push(
    { id:'bus_101', line:'Palhoça → Florianópolis', plate:'ABC-1234', lat:-27.613, lng:-48.655, speed:0, heading:0, lastUpdate:Date.now(), occupancy:0.2 },
    { id:'bus_102', line:'Florianópolis → Palhoça', plate:'DEF-5678', lat:-27.595, lng:-48.548, speed:0, heading:0, lastUpdate:Date.now(), occupancy:0.3 }
  )
}

function addPassenger(p){ passengers.push(p); return p }
function findPassengerByPhone(phone){ return passengers.find(x=>x.phone===phone) }
function getBusById(id){ return buses.find(b=>b.id===id) }
function updateBusPosition(busId,lat,lng,speed,heading){ let b=getBusById(busId); if(!b){ b={ id:String(busId), line:null, plate:null, lat:lat, lng:lng, speed:speed||0, heading:heading||0, lastUpdate:Date.now(), occupancy:0.3 }; buses.push(b) } else { b.lat=lat; b.lng=lng; b.speed=speed; b.heading=heading; b.lastUpdate=Date.now() } return b }
function createRide(r){ rideRequests.push(r); return r }
function getRideById(id){ return rideRequests.find(r=>r.id===id) }
function updateRideStatus(id,status){ const r=getRideById(id); if(!r) return null; r.status=status; r.updatedAt=Date.now(); return r }
function audit(action, reason, payload){ const a={ id:'a_'+Math.random().toString(36).slice(2,8), action, reason, payload, ts:Date.now(), actor:'system' }; audits.push(a); return a }

module.exports={ passengers,buses,rideRequests,stops,otpStore,audits,seed,addPassenger,findPassengerByPhone,getBusById,updateBusPosition,createRide,getRideById,updateRideStatus,audit }
