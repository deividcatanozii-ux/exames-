"""Agenda consultada e reservada na Google Planilha; sem cópia independente."""
import os
import re
import unicodedata
from datetime import datetime
from uuid import UUID
from zoneinfo import ZoneInfo

import sheet_source

TIMEZONE = ZoneInfo("America/Sao_Paulo")
REQUIRED_FIELDS = ["patient", "cpf", "phone", "exam"]
SOURCE = "Google Planilha USG DIONNE"


class AgendaError(Exception):
    def __init__(self, code, message, status=503):
        self.code, self.message, self.status = code, message, status


def _text(value, maximum):
    return isinstance(value, str) and 0 < len(value.strip()) <= maximum and not re.search(r"[\x00-\x1f\x7f<>]", value)


def _slot_id(value):
    return isinstance(value, str) and bool(re.fullmatch(r"[A-Za-z0-9_-]{32,128}", value))


def _slot_datetime(day, time):
    if not isinstance(day, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day):
        raise ValueError()
    if not isinstance(time, str) or not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", time):
        raise ValueError()
    return datetime.strptime(day + " " + time, "%Y-%m-%d %H:%M").replace(tzinfo=TIMEZONE)


def _now():
    return datetime.now(TIMEZONE)


def _exam_catalog(raw, doctors, doctor=""):
    """Metadados opcionais da coluna USG; nunca carregam dados de uma reserva."""
    if not isinstance(raw, list):
        return []
    catalog = {}
    for item in raw:
        if not isinstance(item, dict):
            continue
        professional, name = item.get("doctor"), item.get("name")
        if not _text(professional, 120) or professional.strip() not in doctors or not _text(name, 100):
            continue
        professional, name = professional.strip(), " ".join(name.split())
        if doctor and professional != doctor:
            continue
        if name.startswith(("=", "+", "-", "@")) or any(unicodedata.category(char).startswith("C") for char in name):
            continue
        if "@" in name or re.search(r"(?:[a-z][a-z0-9+.-]*://|\bwww\.|\b(?:https?|mailto):|\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b)", name, re.I):
            continue
        if len(re.sub(r"[^0-9]", "", name)) >= 7 or not any(unicodedata.category(char).startswith("L") for char in name):
            continue
        normalized = "".join(char for char in unicodedata.normalize("NFKD", name.casefold()) if not unicodedata.combining(char))
        catalog.setdefault((professional, normalized), {"doctor": professional, "name": name})
    return sorted(catalog.values(), key=lambda item: (item["doctor"].casefold(), item["name"].casefold()))


