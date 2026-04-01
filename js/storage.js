// ── ARSENAL VAULT — STORAGE ──────────────────────────────────────────
// IndexedDB, localStorage fallback, backup, import, settings,
// collections, milestones, transferred guns.
// Depends on: state.js (globals), utils.js (toast)

var _db=null;
var DB_NAME='ArsenalVaultDB';
var DB_VERSION=1;
var STORE='firearms';

function openDB(cb){
  if(_db){cb(_db);return;}
  var req=indexedDB.open(DB_NAME,DB_VERSION);
  req.onupgradeneeded=function(e){
    var db=e.target.result;
    if(!db.objectStoreNames.contains(STORE)){
      db.createObjectStore(STORE,{keyPath:'id'});
    }
    if(!db.objectStoreNames.contains('meta')){
      db.createObjectStore('meta');
    }
  };
  req.onsuccess=function(e){_db=e.target.result;cb(_db);};
  req.onerror=function(){
    // IndexedDB failed - fall back to localStorage
    cb(null);
  };
}

function sv(){
  saveGunsToCollection(activeCollection);
  var data=guns;
  // Always keep in-memory backup
  window._gunBackup=JSON.stringify(data);
  // Try IndexedDB first
  openDB(function(db){
    if(db){
      try{
        var tx=db.transaction([STORE],'readwrite');
        var store=tx.objectStore(STORE);
        store.clear();
        data.forEach(function(g){store.put(g);});
        tx.oncomplete=function(){
          var ind=document.getElementById('save_ind');
          if(ind){ind.style.display='inline';setTimeout(function(){ind.style.display='none';},2000);}
        };
        tx.onerror=function(){svFallback(data);};
      }catch(e){svFallback(data);}
    } else {
      svFallback(data);
    }
  });
  // Also save meta
  openDB(function(db){
    if(db){
      try{
        var tx=db.transaction(['meta'],'readwrite');
        tx.objectStore('meta').put(customPrices,'customPrices');
        tx.objectStore('meta').put(priceLastUpdated||'','priceLastUpdated');
      }catch(e){}
    }
  });
}

function svFallback(data){
  var str=JSON.stringify(data);
  try{localStorage.setItem(SK,str);}catch(e){}
  try{sessionStorage.setItem(SK,str);}catch(e){}
  var ind=document.getElementById('save_ind');
  if(ind){ind.style.display='inline';setTimeout(function(){ind.style.display='none';},2000);}
}

function ld(){
  // Try IndexedDB first
  openDB(function(db){
    if(db){
      try{
        var tx=db.transaction([STORE],'readonly');
        var store=tx.objectStore(STORE);
        var req=store.getAll();
        req.onsuccess=function(e){
          var result=e.target.result;
          if(result&&result.length>0){
            guns=result;
          } else {
            // Nothing in IndexedDB - try localStorage migration
            ldFallback();
          }
          loadMetaFromDB(db);
          rnd();
        };
        req.onerror=function(){ldFallback();rnd();};
      }catch(e){ldFallback();rnd();}
    } else {
      ldFallback();
      rnd();
    }
  });
}

function ldFallback(){
  var s=null;
  try{s=localStorage.getItem(SK);}catch(e){}
  if(!s){try{s=sessionStorage.getItem(SK);}catch(e){}}
  if(!s&&window._gunBackup){s=window._gunBackup;}
  if(s){
    try{
      var parsed=JSON.parse(s);
      if(parsed&&parsed.length>0){
        guns=parsed;
        // Migrate to IndexedDB
        sv();
      }
    }catch(e){guns=[];}
  }
}

function loadMetaFromDB(db){
  try{
    var tx=db.transaction(['meta'],'readonly');
    var store=tx.objectStore('meta');
    var r1=store.get('customPrices');
    r1.onsuccess=function(e){if(e.target.result)customPrices=e.target.result;};
  }catch(e){}
}

function backupData(){
  var collName=collections[activeCollection]?collections[activeCollection].name:'My Collection';
  var data={guns:guns,customPrices:customPrices,version:SK,exported:new Date().toISOString(),collectionName:collName};
  var blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  var url=URL.createObjectURL(blob);
  var a=document.createElement('a');
  a.href=url;
  a.download='arsenal_vault_'+collName.replace(/[^a-z0-9]/gi,'_')+'_'+new Date().toISOString().split('T')[0]+'.json';
  a.click();
  URL.revokeObjectURL(url);
  toast('Backup saved to Downloads');
}

