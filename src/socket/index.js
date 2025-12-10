const { getBusById, interestedPassengers } = require('../models')

function setupSocket(io){
  io.on('connection', (socket)=>{
    socket.on('gps:update', (payload)=>{
      const { busId, lat, lng, speed, heading } = payload||{}
      const bus = getBusById(busId)
      if (!bus) return
      bus.lat = lat; bus.lng = lng; bus.speed = speed; bus.heading = heading
      io.emit('bus:update', { busId, lat, lng, speed, heading })
    })
    socket.on('ride:accepted', (data)=>{
      io.emit('ride:accepted', data)
    })
    socket.on('boarding:start', (data)=>{ io.emit('boarding:start', data) })
    socket.on('boarding:complete', (data)=>{ io.emit('boarding:complete', data) })
    socket.on('boarding:cancel', (data)=>{ io.emit('boarding:cancel', data) })
  })
}

module.exports = { setupSocket }

