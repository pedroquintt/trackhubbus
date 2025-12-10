function toRad(x){ return x*Math.PI/180 }
function distanceMeters(aLat,aLng,bLat,bLng){ const R=6371000; const dLat=toRad(bLat-aLat), dLng=toRad(bLng-aLng); const s1=Math.sin(dLat/2)**2; const s2=Math.cos(toRad(aLat))*Math.cos(toRad(bLat))*Math.sin(dLng/2)**2; const c=2*Math.atan2(Math.sqrt(s1+s2), Math.sqrt(1-(s1+s2))); return Math.round(R*c) }
function etaMinutes(distanceM, speedKmh){ const speedMs=Math.max(1,(speedKmh||30)*1000/3600); return Math.max(0,Math.round(distanceM/speedMs/60)) }
module.exports={ distanceMeters, etaMinutes }
