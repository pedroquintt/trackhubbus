const { buses, getBusById } = require('../models')
function list(){ return buses.map(b=>({ id:b.id, line:b.line, plate:b.plate, lat:b.lat, lng:b.lng, status:'on_route', occupancy:b.occupancy })) }
function details(id){ const b=getBusById(id); if(!b) return null; return { id:b.id, line:b.line, plate:b.plate, lat:b.lat, lng:b.lng, status:'on_route', occupancy:b.occupancy } }
module.exports={ list, details }
