"""Plain, stable calendar records shared by the workspace and translation cache."""
from datetime import datetime, timezone, timedelta
from html.parser import HTMLParser
import hashlib


def academic_year(now=None):
    local = (now or datetime.now(timezone.utc)).astimezone(timezone(timedelta(hours=8)))
    return local.year if local.month >= 9 else local.year - 1


def year_window(year):
    return f'{year}-09-01', f'{year + 1}-08-31'


class _Text(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts, self.hidden = [], 0
    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style'): self.hidden += 1
        if tag in ('p', 'br', 'li', 'h1', 'h2', 'h3'): self.parts.append('\n')
    def handle_endtag(self, tag):
        if tag in ('script', 'style'): self.hidden = max(0, self.hidden - 1)
    def handle_data(self, value):
        if not self.hidden: self.parts.append(value)


def text(value):
    parser = _Text()
    parser.feed(value or '')
    return '\n'.join(x.strip() for x in ''.join(parser.parts).splitlines() if x.strip())


def translation_key(value):
    return hashlib.sha256(value.encode('utf-8')).hexdigest()


def introduction(value):
    """The introductory task section, excluding subsequent rubrics/policies."""
    original = value
    for marker in ('Learning Outcomes Assessed', 'Learning Outcomes\n', 'Assessment Details\n', 'Assessment Weighting\n'):
        value = value.split(marker, 1)[0]
    if not value.strip(): value = original
    if len(value) > 2000:
        end = value.rfind('\n', 0, 2000)
        value = value[:end if end > 1000 else 2000]
    return value.strip()


def prepare_translation(event, cache):
    source = event.get('description', '')
    identity = translation_key(event['name'] + '\n' + source)
    translated = cache.get(identity)
    return {**event, 'translation_key': identity,
        'name_zh': translated.get('name_zh') if translated else None,
        'description_zh': translated.get('description_zh') if translated else ('Canvas 未提供事件介绍。' if not source else None),
        'translation_status': 'empty' if not source else ('ready' if translated else 'pending'),
        'introduction_is_excerpt': introduction(source) != source}


def merge_events(raw, assignments, courses, groups=()):
    course_map = {str(c['id']): c for c in courses}
    group_map = {str(g['id']): g for g in groups}
    result, seen = [], set()
    assignment_ids = {(str(a['course_id']), str(a['id'])) for a in assignments}
    for event in raw:
        context = event.get('effective_context_code') or event.get('context_code') or ''
        course_id = context.removeprefix('course_') if context.startswith('course_') else None
        group = group_map.get(context.removeprefix('group_'), {}) if context.startswith('group_') else {}
        course_id = course_id or group.get('course_id')
        assignment = event.get('assignment') or {}
        assignment_id = assignment.get('id') or str(event.get('id', '')).removeprefix('assignment_') if str(event.get('id', '')).startswith('assignment_') or assignment else None
        if assignment_id and (str(course_id), str(assignment_id)) in assignment_ids: continue
        start = event.get('start_at') or assignment.get('due_at')
        if not start: continue
        identity = f"event:{event.get('id')}"
        if identity in seen: continue
        seen.add(identity)
        course = course_map.get(str(course_id), {})
        result.append({'id': identity, 'kind': 'assignment' if assignment_id else 'event',
            'course_id': int(course_id) if course_id and str(course_id).isdigit() else None,
            'course': course.get('name') or group.get('name') or '个人日历', 'code': course.get('code', ''),
            'name': text(event.get('title') or assignment.get('name') or '日历事件'),
            'start': start, 'end': event.get('end_at'), 'all_day': bool(event.get('all_day')),
            'description': text(event.get('description') or assignment.get('description')),
            'url': event.get('html_url'), 'location': text(event.get('location_name')),
            'assignment_key': f'{course_id}:{assignment_id}' if assignment_id else None})
    for a in assignments:
        if not a.get('due_at'): continue
        identity = f"assignment:{a['course_id']}:{a['id']}"
        if identity in seen: continue
        seen.add(identity)
        course = course_map.get(str(a['course_id']), {})
        result.append({'id': identity, 'kind': 'assignment', 'course_id': a['course_id'],
            'course': a.get('course') or course.get('name', ''), 'code': a.get('code') or course.get('code', ''),
            'name': a['name'], 'start': a['due_at'], 'end': None, 'all_day': False,
            'description': a.get('description', ''), 'url': a.get('url'), 'location': '',
            'assignment_key': f"{a['course_id']}:{a['id']}", 'status': a.get('status')})
    return sorted(result, key=lambda x: (x['start'], x['id']))
