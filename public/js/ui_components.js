function showDrawer(html){ const el=document.getElementById('drawer'); el.innerHTML=html; el.className='drawer show' }
function hideDrawer(){ const el=document.getElementById('drawer'); el.className='drawer' }
export { showDrawer, hideDrawer }
