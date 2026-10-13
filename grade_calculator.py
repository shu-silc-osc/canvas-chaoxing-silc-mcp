"""Structured, read-only adapter for the pinned Canvas grade arithmetic."""
from __future__ import annotations

import math
from copy import deepcopy
from types import SimpleNamespace
from canvas_mcp.core import grade_calc as gc
from canvas_mcp.core.client import make_canvas_request, fetch_all_paginated_results


async def load_course(course_id, includes):
    """Load the selected student's grade data, keeping visibility gates intact."""
    course = await make_canvas_request('get', f'/courses/{course_id}', params={'include[]': includes})
    if not isinstance(course, dict) or 'error' in course: return 'course_unavailable'
    if course.get('restrict_quantitative_data') is not False: return 'quantitative_visibility_unconfirmed'
    raw = await fetch_all_paginated_results(f'/courses/{course_id}/assignment_groups',
                                           {'include[]': ['assignments', 'submission'], 'per_page': 100})
    if not isinstance(raw, list): return 'groups_unavailable'
    groups_json = deepcopy(raw)
    # Canvas serializes the nullable excused database attribute directly. Only
    # true excuses an assignment. Normalize null, retaining all other validation.
    # https://github.com/instructure/canvas-lms/blob/master/lib/api/v1/submission.rb
    for group in groups_json:
        if not isinstance(group, dict) or not isinstance(group.get('assignments'), list): continue
        for assignment in group['assignments']:
            submission = assignment.get('submission') if isinstance(assignment, dict) else None
            if isinstance(submission, dict) and 'excused' in submission and submission['excused'] is None:
                submission['excused'] = False
    try: groups, items = gc.build_grade_model(groups_json)
    except gc.MalformedGradeData: return 'malformed_grade_data'
    return SimpleNamespace(course_id=str(course_id), course=course, groups_json=groups_json,
                           groups=groups, items=items, display=str(course.get('course_code') or course.get('name') or course_id))


def percentage(value, label):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not 0 <= value <= 100:
        raise ValueError(f'{label}须为 0–100 的数字。')
    return float(value)