def load_availability(doctor="", day=""):
    """Consulta o Google em cada chamada e libera somente dados de vagas livres."""
    if not os.environ.get("APPS_SCRIPT_URL", "").strip() or not os.environ.get("APPS_SCRIPT_TOKEN", "").strip():
        raise AgendaError("CONNECTION_REQUIRED", "Conecte a planilha pelo arquivo CONECTAR PLANILHA.cmd. Use a URL do aplicativo da Web terminada em /exec.")
    raw = sheet_source._read_connector("agenda_operacional")
    try:
        if not isinstance(raw.get("slots"), list):
            raise ValueError()
        remote = raw.get("booking", {})
        if not isinstance(remote, dict) or ("enabled" in remote and type(remote["enabled"]) is not bool):
            raise ValueError()
        required = remote.get("required", REQUIRED_FIELDS)
        if not isinstance(required, list) or any(not isinstance(field, str) or field not in REQUIRED_FIELDS for field in required):
            raise ValueError()
        if remote.get("enabled") is True and set(required) != set(REQUIRED_FIELDS):
            raise ValueError()
        # Mensagens externas não são reproduzidas: podem conter dados da linha.
        booking = {
            "enabled": remote.get("enabled") is True,
            "required": REQUIRED_FIELDS.copy(),
            "reason": "" if remote.get("enabled") is True else "A escrita da agenda ainda não foi habilitada no conector Google.",
        }
        doctors = set()
        provided_doctors = raw.get("doctors", [])
        if not isinstance(provided_doctors, list) or any(not _text(value, 120) for value in provided_doctors):
            raise ValueError()
        doctors.update(value.strip() for value in provided_doctors)
        slots, seen, now, legacy_connector = {}, {}, _now(), False
        for item in raw["slots"]:
            if not isinstance(item, dict):
                raise ValueError()
            identifier, professional = item["id"], item["doctor"]
            status, date, time = item["status"], item["date"], item["time"]
            if not _slot_id(identifier) or not _text(professional, 120) or status not in ("AVAILABLE", "OCCUPIED"):
                raise ValueError()
            when = _slot_datetime(date, time)
            # A versão antiga oferece catálogo por examId; a atual grava texto USG.
            # Mantemos a leitura real, sem oferecer uma confirmação incompatível.
            legacy_connector = legacy_connector or "examIds" in item
            professional = professional.strip()
            signature = (professional, date, time, status)
            if identifier in seen and seen[identifier] != signature:
                raise ValueError()
            seen[identifier] = signature
            doctors.add(professional)
            if status != "AVAILABLE" or when <= now or (doctor and professional != doctor) or (day and date != day):
                continue
            slot = {"id": identifier, "doctor": professional, "date": date, "time": time, "status": "AVAILABLE"}
            if identifier in slots and slots[identifier] != slot:
                raise ValueError()
            slots[identifier] = slot
        if legacy_connector:
            booking["enabled"] = False
            booking["reason"] = "O conector Google está em uma versão anterior. Atualize ConectorCentral.gs e AgendaOperacional.gs no mesmo projeto e publique uma nova versão da implantação para confirmar agendamentos."
        year, blocks = raw.get("baseYear"), raw.get("unidentifiedBlocks", 0)
        if (year is not None and (type(year) is not int or not 1900 <= year <= 9999)) or type(blocks) is not int or not 0 <= blocks <= 1_000_000:
            raise ValueError()
        # O horário de leitura é metadado técnico, nunca texto arbitrário da fonte.
        read_at = raw.get("readAt")
        if not isinstance(read_at, str) or len(read_at) > 40:
            raise ValueError()
        datetime.fromisoformat(read_at.replace("Z", "+00:00"))
        return {
            "slots": sorted(slots.values(), key=lambda item: (item["date"], item["time"], item["doctor"])),
            "doctors": sorted(doctors), "booking": booking, "baseYear": year,
            "exams": _exam_catalog(raw.get("exams"), doctors, doctor),
            "unidentifiedBlocks": blocks, "readAt": read_at, "source": SOURCE, "live": True,
        }
    except (KeyError, TypeError, ValueError, OverflowError):
        raise AgendaError("SCHEMA_INVALID", "Atualize o conector de agendas e confira a estrutura da Google Planilha.") from None


def _validate_request(body):
    """Validação sem mensagens que repitam os dados pessoais enviados."""
    allowed = {"slotId", "patient", "cpf", "phone", "exam", "requestId", "valueCents"}
    if not isinstance(body, dict) or set(body) - allowed or not _slot_id(body.get("slotId")):
        raise AgendaError("INVALID_DATA", "Confira os campos do agendamento.", 422)
    for key, limit in (("patient", 120), ("exam", 100)):
        if not _text(body.get(key), limit) or body[key].strip().startswith(("=", "+", "-", "@")):
            raise AgendaError("INVALID_DATA", "Informe nome completo e exame válidos.", 422)
    try:
        if not isinstance(body.get("requestId"), str):
            raise ValueError()
        request_id = str(UUID(body["requestId"]))
    except (ValueError, TypeError, AttributeError):
        raise AgendaError("INVALID_DATA", "Atualize a agenda e tente novamente.", 422) from None
    cpf, phone = body.get("cpf"), body.get("phone")
    if not isinstance(cpf, str) or not isinstance(phone, str) or len(cpf) > 20 or len(phone) > 30:
        raise AgendaError("INVALID_DATA", "Confira o CPF e o telefone com DDD.", 422)
    if re.search(r"[^0-9.\s-]", cpf) or re.search(r"[^0-9+()\s-]", phone):
        raise AgendaError("INVALID_DATA", "Confira o CPF e o telefone com DDD.", 422)
    cpf, phone = re.sub(r"[^0-9]", "", cpf), re.sub(r"[^0-9]", "", phone)
    if len(cpf) != 11 or not 10 <= len(phone) <= 15:
        raise AgendaError("INVALID_DATA", "Confira o CPF e o telefone com DDD.", 422)
    value = body.get("valueCents")
    if "valueCents" in body and (type(value) is not int or not 0 <= value <= 1_000_000_000):
        raise AgendaError("INVALID_DATA", "Informe um valor válido em reais.", 422)
    result = {
        "slotId": body["slotId"], "patient": body["patient"].strip(),
        "cpf": cpf, "phone": phone, "exam": body["exam"].strip(), "requestId": request_id,
    }
    if "valueCents" in body:
        result["valueCents"] = value
    return result


