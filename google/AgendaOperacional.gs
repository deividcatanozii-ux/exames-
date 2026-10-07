/** Agenda exclusiva da planilha configurada. Datas, profissionais e horários vêm das abas. */
function agendaDigest(value, key) {
  const bytes = key ? Utilities.computeHmacSha256Signature(value,key) : Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,value);
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/,'');
}

function agendaData(value, zone, year) {
  if (value instanceof Date && !isNaN(value.valueOf())) return Utilities.formatDate(value,zone,'yyyy-MM-dd');
  const text=String(value || ''),match=text.match(/(?:^|\D)(\d{1,2})\s*[\/.-]\s*(\d{1,2})(?!\d)/);
  if (!match) return null;
  let explicitYear=null;
  const suffix=text.slice(match.index+match[0].length);
  if(/^\s*[\/.-]/.test(suffix)){
    const yearMatch=suffix.match(/^\s*[\/.-]\s*(\d{4})(?=$|\s)/);
    if(!yearMatch)return null;
    explicitYear=yearMatch[1];
  }
  const y=Number(explicitYear || year),m=Number(match[2]),d=Number(match[1]);
  if (!Number.isInteger(y) || y<1900 || y>9999 || m<1 || m>12 || d<1 || d>31) return null;
  const checked=new Date(Date.UTC(y,m-1,d));
  if(checked.getUTCFullYear()!==y || checked.getUTCMonth()!==m-1 || checked.getUTCDate()!==d)return null;
  return String(y)+'-'+String(m).padStart(2,'0')+'-'+String(d).padStart(2,'0');
}

function agendaProfissional(title) {
  const text=String(title || '').trim(),date=text.match(/\d{1,2}\s*[\/.-]\s*\d{1,2}(?:\s*[\/.-]\s*\d{4})?(?!\d)/);
  if(!date)return null;
  const name=text.slice(0,date.index).replace(/[\s|:_-]+$/g,'').replace(/\s+/g,' ').trim();
  if(!name || name.length>100 || !/[A-Za-zÀ-ÿ]/.test(name) || /[\x00-\x1f<>@=+\d]/.test(name))return null;
  return name;
}

function agendaHorario(value, zone) {
  if(value instanceof Date && !isNaN(value.valueOf()))return Utilities.formatDate(value,zone,'HH:mm');
  if(typeof value==='number' && value>=0 && value<1){const minutes=Math.round(value*24*60);if(minutes<1440)return String(Math.floor(minutes/60)).padStart(2,'0')+':'+String(minutes%60).padStart(2,'0');}
  const match=String(value || '').trim().match(/^(\d{1,2})\s*(?:h|:)\s*(\d{2})(?:\s*:\s*00)?$/i);
  if(!match || Number(match[1])>23 || Number(match[2])>59)return null;
  return String(Number(match[1])).padStart(2,'0')+':'+match[2];
}

function agendaExame(value) {
  const text=String(value || '').trim();
  if(!text || text.length>100 || /[\x00-\x1f\x7f<>]/.test(text) || /^[=+\-@]/.test(text))return null;
  return text;
}

function agendaExameCatalogo(value,row,columns) {
  const text=agendaExame(value);
  if(!text || !/[A-Za-zÀ-ÿ]/.test(text) || /[@=]/.test(text) || /(?:[a-z][a-z0-9+.-]*:\/\/|www\.|[a-z0-9-]+\.(?:com|net|org|gov|edu|br)\b)/i.test(text))return null;
  if(text.replace(/[^0-9]/g,'').length>=8)return null;
  if(/\b(BLOQUEAD[OA]|INDISPONIVEL|RESERVAD[OA]|CANCELAD[OA]|FECHAD[OA]|INTERVALO|ALMOCO|ENCAIXE)\b/.test(centralNormalizar(text)))return null;
  const normalized=' '+centralNormalizar(text).replace(/[^A-Z0-9]+/g,' ').trim()+' ';
  // Uma célula USG preenchida incorretamente com dados do paciente não entra no catálogo público.
  if(['NOME','CPF','TELEFONE'].some(function(k){
    const privateValue=row[columns.map[k]];
    if(privateValue===null || privateValue===undefined)return false;
    const personal=centralNormalizar(privateValue).replace(/[^A-Z0-9]+/g,' ').trim();
    return personal.length>=2 && normalized.indexOf(' '+personal+' ')!==-1;
  }))return null;
  return text;
}

