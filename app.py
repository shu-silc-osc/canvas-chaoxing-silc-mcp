"""Local Student Center experiment. Canvas credentials stay in the server process."""
from __future__ import annotations

import asyncio
import json
import os
import secrets
import time
from contextlib import AsyncExitStack, asynccontextmanager
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from calendar_data import academic_year, year_window, merge_events, prepare_translation, introduction

ROOT = Path(__file__).resolve().parent
UPSTREAM = Path(os.environ.get('STUDENT_CENTER_UPSTREAM', ROOT / 'vendor/canvas-mcp'))
LEGACY = Path(os.environ.get('STUDENT_CENTER_LEGACY', ROOT / 'legacy/canvas-insearch'))
if not os.environ.get('CANVAS_API_TOKEN') and os.name == 'nt':
    import winreg
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, 'Environment') as key:
            os.environ['CANVAS_API_TOKEN'] = winreg.QueryValueEx(key, 'CANVAS_API_TOKEN')[0]
    except (OSError, ValueError):
        pass

# The experiment uses the upstream's operator gates, not UI-only restrictions.
os.environ.update({
    'CANVAS_API_URL': 'https://insearch.instructure.com/api/v1',
    'CANVAS_ROLE': 'student', 'ALLOWED_WRITE_TOOLS': 'none',
    'STUDENT_WRITE_TOOLS': '', 'EXECUTE_TYPESCRIPT_ENABLED': 'false',
    'TIMEZONE': 'Asia/Shanghai', 'LOG_LEVEL': 'WARNING',
})

from fastmcp import Client
from fastmcp.client.transports import StdioTransport
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import HTMLResponse, JSONResponse
from starlette.routing import Route, Mount
from starlette.staticfiles import StaticFiles
from canvas_mcp.server import create_server, register_all_tools
from canvas_mcp.core.tool_policy import apply_tool_policy, resolve_tool_policy, TOOL_EFFECTS, Effect
from canvas_mcp.core.client import fetch_all_paginated_results, make_canvas_request, cleanup_http_client
from canvas_mcp.tools.student_grades import COURSE_INCLUDES
from grade_calculator import calculate as calculate_grade, load_course as load_grade_course

SESSION = secrets.token_hex(32)
state = {'clients': {}, 'tools': [], 'cache': None, 'cached_at': 0, 'last_error': None, 'calendar': {}, 'contexts': None}
refresh_lock = asyncio.Lock()
calendar_lock = asyncio.Lock()
TRANSLATION_DIR = Path(os.getenv('LOCALAPPDATA', Path.home() / '.local/share')) / 'StudentCenter'


def prepare_descriptions(events):
    try:
        cache = json.loads((TRANSLATION_DIR / 'translations.zh-CN.json').read_text(encoding='utf-8'))
    except (OSError, ValueError):
        cache = {}
    prepared = [prepare_translation(e, cache) for e in events]
    pending = {e['translation_key']: {'name': e['name'], 'introduction': introduction(e['description'])}
               for e in prepared if e['translation_status'] == 'pending'}
    # Only a translation work queue is persisted; no token or account credentials.
    if pending:
        try:
            TRANSLATION_DIR.mkdir(parents=True, exist_ok=True)
            path = TRANSLATION_DIR / 'translation-pending.json'
            previous = json.loads(path.read_text(encoding='utf-8')) if path.exists() else {}
            previous.update(pending)
            previous = {k: v for k, v in previous.items() if k not in cache}
            temp = path.with_suffix('.tmp')
            temp.write_text(json.dumps(previous, ensure_ascii=False), encoding='utf-8')
            temp.replace(path)
        except (OSError, ValueError):
            pass
    return prepared
manifest = json.loads((UPSTREAM / 'tools/TOOL_MANIFEST.json').read_text(encoding='utf-8'))
categories = {t['name']: t['category'] for t in manifest['tools']}
# The manifest labels these educator, but upstream registers their read variants
# in register_shared_assignment_tools for the student profile as well.
categories.update({'list_assignments': 'shared', 'get_assignment_details': 'shared', 'search_canvas_tools': 'shared'})


class PlainText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.hidden = 0
    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style'): self.hidden += 1
        if tag in ('p', 'br', 'li', 'h1', 'h2', 'h3', 'tr'): self.parts.append('\n')
    def handle_endtag(self, tag):
        if tag in ('script', 'style'): self.hidden = max(0, self.hidden - 1)
    def handle_data(self, data):
        if not self.hidden: self.parts.append(data)


def plain(value):
    parser = PlainText()
    parser.feed(value or '')
    return '\n'.join(line.strip() for line in ''.join(parser.parts).splitlines() if line.strip())


