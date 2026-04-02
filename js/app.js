// ── ARSENAL VAULT — APP ──────────────────────────────────────────────
// Navigation, routing, back-button handling, audio, and startup IIFE.
// Depends on: state.js, utils.js, storage.js, all renderers.

function _popstateHandler(){
  if(_exiting) return;
  history.pushState({page:'app',ts:Date.now()},'',window.location.href);
  handleBack();
}

function initNavigation(){
  // Push deep history stack so Android back button fires popstate
  for(var x=0;x<8;x++) history.pushState({page:'app',n:x},'',window.location.href);
  window.addEventListener('popstate', _popstateHandler);
}

function initSwipeNav(){
  var startX=0, startY=0, startTime=0;

  document.addEventListener('touchstart', function(e){
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    startTime = Date.now();
  }, {passive:true});

  document.addEventListener('touchend', function(e){
    var dx = e.changedTouches[0].clientX - startX;
    var dy = e.changedTouches[0].clientY - startY;
    var dt = Date.now() - startTime;

    // Pull down from top = refresh current view
    if(dy > 80 && Math.abs(dx) < 40 && dt < 500 && startY < 120){
      rnd();
      toast('Refreshed');
      return;
    }

    // Only process horizontal swipes
    if(Math.abs(dx) < 40 || Math.abs(dy) > 80 || dt > 500) return;

    // Right swipe from left edge = back
    if(dx > 60 && startX < 30){
      handleBack();
      return;
    }

    // Left/right swipe for gun navigation (not from left edge)
    if(Math.abs(dx) > 80 && startX > 40){
      if(VIEW === 'pic'){
        picSwipe(dx < 0 ? 1 : -1);
      } else if(VIEW === 'add' && editId){
        var all = filtered();
        var i = all.findIndex(function(x){return x.id===editId;});
        if(i >= 0){
          var next = all[(i + (dx<0?1:-1) + all.length) % all.length];
          if(next) editGun(next.id);
        }
      }
    }
  }, {passive:true});
}

function unlockAudio(){
  if(_rackAudio) return;
  initRackSound();
  // Play silent buffer to unlock
  if(_rackAudio){
    _rackAudio.volume=0;
    _rackAudio.play().then(function(){
      _rackAudio.pause();
      _rackAudio.currentTime=0;
      _rackAudio.volume=0.8;
    }).catch(function(){});
  }
  document.removeEventListener('touchstart', unlockAudio);
  document.removeEventListener('click', unlockAudio);
}

function playRack(){
  if(!appSettings.sounds) return;
  try{
    if(!_rackAudio) initRackSound();
    if(_rackAudio){
      _rackAudio.currentTime=0;
      _rackAudio.play().catch(function(){
        _rackAudio=null;
        initRackSound();
        if(_rackAudio) setTimeout(function(){_rackAudio.play().catch(function(){});},50);
      });
    }
  }catch(e){}
}

function initRackSound(){
  if(_rackAudio) return;
  try{
    _rackAudio=new Audio('data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjYwLjE2LjEwMAAAAAAAAAAAAAAA//OAwAAAAAAAAAAAAEluZm8AAAAPAAAAFgAAEsUAFhYWFiEhISEhLCwsLDc3Nzc3QkJCQk1NTU1NWFhYWGRkZGRkb29vb3p6enp6hYWFhZCQkJCQm5ubm5umpqamsrKysrK9vb29yMjIyMjT09PT3t7e3t7p6enp9PT09PT/////AAAAAExhdmM2MC4zMQAAAAAAAAAAAAAAACQELwAAAAAAABLFf5i6nQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP/zgMQAAAADSAAAAABMQU1FMy4xMDBVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/84LEOwAAA0gAAAAAVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/zgsQ7AAADSAAAAABVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//OCxDsAAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/84LEOwAAA0gAAAAAVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/zgsQ7AAADSAAAAABVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//OCxDsAAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/84LEOwAAA0gAAAAAVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/zgsQ7AAADSAAAAABVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//OCxDsAAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/84LEOwAAA0gAAAAAVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/zgsQ7AAADSAAAAABVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//OCxDsAAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/84LEOwAAA0gAAAAAVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/zgsQ7AAADSAAAAABVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//OCxDsAAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/84LEOwAAA0gAAAAAVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/zgsQ7AAADSAAAAABVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//OCxDsAAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/84LEOwAAA0gAAAAAVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/zgsQ7AAADSAAAAABVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//OCxDsAAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVU=');
    _rackAudio.volume=0.8;
    _rackAudio.load();
  }catch(e){}
}