function agendaMapa(row) {
  const map={},duplicate=[];
  row.forEach(function(value,index){const label=centralNormalizar(value);if(label){if(label in map)duplicate.push(label);else map[label]=index;}});
  if(duplicate.some(function(k){return ['HORARIO','HORARIOS','HORA','CPF','NOME','TELEFONE','USG','PG','VALOR'].indexOf(k)!==-1;}))return null;
  const time='HORARIO' in map ? map.HORARIO : ('HORARIOS' in map ? map.HORARIOS : ('HORA' in map ? map.HORA : null));
  if(time===null || !['CPF','NOME','TELEFONE','USG'].every(function(k){return k in map;}))return null;
  const writable=['CPF','NOME','TELEFONE','USG'].map(function(k){return map[k];}).sort(function(a,b){return a-b;});
  return {time:time,map:map,start:writable[0],ready:writable[3]-writable[0]===3,
    signature:JSON.stringify(['HORARIO','CPF','NOME','TELEFONE','USG','PG','VALOR'].map(function(k){return [k,k==='HORARIO'?time:(k in map?map[k]:null)];}))};
}

function agendaOcupada(row, columns) {
  return ['CPF','NOME','TELEFONE'].some(function(k){const value=row[columns.map[k]];return value!==null && value!==undefined && String(value).trim()!=='';}) ||
    row.some(function(value){return /\b(BLOQUEAD[OA]|INDISPONIVEL|RESERVAD[OA]|CANCELAD[OA]|FECHAD[OA]|INTERVALO|ALMOCO|ENCAIXE)\b/.test(centralNormalizar(value));});
}

function agendaLerFonte(ss, year, key) {
  const zone=ss.getSpreadsheetTimeZone(),records=[],doctors=[],tables=[],catalog={};
  let unidentifiedBlocks=0;
  ss.getSheets().forEach(function(sheet){
    const doctor=agendaProfissional(sheet.getName()),date=agendaData(sheet.getName(),zone,year);
    if(!doctor || !date)return;
    const sheetId=sheet.getSheetId(),input=sheet.getDataRange().getValues();
    let columns=null,headerRow=null,identified=false;
    input.forEach(function(row,index){
      const candidate=agendaMapa(row);
      if(candidate){columns=candidate;headerRow=index+1;tables.push({ready:columns.ready});identified=true;if(doctors.indexOf(doctor)===-1)doctors.push(doctor);return;}
      if(!columns)return;
      const time=agendaHorario(row[columns.time],zone);
      if(!time)return;
      const exam=agendaExameCatalogo(row[columns.map.USG],row,columns);
      if(exam){
        const examKey=centralNormalizar(doctor)+'|'+centralNormalizar(exam).replace(/\s+/g,' ');
        if(!(examKey in catalog))catalog[examKey]={doctor:doctor,name:exam};
      }
      records.push({sheet:sheet,sheetId:sheetId,row:index+1,headerRow:headerRow,columns:columns,doctor:doctor,date:date,time:time,occupied:agendaOcupada(row,columns)});
    });
    if(!identified && input.some(function(row){return row.some(function(v){return centralNormalizar(v)==='NOME';});}))unidentifiedBlocks++;
  });
  const groups={},slots={};
  records.forEach(function(record){
    const groupKey=centralNormalizar(record.doctor)+'|'+record.date+'|'+record.time;
    if(!groups[groupKey])groups[groupKey]={records:[],status:'AVAILABLE'};
    groups[groupKey].records.push(record);
    if(record.occupied)groups[groupKey].status='OCCUPIED';
  });
  Object.keys(groups).forEach(function(groupKey){
    const group=groups[groupKey];
    group.records.sort(function(a,b){return a.sheetId-b.sheetId || a.row-b.row;});
    const record=group.records.find(function(r){return r.columns.ready;}) || group.records[0];
    const id=agendaDigest(JSON.stringify([record.sheetId,record.row,record.doctor,record.date,record.time,record.headerRow,record.columns.signature]),key);
    slots[id]={id:id,doctor:record.doctor,date:record.date,time:record.time,status:group.status,record:record,records:group.records};
  });
  return {slots:slots,doctors:doctors,exams:Object.keys(catalog).map(function(k){return catalog[k];}),tables:tables,zone:zone,unidentifiedBlocks:unidentifiedBlocks};
}