def public_url(value):
    from urllib.parse import urlparse
    if not value: return None
    parsed = urlparse(value)
    if parsed.scheme == 'https' and parsed.hostname == 'insearch.instructure.com' and not parsed.username:
        return value
    return None


def normalize_assignment(a, course, now=None):
    now = now or datetime.now(timezone.utc)
    due = a.get('due_at')
    try: past = datetime.fromisoformat(due.replace('Z', '+00:00')) < now if due else False
    except (ValueError, TypeError): past = False
    sub = a.get('submission') or {}
    workflow = sub.get('workflow_state')
    types = a.get('submission_types') or []
    if sub.get('excused'): status = 'excused'
    elif workflow == 'graded': status = 'graded'
    elif workflow in ('submitted', 'pending_review'): status = 'submitted'
    elif 'external_tool' in types: status = 'external'
    elif sub.get('missing'): status = 'missing'
    elif any(t in types for t in ('none', 'on_paper')): status = 'classroom'
    elif workflow == 'unsubmitted': status = 'past_due' if past else 'todo'
    else: status = 'unknown'
    return {
        'id': a['id'], 'course_id': course['id'], 'course': course['name'], 'code': course['code'],
        'name': a.get('name') or '未命名作业', 'due_at': due,
        'unlock_at': a.get('unlock_at'), 'lock_at': a.get('lock_at'),
        'points': a.get('points_possible'), 'score': sub.get('score'),
        'status': status, 'late': sub.get('late') is True,
        'submission_types': types, 'submitted_at': sub.get('submitted_at'),
        'description': plain(a.get('description')),
        'url': public_url(a.get('html_url')) or f"https://insearch.instructure.com/courses/{course['id']}/assignments/{a['id']}",
    }


@asynccontextmanager
async def lifespan(app):
    server = create_server()
    register_all_tools(server, role='student')
    await apply_tool_policy(server, resolve_tool_policy('none', 'stdio'))
    async with AsyncExitStack() as stack:
        client = await stack.enter_async_context(Client(server, timeout=90))
        state['clients']['upstream'] = client
        for tool in await client.list_tools():
            spec = tool.model_dump(mode='json', by_alias=True)
            allowed = TOOL_EFFECTS.get(tool.name) == Effect.READ
            state['tools'].append({**spec, 'provider': 'upstream', 'category': categories.get(tool.name, 'shared'), 'enabled': allowed})
        try:
            transport = StdioTransport(str(LEGACY / '.venv/Scripts/canvas-insearch-mcp.exe'), args=[],
                env={**os.environ, 'CANVAS_API_URL': 'https://insearch.instructure.com'}, cwd=str(LEGACY))
            legacy = await stack.enter_async_context(Client(transport, timeout=60, mode='legacy'))
            state['clients']['legacy'] = legacy
            for tool in await legacy.list_tools():
                state['tools'].append({**tool.model_dump(mode='json', by_alias=True), 'provider': 'legacy', 'category': 'legacy',
                    'enabled': tool.name in ('list_courses', 'get_course_details', 'list_assignments')})
        except Exception:
            state['last_error'] = '旧版 MCP 未连接；上游学生工具仍可使用。'
        yield
        await cleanup_http_client()


async def guard(request):
    host = request.headers.get('host', '').split(':')[0]
    if host not in ('127.0.0.1', 'localhost'): return JSONResponse({'error': 'Only localhost is allowed'}, status_code=403)
    origin = request.headers.get('origin')
    if origin and origin not in ('http://127.0.0.1:8768', 'http://localhost:8768'):
        return JSONResponse({'error': 'Cross-origin request refused'}, status_code=403)
    if not secrets.compare_digest(request.headers.get('x-student-center-session', ''), SESSION):
        return JSONResponse({'error': '请从工作台首页打开此页面。'}, status_code=403)
    return None


