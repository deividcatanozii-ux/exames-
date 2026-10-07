/* A Google Planilha é a única fonte das vagas; dados do formulário ficam somente em memória. */
(()=>{
 const a={data:null,slot:null,draft:null,saving:false,loading:false,controller:null,sequence:0,toastTimer:null};
 const upcoming=slot=>{
  const parts=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date());
  const value=type=>parts.find(part=>part.type===type).value;
  return slot.date+' '+slot.time>`${value('year')}-${value('month')}-${value('day')} ${value('hour')}:${value('minute')}`;
 };
 const weekday=day=>new Intl.DateTimeFormat('pt-BR',{weekday:'long',timeZone:'America/Sao_Paulo'}).format(new Date(day+'T12:00:00Z'));
 const filtered=(ignoreDate=false)=>(a.data?.slots||[]).filter(slot=>upcoming(slot)&&(!$('agendaDoctor').value||slot.doctor===$('agendaDoctor').value)&&(ignoreDate||!$('agendaDate').value||slot.date===$('agendaDate').value));
 function busy(value){a.loading=value;for(const id of ['refreshAgendas','searchAgendas'])$(id).disabled=value;}
 function abortRead(){++a.sequence;if(a.controller)a.controller.abort();a.controller=null;busy(false);}
 function render(){
  if(!a.data)return;
  const selectedDoctor=$('agendaDoctor').value;
  const activeDoctors=[...new Set(a.data.slots.filter(upcoming).map(slot=>slot.doctor))].sort((left,right)=>left.localeCompare(right,'pt-BR'));
  $('agendaDoctor').replaceChildren(new Option('Todos os profissionais',''),...activeDoctors.map(doctor=>new Option(doctor,doctor)));
  $('agendaDoctor').value=activeDoctors.includes(selectedDoctor)?selectedDoctor:'';
  const selectedDate=$('agendaDate').value,days=[...new Set(filtered(true).map(slot=>slot.date))].sort();
  $('agendaDate').replaceChildren(new Option('Todas as próximas datas',''),...days.map(day=>new Option(dateLabel(day),day)));
  $('agendaDate').value=days.includes(selectedDate)?selectedDate:'';
  const slots=filtered(),doctors=[...new Set(slots.map(slot=>slot.doctor))],host=$('agendaSlots');
  host.innerHTML=doctors.length?doctors.map(doctor=>`<article class="panel agenda-professional"><div class="section-head"><div><div class="eyebrow">PROFISSIONAL</div><h2>${esc(doctor)}</h2></div><span class="pill">AGENDA DE EXAMES</span></div>${[...new Set(slots.filter(slot=>slot.doctor===doctor).map(slot=>slot.date))].sort().map(day=>`<h3 class="agenda-date">${esc(dateLabel(day))}<small>${esc(weekday(day))}</small></h3><div class="agenda-times">${slots.filter(slot=>slot.doctor===doctor&&slot.date===day).map(slot=>`<button type="button" class="agenda-time agenda-slot available" data-slot="${esc(slot.id)}" aria-label="Agendar com ${esc(doctor)} em ${esc(dateLabel(day))} às ${esc(slot.time)}"><span class="slot-clock">${esc(slot.time)}</span><span class="slot-state">DISPONÍVEL</span><span class="slot-action">AGENDAR</span></button>`).join('')}</div>`).join('')}</article>`).join(''):'<article class="panel agenda-empty"><h3>Nenhum horário disponível neste filtro</h3><p>Escolha outro profissional ou outra data. A Central mostra somente vagas existentes e livres na Google Planilha.</p></article>';
  $('agendaBookingNotice').textContent=a.data.booking.enabled?'Clique em AGENDAR para preencher os dados do paciente.':a.data.booking.reason||'A gravação ainda precisa ser ativada no conector Google.';
 }
 function validAvailability(data){
  if(data?.live!==true||!Array.isArray(data.slots)||!Array.isArray(data.doctors)||!data.booking||typeof data.booking.enabled!=='boolean'||typeof data.readAt!=='string'||!Number.isFinite(Date.parse(data.readAt)))return false;
  if(!data.doctors.every(doctor=>typeof doctor==='string'&&doctor.trim()))return false;
  return data.slots.every(slot=>typeof slot.id==='string'&&slot.id&&data.doctors.includes(slot.doctor)&&/^\d{4}-\d{2}-\d{2}$/.test(slot.date)&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(slot.time)&&slot.status==='AVAILABLE');
 }
 async function refresh(){
  if($('bookingDialog').open||a.saving||a.loading)return false;
  render();
  const sequence=++a.sequence,controller=new AbortController();a.controller=controller;busy(true);
  $('agendaStatus').textContent='Consultando a Google Planilha USG DIONNE…';
  try{
   const response=await fetch('/api/agenda/availability',{cache:'no-store',signal:controller.signal});const data=await response.json();
   if(sequence!==a.sequence)return false;
   if(!response.ok)throw Error(data.error||'Não foi possível consultar a agenda.');
   if(!validAvailability(data))throw Error('A resposta da agenda precisa ser conferida. Nenhum horário foi criado pela Central.');
   a.data={...data,slots:data.slots.filter(upcoming),exams:(Array.isArray(data.exams)?data.exams:[]).filter(exam=>typeof exam?.doctor==='string'&&typeof exam?.name==='string'&&exam.name.trim()).map(exam=>({doctor:exam.doctor,name:exam.name.trim()}))};render();
   $('agendaStatus').textContent=`Google Planilha USG DIONNE consultada em ${timestamp(data.readAt)}.`+(data.baseYear?` Abas sem ano: ${data.baseYear}.`:'')+(data.unidentifiedBlocks?' Algumas tabelas não foram exibidas porque a identificação está incompleta.':'');return true;
  }catch(error){
   if(error.name==='AbortError'||sequence!==a.sequence)return false;
   render();
   $('agendaStatus').textContent=error.message+(a.data?' A consulta falhou; a lista abaixo é da última consulta. A vaga será conferida novamente antes de gravar.':' Os horários ainda não foram carregados.');return false;
  }finally{if(sequence===a.sequence){a.controller=null;busy(false);}}
 }
 function clearPatient(){a.slot=null;a.draft=null;$('bookingForm').reset();$('bookingError').textContent='';$('bookingSaveError').textContent='';$('bookingReviewDetails').replaceChildren();$('bookingSlot').textContent='';$('bookingExamChoice').replaceChildren(new Option('Outro exame / Digitar',''));$('bookingExamHelp').textContent='';$('bookingReview').hidden=true;$('bookingForm').hidden=false;$('bookingValueField').hidden=true;$('bookingValue').required=false;}
 function updateOffer(){
  if(!a.slot)return;
  const hour=Number(new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',hourCycle:'h23'}).format(new Date()));
  const greeting=hour<12?'Bom dia':hour<18?'Boa tarde':'Boa noite';
  const message=`${greeting}! Temos um horário disponível com ${a.slot.doctor} no dia ${dateLabel(a.slot.date)}, às ${a.slot.time}. Gostaria de agendar?`;
  if($('slotOfferMessage').value!==message){$('slotOfferMessage').value=message;$('slotOfferCopyStatus').textContent='';}
 }
 async function copyOffer(){
  if(!a.slot)return;
  updateOffer();const slot=a.slot,message=$('slotOfferMessage').value;
  let copied=false;
  try{await navigator.clipboard.writeText(message);copied=true;}catch{
   if(a.slot!==slot)return;
   $('slotOfferMessage').focus();$('slotOfferMessage').select();
   try{copied=document.execCommand('copy');}catch{}
  }
  if(a.slot===slot)$('slotOfferCopyStatus').textContent=copied?'Mensagem copiada!':'Selecione a mensagem e pressione Ctrl+C para copiar.';
 }
 function open(id){
  const slot=a.data?.slots.find(item=>item.id===id&&upcoming(item));if(!slot)return;
  abortRead();clearPatient();a.slot=slot;$('agendaToast').hidden=true;
  $('bookingSlot').textContent=`${slot.doctor} · ${dateLabel(slot.date)} · ${slot.time}`;
  $('slotOfferCopyStatus').textContent='';updateOffer();
  const exams=[...new Set((a.data.exams||[]).filter(exam=>exam.doctor===slot.doctor).map(exam=>exam.name))].sort((left,right)=>left.localeCompare(right,'pt-BR'));
  $('bookingExamChoice').replaceChildren(new Option('Outro exame / Digitar',''),...exams.map(exam=>new Option(exam,exam)));
  $('bookingExamHelp').textContent=exams.length?'Opções lidas na coluna USG deste profissional. Você também pode digitar outro exame abaixo.':'A planilha não informou opções para este profissional. Digite o exame abaixo.';
  $('bookingNotice').textContent=a.data.booking.enabled?'A Central vai consultar novamente esta linha antes de confirmar.':a.data.booking.reason||'Ative a gravação no conector Google.';
  $('reviewBooking').disabled=!a.data.booking.enabled;$('bookingDialog').showModal();$('bookingPatient').focus();
 }
 const digits=value=>value.replace(/\D/g,'');
 function review(event){
  event.preventDefault();if(!a.slot||!a.data?.booking.enabled||a.saving)return;
  const payload={slotId:a.slot.id,patient:$('bookingPatient').value.trim(),cpf:digits($('bookingCpf').value),phone:digits($('bookingPhone').value),exam:$('bookingExam').value.trim()};
  if(!payload.patient||!payload.exam){$('bookingError').textContent='Informe o nome completo e o exame.';return;}
  if(payload.cpf.length!==11||payload.phone.length<10||payload.phone.length>15){$('bookingError').textContent='Confira o CPF com 11 dígitos e o telefone com DDD.';return;}
  if($('bookingValueMode').value==='set'){
   const cents=calculatorCents($('bookingValue').value);
   if(cents===null||cents>1000000000||!$('bookingValue').value.trim()){$('bookingError').textContent='Informe um valor válido em reais.';return;}payload.valueCents=cents;
  }
  const fingerprint=JSON.stringify(payload);if(!a.draft||a.draft.fingerprint!==fingerprint)a.draft={fingerprint,payload:{...payload,requestId:crypto.randomUUID()}};
  const rows=[['Paciente',payload.patient],['Exame',payload.exam],['Profissional',a.slot.doctor],['Data',dateLabel(a.slot.date)],['Horário',a.slot.time],['Valor',payload.valueCents===undefined?'Manter o valor da planilha':money(payload.valueCents)]];
  $('bookingReviewDetails').innerHTML=rows.map(([label,value])=>`<span>${esc(label)}</span><strong>${esc(value)}</strong>`).join('');
  $('bookingForm').hidden=true;$('bookingReview').hidden=false;$('bookingSaveError').textContent='';$('saveBooking').disabled=false;
 }
 function toast(message,error=false){
  const host=$('agendaToast');clearTimeout(a.toastTimer);host.replaceChildren();
  host.classList.toggle('agenda-toast-error',error);host.classList.toggle('agenda-toast-success',!error);
  if(error)host.textContent=message;
  else{
   host.innerHTML='<button type="button" class="agenda-success-close" aria-label="Fechar mensagem de sucesso">×</button><svg class="agenda-success-icon" viewBox="0 0 96 96" aria-hidden="true"><circle cx="48" cy="48" r="44" fill="currentColor"/><path d="m27 48 14 14 28-29" fill="none" stroke="white" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/></svg><strong></strong>';
   host.querySelector('strong').textContent=message;host.querySelector('button').addEventListener('click',()=>{host.hidden=true;});
   a.toastTimer=setTimeout(()=>{host.hidden=true;},6000);
  }
  host.hidden=false;
 }
 async function save(){
  if(a.saving||!a.draft||!a.data?.booking.enabled)return;
  abortRead();a.saving=true;for(const id of ['saveBooking','backBooking','closeBooking'])$(id).disabled=true;
  $('bookingSaveError').textContent='Conferindo e gravando na mesma linha da Google Planilha…';
  let refreshAfter=false;
  try{
   const request=a.draft.payload,response=await fetch('/api/agenda/bookings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request)});const result=await response.json();
   if(!response.ok){
    if(response.status===409){a.data.slots=a.data.slots.filter(slot=>slot.id!==request.slotId);render();$('bookingDialog').close();toast(result.error||'Este horário acabou de ser ocupado. Escolha outro horário disponível.',true);refreshAfter=true;return;}
    throw Error(result.error||'Não foi possível confirmar o agendamento.');
   }
   if(result.booked!==true||result.receipt?.slotId!==request.slotId)throw Error('A gravação não foi confirmada. Atualize a agenda antes de tentar novamente.');
   a.data.slots=a.data.slots.filter(slot=>slot.id!==request.slotId);render();$('bookingDialog').close();toast('Agendamento criado com sucesso');document.dispatchEvent(new Event('central:booking-confirmed'));refreshAfter=true;
  }catch(error){if($('bookingDialog').open)$('bookingSaveError').textContent=error.message;}
  finally{a.saving=false;for(const id of ['saveBooking','backBooking','closeBooking'])$(id).disabled=false;if(refreshAfter)await refresh();}
 }
 $('availability').addEventListener('click',event=>{const button=event.target.closest('[data-slot]');if(button&&!button.disabled)open(button.dataset.slot);});
 for(const id of ['agendaDoctor','agendaDate'])$(id).addEventListener('change',render);
 for(const id of ['searchAgendas','refreshAgendas'])$(id).addEventListener('click',refresh);
 $('bookingValueMode').addEventListener('change',()=>{const visible=$('bookingValueMode').value==='set';$('bookingValueField').hidden=!visible;$('bookingValue').required=visible;});
 $('bookingForm').addEventListener('submit',review);$('saveBooking').addEventListener('click',save);
 $('bookingExamChoice').addEventListener('change',()=>{$('bookingExam').value=$('bookingExamChoice').value;$('bookingExam').focus();});
 $('bookingExam').addEventListener('input',()=>{if($('bookingExam').value!==$('bookingExamChoice').value)$('bookingExamChoice').value='';});
 $('backBooking').addEventListener('click',()=>{$('bookingReview').hidden=true;$('bookingForm').hidden=false;});
 for(const id of ['cancelBooking','closeBooking'])$(id).addEventListener('click',()=>{if(!a.saving)$('bookingDialog').close();});
 $('bookingDialog').addEventListener('cancel',event=>{if(a.saving)event.preventDefault();});
 $('copySlotOffer').addEventListener('click',copyOffer);
 $('bookingDialog').addEventListener('close',()=>{if(!$('bookingDialog').open){clearPatient();$('slotOfferMessage').value='';$('slotOfferCopyStatus').textContent='';render();}});
 setInterval(()=>{if($('bookingDialog').open&&!document.hidden)updateOffer();if(state.view==='availability'&&!document.hidden&&!$('bookingDialog').open&&!a.saving){render();refresh();}},60000);
 function scheduleExpiry(){setTimeout(()=>{if(state.view==='availability'&&!document.hidden)render();scheduleExpiry();},60000-Date.now()%60000+20);}
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&state.view==='availability')render();});scheduleExpiry();
 window.Agenda={enter:refresh,update:refresh};$('agendaScriptFallback').hidden=true;if(state.view==='availability')refresh();
})();
