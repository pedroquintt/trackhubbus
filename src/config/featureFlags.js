function flag(name, def){ const v = process.env[name]; if (v===undefined) return def; return v==='true' || v==='1' }
const values = {
  ENABLE_SIMULATOR: flag('ENABLE_SIMULATOR', true),
  ENABLE_AUTOPILOT: flag('ENABLE_AUTOPILOT', true),
  ENABLE_EXTERNAL_COMM: flag('ENABLE_EXTERNAL_COMM', false),
  ENABLE_AUTOBOARDING: flag('ENABLE_AUTOBOARDING', true),
  SEED_ON_FIRST_START: flag('SEED_ON_FIRST_START', true)
}
const overrides = {}
function get(name){ return Object.prototype.hasOwnProperty.call(overrides,name) ? !!overrides[name] : !!values[name] }
function set(name, value){ if (Object.prototype.hasOwnProperty.call(values,name)) overrides[name] = !!value }
module.exports = { ...values, get, set }
