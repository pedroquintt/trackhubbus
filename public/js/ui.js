function setStatus(t){ const el=document.getElementById('status'); if(el) el.textContent=t }
function showDrawer(html){ const el=document.getElementById('drawer'); el.innerHTML=html; el.className='drawer show' }
function hideDrawer(){ const el=document.getElementById('drawer'); el.className='drawer' }
export { setStatus, showDrawer, hideDrawer }