def calculate(data, payload):
    weighted = data.course.get('apply_assignment_group_weights')
    if not isinstance(weighted, bool):
        raise ValueError('Canvas 未提供明确的作业组加权设置，暂不能计算。')
    groups, items = data.groups, data.items
    current = gc.calculate_course(groups, items, weighted, include_ungraded=False)
    remaining = {i.assignment_id: i for i in gc.remaining_items(items)}
    metadata = {str(a['id']): a for g in data.groups_json for a in g.get('assignments', [])}
    group_names = {str(g['id']): str(g.get('name') or '未命名作业组') for g in data.groups_json}
    group_grades = {g.group_id: g for g in current.groups}
    total_possible = sum(g.possible for g in current.groups)
    warnings = ['基于当前可见作业与规则；未发布项目、后续规则变更及教师总评覆盖不会自动纳入预测。',
                '未评分项目含已提交待评分和缺交项目，预计得分不代表仍可补交。']
    periods = any(e.get('has_grading_periods') for e in data.course.get('enrollments', []) if isinstance(e, dict)) or bool(data.course.get('grading_periods')) or data.course.get('grading_periods_enabled') is True
    if periods: warnings.append('课程使用评分周期；当前展示按可见作业汇总，暂不预测跨周期总评。')
    canvas_score = next((e.get('computed_current_score') for e in data.course.get('enrollments', [])
                         if isinstance(e, dict) and e.get('type') in ('student', 'StudentEnrollment')), None)
    if isinstance(canvas_score, (int, float)) and current.percent is not None and abs(canvas_score-current.percent) > .015:
        warnings.append('本地重算与 Canvas 当前成绩不同，请核对评分周期、教师覆盖和可见数据；预测仅按当前作业模型。')
    rows = []
    for item in items:
        raw = metadata[item.assignment_id]
        group = group_grades[item.group_id]
        status = ('excluded' if not item.counts_toward_grade else 'excused' if item.excused else
                  'dropped' if item.assignment_id in group.dropped else 'graded' if item.is_graded else 'remaining')
        contribution = None
        if status == 'graded' and item.assignment_id in group.kept:
            if weighted and group.possible > 0:
                factor = 100/current.counted_weight if 0 < current.counted_weight < 100 else 1
                contribution = item.score/group.possible*group.weight*factor
            elif not weighted and total_possible > 0:
                contribution = item.score/total_possible*100
        rows.append({'id': item.assignment_id, 'group_id': item.group_id,
                     'name': str(raw.get('name') or '未命名作业'), 'points_possible': item.points_possible,
                     'score': item.score if item.is_graded else None, 'status': status,
                     'current_contribution': contribution, 'can_predict': item.assignment_id in remaining,
                     'is_quiz': raw.get('is_quiz_assignment') is True or 'online_quiz' in (raw.get('submission_types') or [])})
    result = {'course_id': data.course_id, 'course_name': data.display, 'weighted': weighted,
              'current_percent': current.percent, 'canvas_current_percent': canvas_score,
              'projection_supported': not periods, 'warnings': warnings, 'assignments': rows,
              'groups': [{'id': g.group_id, 'name': group_names[g.group_id], 'weight': g.weight,
                          'current_percent': group_grades[g.group_id].percent,
                          'drop_lowest': g.drop_lowest, 'drop_highest': g.drop_highest,
                          'never_drop': list(g.never_drop)} for g in groups], 'projection': None}
    if 'target_percent' not in payload: return result
    target = percentage(payload['target_percent'], '目标总评')
    if periods: raise ValueError('课程使用评分周期，暂不能可靠预测跨周期总评。')
    fixed = payload.get('expected_percentages', {})
    if not isinstance(fixed, dict) or len(fixed) > 500 or any(not isinstance(k, str) for k in fixed):
        raise ValueError('预计分数格式无效。')
    solve = payload.get('solve_ids', list(remaining))
    if not isinstance(solve, list) or len(solve) > 500 or any(not isinstance(i, str) for i in solve) or len(set(solve)) != len(solve):
        raise ValueError('待测算项目格式无效。')
    if set(solve) - remaining.keys() or set(fixed) - remaining.keys() or set(solve) & fixed.keys():
        raise ValueError('只能为当前未评分项目设置预计分数或选择测算，二者不能重叠。')
    if set(solve) | fixed.keys() != remaining.keys():
        raise ValueError('请为未勾选的未评分作业填写预计得分率。')
    scenario = gc.apply_hypothetical_scores(items, {i: percentage(p, '预计得分率')/100*remaining[i].points_possible for i,p in fixed.items()})
    projection = gc.required_uniform_percent(groups, scenario, weighted, target, max_percent=100)
    status = ('secured' if projection.already_secured else 'reachable' if projection.required_percent is not None else
              'indeterminate' if projection.non_monotone else 'unreachable')
    if projection.projected_at_zero is None and projection.projected_at_full is None:
        status = 'indeterminate'
        warnings.append('当前没有可计算的计分基数，无法判断目标是否可达。')
    if projection.non_monotone:
        warnings.append('同时剔除最高分与最低分时，成绩可能不随得分单调上升；结果是搜索到的可行情景，未必是唯一或最低要求。')
    result['projection'] = {'target_percent': target, 'status': status,
                            'required_percent': projection.required_percent,
                            'projected_at_zero': projection.projected_at_zero,
                            'projected_at_full': projection.projected_at_full,
                            'non_monotone': projection.non_monotone,
                            'assumed_percentages': fixed,
                            'requirements': [{'id': i, 'name': metadata[i].get('name') or '未命名作业',
                                              'points_possible': remaining[i].points_possible,
                                              'points': projection.required_percent/100*remaining[i].points_possible if projection.required_percent is not None else None}
                                             for i in projection.remaining_ids]}
    return result
