// ── ARSENAL VAULT — UTILS ────────────────────────────────────────────
// Pure helper functions. No side effects, no globals modified here.

function eh(s){return(s||'').toString().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

function fm(v){return v?'$'+parseFloat(v).toLocaleString('en-US',{minimumFractionDigits:0}):'—';}

function bj(l,c){return '<span class="badge" style="background:'+c+'25;color:'+c+';border:1px solid '+c+'60">'+l+'</span>';}

function gid(){return Date.now().toString(36)+Math.random().toString(36).substr(2);}

function toast(m,t){var el=document.getElementById('toast');el.textContent=m;el.className='toast '+(t||'ok');el.style.display='block';setTimeout(function(){el.style.display='none';},3000);}

function panelWrap(key,title,html){
  var isOpen=!collapsed[key];
  return '<div class="panel">'
    +'<div class="panel-header'+(isOpen?'':' collapsed')+'" onclick="togglePanel(\''+key+'\')">'
    +'<span class="sec-title" style="margin-bottom:0">'+title+'</span>'
    +'<span class="collapse-icon'+(isOpen?' open':'')+'" id="icon_'+key+'">▾</span>'
    +'</div>'
    +'<div class="panel-content'+(isOpen?'':' collapsed')+'" id="panel_'+key+'">'+html+'</div>'
    +'</div>';
}