async def index(request):
    if request.headers.get('host', '').split(':')[0] not in ('127.0.0.1', 'localhost'):
        return JSONResponse({'error': 'Only localhost is allowed'}, status_code=403)
    html = (ROOT / 'static/index.html').read_text(encoding='utf-8').replace('__SESSION__', json.dumps(SESSION))
    return HTMLResponse(html, headers={'Cache-Control': 'no-store', 'Content-Security-Policy':
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'"})


async def health(request):
    denied = await guard(request)
    if denied: return denied
    return JSONResponse({'ok': True, 'profile': 'student', 'version': manifest['version'],
        'token_present': bool(os.getenv('CANVAS_API_TOKEN')), 'upstream_tools': sum(t['provider'] == 'upstream' for t in state['tools']),
        'legacy_tools': sum(t['provider'] == 'legacy' for t in state['tools']), 'write_tools_enabled': 0})


async def tool_list(request):
    denied = await guard(request)
    if denied: return denied
    return JSONResponse({'tools': state['tools'], 'version': manifest['version'], 'error': state['last_error']})


async def call_tool(request):
    denied = await guard(request)
    if denied: return denied
    if int(request.headers.get('content-length', '0') or '0') > 100000:
        return JSONResponse({'error': '参数过大'}, status_code=413)
    try:
        body = await request.json()
        provider, name = body.get('provider', 'upstream'), body.get('name')
        tool = next((t for t in state['tools'] if t['provider'] == provider and t['name'] == name), None)
        if not tool or not tool['enabled']:
            return JSONResponse({'error': '此工具未在学生只读实验中开放。'}, status_code=403)
        args = body.get('arguments', {})
        if not isinstance(args, dict): return JSONResponse({'error': '参数必须是 JSON 对象'}, status_code=400)
        result = await state['clients'][provider].call_tool(name, args, raise_on_error=False)
        blocks = [getattr(c, 'text', '') for c in result.content]
        return JSONResponse({'name': name, 'is_error': result.is_error, 'text': '\n'.join(blocks),
            'structured': result.structured_content})
    except json.JSONDecodeError:
        return JSONResponse({'error': '无效 JSON'}, status_code=400)
    except Exception as exc:
        # Do not surface exception reprs or credentials from third party libraries.
        return JSONResponse({'error': f'工具调用未完成（{type(exc).__name__}），请检查参数后重试。'}, status_code=502)


async def load_dashboard():
    errors = []
    async def read(path, params=None, paginate=True):
        error = ''
        for attempt in range(3):
            try:
                data = await (fetch_all_paginated_results(path, params) if paginate else make_canvas_request('get', path, params=params))
                if not (isinstance(data, dict) and 'error' in data): return data
                error = str(data['error'])[:250]
                if any(code in error for code in ('401', '403', '404')): break
            except Exception as exc:
                error = type(exc).__name__
            if attempt < 2: await asyncio.sleep(.5 * (attempt + 1))
        errors.append({'source': path, 'error': error})
        return [] if paginate else {}

    raw_courses = await read('/courses', {'enrollment_state': 'active', 'include[]': ['term', 'total_scores'], 'per_page': 100})
    courses = []
    for c in raw_courses if isinstance(raw_courses, list) else []:
        enrollment = next((e for e in c.get('enrollments', []) if e.get('type') == 'student'), {})
        courses.append({'id': c['id'], 'name': c.get('name', '未命名课程'), 'code': c.get('course_code', ''),
            'term': (c.get('term') or {}).get('name', ''), 'grade': enrollment.get('computed_current_score'),
            'role': enrollment.get('role') or enrollment.get('type') or '未报告',
            'url': f"https://insearch.instructure.com/courses/{c['id']}"})
    sem = asyncio.Semaphore(2)
    async def assignments(course):
        async with sem:
            data = await read(f"/courses/{course['id']}/assignments", {'include[]': ['submission'], 'per_page': 100})
            return [normalize_assignment(a, course) for a in data if isinstance(a, dict) and 'id' in a] if isinstance(data, list) else []
    groups = await asyncio.gather(*(assignments(c) for c in courses))
    all_assignments = [a for group in groups for a in group]
    todos = await read('/users/self/todo', {'per_page': 100})
    todo_items = []
    for t in todos if isinstance(todos, list) else []:
        a = t.get('assignment') or t.get('quiz') or {}
        todo_items.append({'name': a.get('name') or t.get('type') or '待办', 'course_id': t.get('course_id'),
            'due_at': a.get('due_at'), 'url': public_url(t.get('html_url') or a.get('html_url'))})
    state['calendar'].clear()
    state['contexts'] = None
    year = academic_year()
    calendar = await load_calendar(year, courses, all_assignments)
    errors.extend(calendar['errors'])
    return {'courses': courses, 'assignments': all_assignments, 'todos': todo_items,
        'calendar_events': calendar['events'], 'academic_year': year,
        'fetched_at': datetime.now(timezone.utc).isoformat(), 'errors': errors, 'source': 'Canvas API · upstream client',
        'version': manifest['version'], 'tool_count': sum(t['provider'] == 'upstream' for t in state['tools'])}


async def load_calendar(year, courses, assignments):
    from canvas_mcp.tools.student_calendar import _fetch_events
    errors = []
    if state['contexts'] is None:
        context_results = await asyncio.gather(make_canvas_request('get', '/users/self'),
            fetch_all_paginated_results('/users/self/groups', {'per_page': 100}), return_exceptions=True)
        me, groups = context_results
        course_ids = {str(c['id']) for c in courses}
        if not isinstance(groups, list):
            groups = []
            errors.append({'source': '小组日历', 'error': '未能读取小组列表'})
        groups = [g for g in groups if g.get('context_type') != 'Course' or str(g.get('course_id')) in course_ids]
        contexts = [f"course_{c['id']}" for c in courses]
        if isinstance(me, dict) and me.get('id'):
            contexts.insert(0, f"user_{me['id']}")
        else:
            errors.append({'source': '个人日历', 'error': '未能确认个人日历参数'})
        if not errors: state['contexts'] = (contexts, groups)
    else:
        contexts, groups = state['contexts']
    start, end = year_window(year)
    try:
        raw, failures, _ = await _fetch_events([contexts, [f"group_{g['id']}" for g in groups]],
            ('event', 'assignment'), start, end, True)
    except Exception as exc:
        raw, failures = [], [type(exc).__name__]
    if failures: errors.append({'source': '日历', 'error': f'{len(failures)} 个来源未能读取，可刷新重试'})
    events = merge_events(raw, assignments, courses, groups)
    for event in events: event['url'] = public_url(event.get('url'))
    result = {'year': year, 'events': prepare_descriptions(events), 'errors': errors}
    if not errors: state['calendar'][year] = (time.monotonic(), result)
    return result


async def calendar_feed(request):
    denied = await guard(request)
    if denied: return denied
    try:
        year = int(request.query_params.get('year', academic_year()))
        if not 2000 <= year <= 2100: raise ValueError()
    except (TypeError, ValueError):
        return JSONResponse({'error': '学年必须在 2000–2100 之间'}, status_code=400)
    async with calendar_lock:
        data = state['cache']
        if not data: return JSONResponse({'error': '请先连接 Canvas'}, status_code=409)
        cached = state['calendar'].get(year)
        if cached and time.monotonic() - cached[0] < 300:
            result = {**cached[1], 'events': prepare_descriptions(cached[1]['events'])}
        else:
            result = await load_calendar(year, data['courses'], data['assignments'])
        if year == data.get('academic_year'):
            data['calendar_events'] = result['events']
            data['errors'] = [e for e in data['errors'] if e['source'] not in ('日历', '个人日历', '小组日历')] + result['errors']
    return JSONResponse(result, headers={'Cache-Control': 'no-store'})


async def dashboard(request):
    denied = await guard(request)
    if denied: return denied
    async with refresh_lock:
        if not state['cache'] or request.query_params.get('refresh') == '1' or time.monotonic() - state['cached_at'] > 300:
            state['cache'] = await load_dashboard()
            state['cached_at'] = time.monotonic()
    return JSONResponse({**state['cache'], 'calendar_events': prepare_descriptions(state['cache']['calendar_events'])},
        headers={'Cache-Control': 'no-store'})


async def grade_calculator(request):
    denied = await guard(request)
    if denied: return denied
    if not state['cache']:
        return JSONResponse({'error': '请先连接 Canvas。'}, status_code=409)
    if len(await request.body()) > 100000:
        return JSONResponse({'error': '参数过大。'}, status_code=413)
    try:
        body = await request.json()
        if not isinstance(body, dict): raise ValueError('参数必须是对象。')
        course_id = body.get('course_id')
        if isinstance(course_id, bool) or not isinstance(course_id, (str, int)) or str(course_id) not in {str(c['id']) for c in state['cache']['courses']}:
            raise ValueError('请选择已连接的课程。')
    except (ValueError, json.JSONDecodeError) as exc:
        return JSONResponse({'error': str(exc)}, status_code=400)
    try:
        async with asyncio.timeout(60):
            data = await load_grade_course(course_id, COURSE_INCLUDES)
        if isinstance(data, str):
            return JSONResponse({'error': '课程成绩数据不可用：请检查 Canvas 权限、数值成绩可见性或评分数据完整性。'}, status_code=422)
    except Exception:
        return JSONResponse({'error': '成绩读取未完成，请稍后重新查询。'}, status_code=502)
    try:
        return JSONResponse(calculate_grade(data, body), headers={'Cache-Control': 'no-store'})
    except ValueError as exc:
        return JSONResponse({'error': str(exc)}, status_code=400)
    except Exception:
        return JSONResponse({'error': '评分数据暂不能计算，请重新读取后重试。'}, status_code=502)


app = Starlette(lifespan=lifespan, routes=[Route('/', index), Route('/api/health', health),
    Route('/api/grade-calculator', grade_calculator, methods=['POST']),
    Route('/api/calendar', calendar_feed),
    Route('/api/tools', tool_list), Route('/api/dashboard', dashboard), Route('/api/call', call_tool, methods=['POST']),
    Mount('/static', app=StaticFiles(directory=ROOT / 'static'))])

if __name__ == '__main__':
    import uvicorn
    uvicorn.run(app, host='127.0.0.1', port=8768, log_level='warning', access_log=False)
