"""Central com dados financeiros e agenda consultados pelo conector Google."""
import json
from pathlib import Path
from urllib.parse import urlparse

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse, Response
from starlette.concurrency import run_in_threadpool
from agenda import AgendaError, load_availability, reserve
from sheet_source import load_live_data, SourceError

ROOT = Path(__file__).resolve().parent
app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
PRIVATE_HEADERS = {"Cache-Control": "no-store"}

@app.get("/", response_class=HTMLResponse)
@app.get("/central.html", response_class=HTMLResponse)
def central():
    return HTMLResponse((ROOT / "views" / "central.html").read_bytes(), headers={"Cache-Control": "no-cache"})

@app.get("/api/data")
def data():
    try:
        return JSONResponse(load_live_data(), headers={"Cache-Control": "no-store"})
    except SourceError as error:
        return JSONResponse({"error": str(error)}, status_code=503, headers={"Cache-Control": "no-store"})


def agenda_error(error):
    if isinstance(error, AgendaError):
        return JSONResponse({"error": error.message, "code": error.code}, status_code=error.status, headers=PRIVATE_HEADERS)
    return JSONResponse({"error": str(error)}, status_code=503, headers=PRIVATE_HEADERS)


@app.get("/api/agenda/availability")
def availability(doctor: str = "", date: str = ""):
    try:
        return JSONResponse(load_availability(doctor=doctor, day=date), headers=PRIVATE_HEADERS)
    except (AgendaError, SourceError) as error:
        return agenda_error(error)


def _same_origin(request):
    """Impede confirmação por páginas externas; não envia credenciais ao browser."""
    if request.headers.get("sec-fetch-site", "").lower() == "cross-site":
        return False
    try:
        origin = urlparse(request.headers.get("origin", ""))
        host = urlparse("http://" + request.headers.get("host", ""))
        if origin.scheme not in ("http", "https") or not origin.hostname or origin.username or origin.password:
            return False
        if request.url.scheme == "https" and origin.scheme != "https":
            return False
        if origin.query or origin.fragment or origin.path not in ("", "/"):
            return False
        if host.username or host.password or host.query or host.fragment or host.path:
            return False
        origin_port = origin.port
        host_port = host.port
        # HTTPS é terminado pelo proxy da Vercel; o processo interno pode usar HTTP.
        if origin_port == (443 if origin.scheme == "https" else 80):
            origin_port = None
        if host_port == (443 if origin.scheme == "https" else 80):
            host_port = None
        return origin.hostname.casefold() == (host.hostname or "").casefold() and origin_port == host_port
    except ValueError:
        return False


@app.post("/api/agenda/bookings")
async def booking(request: Request):
    if not _same_origin(request):
        return agenda_error(AgendaError("INVALID_ORIGIN", "Abra a Central neste navegador para confirmar o agendamento.", 403))
    if request.headers.get("content-type", "").split(";", 1)[0].strip().lower() != "application/json":
        return agenda_error(AgendaError("INVALID_DATA", "Envie os campos pelo formulário de agendamento.", 415))
    try:
        content = await request.body()
        if len(content) > 10_000:
            raise ValueError()
        body = json.loads(content)
    except (ValueError, TypeError, UnicodeDecodeError):
        return agenda_error(AgendaError("INVALID_DATA", "Confira os campos do agendamento.", 422))
    try:
        return JSONResponse(await run_in_threadpool(reserve, body), headers=PRIVATE_HEADERS)
    except (AgendaError, SourceError) as error:
        return agenda_error(error)


@app.get("/assets/agenda.js")
def agenda_script():
    return Response((ROOT / "views" / "agenda.js").read_bytes(), media_type="text/javascript", headers={"Cache-Control": "no-cache"})


@app.get("/assets/agenda.css")
def agenda_styles():
    return Response((ROOT / "views" / "agenda.css").read_bytes(), media_type="text/css", headers={"Cache-Control": "no-cache"})

@app.get("/favicon.ico")
def favicon():
    return Response(status_code=204)