function agendaPolitica(props,source) {
  const required=String(props.getProperty('AGENDAS_CAMPOS_OBRIGATORIOS') || '').split(',').map(centralNormalizar).filter(Boolean);
  const valid=required.length===4 && ['NOME','CPF','TELEFONE','USG'].every(function(k){return required.indexOf(k)!==-1;});
  const enabled=props.getProperty('AGENDAS_ESCRITA_ATIVA')==='SIM' && valid && source.tables.some(function(t){return t.ready;});
  const names={NOME:'patient',CPF:'cpf',TELEFONE:'phone',USG:'exam'};
  return {enabled:enabled,required:required.map(function(k){return names[k];}).filter(Boolean),reason:enabled?'':'A gravação aguarda configuração e conferência das colunas da agenda no Google.'};
}

function agendaConsultar(props) {
  const ss=SpreadsheetApp.openById(props.getProperty('AGENDAS_PLANILHA_ID'));
  const source=agendaLerFonte(ss,props.getProperty('AGENDAS_ANO'),props.getProperty('CENTRAL_TOKEN'));
  const slots=Object.keys(source.slots).map(function(id){const s=source.slots[id];return {id:s.id,doctor:s.doctor,date:s.date,time:s.time,status:s.status};});
  return {ok:true,schema:1,slots:slots,doctors:source.doctors,exams:source.exams,booking:agendaPolitica(props,source),baseYear:Number(props.getProperty('AGENDAS_ANO')) || null,unidentifiedBlocks:source.unidentifiedBlocks,readAt:new Date().toISOString()};
}

function agendaBookingError(code){return {ok:true,schema:1,booked:false,code:code};}

