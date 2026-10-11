"""A narrow Canvas LMS MCP adapter for one configured Instructure instance."""

from __future__ import annotations

import json
import os
import re
import sys
from datetime import datetime
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener

from mcp.server.fastmcp import FastMCP

CANVAS_HOST = "insearch.instructure.com"
DEFAULT_CANVAS_URL = f"https://{CANVAS_HOST}"
MAX_PAGES = 25
MAX_ITEMS = 2500
COURSE_FIELDS = ("id", "name", "course_code", "workflow_state", "term", "start_at", "end_at", "html_url")
ASSIGNMENT_FIELDS = ("id", "name", "description", "due_at", "points_possible", "published", "html_url")


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def validate_canvas_url(base_url: str) -> str:
    parsed = urlparse(base_url)
    if (
        parsed.scheme != "https"
        or parsed.hostname != CANVAS_HOST
        or parsed.port not in (None, 443)
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError(f"Canvas URL must use HTTPS on {CANVAS_HOST}")
    return f"https://{CANVAS_HOST}"


def validate_due_at(value: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError("due_at must be an ISO 8601 datetime with a timezone")
    normalized = value.strip()
    try:
        parsed = datetime.fromisoformat(normalized.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError("due_at must be a valid ISO 8601 datetime with a timezone") from exc
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError("due_at must include a timezone offset, such as +08:00 or Z")
    return normalized


def _positive_id(value: int, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise ValueError(f"{label} must be a positive integer")
    return value


def _project_fields(value: dict[str, Any], fields: tuple[str, ...]) -> dict[str, Any]:
    return {key: value[key] for key in fields if key in value}


def _next_link(link_header: str | None) -> str | None:
    if not link_header:
        return None
    for part in link_header.split(","):
        match = re.match(r'\s*<([^>]+)>\s*;\s*rel="?next"?(?:\s*;|\s*$)', part)
        if match:
            return match.group(1)
    return None


class CanvasClient:
    def __init__(self, token: str | None = None, base_url: str | None = None, opener=None):
        self.token = token if token is not None else os.getenv("CANVAS_API_TOKEN", "")
        configured_url = base_url if base_url is not None else os.getenv("CANVAS_API_URL", DEFAULT_CANVAS_URL)
        self.base_url = validate_canvas_url(configured_url)
        self.opener = opener or self._open_without_redirects

    @staticmethod
    def _open_without_redirects(request: Request, timeout: int):
        return build_opener(_NoRedirect()).open(request, timeout=timeout)

    def _validate_api_url(self, url: str) -> str:
        parsed = urlparse(url)
        if parsed.scheme != "https" or parsed.hostname != CANVAS_HOST or parsed.port not in (None, 443):
            raise RuntimeError("Canvas pagination returned a URL outside the configured HTTPS host")
        return url

    def _request(self, method: str, path_or_url: str, params: dict[str, Any] | None = None, payload: dict[str, Any] | None = None):
        if not self.token:
            raise RuntimeError("Canvas API token is missing; set CANVAS_API_TOKEN in the local environment")
        if path_or_url.startswith("https://"):
            url = self._validate_api_url(path_or_url)
        else:
            if not path_or_url.startswith("/api/v1/"):
                raise ValueError("Canvas API path is invalid")
            url = f"{self.base_url}{path_or_url}"
            if params:
                url = f"{url}?{urlencode(params, doseq=True)}"
        body = json.dumps(payload).encode("utf-8") if payload is not None else None
        headers = {"Authorization": f"Bearer {self.token}", "Accept": "application/json"}
        if body is not None:
            headers["Content-Type"] = "application/json"
        request = Request(url, data=body, headers=headers, method=method)
        try:
            with self.opener(request, timeout=30) as response:
                data = response.read()
                decoded = json.loads(data.decode("utf-8")) if data else None
                return decoded, response.headers
        except HTTPError as exc:
            if exc.code == 401:
                message = "Canvas authentication failed (HTTP 401)"
            elif exc.code == 403:
                message = "Canvas denied this operation (HTTP 403); check the account role and permissions"
            else:
                message = f"Canvas API request failed (HTTP {exc.code})"
            raise RuntimeError(message) from None
        except URLError as exc:
            raise RuntimeError(f"Canvas API connection failed: {exc.reason}") from None

    def _paginate(self, path: str, params: dict[str, Any]) -> list[dict[str, Any]]:
        url = f"{self.base_url}{path}?{urlencode(params, doseq=True)}"
        items: list[dict[str, Any]] = []
        for _ in range(MAX_PAGES):
            data, headers = self._request("GET", url)
            if not isinstance(data, list):
                raise RuntimeError("Canvas returned an unexpected paginated response")
            items.extend(item for item in data if isinstance(item, dict))
            if len(items) > MAX_ITEMS:
                raise RuntimeError(f"Canvas result exceeded the {MAX_ITEMS}-item safety limit")
            url = _next_link(headers.get("Link"))
            if not url:
                return items
            url = self._validate_api_url(url)
        raise RuntimeError(f"Canvas pagination exceeded the {MAX_PAGES}-page safety limit")

    @staticmethod
    def _assignment_payload(name: str | None, due_at: str | None, description: str | None, points_possible: float | None) -> dict[str, Any]:
        fields: dict[str, Any] = {}
        if name is not None:
            if not name.strip() or len(name.strip()) > 255:
                raise ValueError("name must contain 1 to 255 characters")
            fields["name"] = name.strip()
        if due_at is not None:
            fields["due_at"] = validate_due_at(due_at)
        if description is not None:
            fields["description"] = description
        if points_possible is not None:
            if isinstance(points_possible, bool) or points_possible < 0:
                raise ValueError("points_possible must be a non-negative number")
            fields["points_possible"] = points_possible
        return fields

    def list_courses(self) -> list[dict[str, Any]]:
        courses = self._paginate("/api/v1/courses", {"enrollment_state": "active", "include[]": "term", "per_page": 100})
        return [_project_fields(course, COURSE_FIELDS) for course in courses]

    def get_course_details(self, course_id: int) -> dict[str, Any]:
        course_id = _positive_id(course_id, "course_id")
        data, _ = self._request("GET", f"/api/v1/courses/{course_id}")
        if not isinstance(data, dict):
            raise RuntimeError("Canvas returned an unexpected course response")
        return _project_fields(data, COURSE_FIELDS)

    def list_assignments(self, course_id: int) -> list[dict[str, Any]]:
        course_id = _positive_id(course_id, "course_id")
        assignments = self._paginate(f"/api/v1/courses/{course_id}/assignments", {"per_page": 100})
        return [_project_fields(assignment, ASSIGNMENT_FIELDS) for assignment in assignments]

    def create_assignment(self, course_id: int, name: str, due_at: str, description: str | None = None, points_possible: float | None = None) -> dict[str, Any]:
        course_id = _positive_id(course_id, "course_id")
        fields = self._assignment_payload(name, due_at, description, points_possible)
        fields["published"] = False
        data, _ = self._request("POST", f"/api/v1/courses/{course_id}/assignments", payload={"assignment": fields})
        if not isinstance(data, dict):
            raise RuntimeError("Canvas returned an unexpected assignment response")
        return _project_fields(data, ASSIGNMENT_FIELDS)

    def update_assignment(self, course_id: int, assignment_id: int, name: str | None = None, due_at: str | None = None, description: str | None = None, points_possible: float | None = None) -> dict[str, Any]:
        course_id = _positive_id(course_id, "course_id")
        assignment_id = _positive_id(assignment_id, "assignment_id")
        fields = self._assignment_payload(name, due_at, description, points_possible)
        if not fields:
            raise ValueError("Provide at least one field to update")
        data, _ = self._request(
            "PUT",
            f"/api/v1/courses/{course_id}/assignments/{assignment_id}",
            payload={"assignment": fields},
        )
        if not isinstance(data, dict):
            raise RuntimeError("Canvas returned an unexpected assignment response")
        return _project_fields(data, ASSIGNMENT_FIELDS)


mcp = FastMCP("canvas-insearch")
_client = CanvasClient()


@mcp.tool()
def list_courses() -> list[dict[str, Any]]:
    """List active Canvas courses available to the authenticated account."""
    return _client.list_courses()


@mcp.tool()
def get_course_details(course_id: int) -> dict[str, Any]:
    """Get basic details for one Canvas course by course ID."""
    return _client.get_course_details(course_id)


@mcp.tool()
def list_assignments(course_id: int) -> list[dict[str, Any]]:
    """List assignments and due dates for one Canvas course."""
    return _client.list_assignments(course_id)


@mcp.tool()
def create_assignment(course_id: int, name: str, due_at: str, description: str | None = None, points_possible: float | None = None) -> dict[str, Any]:
    """Create an unpublished assignment with a timezone-qualified due date."""
    return _client.create_assignment(course_id, name, due_at, description, points_possible)


@mcp.tool()
def update_assignment(course_id: int, assignment_id: int, name: str | None = None, due_at: str | None = None, description: str | None = None, points_possible: float | None = None) -> dict[str, Any]:
    """Update only the provided name, due date, description, or points for an assignment."""
    return _client.update_assignment(course_id, assignment_id, name, due_at, description, points_possible)


def main() -> None:
    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
