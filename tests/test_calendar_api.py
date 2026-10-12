import asyncio
import unittest
import json
import time
import tempfile
from pathlib import Path
from unittest.mock import patch, AsyncMock
from starlette.requests import Request
import app


def request(query='',session=True):
    headers=[(b'host',b'127.0.0.1:8768')]
    if session: headers.append((b'x-student-center-session',app.SESSION.encode()))
    return Request({'type':'http','method':'GET','path':'/api/calendar','query_string':query.encode(),'headers':headers})


class CalendarApiTests(unittest.IsolatedAsyncioTestCase):
    async def test_calendar_requires_connected_workspace(self):
        with patch.dict(app.state,{'cache':None}):
            response=await app.calendar_feed(request())
        self.assertEqual(response.status_code,409)

    async def test_calendar_preserves_session_guard(self):
        response=await app.calendar_feed(request(session=False))
        self.assertEqual(response.status_code,403)

    async def test_calendar_validates_year(self):
        response=await app.calendar_feed(request('year=hello'))
        self.assertEqual(response.status_code,400)

    async def test_calendar_timeout_keeps_assignment_deadlines(self):
        assignments=[{'id':42,'course_id':7,'name':'Essay','due_at':'2026-10-15T04:00:00Z','description':''}]
        with patch.dict(app.state,{'contexts':(['course_7'],[]),'calendar':{}}),patch('canvas_mcp.tools.student_calendar._fetch_events',new=AsyncMock(side_effect=TimeoutError)):
            result=await app.load_calendar(2026,[{'id':7,'name':'Math'}],assignments)
        self.assertEqual(result['events'][0]['assignment_key'],'7:42')
        self.assertTrue(result['errors'])

    async def test_cached_dashboard_picks_up_new_translation_without_network(self):
        event={'name':'Essay','description':'Write an essay.'}
        identity=app.prepare_translation(event,{})['translation_key']
        with tempfile.TemporaryDirectory() as folder:
            Path(folder,'translations.zh-CN.json').write_text(json.dumps({identity:{'name_zh':'论文','description_zh':'撰写一篇论文。'}}),encoding='utf-8')
            with patch.object(app,'TRANSLATION_DIR',Path(folder)),patch.dict(app.state,{'cache':{'calendar_events':[event]},'cached_at':time.monotonic()}):
                response=await app.dashboard(request())
        self.assertEqual(json.loads(response.body)['calendar_events'][0]['name_zh'],'论文')

    async def test_failed_context_discovery_is_not_cached_as_complete(self):
        with patch.dict(app.state,{'contexts':None,'calendar':{}}),patch.object(app,'make_canvas_request',new=AsyncMock(return_value={'id':1})),patch.object(app,'fetch_all_paginated_results',new=AsyncMock(return_value={'error':'Unavailable'})),patch('canvas_mcp.tools.student_calendar._fetch_events',new=AsyncMock(return_value=([],[],1))):
            first=await app.load_calendar(2026,[],[])
            second=await app.load_calendar(2026,[],[])
        self.assertTrue(first['errors'])
        self.assertTrue(second['errors'])

    async def test_successful_calendar_retry_clears_only_calendar_errors(self):
        data={'academic_year':2026,'calendar_events':[],'errors':[{'source':'日历','error':'temporary'},{'source':'/courses','error':'403'}]}
        result={'year':2026,'events':[],'errors':[]}
        with patch.dict(app.state,{'cache':data,'calendar':{2026:(time.monotonic(),result)}}):
            await app.calendar_feed(request('year=2026'))
            self.assertEqual(app.state['cache']['errors'],[{'source':'/courses','error':'403'}])

if __name__=='__main__': unittest.main()
