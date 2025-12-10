const request = require('supertest')

describe('Autopilot e QR', () => {
  beforeAll(()=>{
    process.env.ENABLE_AUTOPILOT = 'true'
    process.env.ENABLE_AUTOBOARDING = 'false'
    process.env.MAX_DIST = '100000'
  })

  test('aceita ride request e reflete em metrics', async () => {
    const res1 = await request('http://localhost:3001').post('/api/ride/request').send({ passengerId:'p1', busId:1, stopId:'stop_1' })
    expect(res1.status).toBe(200)
    expect(res1.body).toHaveProperty('id')
    expect(['accepted','pending','rejected']).toContain(res1.body.status)
    const res2 = await request('http://localhost:3001').get('/metrics')
    expect(res2.status).toBe(200)
    expect(res2.body).toHaveProperty('rides_total')
  })

  test('QR expira após alteração manual de expires', async () => {
    const rideSvc = require('../src/services/ride')
    const models = require('../src/models')
    models.seed()
    const r = rideSvc.request({ passengerId:'p2', busId:'bus_101', stopId:'stop_1' })
    const d = rideSvc.decide(r)
    expect(d.decision).toBe('accepted')
    const qr = rideSvc.generateQr(r.id)
    expect(qr).toBeTruthy()
    const rideObj = models.getRideById(r.id)
    rideObj.qr.expires = Date.now()-1
    const ok = rideSvc.validateQr({ rideId:r.id, hash: rideObj.qr.hash })
    expect(ok).toBe(false)
  })
})
