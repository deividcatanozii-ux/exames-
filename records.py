"""Mesmos critérios de server.py; sem pacientes no payload público."""
import datetime, math, re, unicodedata
from decimal import Decimal
from zoneinfo import ZoneInfo

SAO_PAULO=ZoneInfo('America/Sao_Paulo')
MONTH_NAMES=['JANEIRO','FEVEREIRO','MARCO','ABRIL','MAIO','JUNHO','JULHO','AGOSTO','SETEMBRO','OUTUBRO','NOVEMBRO','DEZEMBRO']
TECHNICAL={'CENTRAL DE EXAMES','BASE CONSOLIDADA','QUALIDADE DOS DADOS','CONFIGURACOES','AUXILIAR CENTRAL'}

def normalize(v):
    return ''.join(c for c in unicodedata.normalize('NFD',str(v or '').strip().upper()) if not unicodedata.combining(c))

def payment_method(value):
    text=normalize(value)
    if not text: return 'NAO_INFORMADO'
    methods=[]
    for pattern,name in [(r'\bDEBITO\b','DEBITO'),(r'\bCREDITO\b','CREDITO'),(r'\bPIX\b','PIX'),(r'\bDINHEIRO\b','DINHEIRO'),(r'\bBOLETO\b','BOLETO'),(r'\bCASHBACK\b','CASHBACK')]:
        if re.search(pattern,text): methods.append(name)
    if len(methods)>1: return 'MISTO'
    # Uma descrição desconhecida junto a uma forma conhecida não vira pagamento simples.
    if len(methods)==1:
        remainder=re.sub(r'\b(CARTAO|DE|NO|EM|A|VISTA|PAGAMENTO|RECEBIMENTO|DEBITO|CREDITO|PIX|DINHEIRO|BOLETO|CASHBACK)\b','',text)
        if not re.sub(r'[\s/+,;\-]','',remainder): return methods[0]
        if re.search(r'[/+;]|\s-\s',text): return 'MISTO'
    return 'OUTROS'

def currency(value):
    if isinstance(value,(int,float)):
        return round(value*100) if math.isfinite(value) else None
    value=re.sub(r'R\$|\s','',str(value or ''))
    if not re.fullmatch(r'-?(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?',value): return None
    return int(Decimal(value.replace('.','').replace(',','.'))*100)

def parse_date(value, serial_dates=False):
    if isinstance(value,datetime.datetime): return value.date()
    if isinstance(value,datetime.date): return value
    # Google Sheets retorna datas numéricas com SERIAL_NUMBER (origem 1899-12-30).
    if serial_dates and isinstance(value,(int,float)) and math.isfinite(value):
        try: return datetime.date(1899,12,30)+datetime.timedelta(days=math.floor(value))
        except (OverflowError,ValueError): return None
    try: return datetime.datetime.strptime(str(value).strip(),'%d/%m/%Y').date()
    except (ValueError,TypeError): return None

def consolidate(sheets, serial_dates=False, source='Google Sheets', now=None, duplicate_lines=None):
    rows,issues,inventory=[],[],[]
    for title,values in sheets:
        if normalize(title) in TECHNICAL or not values: continue
        mapping={normalize(v):i for i,v in enumerate(values[0]) if v}
        if not all(k in mapping for k in ['DATA','VALOR','ATENDENTE']): continue
        count,seen=0,{}
        for line,row in enumerate(values[1:],2):
            def get(key):
                i=mapping.get(key)
                return row[i] if i is not None and i<len(row) else None
            if not any([row[0] if row else None,get('DATA'),get('ATENDENTE')]): continue
            count+=1
            date=parse_date(get('DATA'),serial_dates);cents=currency(get('VALOR'));agent=normalize(get('ATENDENTE'));errors=[]
            if not date: errors.append('Data ausente ou inválida')
            if cents is None or cents<=0: errors.append('Valor ausente, inválido ou não positivo')
            if not agent: errors.append('Atendente ausente')
            elif agent not in ['EDUARDO','BEATRIZ','TATIANE']: errors.append('Atendente não reconhecido')
            if date and normalize(title)!=f'{MONTH_NAMES[date.month-1]} {date.year}': errors.append('Data diverge do mês da aba')
            # A assinatura transitória usa os mesmos primeiros 15 campos; nunca é enviada ou persistida.
            if duplicate_lines is not None:
                original=duplicate_lines.get(title,{}).get(str(line))
                if original is not None: errors.append(f'Possível duplicado da linha {original}')
            else:
                key=tuple(normalize(x) for x in row[:15])
                if key in seen: errors.append(f'Possível duplicado da linha {seen[key]}')
                seen[key]=line
            comp=date.strftime('%Y-%m') if date else None
            for error in errors: issues.append({'sheet':title,'line':line,'type':error,'month':comp})
            rows.append({'date':date.isoformat() if date else None,'month':comp,'agent':agent,'cents':cents,'description':str(get('DESCRICAO') or '').strip().upper(),'payment':payment_method(get('FORMA DE RECEBIMENTO')),'valid':date is not None and cents is not None and cents>0 and bool(agent),'sheet':title,'line':line})
        inventory.append({'name':title,'records':count})
    now=now or datetime.datetime.now(datetime.timezone.utc)
    return {'rows':rows,'issues':issues,'sheets':inventory,'months':sorted({r['month'] for r in rows if r['month']}),'source':source,'sourceModified':None,'loadedAt':now.isoformat(),'today':now.astimezone(SAO_PAULO).date().isoformat()}

def metrics(data,month,today=None):
    """Conferência independente usada pelo comando de comparação, em centavos."""
    eligible=[r for r in data['rows'] if r['valid'] and r['month']==month and r['date']<=(today or data['today'])]
    result={}
    for agent in ['EDUARDO','BEATRIZ',None]:
        rows=[r for r in eligible if agent is None or r['agent']==agent];total=sum(r['cents'] for r in rows)
        result[agent or 'CENTRAL']={'count':len(rows),'cents':total,'ticket_cents':total/len(rows) if rows else 0}
    e,b=result['EDUARDO'],result['BEATRIZ'];total=result['CENTRAL']['cents']
    result['leader']='SEM DADOS' if not e['count']+b['count'] else 'EMPATE' if e['cents']==b['cents'] else 'EDUARDO' if e['cents']>b['cents'] else 'BEATRIZ'
    result['difference_cents']=abs(e['cents']-b['cents'])
    result['shares']={a:result[a]['cents']/total if total else 0 for a in ['EDUARDO','BEATRIZ']}
    return result
