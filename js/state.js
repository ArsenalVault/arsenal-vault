// ── ARSENAL VAULT — STATE ────────────────────────────────────────────
// All runtime globals. No rendering, no storage logic here.

var SK='arsenal_v6';
var CONDITIONS=['Excellent','Good','Fair','Poor','Needs Repair'];
var CC={Excellent:'#60e880',Good:'#a0e0a0',Fair:'#ffd060',Poor:'#ff9040','Needs Repair':'#ff7070'};
var CALIBERS=['.22 LR','.22 WMR','.223 Rem','.243 Win','.270 Win','.30-06 Springfield','.308 Win','.30-30 Win','.338 Lapua','.357 Mag','.38 Special','.380 ACP','.40 S&W','.44 Mag','.45 ACP','.45 Colt','.50 BMG','5.56 NATO','6.5 Creedmoor','7.62x39mm','7.62x51mm','9mm Luger','10mm Auto','12 Gauge','20 Gauge','.410 Bore','Other'];
var TYPES=['Pistol','Revolver','Rifle','Shotgun','Carbine','Suppressor','Other'];

var guns=[];
var VIEW='dashboard';
var selId=null;
var editId=null;
var FORM=ef();
var srch='';
var fCond='All';
var fWork='All';
var fType='All';
var srtBy='make';
var dTab='info';
var scTab='dis';
var SCH=null;
var scLoad=false;
var aiVal=null;
var aiLoad=null;
var aiDiag=null;
var yrLoad=false;
var yrResult=null;
var activeCollection='default';
var collections={};
var collMenuOpen=false;
var quickAdd=false;
var transferredGuns=[];
var editingCustodyId=null;
var showCustodyForm=false;
var reportTab='worth';
var maintSort='overdue';
var collapsed={photo:false,basic:false,condition:false,value:true,extra:true,custody:true};
var lbPhotos=[];
var qrSize=260;
var lbIdx=0;
var priceUpdating=false;


function ef(){return{make:'',model:'',type:'',caliber:'',serialNumber:'',year:'',purchasePrice:'',currentValue:'',condition:'Good',working:true,repairNotes:'',maintenanceLog:'',photo:'',photos:[],storageLocation:'',ammoType:'',ammoCount:'',ammoLocation:'',insuranceValue:'',lastCleaned:'',starred:false,custody:[]};}
