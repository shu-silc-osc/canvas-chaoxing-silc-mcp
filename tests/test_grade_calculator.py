import json
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from canvas_mcp.core import grade_calc as gc
import app
import grade_calculator as calculator
from starlette.requests import Request


def fixture(weighted=True):
    raw = [{'id': 1, 'name': '作业', 'group_weight': 40, 'assignments': [
        {'id': 11, 'name': 'Essay', 'points_possible': 100, 'submission': {'score': 80}}]},
        {'id': 2, 'name': 'Quiz', 'group_weight': 20, 'assignments': [
        {'id': 12, 'name': 'Quiz', 'points_possible': 100}]},
        {'id': 3, 'name': '考试', 'group_weight': 40, 'assignments': [
        {'id': 13, 'name': 'Final exam', 'points_possible': 100}]}]
    groups, items = gc.build_grade_model(raw)
    return SimpleNamespace(course_id='7', display='Demo', course={
        'apply_assignment_group_weights': weighted, 'enrollments': []},
        groups_json=raw, groups=groups, items=items)


class GradeCalculatorTests(unittest.TestCase):
    def test_weighted_breakdown_matches_current_and_final_basis(self):
        result = calculator.calculate(fixture(), {'target_percent': 80})
        self.assertEqual(result['current_percent'], 80)
        self.assertEqual(result['assignments'][0]['current_contribution'], 80)
        self.assertEqual(result['projection']['projected_at_zero'], 32)
        self.assertEqual(result['projection']['projected_at_full'], 92)
        self.assertEqual(result['projection']['required_percent'], 80)
        self.assertEqual(result['projection']['status'], 'reachable')

    def test_selected_exam_requires_other_remaining_assumption(self):
        result = calculator.calculate(fixture(), {'target_percent': 80,
            'solve_ids': ['13'], 'expected_percentages': {'12': 90}})
        self.assertEqual(result['projection']['required_percent'], 75)
        self.assertEqual(result['projection']['requirements'][0]['points'], 75)
        with self.assertRaises(ValueError):
            calculator.calculate(fixture(), {'target_percent': 80, 'solve_ids': ['13']})

    def test_total_points_uses_points_rather_than_group_weights(self):
        result = calculator.calculate(fixture(False), {'target_percent': 80})
        self.assertEqual(result['projection']['required_percent'], 80)
        self.assertAlmostEqual(result['projection']['projected_at_zero'], 80 / 3)

    def test_impossible_and_secured_targets(self):
        self.assertEqual(calculator.calculate(fixture(), {'target_percent': 95})['projection']['status'], 'unreachable')
        self.assertEqual(calculator.calculate(fixture(), {'target_percent': 30})['projection']['status'], 'secured')

    def test_does_not_change_original_scores(self):
        data = fixture()
        calculator.calculate(data, {'target_percent': 80, 'solve_ids': ['13'], 'expected_percentages': {'12': 90}})
        self.assertIsNone(data.items[1].score)

    def test_rejects_invalid_targets_and_unknown_or_graded_assumptions(self):
        for value in [True, '', -1, 101, float('nan'), float('inf')]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                calculator.calculate(fixture(), {'target_percent': value})
        for payload in [{'target_percent':80,'expected_percentages':{'11':80}},
                        {'target_percent':80,'solve_ids':['999']},
                        {'target_percent':80,'solve_ids':['13','13']},
                        {'target_percent':80,'solve_ids':['13'],'expected_percentages':{'12':True}},
                        {'target_percent':80,'solve_ids':['13'],'expected_percentages':{'12':101}}]:
            with self.subTest(payload=payload), self.assertRaises(ValueError):
                calculator.calculate(fixture(), payload)

    def test_no_remaining_work_and_grading_periods_are_explicit(self):
        data=fixture(); data.items=gc.apply_hypothetical_scores(data.items, {'12':80,'13':80})
        self.assertEqual(calculator.calculate(data, {'target_percent':90})['projection']['status'], 'unreachable')
        data.course['enrollments']=[{'has_grading_periods':True}]
        self.assertFalse(calculator.calculate(data, {})['projection_supported'])
        with self.assertRaises(ValueError): calculator.calculate(data, {'target_percent':80})

    def test_empty_grade_basis_is_indeterminate_instead_of_unreachable(self):
        data=fixture();data.groups_json=[];data.groups=[];data.items=[]
        result=calculator.calculate(data,{'target_percent':80})
        self.assertEqual(result['projection']['status'],'indeterminate')

    def test_drop_rules_and_exclusions_are_used(self):
        data=fixture(); raw=data.groups_json
        raw[0]['rules']={'drop_lowest':1}
        raw[0]['assignments'].extend([
            {'id':14,'name':'Low','points_possible':100,'submission':{'score':10}},
            {'id':15,'name':'Omitted','points_possible':100,'omit_from_final_grade':True,'submission':{'score':0}},
            {'id':16,'name':'Excused','points_possible':100,'submission':{'excused':True,'score':0}}])
        data.groups,data.items=gc.build_grade_model(raw)
        result=calculator.calculate(data,{})
        self.assertEqual(result['current_percent'],80)
        by_id={a['id']:a for a in result['assignments']}
        self.assertEqual(by_id['14']['status'],'dropped')
        self.assertEqual(by_id['15']['status'],'excluded')
        self.assertEqual(by_id['16']['status'],'excused')

    def test_unposted_score_is_not_displayed_or_counted(self):
        data=fixture(); data.groups_json[0]['assignments'][0]['submission']={'score':80,'posted_at':None,'workflow_state':'graded'}
        data.groups,data.items=gc.build_grade_model(data.groups_json)
        result=calculator.calculate(data,{})
        self.assertIsNone(result['assignments'][0]['score'])
        self.assertIsNone(result['current_percent'])

    def test_simultaneous_drop_rules_label_non_monotone_solution(self):
        data=fixture()
        data.groups_json[0]['rules']={'drop_lowest':1,'drop_highest':1}
        data.groups_json[0]['assignments'].extend([
            {'id':14,'name':'Other','points_possible':100,'submission':{'score':70}},
            {'id':15,'name':'Next','points_possible':100}])
        data.groups,data.items=gc.build_grade_model(data.groups_json)
        result=calculator.calculate(data,{'target_percent':80})
        self.assertTrue(result['projection']['non_monotone'])


