/** Conector privado: financeiro em leitura e agenda operacional na planilha USG DIONNE. */
function configurarConector() {
  const props = PropertiesService.getScriptProperties();
  // Estas são as duas fontes operacionais conferidas desta unidade.
  // Executar a configuração corrige também IDs antigos salvos nas propriedades.
  const planilhaId = '1Ri7pS4sH_KkxakVEa0SlMkR_pqsY1HgmyC_b7OOe1D8';
  const agendaId = '1vGVREKfOcbB_4O3OahvQsR-UzdjqhHof4RxNvmf91Q8';
  const ss = SpreadsheetApp.openById(planilhaId);
  const agenda = SpreadsheetApp.openById(agendaId);
  props.setProperty('PLANILHA_ID', ss.getId());
  props.setProperty('AGENDAS_PLANILHA_ID', agenda.getId());
  if (!props.getProperty('CENTRAL_TOKEN')) {
    props.setProperty('CENTRAL_TOKEN', Utilities.getUuid() + Utilities.getUuid());
  }
  const baseYear=props.getProperty('AGENDAS_ANO') || '';
  if (!/^\d{4}$/.test(baseYear) || Number(baseYear)<1900 || Number(baseYear)>9999) props.setProperty('AGENDAS_ANO', '2026');
  const fields=String(props.getProperty('AGENDAS_CAMPOS_OBRIGATORIOS') || '').split(',').map(centralNormalizar).filter(Boolean);
  if (fields.length!==4 || !['NOME','CPF','TELEFONE','USG'].every(function(k){return fields.indexOf(k)!==-1;})) props.setProperty('AGENDAS_CAMPOS_OBRIGATORIOS', 'NOME,CPF,TELEFONE,USG');
  // Executar esta função é a configuração inicial da leitura e escrita solicitadas.
  props.setProperty('AGENDAS_ESCRITA_ATIVA', 'SIM');
  console.log('Conector configurado. Copie CENTRAL_TOKEN em Configurações do projeto → Propriedades do script. Não divulgue essa chave.');
}

function centralNormalizar(value) {
  return String(value === null || value === undefined || value === false || value === 0 ? '' : value)
    .trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function centralExtrair(ss) {
  const technical = ['CENTRAL DE EXAMES','BASE CONSOLIDADA','QUALIDADE DOS DADOS','CONFIGURACOES','AUXILIAR CENTRAL'];
  const zone = ss.getSpreadsheetTimeZone();
  const sheets = [];
  ss.getSheets().forEach(function(sheet) {
    if (technical.indexOf(centralNormalizar(sheet.getName())) !== -1) return;
    const input = sheet.getDataRange().getValues();
    if (!input.length) return;
    const map = {};
    input[0].forEach(function(h,i) {if(h) map[centralNormalizar(h)] = i;});
    if (!['DATA','VALOR','ATENDENTE'].every(function(k){return k in map;})) return;
    const output = [['PRESENTE','DATA','VALOR','DESCRICAO','ATENDENTE','FORMA DE RECEBIMENTO']];
    const duplicates = {}, seen = Object.create(null);
    for(let i=1;i<input.length;i++) {
      const row=input[i], get=function(key){return key in map ? row[map[key]] : '';};
      if (!(row[0] || get('DATA') || get('ATENDENTE'))) {output.push([]);continue;}
      // Os 15 campos originais são usados só aqui para identificar duplicados.
      // Nome, CPF, telefone, email e endereço nunca saem da planilha.
      const signature=JSON.stringify(row.slice(0,15).map(function(value){
        return centralNormalizar(value instanceof Date ? Utilities.formatDate(value,zone,'yyyy-MM-dd HH:mm:ss') : value);
      }));
      if(signature in seen) duplicates[String(i+1)]=seen[signature];
      seen[signature]=i+1;
      let date=get('DATA');
      if(date instanceof Date) date=Utilities.formatDate(date,zone,'dd/MM/yyyy');
      output.push([row[0] ? 'REGISTRO' : '',date,get('VALOR'),get('DESCRICAO'),get('ATENDENTE'),get('FORMA DE RECEBIMENTO')]);
    }
    sheets.push({name:sheet.getName(),values:output,duplicates:duplicates});
  });
  return {ok:true,schema:1,sheets:sheets,readAt:new Date().toISOString()};
}

function centralJson(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {return centralJson({ok:false,error:'Consulta não autorizada.'});}

function doPost(e) {
  const props=PropertiesService.getScriptProperties(),key=props.getProperty('CENTRAL_TOKEN');
  let request;
  try {request=JSON.parse(e.postData.contents);} catch(error) {return centralJson({ok:false,error:'Consulta não autorizada.'});}
  if(!key || !request || typeof request.token!=='string' || request.token!==key) {
    return centralJson({ok:false,error:'Consulta não autorizada.'});
  }
  try {
    if (request.action === 'agenda_operacional') return centralJson(agendaConsultar(props));
    if (request.action === 'agendar') return centralJson(agendaReservar(request.booking, props));
    if (request.action) return centralJson({ok:false,error:'Consulta não autorizada.'});
    return centralJson(centralExtrair(SpreadsheetApp.openById(props.getProperty('PLANILHA_ID'))));
  }
  catch(error) {return centralJson({ok:false,error:'Não foi possível consultar a planilha configurada. Confira a implantação e a configuração do conector.'});}
}
