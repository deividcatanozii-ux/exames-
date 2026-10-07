# Central de Exames — Amor Saúde Fernandópolis

Código atual separado para subir no GitHub. O programa instalado no computador continua independente desta pasta. O visual e os cálculos foram preservados.

## Publicar na Vercel

O código completo desta versão está na raiz do repositório. Os arquivos locais originais permanecem no computador.

1. Importe este repositório em https://vercel.com/new.
2. Use Root Directory `.` e Framework Preset **FastAPI**. Mantenha os comandos de instalação e build nos padrões.
3. Configure `APPS_SCRIPT_URL` e `APPS_SCRIPT_TOKEN` nas variáveis de ambiente de produção usando a configuração privada existente. Não envie `.env.local` ao GitHub.
4. Clique em Deploy e valide a consulta financeira e a agenda no endereço HTTPS gerado.

O conector Google Apps Script precisa estar implantado e autorizado nas duas planilhas. O sistema atual não exige login; configure controle de acesso na hospedagem antes de disponibilizar o link à equipe.

## Arquivos

- `app.py`: backend FastAPI e entrada do sistema.
- `views/central.html`: painel atual.
- `views/agenda.js` e `views/agenda.css`: agenda, horários e confirmação visual de sucesso.
- `records.py`: consolidação financeira exclusiva da NOTA FISCAL.
- `sheet_source.py`: comunicação privada com o conector Google.
- `agenda.py`: disponibilidade e confirmação de reservas.
- `google/ConectorCentral.gs`, `google/AgendaOperacional.gs` e `google/appsscript.json`: conector existente, com leitura das duas planilhas e escrita na agenda.
- `requirements.txt`: dependências do backend.
- `requirements-dev.txt`: inclui o servidor para desenvolvimento local.

Não estão incluídos tokens, configuração privada local, planilhas, cadastros de pacientes, instaladores, imagens de testes ou cópias antigas.

## Conexão privada

O backend precisa de duas variáveis de ambiente:

- `APPS_SCRIPT_URL`: URL do aplicativo da Web do conector Google, terminada em `/exec`.
- `APPS_SCRIPT_TOKEN`: valor de `CENTRAL_TOKEN` nas propriedades do projeto Google.

Reutilize a configuração existente no computador. `.env.example` contém apenas exemplos. Não envie `.env.local`, o token ou exportações das planilhas ao GitHub.

Se precisar instalar o conector em outra conta, coloque os DOIS arquivos `.gs` em um único projeto Google Apps Script, configure o manifesto, execute `configurarConector` e implante como Aplicativo da Web. Selecione **Executar como: Eu**, com a conta autorizada nas duas planilhas, e **Quem pode acessar: Qualquer pessoa**. O conector exige a chave enviada pelo backend; ela não vai para o navegador. Para atualizar o conector existente, publique uma nova versão da mesma implantação e preserve a chave. Não mantenha funções duplicadas no projeto Google.

## Executar em desenvolvimento

Com Python 3.12 instalado, abra o terminal nesta pasta:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
```

Defina as duas variáveis acima no ambiente do processo, de forma privada. Em seguida:

```powershell
.\.venv\Scripts\python.exe -m uvicorn app:app --host 127.0.0.1 --port 8773
```

Abra `http://127.0.0.1:8773`. Esse comando não lê `.env.local` automaticamente; as variáveis precisam estar no ambiente do processo. Sem elas, o painel abre, mas as APIs informam que a conexão precisa ser configurada.

## Atualização

O financeiro consulta somente a NOTA FISCAL, com atualização periódica de 30 segundos e botão Atualizar dados. A agenda consulta a USG DIONNE, com atualização periódica de 60 segundos quando ativa, e confirmação de reservas pelo conector. Horários passados não são exibidos. Não há resumo dos agendamentos.

Os resultados dependem do acesso às planilhas e da implantação correta do Google Apps Script. O envio ao GitHub não valida nem altera a implantação Google. Testes locais de código não substituem uma confirmação real de gravação na planilha.