function agendaReservar(request,props) {
  if(props.getProperty('AGENDAS_ESCRITA_ATIVA')!=='SIM')return agendaBookingError('BOOKING_NOT_CONFIGURED');
  if(!request || typeof request.requestId!=='string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(request.requestId))return agendaBookingError('INVALID_DATA');
  if(!['slotId','patient','cpf','phone','exam'].every(function(k){return typeof request[k]==='string' && request[k].length<=120;}))return agendaBookingError('INVALID_DATA');
  const patient=request.patient.trim(),exam=agendaExame(request.exam);
  if(!patient || /^[=+\-@]/.test(patient) || /[\x00-\x1f\x7f<>]/.test(patient) || !exam)return agendaBookingError('INVALID_DATA');
  if((request.cpf && !/^\d{11}$/.test(request.cpf)) || (request.phone && !/^\d{10,15}$/.test(request.phone)))return agendaBookingError('INVALID_DATA');
  if(request.valueCents!==undefined && (typeof request.valueCents!=='number' || !Number.isSafeInteger(request.valueCents) || request.valueCents<0 || request.valueCents>1000000000))return agendaBookingError('INVALID_DATA');
  const lock=LockService.getScriptLock();
  if(!lock.tryLock(15000))return agendaBookingError('LOCK_BUSY');
  try {
    const transactionKey='AGENDA_TX_'+request.requestId;
    const fingerprint=agendaDigest(JSON.stringify([request.slotId,patient,request.cpf,request.phone,exam,request.valueCents===undefined?null:request.valueCents]),props.getProperty('CENTRAL_TOKEN'));
    const previous=props.getProperty(transactionKey);
    if(previous){const saved=JSON.parse(previous);if(saved.fingerprint!==fingerprint)return agendaBookingError('INVALID_DATA');return {ok:true,schema:1,booked:true,receipt:saved.receipt};}
    const ss=SpreadsheetApp.openById(props.getProperty('AGENDAS_PLANILHA_ID'));
    const source=agendaLerFonte(ss,props.getProperty('AGENDAS_ANO'),props.getProperty('CENTRAL_TOKEN'));
    const policy=agendaPolitica(props,source);
    if(!policy.enabled)return agendaBookingError('BOOKING_NOT_CONFIGURED');
    if(policy.required.some(function(k){return !request[k] || !request[k].trim();}))return agendaBookingError('REQUIRED_FIELDS');
    const slot=source.slots[request.slotId];
    if(!slot || slot.status!=='AVAILABLE')return agendaBookingError('SLOT_OCCUPIED');
    const record=slot.record;
    if(!record.columns.ready)return agendaBookingError('COLUMN_MAPPING_INVALID');
    const now=Utilities.formatDate(new Date(),source.zone,'yyyy-MM-dd HH:mm');
    if(slot.date+' '+slot.time<=now)return agendaBookingError('SLOT_EXPIRED');
    // Última conferência de cabeçalho, horário e todas as cópias da vaga dentro do lock.
    for(let index=0;index<slot.records.length;index++){
      const r=slot.records[index],width=r.sheet.getLastColumn();
      const header=agendaMapa(r.sheet.getRange(r.headerRow,1,1,width).getValues()[0]);
      const current=r.sheet.getRange(r.row,1,1,width).getValues()[0];
      if(!header || header.signature!==r.columns.signature || agendaHorario(current[header.time],source.zone)!==r.time)return agendaBookingError('SLOT_CHANGED');
      if(agendaOcupada(current,header))return agendaBookingError('SLOT_OCCUPIED');
    }
    const target=record.sheet.getRange(record.row,record.columns.start+1,1,4);
    if(!target.canEdit())return agendaBookingError('CELL_PROTECTED');
    if(target.getFormulas()[0].some(Boolean))return agendaBookingError('FORMULA_PROTECTED');
    let valueTarget=null;
    if(request.valueCents!==undefined){
      const valueColumn=record.columns.map.VALOR;
      if(valueColumn===undefined || valueColumn<0 || (valueColumn>=record.columns.start && valueColumn<record.columns.start+4) || valueColumn===record.columns.time)return agendaBookingError('VALUE_MAPPING_INVALID');
      valueTarget=record.sheet.getRange(record.row,valueColumn+1,1,1);
      if(!valueTarget.canEdit())return agendaBookingError('CELL_PROTECTED');
      if(valueTarget.getFormulas()[0].some(Boolean))return agendaBookingError('FORMULA_PROTECTED');
    }
    const output=Array(4).fill('');
    [['CPF',request.cpf],['NOME',patient],['TELEFONE',request.phone],['USG',exam]].forEach(function(pair){output[record.columns.map[pair[0]]-record.columns.start]=pair[1];});
    // Libera espaço do histórico técnico antes da escrita, reduzindo falhas de quota após reservar.
    agendaLimparTransacoes(props,true);
    // A aba, linha e colunas são as mesmas da vaga escolhida. Formatos, PG e horário não são alterados.
    target.setValues([output]);
    if(valueTarget)valueTarget.setValues([[request.valueCents/100]]);
    SpreadsheetApp.flush();
    const receipt={slotId:slot.id,doctor:slot.doctor,exam:exam,date:slot.date,time:slot.time};
    if(request.valueCents!==undefined)receipt.valueCents=request.valueCents;
    props.setProperty(transactionKey,JSON.stringify({fingerprint:fingerprint,receipt:receipt,created:Date.now()}));
    return {ok:true,schema:1,booked:true,receipt:receipt};
  }finally{lock.releaseLock();}
}

function agendaLimparTransacoes(props,reserveNew) {
  const now=Date.now(),all=props.getProperties(),active=[];
  Object.keys(all).filter(function(k){return k.indexOf('AGENDA_TX_')===0;}).forEach(function(k){
    try{const value=JSON.parse(all[k]);if(!Number.isFinite(value.created) || now-value.created>48*60*60*1000)props.deleteProperty(k);else active.push({key:k,created:value.created,bytes:(String(all[k]).length+k.length)*3});}catch(error){props.deleteProperty(k);}
  });
  active.sort(function(a,b){return a.created-b.created;});
  let bytes=active.reduce(function(total,item){return total+item.bytes;},0),count=active.length;
  const maximum=reserveNew?799:800;
  for(let index=0;index<active.length && (count>maximum || bytes>350000);index++){
    props.deleteProperty(active[index].key);bytes-=active[index].bytes;count--;
  }
}
