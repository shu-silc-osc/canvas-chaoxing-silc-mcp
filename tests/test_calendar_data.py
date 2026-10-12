import unittest
from datetime import datetime, timezone
import calendar_data as data


class CalendarDataTests(unittest.TestCase):
    def test_academic_year_uses_september_boundary(self):
        self.assertEqual(data.academic_year(datetime(2026, 8, 31, 18, tzinfo=timezone.utc)), 2026)
        self.assertEqual(data.academic_year(datetime(2026, 8, 30, tzinfo=timezone.utc)), 2025)
        self.assertEqual(data.year_window(2026), ('2026-09-01', '2027-08-31'))

    def test_assignment_calendar_entry_is_not_duplicated(self):
        assignments = [{'id': 42, 'course_id': 7, 'name': 'Essay', 'due_at': '2026-10-15T04:00:00Z', 'description': 'Read chapters', 'url': None}]
        raw = [{'id': 'assignment_42', 'assignment': {'id': 42}, 'context_code': 'course_7', 'title': 'Essay', 'start_at': '2026-10-15T04:00:00Z'},
               {'id': 99, 'context_code': 'course_7', 'title': 'Lecture', 'start_at': '2026-10-15T02:00:00Z', 'end_at': '2026-10-15T03:00:00Z', 'description': 'Lecture notes'}]
        result = data.merge_events(raw, assignments, [{'id': 7, 'name': 'Math', 'code': 'M7'}])
        self.assertEqual(len(result), 2)
        self.assertEqual(next(x for x in result if x['kind'] == 'assignment')['id'], 'assignment:7:42')
        self.assertEqual(next(x for x in result if x['kind'] == 'event')['course_id'], 7)

    def test_undated_assignments_do_not_invent_calendar_dates(self):
        self.assertEqual(data.merge_events([], [{'id': 1, 'course_id': 7, 'name': 'Undated', 'due_at': None}], []), [])

    def test_group_event_inherits_course_filter_and_has_stable_id(self):
        result = data.merge_events([{'id': 12, 'context_code': 'group_3', 'start_at': '2026-10-14', 'all_day': True, 'title': 'Meeting'}], [], [{'id': 7, 'name': 'Math'}], [{'id': 3, 'course_id': 7, 'name': 'Team'}])
        self.assertEqual(result[0]['id'], 'event:12')
        self.assertEqual(result[0]['course_id'], 7)
        self.assertTrue(result[0]['all_day'])

    def test_description_markup_is_not_executable(self):
        result = data.merge_events([{'id': 4, 'start_at': '2026-10-14', 'description': '<p>Read</p><script>evil()</script>'}], [], [])
        self.assertEqual(result[0]['description'], 'Read')

    def test_pretranslated_intro_is_invalidated_when_source_changes(self):
        event = {'name': 'Essay', 'description': 'Write an essay.'}
        cache = {data.translation_key('Essay\nWrite an essay.'): {'name_zh': '论文', 'description_zh': '撰写一篇论文。'}}
        self.assertEqual(data.prepare_translation(event, cache)['description_zh'], '撰写一篇论文。')
        changed = {**event, 'description': 'Write two essays.'}
        self.assertEqual(data.prepare_translation(changed, cache)['translation_status'], 'pending')
        self.assertIsNone(data.prepare_translation(changed, cache)['description_zh'])

    def test_metadata_only_description_remains_available_for_translation(self):
        self.assertIn('Weighting', data.introduction('Assessment Details\nWeighting\n1%'))

if __name__ == '__main__':
    unittest.main()