def reserve(body):
    request = _validate_request(body)
    raw = sheet_source._read_connector("agendar", request)
    if raw.get("booked") is not True:
        errors = {
            "SLOT_OCCUPIED": ("Este horário acabou de ser ocupado. Escolha outro horário disponível.", 409),
            "SLOT_EXPIRED": ("Este horário já passou. Escolha outro horário disponível.", 409),
            "INVALID_SLOT": ("A vaga foi alterada na planilha. Atualize a agenda e escolha outro horário.", 409),
            "SLOT_CHANGED": ("A vaga foi alterada na planilha. Atualize a agenda e escolha outro horário.", 409),
            "REQUIRED_FIELDS": ("Preencha nome completo, CPF, telefone e exame.", 422),
            "INVALID_EXAM": ("Informe um exame válido.", 422),
            "INVALID_DATA": ("Confira os campos do agendamento.", 422),
            "FORMULA_PROTECTED": ("Esta linha possui fórmulas protegidas. Confira a agenda na planilha.", 409),
            "CELL_PROTECTED": ("Esta linha possui células protegidas. Confira a agenda na planilha.", 409),
            "VALUE_MAPPING_INVALID": ("Confira a coluna VALOR na planilha ou mantenha o valor existente.", 422),
            "COLUMN_MAPPING_INVALID": ("Confira as colunas da agenda na Google Planilha antes de confirmar.", 422),
            "LOCK_BUSY": ("Outra confirmação está em andamento. Aguarde alguns segundos e tente novamente.", 503),
        }
        code = raw.get("code")
        if not isinstance(code, str):
            code = "UNCONFIRMED"
        message, status = errors.get(code, ("A gravação não foi confirmada. Confira a conexão com a Google Planilha.", 503))
        raise AgendaError(code if code in errors else "UNCONFIRMED", message, status)
    try:
        receipt = raw["receipt"]
        if not isinstance(receipt, dict) or receipt["slotId"] != request["slotId"]:
            raise ValueError()
        if not _text(receipt["doctor"], 120) or receipt["exam"] != request["exam"]:
            raise ValueError()
        _slot_datetime(receipt["date"], receipt["time"])
        result = {key: receipt[key] for key in ("slotId", "doctor", "exam", "date", "time")}
        if "valueCents" in request and "valueCents" not in receipt:
            raise ValueError()
        if "valueCents" in receipt:
            if type(receipt["valueCents"]) is not int or not 0 <= receipt["valueCents"] <= 1_000_000_000:
                raise ValueError()
            if "valueCents" not in request or receipt["valueCents"] != request["valueCents"]:
                raise ValueError()
            result["valueCents"] = receipt["valueCents"]
        return {"booked": True, "receipt": result, "message": "Agendamento realizado com sucesso"}
    except (KeyError, TypeError, ValueError, OverflowError):
        raise AgendaError("UNCONFIRMED", "Não foi possível confirmar a gravação. Atualize a agenda antes de tentar novamente.") from None