function restoreData(e){
  var file=e.target.files[0];if(!file)return;
  var reader=new FileReader();
  reader.onload=function(ev){
    try{
      var data=JSON.parse(ev.target.result);
      if(!data.guns||!Array.isArray(data.guns)){
        toast('Invalid backup file','err');
        return;
      }

      var count=data.guns.length;

      // Ask how to import
      var modal=document.createElement('div');
      modal.id='import_modal';
      modal.style.cssText='position:fixed;inset:0;background:#000000cc;z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
      modal.innerHTML='<div style="background:#222835;border:2px solid #e8c46a40;border-radius:12px;padding:24px;max-width:340px;width:100%">'
        +'<div style="font-size:16px;font-weight:700;color:#e8c46a;margin-bottom:6px">&#128194; Import Backup</div>'
        +'<div style="font-size:13px;color:#8a95a8;margin-bottom:18px">Found '+count+' firearm'+(count!==1?'s':'')+' in this backup file.</div>'
        +'<div style="margin-bottom:14px">'
          +'<div style="font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#8a95a8;font-weight:600;margin-bottom:6px">Collection Name</div>'
          +'<input id="import_name" type="text" placeholder="e.g. John\'s Collection" value="'+(data.collectionName||'Imported Collection')+'" style="width:100%;background:#13161d;border:2px solid #3a4455;border-radius:6px;color:#f0f2f5;padding:11px 12px;font-size:14px;outline:none;font-family:inherit"/>'
        +'</div>'
        +'<div style="background:#1a1d24;border:1px solid #2e3545;border-radius:8px;padding:12px;margin-bottom:16px">'
          +'<div style="font-size:12px;color:#8a95a8;margin-bottom:8px">Import as:</div>'
          +'<label style="display:flex;align-items:center;gap:10px;cursor:pointer;margin-bottom:8px">'
            +'<input type="radio" name="import_mode" value="new" checked style="accent-color:#e8c46a;width:16px;height:16px"/>'
            +'<div><div style="font-size:13px;font-weight:600;color:#f0f2f5">New Collection</div><div style="font-size:11px;color:#4a5568">Creates a separate collection — your data is safe</div></div>'
          +'</label>'
          +'<label style="display:flex;align-items:center;gap:10px;cursor:pointer">'
            +'<input type="radio" name="import_mode" value="replace" style="accent-color:#ff7070;width:16px;height:16px"/>'
            +'<div><div style="font-size:13px;font-weight:600;color:#ff7070">Replace Current Collection</div><div style="font-size:11px;color:#4a5568">Overwrites "'+( collections[activeCollection]?collections[activeCollection].name:'current')+'" — cannot be undone</div></div>'
          +'</label>'
        +'</div>'
        +'<div style="display:flex;flex-direction:column;gap:8px">'
          +'<button onclick="doImport('+JSON.stringify(data).replace(/'/g,"&#39;")+')" style="background:#e8c46a;color:#1a1d24;border:none;padding:13px;border-radius:8px;font-size:14px;font-weight:800;cursor:pointer;font-family:inherit">Import</button>'
          +'<button onclick="document.getElementById(\'import_modal\').remove()" style="background:transparent;border:1px solid #3a4455;color:#8a95a8;padding:10px;border-radius:8px;font-size:13px;cursor:pointer;font-family:inherit">Cancel</button>'
        +'</div>'
        +'</div>';
      modal.onclick=function(e){if(e.target===modal)modal.remove();};
      document.body.appendChild(modal);

    }catch(ex){toast('Could not read backup file','err');}
  };
  reader.readAsText(file);
  e.target.value='';
}

function doImport(data){
  var nameEl=document.getElementById('import_name');
  var modeEl=document.querySelector('input[name="import_mode"]:checked');
  var name=nameEl?nameEl.value.trim():'Imported Collection';
  var mode=modeEl?modeEl.value:'new';

  if(!name) name='Imported Collection';

  var m=document.getElementById('import_modal');
  if(m) m.remove();

  if(mode==='new'){
    // Create new collection
    var id='coll_'+Date.now().toString(36);
    collections[id]={name:name,created:new Date().toISOString()};
    saveCollections();

    // Save current collection first
    saveGunsToCollection(activeCollection);

    // Switch to new collection with imported guns
    activeCollection=id;
    try{localStorage.setItem('av_active_coll',id);}catch(e){}
    guns=data.guns;
    if(data.customPrices) customPrices=data.customPrices;
    sv();
    milestones={};totalCleanings=0;transferredGuns=[];
    loadMilestones();loadTransferred();
    haptic('save');
    toast('Imported '+guns.length+' firearms into "'+name+'"');
    VIEW='dashboard';
    rnd();
  } else {
    // Replace current collection
    if(!confirm('Replace all firearms in "'+collections[activeCollection].name+'" with '+data.guns.length+' firearms from backup? This cannot be undone.')) return;
    guns=data.guns;
    if(data.customPrices) customPrices=data.customPrices;
    sv();
    haptic('save');
    toast('Restored '+guns.length+' firearms');
    VIEW='dashboard';
    rnd();
  }
}