function go(v){
  if(v==='add'){FORM=ef();editId=null;aiVal=null;aiDiag=null;playRack();}
  if(v==='pic'&&!picGunId&&guns.length){picGunId=guns[0].id;}
  history.pushState({page:v,ts:Date.now()},"",window.location.href);history.pushState({page:v,ts:Date.now()},"",window.location.href);history.pushState({page:v,ts:Date.now()},"",window.location.href);VIEW=v;rnd();
}

function handleBack(){
  // Close any open modals first
  var modals=['qr_modal','label_modal','settings_modal','print_menu',
    'unsaved_modal','exit_modal','identifier_modal','nfc_modal',
    'bulk_modal','import_modal','pin_forgot_modal'];
  for(var i=0;i<modals.length;i++){
    var m=document.getElementById(modals[i]);
    if(m){
      m.remove();
      history.pushState({page:'app'},'',window.location.href);
      return;
    }
  }

  // Close hamburger if open
  if(hamOpen){
    closeHam();
    history.pushState({page:'app'},'',window.location.href);
    return;
  }

  // Unsaved changes on edit form
  if(VIEW==='add' && editId && _hasUnsavedChanges()){
    showUnsavedWarning();
    history.pushState({page:'app'},'',window.location.href);
    return;
  }

  // If on dashboard → show exit confirm
  if(VIEW==='dashboard'){
    showExitConfirm();
    history.pushState({page:'app'},'',window.location.href);
    return;
  }

  // Any other page → go to dashboard
  history.pushState({page:'app'},'',window.location.href);
  haptic('light');
  go('dashboard');
}

function showExitConfirm(){
  var existing=document.getElementById('exit_modal');
  if(existing) existing.remove();

  var modal=document.createElement('div');
  modal.id='exit_modal';
  modal.style.cssText='position:fixed;inset:0;background:#000000cc;z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
  modal.innerHTML='<div style="background:#222835;border:2px solid #3a4455;border-radius:12px;padding:28px;max-width:300px;width:100%;text-align:center">'
    +'<div style="font-size:28px;margin-bottom:12px">&#8962;</div>'
    +'<div style="font-size:16px;font-weight:700;color:#e8c46a;margin-bottom:8px">Exit Arsenal Vault?</div>'
    +'<div style="font-size:13px;color:#8a95a8;margin-bottom:24px">Your data is saved.</div>'
    +'<div style="display:flex;gap:10px">'
      +'<button onclick="document.getElementById(\'exit_modal\').remove()" style="flex:1;background:#1a1d24;border:1px solid #3a4455;color:#f0f2f5;padding:13px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit">Stay</button>'
      +'<button onclick="doExitApp()" style="flex:1;background:#ff707020;border:2px solid #ff707060;color:#ff7070;padding:13px;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">Exit</button>'
    +'</div>'
    +'</div>';
  modal.onclick=function(e){if(e.target===modal)modal.remove();};
  document.body.appendChild(modal);
  haptic('light');
}

function doExitApp(){
  _exiting = true;
  var m = document.getElementById('exit_modal');
  if(m) m.remove();
  // Remove popstate listener so Android handles back naturally
  window.removeEventListener('popstate', _popstateHandler);
  // Go back through all our pushed states so Android exits
  history.go(-history.length);
}