def request(payload, session=True):
    body=json.dumps(payload).encode()
    async def receive(): return {'type':'http.request','body':body,'more_body':False}
    headers=[(b'host',b'127.0.0.1:8768')]
    if session:headers.append((b'x-student-center-session',app.SESSION.encode()))
    return Request({'type':'http','method':'POST','path':'/api/grade-calculator','headers':headers},receive)


class GradeCalculatorApiTests(unittest.IsolatedAsyncioTestCase):
    async def test_nullable_excused_from_canvas_is_not_treated_as_malformed(self):
        raw=fixture().groups_json
        raw[0]['assignments'][0]['submission']['excused']=None
        raw[1]['assignments'][0]['submission']={'excused':True}
        with patch.object(calculator,'make_canvas_request',new=AsyncMock(return_value={'restrict_quantitative_data':False,'apply_assignment_group_weights':True})),patch.object(calculator,'fetch_all_paginated_results',new=AsyncMock(return_value=raw)):
            data=await calculator.load_course('7',[])
        self.assertNotIsInstance(data,str)
        self.assertEqual(calculator.calculate(data,{})['current_percent'],80)
        self.assertTrue(data.items[1].excused)
        self.assertIsNone(raw[0]['assignments'][0]['submission']['excused'])

    async def test_loader_keeps_restriction_and_malformed_boolean_checks(self):
        with patch.object(calculator,'make_canvas_request',new=AsyncMock(return_value={'restrict_quantitative_data':True})):
            self.assertIsInstance(await calculator.load_course('7',[]),str)
        raw=fixture().groups_json;raw[0]['assignments'][0]['submission']['excused']='false'
        with patch.object(calculator,'make_canvas_request',new=AsyncMock(return_value={'restrict_quantitative_data':False})),patch.object(calculator,'fetch_all_paginated_results',new=AsyncMock(return_value=raw)):
            self.assertIsInstance(await calculator.load_course('7',[]),str)

    async def test_library_value_error_does_not_expose_credentials(self):
        with patch.dict(app.state,{'cache':{'courses':[{'id':7}]}}),patch.object(app,'load_grade_course',new=AsyncMock(side_effect=ValueError('private credential'))):
            response=await app.grade_calculator(request({'course_id':7}))
        self.assertEqual(response.status_code,502)
        self.assertNotIn('private credential',response.body.decode())

    async def test_guard_and_connected_course_are_required(self):
        self.assertEqual((await app.grade_calculator(request({'course_id':7},False))).status_code,403)
        with patch.dict(app.state,{'cache':None}):
            self.assertEqual((await app.grade_calculator(request({'course_id':7}))).status_code,409)
        with patch.dict(app.state,{'cache':{'courses':[{'id':7}]}}):
            self.assertEqual((await app.grade_calculator(request({'course_id':8}))).status_code,400)

    async def test_returns_structured_projection_without_leaking_upstream_error(self):
        with patch.dict(app.state,{'cache':{'courses':[{'id':7}]}}),patch.object(app,'load_grade_course',new=AsyncMock(return_value=fixture())):
            response=await app.grade_calculator(request({'course_id':7,'target_percent':80}))
        self.assertEqual(response.status_code,200)
        self.assertEqual(json.loads(response.body)['projection']['required_percent'],80)
        with patch.dict(app.state,{'cache':{'courses':[{'id':7}]}}),patch.object(app,'load_grade_course',new=AsyncMock(return_value='Error: private token')):
            response=await app.grade_calculator(request({'course_id':7}))
        self.assertEqual(response.status_code,422)
        self.assertNotIn('private token',response.body.decode())