function clearAllData(){
  if(!confirm('Delete ALL firearms from inventory? This cannot be undone.\n\nTip: tap Backup first to save your data.'))return;
  guns=[];
  // Clear IndexedDB
  openDB(function(db){
    if(db){
      try{
        var tx=db.transaction([STORE],'readwrite');
        tx.objectStore(STORE).clear();
      }catch(e){}
    }
  });
  // Clear localStorage too
  try{localStorage.removeItem(SK);}catch(e){}
  try{sessionStorage.removeItem(SK);}catch(e){}
  window._gunBackup=null;
  haptic('delete');toast('All data cleared');
  rnd();
}

function loadSettings(){
  try{
    var s=localStorage.getItem('av_settings');
    if(s) appSettings=Object.assign(appSettings,JSON.parse(s));
  }catch(e){}
}

function saveSettings(){
  try{localStorage.setItem('av_settings',JSON.stringify(appSettings));}catch(e){}
}

function loadCollections(){
  try{
    var s=localStorage.getItem('av_collections');
    if(s){
      collections=JSON.parse(s);
    }
  }catch(e){}

  // Ensure default collection exists
  if(!collections['default']){
    collections['default']={
      name:'My Collection',
      created:new Date().toISOString()
    };
    saveCollections();
  }

  // Migrate existing guns into default collection if not already done
  var migrated=localStorage.getItem('av_coll_migrated');
  if(!migrated){
    localStorage.setItem('av_coll_migrated','1');
    // guns array already loaded by ld() - they belong to default collection
  }

  // Load active collection preference
  try{
    var ac=localStorage.getItem('av_active_coll');
    if(ac&&collections[ac]) activeCollection=ac;
    else activeCollection='default';
  }catch(e){activeCollection='default';}
}

function saveCollections(){
  try{localStorage.setItem('av_collections',JSON.stringify(collections));}catch(e){}
}

function saveGunsToCollection(collId){
  var data=JSON.stringify(guns);
  try{localStorage.setItem(getCollKey(collId),data);}catch(e){}
  try{sessionStorage.setItem(getCollKey(collId),data);}catch(e){}
  // Also save to IndexedDB with collection prefix
  openDB(function(db){
    if(!db)return;
    try{
      var tx=db.transaction(['meta'],'readwrite');
      tx.objectStore('meta').put(guns,'guns_'+collId);
    }catch(e){}
  });
}

function loadGunsFromCollection(collId){
  // Try IndexedDB first
  openDB(function(db){
    if(db){
      try{
        var tx=db.transaction(['meta'],'readonly');
        var req=tx.objectStore('meta').get('guns_'+collId);
        req.onsuccess=function(e){
          if(e.target.result&&e.target.result.length>0){
            guns=e.target.result;
          } else {
            // Try localStorage
            var s=localStorage.getItem(getCollKey(collId));
            if(s){try{guns=JSON.parse(s);}catch(ex){guns=[];}}
            else guns=[];
          }
          rnd();
        };
        req.onerror=function(){
          var s=localStorage.getItem(getCollKey(collId));
          if(s){try{guns=JSON.parse(s);}catch(ex){guns=[];}}
          else guns=[];
          rnd();
        };
      }catch(e){guns=[];rnd();}
    } else {
      var s=localStorage.getItem(getCollKey(collId));
      if(s){try{guns=JSON.parse(s);}catch(ex){guns=[];}}
      else guns=[];
      rnd();
    }
  });
}

function loadMilestones(){
  try{
    var m=localStorage.getItem('av_milestones');
    if(m) milestones=JSON.parse(m);
    var c=localStorage.getItem('av_cleanings');
    if(c) totalCleanings=parseInt(c)||0;
  }catch(e){}
}

function saveMilestones(){
  try{
    localStorage.setItem('av_milestones',JSON.stringify(milestones));
    localStorage.setItem('av_cleanings',String(totalCleanings));
  }catch(e){}
}

function loadTransferred(){
  try{
    var s=localStorage.getItem('av_transferred');
    if(s) transferredGuns=JSON.parse(s);
  }catch(e){}
}

function saveTransferred(){
  try{localStorage.setItem('av_transferred',JSON.stringify(transferredGuns));}catch(e){}
  openDB(function(db){
    if(!db)return;
    try{
      var tx=db.transaction(['meta'],'readwrite');
      tx.objectStore('meta').put(transferredGuns,'transferredGuns');
    }catch(e){}
  });
}

function loadCustomPrices(){
  try{var cp=localStorage.getItem('av_custom_prices');if(cp)customPrices=JSON.parse(cp);}catch(e){}
  try{}catch(e){}
}