function showUnsavedWarning(){
  var modal=document.createElement('div');
  modal.id='unsaved_modal';
  modal.style.cssText='position:fixed;inset:0;background:#000000cc;z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
  modal.innerHTML='<div style="background:#222835;border:2px solid #ffd06060;border-radius:12px;padding:24px;max-width:320px;width:100%;text-align:center">'
    +'<div style="font-size:28px;margin-bottom:12px">⚠</div>'
    +'<div style="font-size:16px;font-weight:700;color:#ffd060;margin-bottom:8px">Unsaved Changes</div>'
    +'<div style="font-size:13px;color:#8a95a8;margin-bottom:22px;line-height:1.6">You have unsaved changes to this firearm.<br>What would you like to do?</div>'
    +'<div style="display:flex;flex-direction:column;gap:8px">'
      +'<button onclick="document.getElementById(\'unsaved_modal\').remove();doSave()" style="background:#60e880;color:#1a1d24;border:none;padding:13px;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">💾 Save Changes</button>'
      +'<button onclick="document.getElementById(\'unsaved_modal\').remove();FORM=editId?Object.assign({},guns.find(function(x){return x.id===editId;})):ef();editId=null;go(\'dashboard\')" style="background:#1a1d24;border:2px solid #ff707060;color:#ff7070;padding:13px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit">Discard Changes</button>'
      +'<button onclick="document.getElementById(\'unsaved_modal\').remove()" style="background:transparent;border:1px solid #3a4455;color:#8a95a8;padding:10px;border-radius:8px;font-size:13px;cursor:pointer;font-family:inherit">Cancel — Keep Editing</button>'
    +'</div>'
    +'</div>';
  modal.onclick=function(e){if(e.target===modal)modal.remove();};
  document.body.appendChild(modal);
  haptic('error');
}

function _hasUnsavedChanges(){
  // Compare current form state to saved gun
  if(!editId) return false;
  var g=guns.find(function(x){return x.id===editId;});
  if(!g) return false;
  // Quick check on key fields
  var fmake=document.getElementById('f_make');
  var fmodel=document.getElementById('f_model');
  if(fmake && fmake.value !== g.make) return true;
  if(fmodel && fmodel.value !== g.model) return true;
  return false;
}

function rnd(){
  var nav=document.getElementById('nav');
  nav.innerHTML='<div style="grid-column:1/2">'+rCollDropdown()+'</div>'+'<button class="nav-btn'+(VIEW==="dashboard"?' active':'')+'" onclick="go(\'dashboard\')" style="grid-column:2/3">&#9632; Dashboard</button>'+'<button class="nav-btn'+(VIEW==="pic"?' active':'')+'" onclick="go(\'pic\')" style="grid-column:3/4">&#128247; View</button>'+'<button class="nav-btn'+(VIEW==="reports"?' active':'')+'" onclick="go(\'reports\')" style="grid-column:1/2">&#128202; Reports</button>'+'<button class="nav-btn'+(VIEW==="list"?' active':'')+'" onclick="go(\'list\')" style="grid-column:2/3">Inventory</button>'+'<button class="nav-btn'+(VIEW==="add"?' active':'')+'" onclick="go(\'add\')" style="grid-column:3/4">+ Add</button>';
  if(VIEW==='dashboard')app.innerHTML=rDash();
  else if(VIEW==='list')app.innerHTML=rList();
  else if(VIEW==='add')app.innerHTML=rAdd();
  else if(VIEW==='detail')app.innerHTML=rDet();
  else if(VIEW==='reports')app.innerHTML=rReports();
  else if(VIEW==='pic')app.innerHTML=rPicturePage();
  buildHamMenu();
  document.getElementById('photoIn').onchange=onPhoto;
  document.getElementById('schIn').onchange=onSch;
  var imp=document.getElementById('importIn');if(imp)imp.onchange=restoreData;
}


