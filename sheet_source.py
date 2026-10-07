"""Leitura privada do conector Apps Script. Sem cópia de produção ou dados pessoais."""
import os
import re
import time
from concurrent.futures import Future
from threading import Lock
from urllib.parse import urlparse

import httpx
from httpx import Client as HttpClient
from records import consolidate


class SourceError(Exception):
    pass


_pending_lock = Lock()
_pending_reads = {}


def _read_connector(action=None, booking=None):
    # A consulta financeira continua enviando somente a chave. As ações da
    # agenda usam o mesmo conector privado, sem outro cadastro de credenciais.
    if action not in (None, "agenda_operacional", "agendar") or (booking is not None and action != "agendar"):
        raise SourceError("A operação solicitada não é compatível com o conector.")
    url = os.environ.get("APPS_SCRIPT_URL", "").strip()
    token = os.environ.get("APPS_SCRIPT_TOKEN", "").strip()
    parsed = urlparse(url)
    if not url or not token:
        raise SourceError("Conecte a Google Planilha: configure APPS_SCRIPT_URL e APPS_SCRIPT_TOKEN na Vercel.")
    if parsed.scheme != "https" or parsed.netloc != "script.google.com" or not re.fullmatch(r"/macros/s/[A-Za-z0-9_-]+/exec", parsed.path) or parsed.query or parsed.fragment:
        raise SourceError("APPS_SCRIPT_URL deve ser o endereço HTTPS de implantação do Google Apps Script terminado em /exec.")
    if len(token) < 32:
        raise SourceError("A chave de conexão precisa ter pelo menos 32 caracteres.")
    if action == "agendar":
        return _fetch_connector(url, token, action, booking)
    # Compartilha somente consultas simultaneas. Toda consulta posterior le
    # novamente o Google; nao ha copia congelada nem cache de dados antigos.
    key = (url, token, action)
    with _pending_lock:
        pending = _pending_reads.get(key)
        owner = pending is None
        if owner:
            pending = Future()
            _pending_reads[key] = pending
    if not owner:
        return pending.result()
    try:
        result = _fetch_connector(url, token, action, booking)
        pending.set_result(result)
        return result
    except BaseException as error:
        pending.set_exception(error)
        raise
    finally:
        with _pending_lock:
            _pending_reads.pop(key, None)


def _fetch_connector(url, token, action, booking):
    # Leituras podem ser repetidas: um erro transitório do ContentService não
    # significa que a conexão salva deixou de funcionar. Escritas são únicas.
    attempts = 1 if action == "agendar" else 3
    deadline = time.monotonic() + 55
    completed = False
    raw = None
    for attempt in range(attempts):
        try:
            with HttpClient(timeout=httpx.Timeout(20, connect=10), follow_redirects=False, trust_env=False) as client:
                request = {"token": token}
                if action is not None:
                    request["action"] = action
                if booking is not None:
                    request["booking"] = booking
                response = client.post(url, json=request, timeout=_remaining_timeout(deadline))
                # ContentService entrega o JSON por redirecionamento para googleusercontent.
                # Nunca repetimos o POST com a chave no endereço de redirecionamento.
                for _ in range(3):
                    if response.status_code not in (301, 302, 303, 307, 308):
                        break
                    target = response.headers.get("location", "")
                    redirect = urlparse(target)
                    if redirect.scheme != "https" or redirect.hostname != "script.googleusercontent.com" or redirect.username or redirect.password or redirect.port not in (None, 443):
                        error = SourceError("Revise a implantação do conector: execute como você e permita acesso a Qualquer pessoa.")
                        error.redirect_host = redirect.hostname
                        raise error
                    response = client.get(target, timeout=_remaining_timeout(deadline))
                response.raise_for_status()
                raw = response.json()
            completed = True
            break
        except SourceError:
            raise
        except httpx.HTTPStatusError as error:
            if error.response.status_code not in (404, 408, 429, 500, 502, 503, 504):
                break
        except (httpx.TransportError, ValueError, TypeError):
            pass
        if time.monotonic() >= deadline or attempt == attempts - 1:
            break
    if not completed:
        if action == "agendar":
            raise SourceError("O Google não confirmou a resposta do agendamento. Confira o horário na planilha antes de tentar novamente; a Central não repetiu a gravação.") from None
        raise SourceError("O Google não respondeu após novas tentativas de leitura. Clique em Atualizar dados ou Atualizar agenda para consultar novamente.") from None
    if not isinstance(raw, dict) or raw.get("ok") is not True or type(raw.get("schema")) is not int or raw.get("schema") != 1:
        raise SourceError("O conector recusou a consulta. Confira a chave, a planilha e a implantação do Apps Script.")
    return raw


def _remaining_timeout(deadline):
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise httpx.ReadTimeout("Prazo da consulta encerrado.")
    return httpx.Timeout(min(20, remaining), connect=min(10, remaining))


def load_live_data():
    raw = _read_connector()
    try:
        sheets = [(item["name"], item["values"]) for item in raw["sheets"]]
        duplicates = {item["name"]: item.get("duplicates", {}) for item in raw["sheets"]}
        if not sheets:
            raise SourceError("Nenhuma aba operacional com DATA, VALOR e ATENDENTE foi encontrada na Google Planilha.")
        payload = consolidate(sheets, source="Google Planilha operacional", duplicate_lines=duplicates)
    except SourceError:
        raise
    except (KeyError, TypeError, ValueError, IndexError):
        raise SourceError("A estrutura recebida da planilha é inválida. Confira o conector instalado.") from None
    payload["sourceModified"] = raw.get("readAt", payload["loadedAt"])
    payload["live"] = True
    return payload
