const { createRide, getRideById, updateRideStatus, getBusById, stops, audit } = require('../models')
const { distanceMeters, etaMinutes } = require('../utils/geo')
const crypto=require('crypto')

function request({ passengerId, busId, stopId }){
  const id='r_'+Math.random().toString(36).slice(2,8)
  const stop = stops.find(s=>s.id===stopId)||stops[0]
  const r={ id, passengerId, busId, stopId:stop.id, status:'pending', createdAt:Date.now(), updatedAt:Date.now(), qr:null }
  createRide(r)
  audit('ride_request','received',r)
  return r
}

function decide(r){
  const b=getBusById(r.busId); if(!b) { updateRideStatus(r.id,'rejected'); audit('autopilot','bus_not_found',r); return { decision:'rejected', reason:'bus_not_found' } }
  const stop=stops.find(s=>s.id===r.stopId)||stops[0]
  const d=distanceMeters(b.lat,b.lng,stop.lat,stop.lng)
  const occ=b.occupancy
  const maxOcc=Number(process.env.MAX_OCC||0.9)
  const maxDist=Number(process.env.MAX_DIST||2000)
  if (occ>=maxOcc){ updateRideStatus(r.id,'rejected'); audit('autopilot','high_occupancy',{rideId:r.id,occ}); return { decision:'rejected', reason:'high_occupancy' } }
  if (d>maxDist){ updateRideStatus(r.id,'rejected'); audit('autopilot','too_far',{rideId:r.id,d}); return { decision:'rejected', reason:'too_far' } }
  updateRideStatus(r.id,'accepted')
  const eta=etaMinutes(d,Math.max(10,b.speed))
  audit('autopilot','accepted',{rideId:r.id,eta})
  return { decision:'accepted', eta }
}

function generateQr(rideId){ const r=getRideById(rideId); if(!r||r.status!=='accepted') return null; const token=crypto.randomBytes(16).toString('hex'); const hash=crypto.createHash('sha256').update(token).digest('hex'); const expires=Date.now()+90*1000; r.qr={ id:'qr_'+Math.random().toString(36).slice(2,6), hash, expires }; audit('qr_generate','accepted',{rideId}); return r.qr }
function validateQr({ rideId, hash }){ const r=getRideById(rideId); if(!r||!r.qr) return false; if(Date.now()>r.qr.expires) { audit('qr_validate','expired',{rideId}); return false } const ok=r.qr.hash===hash; if(ok){ updateRideStatus(rideId,'complete'); audit('boarding_complete','qr_ok',{rideId}) } else { audit('qr_validate','hash_mismatch',{rideId}) } return ok }

module.exports={ request, decide, generateQr, validateQr }
